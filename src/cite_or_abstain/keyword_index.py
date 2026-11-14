"""Keyword search: SQLite FTS5 with BM25 ranking and Porter stemming.

The same schema runs in Cloudflare D1, which supports FTS5, so the live demo can use this index as is.
"""
from __future__ import annotations

import re
import sqlite3
from pathlib import Path

from .ingest import Passage

STOPWORDS = frozenset(
    "a an and are as at be been by can could did do does for from had has have how i if in into is it its "
    "me my of on or our should so than that the their them then there these they this to was we were what "
    "when where which who why will with would you your".split()
)
_TOKEN = re.compile(r"[a-z0-9]+(?:[.,][0-9]+)*")


def build(passages: list[Passage], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        path.unlink()
    con = sqlite3.connect(path)
    con.executescript(
        """
        CREATE TABLE passages (rowid INTEGER PRIMARY KEY, id TEXT UNIQUE, doc TEXT, year INTEGER,
                               page INTEGER, section TEXT, kind TEXT, text TEXT);
        CREATE VIRTUAL TABLE passages_fts USING fts5(section, text, content='passages', content_rowid='rowid',
                                                     tokenize='porter unicode61');
        """
    )
    con.executemany(
        "INSERT INTO passages (id, doc, year, page, section, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(p.id, p.doc, p.year, p.page, p.section, p.kind, p.text) for p in passages],
    )
    con.execute("INSERT INTO passages_fts(passages_fts) VALUES ('rebuild')")
    con.commit()
    con.close()


def to_query(question: str) -> str:
    """Turn a free-text question into an FTS5 OR-query of quoted terms, stopwords removed."""
    terms = [t for t in _TOKEN.findall(question.lower()) if t not in STOPWORDS]
    seen: list[str] = []
    for t in terms:
        if t not in seen:
            seen.append(t)
    return " OR ".join(f'"{t}"' for t in seen)


def search(con: sqlite3.Connection, question: str, k: int = 5) -> list[dict]:
    query = to_query(question)
    if not query:
        return []
    rows = con.execute(
        """
        SELECT p.id, p.doc, p.year, p.page, p.section, p.kind, p.text, bm25(passages_fts, 2.0, 1.0) AS score
        FROM passages_fts JOIN passages p ON p.rowid = passages_fts.rowid
        WHERE passages_fts MATCH ? ORDER BY score LIMIT ?
        """,
        (query, k),
    ).fetchall()
    cols = ["id", "doc", "year", "page", "section", "kind", "text", "score"]
    return [dict(zip(cols, r, strict=True)) for r in rows]
