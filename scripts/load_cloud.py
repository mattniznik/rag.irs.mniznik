"""Load passages into Cloudflare D1 and vectors into Vectorize with the `cf` CLI, then check that the
cloud search returns what the local search returns.

Usage:
  python scripts/load_cloud.py d1 <database-uuid>        load passages, rebuild FTS, check keyword parity
  python scripts/load_cloud.py vectors <index-name>      insert vectors in chunks of 1,000
  python scripts/load_cloud.py parity <index-name>       compare cloud vs local vector top-20 on the eval questions

Needs `cf` logged in. Works from data/ built by build_index.py, build_vectors.py and export_cloud.py.
"""
from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from cite_or_abstain import evaluation, ingest, keyword_index, retrieval  # noqa: E402

INSERT = "INSERT INTO passages (id, doc, year, page, section, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?)"


def cf(*args: str) -> object:
    r = subprocess.run(["cf", *args], capture_output=True, text=True, encoding="utf-8", shell=(sys.platform == "win32"))
    if r.returncode != 0:
        raise SystemExit(f"cf {' '.join(args[:3])} failed: {r.stderr.strip() or r.stdout.strip()}"[:600])
    return json.loads(r.stdout) if r.stdout.strip().startswith(("[", "{")) else r.stdout


def query(db: str, sql: str, params: list | None = None) -> list[dict]:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump([{"sql": sql, "params": params or []}], f)
        path = f.name
    try:
        return cf("d1", "query", db, "--batch", f"@{path}")[0]["results"]
    finally:
        Path(path).unlink()


def load_d1(db: str) -> int:
    passages = ingest.read_jsonl(ROOT / "data" / "passages.jsonl")
    query(db, "DELETE FROM passages")
    for start in range(0, len(passages), 250):
        chunk = passages[start:start + 250]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump([{"sql": INSERT, "params": [p.id, p.doc, p.year, p.page, p.section, p.kind, p.text]} for p in chunk], f)
            path = f.name
        try:
            res = cf("d1", "query", db, "--batch", f"@{path}")
        finally:
            Path(path).unlink()
        if not all(r.get("success") for r in res):
            raise SystemExit(f"batch at {start} failed")
        print(f"  loaded {start + len(chunk):,} / {len(passages):,}")
    query(db, "INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')")
    n = query(db, "SELECT count(*) AS n FROM passages")[0]["n"]
    print(f"rows in D1: {n:,} (local {len(passages):,})")

    questions = [q for q in evaluation.load(ROOT / "eval" / "questions.jsonl") if q["type"] in evaluation.ANSWERABLE]
    con = sqlite3.connect(ROOT / "data" / "keyword.sqlite")
    same = 0
    for q in questions:
        fts = keyword_index.to_query(q["question"])
        local = [h["id"] for h in keyword_index.search(con, q["question"], k=5)]
        cloud = [r["id"] for r in query(db, "SELECT p.id FROM passages_fts JOIN passages p ON p.rowid = passages_fts.rowid "
                                            "WHERE passages_fts MATCH ? ORDER BY bm25(passages_fts, 2.0, 1.0) LIMIT 5", [fts])] if fts else []
        same += local == cloud
    print(f"keyword top-5 identical, cloud vs local: {same} / {len(questions)} questions")
    return 0 if n == len(passages) else 1


def load_vectors(index: str) -> int:
    lines = (ROOT / "worker" / "build" / "vectors.ndjson").read_text(encoding="utf-8").splitlines()
    for start in range(0, len(lines), 1000):
        with tempfile.NamedTemporaryFile("w", suffix=".ndjson", delete=False, encoding="utf-8") as f:
            f.write("\n".join(lines[start:start + 1000]) + "\n")
            path = f.name
        try:
            res = cf("vectorize", "insert", index, "--file", path)
        finally:
            Path(path).unlink()
        print(f"  inserted {min(start + 1000, len(lines)):,} / {len(lines):,}: {json.dumps(res)[:120]}")
    return 0


def parity(index: str) -> int:
    """Cloud: Workers AI query embedding (CLS pooling) + Vectorize. Local: fastembed + numpy."""
    questions = [q for q in evaluation.load(ROOT / "eval" / "questions.jsonl") if q["type"] in evaluation.ANSWERABLE][:30]
    r = retrieval.Retriever(ROOT / "data")
    overlap, identical = [], 0
    for q in questions:
        text = retrieval.QUERY_INSTRUCTION + q["question"]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"text": [text], "pooling": "cls"}, f)
            path = f.name
        emb = cf("ai", "run", "@cf/baai/bge-small-en-v1.5", "--body", f"@{path}")
        Path(path).unlink()
        vec = (emb.get("result") or emb)["data"][0]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump({"vector": vec, "topK": 20}, f)
            path = f.name
        res = cf("vectorize", "query", index, "--body", f"@{path}")
        Path(path).unlink()
        matches = (res.get("result") or res)["matches"]
        cloud = [m["id"] for m in matches]
        local = [h["id"] for h in r.vector(q["question"], 20)]
        overlap.append(len(set(cloud) & set(local)) / 20)
        identical += cloud[:5] == local[:5]
    print(f"vector top-20 overlap, cloud vs local: mean {np.mean(overlap):.3f}, min {min(overlap):.2f} (n={len(questions)}); "
          f"identical top-5: {identical}/{len(questions)}")
    return 0


if __name__ == "__main__":
    cmd, target = sys.argv[1], sys.argv[2]
    raise SystemExit({"d1": load_d1, "vectors": load_vectors, "parity": parity}[cmd](target))
