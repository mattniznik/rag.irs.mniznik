"""Answer every eval question end to end, verify citations, grade, and record a trace per question.

Usage:  python scripts/run_answers.py --model ollama:qwen2.5:7b [--retrieval hybrid] [--k 8]
                                      [--questions eval/questions.jsonl] [--limit N] [--tag rerun]

Writes data/runs/<run>.jsonl (one trace per question: retrieved passages with scores, the raw reply,
the verdict, the grade, tokens, latency) and docs/results/answers-<run>.json (the summary).
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import answer, evaluation, grading, ingest, retrieval  # noqa: E402
from cite_or_abstain.models import AnthropicClient, OllamaClient  # noqa: E402


def arg(name: str, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def client_for(spec: str):
    provider, _, model = spec.partition(":")
    if provider == "ollama":
        return OllamaClient(model)
    if provider == "anthropic":
        return AnthropicClient(model)
    raise SystemExit(f"unknown model provider in {spec!r}")


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))] if s else 0.0


def main() -> int:
    spec = arg("--model", "ollama:qwen2.5:7b")
    method = arg("--retrieval", "hybrid")
    k = int(arg("--k", "8"))
    qpath = Path(arg("--questions", str(ROOT / "eval" / "questions.jsonl")))
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    questions = evaluation.load(qpath)
    problems = evaluation.validate(questions, passages)
    if problems:
        print("eval set failed validation:\n" + "\n".join(f"  {p}" for p in problems))
        return 1
    if arg("--limit"):
        questions = questions[: int(arg("--limit"))]
    client = client_for(spec)
    r = retrieval.Retriever(ROOT / "data")
    run = f"{spec.replace(':', '-').replace('/', '-')}_{method}_k{k}_prompt-{answer.PROMPT_VERSION}"
    if arg("--tag"):  # a repeat of the same configuration, e.g. to measure run-to-run noise
        run += f"_{arg('--tag')}"
    (ROOT / "data" / "runs").mkdir(parents=True, exist_ok=True)
    trace_path = ROOT / "data" / "runs" / f"{run}.jsonl"
    rows = []
    with trace_path.open("w", encoding="utf-8") as trace:
        for i, q in enumerate(questions, 1):
            t0 = time.perf_counter()
            hits = r.search(method, q["question"], k)
            t_retrieve = time.perf_counter() - t0
            verdict, reply = answer.answer_question(client, q["question"], hits)
            result = grading.grade(q, verdict, reply.text)
            row = {"id": q["id"], "type": q["type"], "grade": result, "status": verdict.status,
                   "problems": verdict.problems, "citations_total": verdict.citations_total,
                   "citations_valid": verdict.citations_valid, "input_tokens": reply.input_tokens,
                   "output_tokens": reply.output_tokens, "model_seconds": round(reply.seconds, 2),
                   "retrieval_seconds": round(t_retrieve, 3), "cost_usd": reply.extra.get("cost_usd", 0.0),
                   "stop_reason": reply.extra.get("stop_reason", "")}
            if q["type"] in evaluation.ANSWERABLE:
                row["evidence_in_context"] = evaluation.evidence_at_k(q, hits, k)
            rows.append(row)
            trace.write(json.dumps(dict(row, question=q["question"], answer=verdict.answer,
                                        citations=verdict.citations, raw=reply.text,
                                        retrieved=[{"id": h["id"], "score": round(h["score"], 4)} for h in hits]),
                                   ensure_ascii=False) + "\n")
            print(f"[{i:3}/{len(questions)}] {q['id']:4} {q['type']:11} {result:9} {verdict.status:10} "
                  f"{reply.seconds:5.1f}s {'; '.join(verdict.problems)[:70]}")
    summary = summarize(rows)
    summary.update({"run": run, "model": spec, "retrieval": method, "k": k, "questions_file": qpath.name})
    out = ROOT / "docs" / "results" / f"answers-{run}.json"
    out.write_text(json.dumps(dict(summary, rows=rows), indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


def summarize(rows: list[dict]) -> dict:
    ans = [r for r in rows if r["type"] in evaluation.ANSWERABLE]
    c = Counter(r["grade"] for r in ans)
    shown = c["correct"] + c["wrong"]
    nf = [r for r in rows if r["type"] == "not_found"]
    atk = [r for r in rows if r["type"] == "attack"]
    secs = [r["model_seconds"] for r in rows]
    cites_total = sum(r["citations_total"] for r in rows)
    out = {
        "n": len(rows),
        "answerable": {"n": len(ans), "correct": c["correct"], "wrong": c["wrong"], "abstained": c["abstained"],
                       "accuracy": round(c["correct"] / len(ans), 3) if ans else None,
                       "precision_when_shown": round(c["correct"] / shown, 3) if shown else None,
                       "evidence_in_context": round(sum(r["evidence_in_context"] for r in ans) / len(ans), 3) if ans else None},
        "not_found": {"n": len(nf), "correctly_abstained": sum(1 for r in nf if r["grade"] == "correct")},
        "attack": {"n": len(atk), "held": sum(1 for r in atk if r["grade"] == "correct")},
        "citations": {"total": cites_total, "valid": sum(r["citations_valid"] for r in rows),
                      "valid_rate": round(sum(r["citations_valid"] for r in rows) / cites_total, 3) if cites_total else None},
        "unverified_answers": sum(1 for r in rows if r["status"] == "unverified"),
        "refusals": sum(1 for r in rows if r.get("stop_reason") == "refusal"),
        "cost_usd": {"total": round(sum(r.get("cost_usd", 0.0) for r in rows), 5),
                     "per_question": round(sum(r.get("cost_usd", 0.0) for r in rows) / len(rows), 6)},
        "latency_s": {"p50": round(statistics.median(secs), 2), "p95": round(pct(secs, 0.95), 2)},
        "tokens_mean": {"input": round(statistics.mean(r["input_tokens"] for r in rows)),
                        "output": round(statistics.mean(r["output_tokens"] for r in rows))},
        "by_type": {t: dict(Counter(r["grade"] for r in rows if r["type"] == t)) for t in sorted({r["type"] for r in rows})},
    }
    return out


if __name__ == "__main__":
    raise SystemExit(main())
