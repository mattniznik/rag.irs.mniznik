"""Re-verify and re-grade a recorded run against the current passages, grader and eval set, without
calling any model. Usage: python scripts/regrade.py data/runs/<run>.jsonl [--write] [--record]

--write adds the result as a "regraded" block to docs/results/answers-<run>.json, next to the
numbers the run itself recorded, so both stay visible.
--record copies the run's raw replies and retrieved passage ids to eval/recorded/<run>.jsonl, where
scripts/ci_check.py re-grades them on every build. Its floors go in eval/thresholds.json by hand."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from cite_or_abstain import answer, evaluation, grading, ingest  # noqa: E402
from run_answers import summarize  # noqa: E402

if __name__ == "__main__":
    trace = Path(next(a for a in sys.argv[1:] if not a.startswith("--")))
    by_id = {p.id: p for p in ingest.read_jsonl(ROOT / "data" / "passages.jsonl")}
    qs = {q["id"]: q for q in evaluation.load(ROOT / "eval" / "questions.jsonl")}
    rows = []
    for line in trace.open(encoding="utf-8"):
        t = json.loads(line)
        hits = [vars(by_id[r["id"]]) for r in t["retrieved"] if r["id"] in by_id]
        v = answer.verify(answer.parse(t["raw"]), hits)
        rows.append(dict(t, grade=grading.grade(qs[t["id"]], v, t["raw"]), status=v.status, problems=v.problems))
    regraded = {k: v for k, v in summarize(rows).items() if k in ("answerable", "not_found", "attack", "by_type")}
    print(json.dumps(regraded, indent=1))
    if "--write" in sys.argv:
        out = ROOT / "docs" / "results" / f"answers-{trace.stem}.json"
        summary = json.loads(out.read_text(encoding="utf-8"))
        summary["regraded"] = dict(regraded, note="re-verified and re-graded offline with the current "
                                   "grader and eval set (accepted wordings); the top-level numbers are as recorded")
        out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"wrote the regraded block into {out.relative_to(ROOT)}")
    if "--record" in sys.argv:
        rec = ROOT / "eval" / "recorded" / f"{trace.stem}.jsonl"
        rec.parent.mkdir(exist_ok=True)
        with rec.open("w", encoding="utf-8", newline="\n") as f:
            for row in rows:
                f.write(json.dumps({"id": row["id"], "retrieved": [r["id"] for r in row["retrieved"]],
                                    "raw": row["raw"]}, ensure_ascii=False) + "\n")
        print(f"recorded {len(rows)} replies in {rec.relative_to(ROOT)}")
