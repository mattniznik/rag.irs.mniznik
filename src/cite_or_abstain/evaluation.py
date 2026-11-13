"""The eval set and retrieval metrics.

Every question is validated against the passages before it is used: each gold page must hold a
passage containing every `must_contain` string, and every `absent_terms` entry of a not-found
question must appear in no passage at all. A question that fails validation stops the run, so a
misremembered fact cannot quietly become a "correct" answer.
"""
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

from .ingest import Passage
from .text import for_match

ANSWERABLE = ("lookup", "table", "year", "two_section")


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def validate(questions: list[dict], passages: list[Passage]) -> list[str]:
    by_page: dict[tuple[str, int], list[str]] = defaultdict(list)
    for p in passages:
        by_page[(p.doc, p.page)].append(for_match(p.text))
    corpus = [for_match(p.text) for p in passages]
    problems = []
    ids = [q["id"] for q in questions]
    if len(ids) != len(set(ids)):
        problems.append("duplicate question ids")
    for q in questions:
        if q["type"] in ANSWERABLE:
            for needle in q["must_contain"]:
                hit_pages = [g for g in q["gold"]
                             if any(for_match(needle) in t for t in by_page.get((g["doc"], g["page"]), []))]
                if not hit_pages:
                    problems.append(f"{q['id']}: no gold page contains {needle!r}")
        elif q["type"] == "not_found":
            for term in q["absent_terms"]:
                # whole words only: "vat" must not match inside "private" or "elevator"
                rx = re.compile(r"\b" + re.escape(for_match(term)) + r"\b")
                n = sum(1 for t in corpus if rx.search(t))
                if n:
                    problems.append(f"{q['id']}: {term!r} appears in {n} passages, so the answer may be there")
    return problems


def recall_at_k(gold: list[dict], hits: list[dict], k: int) -> float:
    """Strict: share of the listed gold pages found among the top-k hits."""
    found = {(h["doc"], h["page"]) for h in hits[:k]}
    return sum(1 for g in gold if (g["doc"], g["page"]) in found) / len(gold)


def evidence_at_k(question: dict, hits: list[dict], k: int) -> float:
    """Share of the answer's required strings present in a top-k passage from a gold document.

    Many facts appear on more than one page (a "What's New" item and its chapter), so this counts
    any page of the right document that holds the evidence, not only the page listed as gold.
    """
    docs = {g["doc"] for g in question["gold"]}
    texts = [for_match(h["text"]) for h in hits[:k] if h["doc"] in docs]
    needles = question["must_contain"]
    return sum(1 for s in needles if any(for_match(s) in t for t in texts)) / len(needles)


def summarize(rows: list[dict], ks: tuple[int, ...]) -> dict:
    out: dict = {"n": len(rows)}
    for k in ks:
        out[f"recall@{k}"] = round(sum(r[f"recall@{k}"] for r in rows) / len(rows), 3)
        out[f"evidence@{k}"] = round(sum(r[f"evidence@{k}"] for r in rows) / len(rows), 3)
    return out
