"""Retrieval methods compared in M2: keyword (FTS5/BM25), vector (bge-small), hybrid (reciprocal rank
fusion of both) and hybrid + rerank (bge-reranker-base over the fused top 20).

Embeddings: BAAI/bge-small-en-v1.5 with CLS pooling, 384 dims, unit-normalized. M0 measured local
fastembed and Workers AI (pooling "cls") as identical (cosine 1.0000 over 100 passages), so vectors
built here are the ones the live demo queries. Passages are embedded as "section. text"; the optional
query instruction is the one BGE recommends for short queries, added by hand so the Worker can send
exactly the same string.
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np

from . import keyword_index
from .ingest import Passage

EMBED_MODEL = "BAAI/bge-small-en-v1.5"
RERANK_MODEL = "BAAI/bge-reranker-base"
QUERY_INSTRUCTION = "Represent this sentence for searching relevant passages: "
RRF_K = 60
FUSE_DEPTH = 20


def passage_text(p: Passage) -> str:
    return f"{p.section}. {p.text}" if p.section else p.text


def build_vectors(passages: list[Passage], out_dir: Path) -> None:
    from fastembed import TextEmbedding

    model = TextEmbedding(EMBED_MODEL)
    vecs = np.asarray(list(model.embed([passage_text(p) for p in passages], batch_size=64)), dtype=np.float32)
    vecs /= np.linalg.norm(vecs, axis=1, keepdims=True)
    np.save(out_dir / "vectors.npy", vecs)
    (out_dir / "vector_ids.json").write_text(json.dumps([p.id for p in passages]), encoding="utf-8")


class Retriever:
    def __init__(self, data_dir: Path):
        self.passages = {p.id: p for p in _read(data_dir / "passages.jsonl")}
        self.con = sqlite3.connect(data_dir / "keyword.sqlite")
        self.vectors = np.load(data_dir / "vectors.npy")
        self.ids = json.loads((data_dir / "vector_ids.json").read_text(encoding="utf-8"))
        # loaded on first use (fastembed is the optional [embed] extra), so typed loosely
        self._embedder: Any = None
        self._reranker: Any = None

    def _embed_query(self, question: str, instruction: bool) -> np.ndarray:
        if self._embedder is None:
            from fastembed import TextEmbedding
            self._embedder = TextEmbedding(EMBED_MODEL)
        text = (QUERY_INSTRUCTION + question) if instruction else question
        v = np.asarray(next(iter(self._embedder.embed([text]))), dtype=np.float32)
        return v / np.linalg.norm(v)

    def _hit(self, pid: str, score: float) -> dict:
        p = self.passages[pid]
        return {"id": p.id, "doc": p.doc, "year": p.year, "page": p.page, "section": p.section,
                "kind": p.kind, "text": p.text, "score": float(score)}

    def keyword(self, question: str, k: int) -> list[dict]:
        return keyword_index.search(self.con, question, k=k)

    def vector(self, question: str, k: int, instruction: bool = True) -> list[dict]:
        scores = self.vectors @ self._embed_query(question, instruction)
        top = np.argsort(-scores)[:k]
        return [self._hit(self.ids[i], scores[i]) for i in top]

    def hybrid(self, question: str, k: int, instruction: bool = True) -> list[dict]:
        fused: dict[str, float] = {}
        for ranked in (self.keyword(question, FUSE_DEPTH), self.vector(question, FUSE_DEPTH, instruction)):
            for rank, h in enumerate(ranked):
                fused[h["id"]] = fused.get(h["id"], 0.0) + 1.0 / (RRF_K + rank + 1)
        best = sorted(fused, key=lambda pid: fused[pid], reverse=True)[:k]
        return [self._hit(pid, fused[pid]) for pid in best]

    def hybrid_rerank(self, question: str, k: int, instruction: bool = True) -> list[dict]:
        if self._reranker is None:
            from fastembed.rerank.cross_encoder import TextCrossEncoder
            self._reranker = TextCrossEncoder(RERANK_MODEL)
        candidates = self.hybrid(question, FUSE_DEPTH, instruction)
        scores = list(self._reranker.rerank(question, [passage_text(self.passages[c["id"]]) for c in candidates]))
        order = sorted(range(len(candidates)), key=lambda i: scores[i], reverse=True)[:k]
        return [dict(candidates[i], score=float(scores[i])) for i in order]

    def search(self, method: str, question: str, k: int) -> list[dict]:
        if method == "keyword":
            return self.keyword(question, k)
        if method == "vector_plain":
            return self.vector(question, k, instruction=False)
        if method == "vector":
            return self.vector(question, k)
        if method == "hybrid":
            return self.hybrid(question, k)
        if method == "hybrid_rerank":
            return self.hybrid_rerank(question, k)
        raise ValueError(f"unknown method {method!r}")


METHODS = ("keyword", "vector_plain", "vector", "hybrid", "hybrid_rerank")


def _read(path: Path) -> list[Passage]:
    with path.open(encoding="utf-8") as f:
        return [Passage(**json.loads(line)) for line in f if line.strip()]
