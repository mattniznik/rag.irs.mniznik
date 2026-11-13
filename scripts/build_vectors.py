"""Embed every passage with bge-small (CLS pooling, the same vectors Workers AI returns).

Usage:  python scripts/build_vectors.py      (after build_index.py; about 6 minutes on a laptop CPU)
Writes data/vectors.npy and data/vector_ids.json.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import ingest, retrieval  # noqa: E402

if __name__ == "__main__":
    t0 = time.perf_counter()
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    retrieval.build_vectors(passages, ROOT / "data")
    print(f"embedded {len(passages):,} passages in {time.perf_counter() - t0:.0f}s")
