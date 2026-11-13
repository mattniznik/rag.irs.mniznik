"""Text cleanup shared by ingestion and the citation check.

The same normalization runs on passages and on the model's quotes, so a quote that differs only in
curly vs straight quotes, dashes or spacing still matches the passage it cites.
"""
from __future__ import annotations

import re

_LINE_HYPHEN = re.compile(r"([a-z])- ([a-z])")
_DOT_LEADER = re.compile(r"(?:\.\s?){4,}")
_SPACES = re.compile(r"\s+")
# A table-of-contents line: any text, a run of dot leaders, then a bare page number. Wrapped entries
# can start with "$" or a digit ("$11,950 or Less . . . 6"); worksheet lines end in an amount
# ("$18,600") or a numbered line ("12."), so they never end in a bare number right after the dots.
_TOC_LINE = re.compile(r"^\s*\S.*?(?:\.\s?){4,}\s*\d{1,3}\s*$")
_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                         "–": "-", "—": "-", "‑": "-", " ": " "})


def is_toc_line(line: str) -> bool:
    return bool(_TOC_LINE.match(line))


def clean(text: str) -> str:
    """Join words split across lines, shorten dot leaders, collapse whitespace."""
    text = _SPACES.sub(" ", text)
    text = _LINE_HYPHEN.sub(r"\1\2", text)
    text = _DOT_LEADER.sub(" ... ", text)
    return _SPACES.sub(" ", text).strip()


def for_match(text: str) -> str:
    """Normalize for comparing a quote with a passage: quotes, dashes, spacing and case."""
    return _SPACES.sub(" ", text.translate(_QUOTES)).strip().lower()


def words(text: str) -> int:
    return len(text.split())


_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\"'])")


def split_long(text: str, max_words: int) -> list[str]:
    """Split text longer than max_words at sentence ends; a single overlong sentence is cut by words."""
    if words(text) <= max_words:
        return [text]
    out: list[str] = []
    cur: list[str] = []
    n = 0
    for sentence in _SENTENCE_END.split(text):
        w = words(sentence)
        if w > max_words:
            if cur:
                out.append(" ".join(cur))
                cur, n = [], 0
            tokens = sentence.split()
            out += [" ".join(tokens[i:i + max_words]) for i in range(0, len(tokens), max_words)]
            continue
        if cur and n + w > max_words:
            out.append(" ".join(cur))
            cur, n = [], 0
        cur.append(sentence)
        n += w
    if cur:
        out.append(" ".join(cur))
    return out
