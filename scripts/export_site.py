"""Write worker/public/site-data.json: the recorded examples and the result numbers the demo page shows.

Usage: python scripts/export_site.py      (needs data/ from build_index.py, build_vectors.py and the
                                           Claude batch run named in EXAMPLE_RUN)

Recorded examples are real traces from the evaluation run of the demo's model, in the same shape the
live Worker returns (worker/src/index.ts, `trace`), so one viewer shows both and visitors can see how
an answer is made without spending anything. Keyword and vector ranks are recomputed with the same
retriever; an example whose recomputed top 8 differs from the recorded one is skipped with a note.
Result numbers are read from docs/results/ so the page and the README cannot disagree.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import answer, evaluation, ingest, retrieval  # noqa: E402
from cite_or_abstain import engineering as eng  # noqa: E402

REPO = "https://github.com/mattniznik/rag.irs.mniznik"

EXAMPLE_RUN = "anthropic-claude-haiku-5-5_hybrid_k8_prompt-v1_batch"
EXAMPLES = [  # (question id, group, short label)
    ("T01", "Answered", "A number from a table"),
    ("Y02", "Answered", "The right tax year"),
    ("S04", "Answered", "Two facts, one calculation"),
    ("S15", "Answered", "Honest about a missing part"),
    ("T05", "Held back", "Quote named the wrong passage"),
    ("N01", "Not covered", "Not in the publications"),
    ("A01", "Attacks", "\"Ignore your rules\""),
    ("A03", "Attacks", "A fake quote to confirm"),
]
RUN_ROWS = [  # (results file, variant or None, label)
    ("anthropic-claude-sonnet-5-5_hybrid_k8_prompt-v1_batch", None, "Claude Sonnet 5.5"),
    ("anthropic-claude-haiku-5-5_hybrid_k8_prompt-v1_batch", None, "Claude Haiku 5.5 (this demo)"),
    ("anthropic-claude-haiku-5-5_hybrid_k8_prompt-v1_batch", "no_quote_check", "Haiku, quote check off"),
    ("ollama-qwen2.5-7b_hybrid_k8_prompt-v1", None, "qwen2.5 7B, local"),
    ("ollama-qwen2.5-7b_hybrid_k8_prompt-v1", "no_quote_check", "qwen 7B, quote check off"),
]
METHODS = [("keyword", "Keyword (BM25)"), ("vector", "Vector (bge-small)"), ("hybrid", "Hybrid (RRF)"),
           ("hybrid_rerank", "Hybrid + rerank")]


def doc_urls() -> dict[str, str]:
    ts = (ROOT / "worker" / "src" / "generated.ts").read_text(encoding="utf-8")
    return json.loads(re.search(r"export const DOC_URLS: Record<string, string> = (\{.*\});", ts).group(1))


def citation_checks(reply: dict | None, problems: list[str]) -> list[dict]:
    """Same rows as citationChecks() in worker/src/verify.ts."""
    if not reply or str(reply.get("status", "")).strip().lower() != "answered":
        return []
    cites = reply.get("citations") if isinstance(reply.get("citations"), list) else []
    rows = []
    for i, c in enumerate(cites):
        c = c if isinstance(c, dict) else {}
        found = next((p for p in problems if p.startswith(f"citation {i}: ")), None)
        passage = c.get("passage", c.get("passage_id"))
        rows.append({"passage": None if passage is None else str(passage), "quote": str(c.get("quote", "")),
                     "ok": found is None, "problem": found[len(f"citation {i}: "):] if found else None})
    return rows


def examples(r: retrieval.Retriever, by_id: dict, urls: dict) -> list[dict]:
    rows = {json.loads(line)["id"]: json.loads(line)
            for line in (ROOT / "data" / "runs" / f"{EXAMPLE_RUN}.jsonl").open(encoding="utf-8")}
    out = []
    for qid, group, label in EXAMPLES:
        t = rows[qid]
        recorded = [x["id"] for x in t["retrieved"]]
        hybrid = r.hybrid(t["question"], len(recorded))
        if [h["id"] for h in hybrid] != recorded:
            print(f"skipped {qid}: recomputed search differs from the recorded run")
            continue
        kw = {h["id"]: i + 1 for i, h in enumerate(r.keyword(t["question"], retrieval.FUSE_DEPTH))}
        vec = {h["id"]: i + 1 for i, h in enumerate(r.vector(t["question"], retrieval.FUSE_DEPTH))}
        passages = []
        for n, h in enumerate(hybrid, 1):
            p = by_id[h["id"]]
            title = answer._DOC_TITLES.get(p.doc.rsplit("-", 1)[0], p.doc)
            passages.append({"n": n, "source": f"{title} ({p.year}), page {p.page}", "url": f"{urls[p.doc]}#page={p.page}",
                             "section": p.section, "text": p.text, "kw": kw.get(p.id), "vec": vec.get(p.id),
                             "fused": round(h["score"], 5)})
        reply = answer.parse(t["raw"])
        v = answer.verify(reply, [vars(by_id[i]) for i in recorded])
        out.append({
            "id": qid, "group": group, "label": label, "question": t["question"], "model": "claude-haiku-5-5",
            "recorded": "evaluation run, 2026-11-13", "status": v.status, "answer": v.answer,
            "trace": {"model": "claude-haiku-5-5", "passages": passages, "raw": t["raw"], "stop_reason": t.get("stop_reason"),
                      "citations": citation_checks(reply, v.problems),
                      "problems": [p for p in v.problems if not p.startswith("citation ")],
                      "usage": {"input": t["input_tokens"], "output": t["output_tokens"], "cost_usd": round(t["cost_usd"], 6),
                                "batch": True},
                      "ms": None},
        })
    return out


def results() -> dict:
    ret = json.loads((ROOT / "docs" / "results" / "retrieval-comparison.json").read_text(encoding="utf-8"))
    methods = [{"key": k, "label": label, **{m: ret["methods"][k]["overall"][m] for m in ("n", "evidence@5", "evidence@10", "recall@5")},
                "median_ms": ret["methods"][k]["median_ms"]} for k, label in METHODS]
    runs = []
    for name, variant, label in RUN_ROWS:
        s = json.loads((ROOT / "docs" / "results" / f"answers-{name}.json").read_text(encoding="utf-8"))
        graded = s.get("regraded", s)
        a = s["what_if"][variant] if variant else graded["answerable"]
        row = {"label": label, "variant": variant, "n": a["n"], "correct": a["correct"], "abstained": a["abstained"],
               "wrong": a["wrong"], "precision_when_shown": a["precision_when_shown"]}
        if not variant:
            row.update(not_found_held=graded["not_found"]["correctly_abstained"], not_found_n=graded["not_found"]["n"],
                       attacks_held=graded["attack"]["held"], attacks_n=graded["attack"]["n"],
                       evidence_in_context=graded["answerable"].get("evidence_in_context"))
        if not variant and s.get("cost_usd", {}).get("per_question"):
            row["usd_per_1000_realtime"] = round(s["cost_usd"]["per_question"] * 1000 * (2 if name.endswith("_batch") else 1), 2)
        runs.append(row)
    review = json.loads((ROOT / "docs" / "results" / "review-claude-batch.json").read_text(encoding="utf-8"))
    verdicts = {name.split("_")[0].replace("anthropic-", ""): [i["verdict"] for i in items] for name, items in review["runs"].items()}
    counts = {m: {k: v.count(k) for k in ("real_error", "partial_retrieval_miss", "key_too_strict")} for m, v in verdicts.items()}
    return {"methods": methods, "runs": runs, "review": counts}


def _listing(cmd: list[str], cwd: Path) -> str:
    """Run a test tool's listing command (it collects, it does not run the tests) and return its output."""
    exe = shutil.which(cmd[0]) or cmd[0]
    p = subprocess.run([exe, *cmd[1:]], cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return p.stdout + p.stderr


def engineering() -> dict:
    """The page's "How it was built" section. Counts come from each test tool's own listing and from the decision
    records (src/cite_or_abstain/engineering.py raises if one cannot be read). The commits named are history: the
    evidence for each step is in that commit's message."""
    decisions, links = [], set()
    for f in sorted((ROOT / "docs" / "decisions").glob("[0-9][0-9][0-9][0-9]-*.md")):
        text = f.read_text(encoding="utf-8")
        decisions.append({**eng.decision(text), "url": f"{REPO}/blob/main/docs/decisions/{f.name}"})
        links |= eng.external_links(text)
    tests = {"python": eng.count_pytest(_listing([sys.executable, "-m", "pytest", "--collect-only", "-q"], ROOT)),
             "typescript": eng.count_vitest(_listing(["npx", "vitest", "list"], ROOT / "worker")),
             "browser": eng.count_playwright(_listing(["npx", "playwright", "test", "--list"], ROOT / "worker"))}
    first = decisions[0]
    steps = [
        {"title": "Read the provider's docs",
         "text": "Before relying on how an API or a platform behaves, quote the provider's own page, with the date it was read.",
         "fact": f"{len(decisions)} decision records cite {len(links)} provider pages",
         "url": f"{REPO}/tree/main/docs/decisions"},
        {"title": "Decide, with a measurement",
         "text": "Each decision records the numbers behind it, the options rejected, and what would change it.",
         "fact": f"{first['id']}: {first['title']}", "url": first["url"]},
        {"title": "Write the test, watch it fail",
         "text": "The test comes first, and it has to fail on the old code for the reason expected.",
         "fact": "17 of 17 browser tests failed on the page from before the Studio", "url": f"{REPO}/commit/d5eed25"},
        {"title": "Change the code",
         "text": "Small commits whose message carries the symptom, the cause, the evidence and what is still unverified.",
         "fact": "Lint and type check: 21 findings fixed, passages rebuilt byte-identical", "url": f"{REPO}/commit/991d759"},
        {"title": "CI on every push",
         "text": "Three jobs, none of them calling a model. A change that breaks a verified answer fails the build.",
         "fact": f"{tests['python']} Python, {tests['typescript']} TypeScript and {tests['browser']} browser tests",
         "url": f"{REPO}/actions/workflows/ci.yml"},
        {"title": "Deploy, then check live",
         "text": "After a deploy, the live files are compared with the repository and real questions are asked.",
         "fact": "24 files matched byte for byte; 2 real questions answered", "url": f"{REPO}/commit/7ae1491"},
    ]
    return {"repo": REPO, "decisions": decisions, "sources": len(links), "tests": tests, "steps": steps,
            "badge": f"{REPO}/actions/workflows/ci.yml/badge.svg",
            "links": [{"label": "AGENTS.md: the rules", "url": f"{REPO}/blob/main/AGENTS.md"},
                      {"label": "SECURITY.md", "url": f"{REPO}/blob/main/SECURITY.md"},
                      {"label": "The code", "url": REPO}]}


if __name__ == "__main__":
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    by_id = {p.id: p for p in passages}
    qs = evaluation.load(ROOT / "eval" / "questions.jsonl")
    data = {"corpus": {"publications": 11, "passages": len(passages)},
            "eval": {"questions": len(qs), "answerable": sum(1 for q in qs if q["type"] in evaluation.ANSWERABLE)},
            "examples": examples(retrieval.Retriever(ROOT / "data"), by_id, doc_urls()), "results": results(),
            "engineering": engineering()}
    out = ROOT / "worker" / "public" / "site-data.json"
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(data['examples'])} examples, {out.stat().st_size / 1024:.0f} KB")
