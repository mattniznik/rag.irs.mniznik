"""Measure retrieval on the eval set: does the right page come back in the top k?

Usage:  python scripts/eval_retrieval.py [--method keyword]

Validates every question against the passages first and stops if any fails. Writes
docs/results/retrieval-<method>.json with per-question hits and recall@1/5/10 overall and by type.
Not-found and attack questions have no gold page, so they are not part of recall.
"""
from __future__ import annotations

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import evaluation, ingest, keyword_index  # noqa: E402

KS = (1, 5, 10)


def main() -> int:
    method = sys.argv[sys.argv.index("--method") + 1] if "--method" in sys.argv else "keyword"
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    questions = evaluation.load(ROOT / "eval" / "questions.jsonl")
    problems = evaluation.validate(questions, passages)
    if problems:
        print("eval set failed validation:")
        print("\n".join(f"  {p}" for p in problems))
        return 1
    con = sqlite3.connect(ROOT / "data" / "keyword.sqlite")
    rows = []
    for q in questions:
        if q["type"] not in evaluation.ANSWERABLE:
            continue
        hits = keyword_index.search(con, q["question"], k=max(KS))
        row = {"id": q["id"], "type": q["type"], "gold": q["gold"],
               "top5": [f"{h['doc']} p{h['page']}" for h in hits[:5]]}
        for k in KS:
            row[f"recall@{k}"] = evaluation.recall_at_k(q["gold"], hits, k)
            row[f"evidence@{k}"] = evaluation.evidence_at_k(q, hits, k)
        rows.append(row)
    types = sorted({r["type"] for r in rows})
    result = {"method": method, "questions_validated": len(questions),
              "overall": evaluation.summarize(rows, KS),
              "by_type": {t: evaluation.summarize([r for r in rows if r["type"] == t], KS) for t in types},
              "rows": rows}
    (ROOT / "docs" / "results" / f"retrieval-{method}.json").write_text(json.dumps(result, indent=2) + "\n",
                                                                      encoding="utf-8")
    print(f"validated {len(questions)} questions; scored {len(rows)} answerable")
    print("overall:", json.dumps(result["overall"]))
    for t in types:
        print(f"  {t:12}", json.dumps(result["by_type"][t]))
    misses = [r for r in rows if r["evidence@5"] < 1.0]
    print(f"evidence not fully in top 5: {len(misses)}")
    for r in misses:
        print(f"  {r['id']} gold={[g['doc'] + ' p' + str(g['page']) for g in r['gold']]} top5={r['top5']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
