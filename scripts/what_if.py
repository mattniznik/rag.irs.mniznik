"""What-if experiments on a recorded run, offline (no model calls).

Usage: python scripts/what_if.py data/runs/<run>.jsonl [--write]

--write stores the results as a "what_if" block in docs/results/answers-<run>.json.

1. No quote check: show every reply the model marked "answered", with the quotes it claimed, and
   grade that. Compared with the real pipeline, this is what the citation check buys and costs.
2. Number rule (considered and rejected): also hide an answer that states a number none of its
   verified quotes contains, in two variants: any such number, and ignoring numbers the question
   itself gives. The rule is only worth having if it hides mostly wrong answers.
3. Re-attribution: a quote that is not in the passage it names but is word for word in another
   passage the model was given counts, credited to that passage (answer.verify(reattribute=True)).
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import answer, evaluation, grading, ingest  # noqa: E402

NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def numbers(text: str) -> set[str]:
    return {m.group().replace(",", "").rstrip(".") for m in NUMBER.finditer(text)}


def unchecked(reply: dict | None) -> answer.Verdict:
    """What the user would see with no citation check: the model's own status and claimed quotes."""
    if not reply or str(reply.get("status", "")).strip().lower() != "answered":
        return answer.Verdict("not_found")
    cites = [{"quote": str(c.get("quote", ""))} for c in reply.get("citations") or [] if isinstance(c, dict)]
    return answer.Verdict("answered", str(reply.get("answer", "")), cites)


def stats(c: Counter) -> dict:
    n, shown = c["correct"] + c["wrong"] + c["abstained"], c["correct"] + c["wrong"]
    return {"n": n, "correct": c["correct"], "wrong": c["wrong"], "abstained": c["abstained"],
            "accuracy": round(c["correct"] / n, 3), "precision_when_shown": round(c["correct"] / shown, 3)}


def line(name: str, c: Counter) -> str:
    s = stats(c)
    return (f"{name:28} correct {s['correct']:3}  wrong {s['wrong']:3}  held back {s['abstained']:3}  "
            f"accuracy {s['accuracy']:.3f}  right when shown {s['precision_when_shown']:.3f}  "
            f"(n={s['n']}, shown={s['correct'] + s['wrong']})")


if __name__ == "__main__":
    trace = Path(next(a for a in sys.argv[1:] if not a.startswith("--")))
    by_id = {p.id: p for p in ingest.read_jsonl(ROOT / "data" / "passages.jsonl")}
    qs = {q["id"]: q for q in evaluation.load(ROOT / "eval" / "questions.jsonl")}
    checked, loose, nf_loose, moved, nf_moved = Counter(), Counter(), Counter(), Counter(), Counter()
    rules = {"any number not quoted": False, "ignoring numbers the question states": True}
    hidden = {name: {"correct": [], "wrong": []} for name in rules}
    for row in trace.open(encoding="utf-8"):
        t = json.loads(row)
        q = qs[t["id"]]
        reply = answer.parse(t["raw"])
        hits = [vars(by_id[r["id"]]) for r in t["retrieved"] if r["id"] in by_id]
        v = answer.verify(reply, hits)
        v_moved = answer.verify(reply, hits, reattribute=True)
        if q["type"] == "not_found":
            nf_loose[grading.grade(q, unchecked(reply), t["raw"])] += 1
            nf_moved[grading.grade(q, v_moved, t["raw"])] += 1
        if q["type"] not in evaluation.ANSWERABLE:
            continue
        grade = grading.grade(q, v, t["raw"])
        checked[grade] += 1
        loose[grading.grade(q, unchecked(reply), t["raw"])] += 1
        moved[grading.grade(q, v_moved, t["raw"])] += 1
        if v.status == "answered":
            quoted = set().union(*(numbers(c["quote"]) for c in v.citations))
            for name, skip_question in rules.items():
                allowed = quoted | (numbers(q["question"]) if skip_question else set())
                if numbers(v.answer) - allowed:
                    hidden[name][grade].append(t["id"])
    print(line("with the quote check", checked))
    print(line("no quote check", loose))
    print(f"{'':28} not-found questions answered anyway without the check: {nf_loose['wrong']} of {sum(nf_loose.values())}")
    print(line("check + re-attribution", moved))
    print(f"{'':28} not-found questions answered anyway with re-attribution: {nf_moved['wrong']} of {sum(nf_moved.values())}")
    print()
    for name, h in hidden.items():
        print(f"number rule, {name}: would hide {len(h['correct']) + len(h['wrong'])}: "
              f"{len(h['wrong'])} wrong {h['wrong']}, {len(h['correct'])} correct {h['correct']}")
    if "--write" in sys.argv:
        out = ROOT / "docs" / "results" / f"answers-{trace.stem}.json"
        summary = json.loads(out.read_text(encoding="utf-8"))
        summary["what_if"] = {
            "no_quote_check": dict(stats(loose), not_found_held=nf_loose["correct"], not_found_n=sum(nf_loose.values())),
            "reattribute": dict(stats(moved), not_found_held=nf_moved["correct"], not_found_n=sum(nf_moved.values())),
            "number_rule": {name: {"hidden_wrong": h["wrong"], "hidden_correct": h["correct"]} for name, h in hidden.items()},
        }
        out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
        print(f"wrote the what_if block into {out.relative_to(ROOT)}")
