"""Compare retrieval methods on the eval set: keyword, vector (with and without the BGE query
instruction), hybrid (reciprocal rank fusion) and hybrid + rerank.

Usage:  python scripts/compare_retrieval.py [--questions eval/questions.jsonl]

Validates the questions first. Writes docs/results/retrieval-comparison.json (per question, per
method) and prints the table: strict recall and evidence at k = 1, 5, plus median latency per query.
"""
from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import evaluation, ingest, retrieval  # noqa: E402

KS = (1, 5, 10)


def main() -> int:
    qpath = Path(sys.argv[sys.argv.index("--questions") + 1]) if "--questions" in sys.argv else ROOT / "eval" / "questions.jsonl"
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    questions = evaluation.load(qpath)
    problems = evaluation.validate(questions, passages)
    if problems:
        print("eval set failed validation:\n" + "\n".join(f"  {p}" for p in problems))
        return 1
    answerable = [q for q in questions if q["type"] in evaluation.ANSWERABLE]
    r = retrieval.Retriever(ROOT / "data")
    r.search("hybrid_rerank", "warm up the models", 5)  # load models outside the timings
    results: dict = {"questions": len(questions), "answerable": len(answerable), "methods": {}}
    for method in retrieval.METHODS:
        rows, ms = [], []
        for q in answerable:
            t0 = time.perf_counter()
            hits = r.search(method, q["question"], max(KS))
            ms.append((time.perf_counter() - t0) * 1000)
            row = {"id": q["id"], "type": q["type"], "top5": [f"{h['doc']} p{h['page']}" for h in hits[:5]]}
            for k in KS:
                row[f"recall@{k}"] = evaluation.recall_at_k(q["gold"], hits, k)
                row[f"evidence@{k}"] = evaluation.evidence_at_k(q, hits, k)
            rows.append(row)
        types = sorted({x["type"] for x in rows})
        results["methods"][method] = {
            "overall": evaluation.summarize(rows, KS),
            "by_type": {t: evaluation.summarize([x for x in rows if x["type"] == t], KS) for t in types},
            "median_ms": round(statistics.median(ms), 1),
            "rows": rows,
        }
    out = ROOT / "docs" / "results" / "retrieval-comparison.json"
    out.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"validated {len(questions)} questions; n = {len(answerable)} answerable\n")
    print(f"{'method':15} {'strict@1':>9} {'strict@5':>9} {'evid@1':>7} {'evid@5':>7} {'evid@10':>8} {'ms/query':>9}")
    for method, m in results["methods"].items():
        o = m["overall"]
        print(f"{method:15} {o['recall@1']:9.3f} {o['recall@5']:9.3f} {o['evidence@1']:7.3f} {o['evidence@5']:7.3f} "
              f"{o['evidence@10']:8.3f} {m['median_ms']:9.1f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
