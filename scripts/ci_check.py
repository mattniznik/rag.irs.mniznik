"""The CI gate. Fails the build when retrieval or answer quality drops below eval/thresholds.json.

Usage:  python scripts/ci_check.py            (expects data/ built by build_index.py and the vectors)

1. Validates the eval set against the current passages.
2. Measures retrieval (keyword and hybrid) and compares evidence@5 with the thresholds.
3. Re-verifies and re-grades the recorded answers in eval/recorded/*.jsonl against the current
   passages, without calling any model: a change to ingestion, the citation check or the grader that
   breaks a previously verified answer, or lets a wrong one through, fails here.
Prints one line per check and exits 1 if any fails.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import answer, evaluation, grading, ingest, retrieval  # noqa: E402


def main() -> int:
    thresholds = json.loads((ROOT / "eval" / "thresholds.json").read_text(encoding="utf-8"))
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    by_id = {p.id: p for p in passages}
    questions = evaluation.load(ROOT / "eval" / "questions.jsonl")
    qmap = {q["id"]: q for q in questions}
    failures: list[str] = []

    problems = evaluation.validate(questions, passages)
    print(f"eval set: {len(questions)} questions, {len(problems)} validation problems")
    failures += [f"validation: {p}" for p in problems]

    answerable = [q for q in questions if q["type"] in evaluation.ANSWERABLE]
    r = retrieval.Retriever(ROOT / "data")
    for method, floor in thresholds["retrieval_evidence_at_5"].items():
        score = sum(evaluation.evidence_at_k(q, r.search(method, q["question"], 5), 5) for q in answerable) / len(answerable)
        ok = score >= floor
        print(f"retrieval {method:8} evidence@5 {score:.3f} (floor {floor:.3f}) {'ok' if ok else 'FAIL'}")
        if not ok:
            failures.append(f"retrieval {method} evidence@5 {score:.3f} < {floor:.3f}")

    for path in sorted((ROOT / "eval" / "recorded").glob("*.jsonl")):
        floors = thresholds["recorded"][path.stem]
        rows = [json.loads(line) for line in path.open(encoding="utf-8") if line.strip()]
        grades, missing = [], 0
        for row in rows:
            hits = []
            for pid in row["retrieved"]:
                p = by_id.get(pid)
                if p is None:
                    missing += 1
                    continue
                hits.append({"id": p.id, "doc": p.doc, "year": p.year, "page": p.page, "section": p.section,
                             "kind": p.kind, "text": p.text})
            verdict = answer.verify(answer.parse(row["raw"]), hits)
            grades.append((qmap[row["id"]]["type"], grading.grade(qmap[row["id"]], verdict, row["raw"])))
        ans = [g for t, g in grades if t in evaluation.ANSWERABLE]
        correct, wrong = ans.count("correct"), ans.count("wrong")
        accuracy = correct / len(ans)
        precision = correct / (correct + wrong) if correct + wrong else 1.0
        checks = [("accuracy", accuracy, floors["accuracy"]), ("precision_when_shown", precision, floors["precision_when_shown"])]
        for name, value, floor in checks:
            ok = value >= floor
            print(f"recorded {path.stem}: {name} {value:.3f} (floor {floor:.3f}) {'ok' if ok else 'FAIL'}")
            if not ok:
                failures.append(f"recorded {path.stem} {name} {value:.3f} < {floor:.3f}")
        if missing:
            print(f"recorded {path.stem}: {missing} retrieved passage ids no longer exist (ingestion changed)")

    print("PASS" if not failures else "FAIL:\n  " + "\n  ".join(failures))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
