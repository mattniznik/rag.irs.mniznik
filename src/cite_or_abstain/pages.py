"""Decide which pages become passages.

Rules come from measuring all 892 pages (docs/results/m1.md):
- lookup tables (the Tax Table, the EIC table, Pub 463's inclusion-amount appendix): at least 0.78 of
  lines end in a number and at least 0.45 of tokens are numbers. No other page type reached both.
- the index starts on the page that says "To help us develop a more useful index" and runs to the end.
Everything else is kept; table-of-contents lines are stripped line by line, because contents pages
also carry the "What's New" text.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_NUMERIC = re.compile(r"^[\d,.$%()\-]+$")
_ENDS_IN_NUMBER = re.compile(r"\b\d{1,3}(?:, ?\d{1,3})*$")
INDEX_MARKER = "To help us develop a more useful index"
LOOKUP_LINE_RATIO = 0.78
LOOKUP_NUMERIC_RATIO = 0.45


@dataclass(frozen=True)
class PageSignals:
    tokens: int
    numeric_ratio: float
    number_line_ratio: float
    has_index_marker: bool


def signals(text: str) -> PageSignals:
    toks = text.split()
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    numeric = sum(1 for t in toks if _NUMERIC.match(t)) / len(toks) if toks else 0.0
    ending = sum(1 for l in lines if _ENDS_IN_NUMBER.search(l) and len(l.split()) <= 8)
    return PageSignals(len(toks), numeric, ending / len(lines) if lines else 0.0, INDEX_MARKER in text)


def is_lookup_table(s: PageSignals) -> bool:
    return s.number_line_ratio >= LOOKUP_LINE_RATIO and s.numeric_ratio >= LOOKUP_NUMERIC_RATIO


def classify(page_texts: list[str]) -> list[str]:
    """Return one label per page: 'keep', 'lookup_table' or 'index'."""
    labels = []
    in_index = False
    for text in page_texts:
        s = signals(text)
        in_index = in_index or s.has_index_marker
        if in_index:
            labels.append("index")
        elif is_lookup_table(s):
            labels.append("lookup_table")
        else:
            labels.append("keep")
    return labels
