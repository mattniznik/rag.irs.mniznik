"""Run the whole eval set on a Claude model through the Message Batches API (50% of standard price).

Usage:
  python scripts/run_claude_batch.py submit --model claude-haiku-5-5 [--retrieval hybrid] [--k 8]
  python scripts/run_claude_batch.py collect --batch <batch id>

`submit` retrieves passages for every question, writes the exact prompts to data/batches/<batch>.json
(so collect can verify against the same passages), and submits one request per question with the
question id as custom_id. `collect` waits for the batch to end, then verifies citations, grades,
prices every answer at batch rates and writes data/runs/<run>.jsonl and docs/results/answers-<run>.json
like run_answers.py.
Needs ANTHROPIC_API_KEY, in the environment or in the gitignored .env at the project root. Spends money: check the estimate it prints.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from cite_or_abstain import answer, evaluation, grading, ingest, models, retrieval  # noqa: E402
from run_answers import arg, summarize  # noqa: E402


def submit() -> int:
    import anthropic
    from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
    from anthropic.types.messages.batch_create_params import Request

    model, method, k = arg("--model", "claude-haiku-5-5"), arg("--retrieval", "hybrid"), int(arg("--k", "8"))
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    questions = evaluation.load(ROOT / "eval" / "questions.jsonl")
    problems = evaluation.validate(questions, passages)
    if problems:
        print("eval set failed validation:\n" + "\n".join(f"  {p}" for p in problems))
        return 1
    r = retrieval.Retriever(ROOT / "data")
    items, requests = [], []
    for q in questions:
        hits = r.search(method, q["question"], k)
        params = models.request_params(model, answer.SYSTEM, answer.user_message(q["question"], hits))
        items.append({"question": q, "hits": [{key: h[key] for key in ("id", "doc", "year", "page", "section", "kind", "text", "score")} for h in hits]})
        requests.append(Request(custom_id=q["id"], params=MessageCreateParamsNonStreaming(**params)))
    approx_in = sum(len(json.dumps(x["hits"])) for x in items) / 4  # rough: ~4 characters per token
    print(f"{len(requests)} requests; rough input {approx_in:,.0f} tokens -> about "
          f"${models.cost_usd(model, int(approx_in), 300 * len(requests), batch=True):.2f} at batch prices (estimate)")
    models.load_env_file()
    batch = anthropic.Anthropic().messages.batches.create(requests=requests)
    out = ROOT / "data" / "batches"
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{batch.id}.json").write_text(json.dumps({"model": model, "retrieval": method, "k": k, "prompt": answer.PROMPT_VERSION, "items": items},
                                                     ensure_ascii=False), encoding="utf-8")
    print(f"submitted batch {batch.id} ({batch.processing_status}); collect with: --batch {batch.id}")
    return 0


def collect() -> int:
    import anthropic

    batch_id = arg("--batch")
    saved = json.loads((ROOT / "data" / "batches" / f"{batch_id}.json").read_text(encoding="utf-8"))
    models.load_env_file()
    client = anthropic.Anthropic()
    while (b := client.messages.batches.retrieve(batch_id)).processing_status != "ended":
        print(f"{b.processing_status}: {b.request_counts.processing} processing")
        time.sleep(60)
    model = saved["model"]
    by_id = {it["question"]["id"]: it for it in saved["items"]}
    run = f"anthropic-{model}_{saved['retrieval']}_k{saved['k']}_prompt-{saved['prompt']}_batch"
    (ROOT / "data" / "runs").mkdir(parents=True, exist_ok=True)
    trace = (ROOT / "data" / "runs" / f"{run}.jsonl").open("w", encoding="utf-8")  # same shape as run_answers.py
    rows = []
    for res in client.messages.batches.results(batch_id):
        it = by_id[res.custom_id]
        q, hits = it["question"], it["hits"]
        if res.result.type != "succeeded":
            raw, tin, tout, stop = "", 0, 0, res.result.type
        else:
            msg = res.result.message
            stop = msg.stop_reason
            raw = "" if stop == "refusal" else next((x.text for x in msg.content if x.type == "text"), "")
            tin, tout = msg.usage.input_tokens, msg.usage.output_tokens
        verdict = answer.verify(answer.parse(raw), hits)
        row = {"id": q["id"], "type": q["type"], "grade": grading.grade(q, verdict, raw), "status": verdict.status,
               "problems": verdict.problems, "citations_total": verdict.citations_total,
               "citations_valid": verdict.citations_valid, "input_tokens": tin, "output_tokens": tout,
               "model_seconds": 0.0, "retrieval_seconds": 0.0, "stop_reason": stop,
               "cost_usd": models.cost_usd(model, tin, tout, batch=True)}
        if q["type"] in evaluation.ANSWERABLE:
            row["evidence_in_context"] = evaluation.evidence_at_k(q, hits, saved["k"])
        rows.append(row)
        trace.write(json.dumps(dict(row, question=q["question"], answer=verdict.answer, citations=verdict.citations,
                                    raw=raw, retrieved=[{"id": h["id"], "score": h["score"]} for h in hits]),
                               ensure_ascii=False) + "\n")
    trace.close()
    summary = summarize(rows)
    summary.update({"run": run, "model": f"anthropic:{model}", "retrieval": saved["retrieval"], "k": saved["k"],
                    "batch_id": batch_id, "note": "latency not measured in batch mode"})
    (ROOT / "docs" / "results" / f"answers-{run}.json").write_text(json.dumps(dict(summary, rows=rows), indent=2) + "\n",
                                                                  encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit({"submit": submit, "collect": collect}[sys.argv[1]]())
