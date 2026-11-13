"""Build passages and the keyword index from the pinned PDFs.

Usage:  python scripts/build_index.py

Verifies corpus/manifest.json first (refuses to build on a changed PDF), then writes
data/passages.jsonl, data/keyword.sqlite and docs/results/ingest.json.
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import ingest, keyword_index  # noqa: E402


def main() -> int:
    check = subprocess.run([sys.executable, str(ROOT / "scripts" / "fetch_corpus.py"), "--verify"],
                           capture_output=True, text=True)
    if check.returncode != 0:
        print(check.stdout)
        print("corpus does not match corpus/manifest.json; not building")
        return 1
    t0 = time.perf_counter()
    passages, report = ingest.ingest(ROOT / "corpus" / "raw")
    ingest.write_jsonl(passages, ROOT / "data" / "passages.jsonl")
    keyword_index.build(passages, ROOT / "data" / "keyword.sqlite")
    totals = {k: sum(r[k] for r in report.values()) for k in next(iter(report.values()))}
    lengths = sorted(len(p.text.split()) for p in passages)
    summary = {
        "seconds": round(time.perf_counter() - t0, 1),
        "totals": totals,
        "passages_by_kind": {k: sum(1 for p in passages if p.kind == k) for k in ("text", "table")},
        "words": {"median": lengths[len(lengths) // 2], "max": lengths[-1]},
        "no_section": sum(1 for p in passages if not p.section),
        "per_pdf": report,
    }
    out = ROOT / "docs" / "results" / "ingest.json"
    out.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "per_pdf"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
