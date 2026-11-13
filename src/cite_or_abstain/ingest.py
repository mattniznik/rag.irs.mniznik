"""Turn the pinned PDFs into passages: ~300-word chunks that never cross a page, each with the
section heading it sits under, plus one passage per extracted table.

Prose comes from PyMuPDF (0.5 s for Pub 17, 0 run-together words in M0). Tables come from pdfplumber,
which read the Standard Deduction chart cleanly where PyMuPDF's table finder glued words, and it runs
only on pages whose text names a table or chart, because table detection on every page took most of
M0's 931 seconds.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import pdfplumber
import pymupdf

from . import pages, text

CHUNK_WORDS = 300
MAX_WORDS = 380  # ~500 tokens: bge-small reads at most 512
HEADING_MIN_SIZE = 11.0
HEADING_MAX_WORDS = 15
# IRS margin icons are bold and large but are not section headings ("CAUTION !", "TIP", "RECORDS").
_ICON_LABEL = re.compile(r"^(CAUTION|TIP|RECORDS|ENCLOSURE)\s*!?$", re.I)
_ICON_PREFIX = re.compile(r"^(CAUTION|TIP|RECORDS)\s*!?\s+(?=[A-Z])")
# A contents page whose entries PyMuPDF joins into one line ("What's New ... 1 Reminders ... 2").
_PAGE_REF = re.compile(r"\.\.\. \d{1,3}(?=\s|$)")
CONTENTS_REFS = 6
_TABLE_CUE = re.compile(r"\b(Table \d|Chart\b|Table [A-Z]\b)")
_YEAR = re.compile(r"For use in preparing\s+(\d{4})\s+Returns", re.I)


@dataclass
class Passage:
    id: str
    doc: str
    year: int
    page: int
    section: str
    kind: str  # "text" or "table"
    text: str


def doc_id(pdf: Path, year: int) -> str:
    return f"{pdf.stem.split('--')[0]}-{year}"


def stated_year(doc: pymupdf.Document) -> int:
    head = " ".join(doc[i].get_text() for i in range(min(2, len(doc))))
    m = _YEAR.search(head)
    if not m:
        raise ValueError(f"{doc.name}: no 'For use in preparing YYYY Returns' on the first pages")
    return int(m.group(1))


def _blocks(page: pymupdf.Page) -> list[tuple[str, bool]]:
    """(text, is_heading) per text block, in reading order."""
    out = []
    for b in page.get_text("dict")["blocks"]:
        spans = [s for line in b.get("lines", []) for s in line["spans"] if s["text"].strip()]
        if not spans:
            continue
        raw = "\n".join("".join(s["text"] for s in line["spans"]) for line in b["lines"])
        heading = (all(s["flags"] & 16 for s in spans)
                   and max(s["size"] for s in spans) >= HEADING_MIN_SIZE
                   and text.words(raw) <= HEADING_MAX_WORDS
                   and not _ICON_LABEL.match(text.clean(raw)))
        out.append((raw, heading))
    return out


def _chunks(paragraphs: list[str]) -> list[str]:
    pieces = [piece for p in paragraphs for piece in text.split_long(p, MAX_WORDS)]
    out, cur, n = [], [], 0
    for p in pieces:
        w = text.words(p)
        if cur and n + w > CHUNK_WORDS:
            out.append(" ".join(cur))
            cur, n = [], 0
        cur.append(p)
        n += w
    if cur:
        out.append(" ".join(cur))
    return out


def _table_markdown(rows: list[list]) -> str:
    """One markdown line per row. A blank leading cell means "same as the row above" in IRS tables
    (filing status spans several age rows), so it is filled in: every row then stands on its own."""
    rows = [[text.clean(c or "") for c in r] for r in rows if r and any(c for c in r)]
    for prev, row in zip(rows, rows[1:]):
        for i, cell in enumerate(row):
            if cell or i >= len(prev):
                break
            row[i] = prev[i]
    return "\n".join("| " + " | ".join(r) + " |" for r in rows)


def ingest_pdf(pdf: Path) -> tuple[list[Passage], dict]:
    doc = pymupdf.open(pdf)
    year = stated_year(doc)
    did = doc_id(pdf, year)
    labels = pages.classify([p.get_text() for p in doc])
    passages: list[Passage] = []
    section = ""
    stats = {"pages": len(doc), "keep": 0, "lookup_table": 0, "index": 0, "toc_lines_removed": 0,
             "contents_passages_dropped": 0, "tables": 0}
    table_pages = []
    for i, page in enumerate(doc):
        stats[labels[i]] += 1
        if labels[i] != "keep":
            continue
        paragraphs: list[tuple[str, str]] = []  # (section, text)
        for raw, heading in _blocks(page):
            lines = raw.splitlines()
            kept = [l for l in lines if not text.is_toc_line(l)]
            stats["toc_lines_removed"] += len(lines) - len(kept)
            cleaned = text.clean(" ".join(kept))
            if not cleaned:
                continue
            if heading:
                section = _ICON_PREFIX.sub("", cleaned)
                continue
            paragraphs.append((section, cleaned))
        # group consecutive paragraphs under the same section, chunk each group
        n = 0
        start = 0
        while start < len(paragraphs):
            sec = paragraphs[start][0]
            end = start
            while end < len(paragraphs) and paragraphs[end][0] == sec:
                end += 1
            for chunk in _chunks([p for _, p in paragraphs[start:end]]):
                # Contents entries are separate small blocks; only once joined do the page refs add up.
                in_contents = sec.lower().startswith("contents") or "Contents" in chunk[:200]
                if in_contents and len(_PAGE_REF.findall(chunk)) >= CONTENTS_REFS:
                    stats["contents_passages_dropped"] += 1
                    continue
                passages.append(Passage(f"{did}:p{i + 1}:{n}", did, year, i + 1, sec, "text", chunk))
                n += 1
            start = end
        if _TABLE_CUE.search(page.get_text()):
            table_pages.append((i, section))
    if table_pages:
        with pdfplumber.open(pdf) as plumber:
            for i, sec in table_pages:
                for t, rows in enumerate(plumber.pages[i].extract_tables()):
                    md = _table_markdown(rows)
                    if text.words(md) < 8:
                        continue
                    for j, part in enumerate(text.split_long(md, MAX_WORDS)):
                        passages.append(Passage(f"{did}:p{i + 1}:t{t}.{j}", did, year, i + 1, sec, "table", part))
                        stats["tables"] += 1
    return passages, stats


def ingest(raw_dir: Path) -> tuple[list[Passage], dict]:
    all_passages: list[Passage] = []
    report = {}
    for pdf in sorted(raw_dir.glob("*.pdf")):
        ps, stats = ingest_pdf(pdf)
        stats["passages"] = len(ps)
        report[pdf.name] = stats
        all_passages += ps
    return all_passages, report


def write_jsonl(passages: list[Passage], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for p in passages:
            f.write(json.dumps(asdict(p), ensure_ascii=False) + "\n")


def read_jsonl(path: Path) -> list[Passage]:
    with path.open(encoding="utf-8") as f:
        return [Passage(**json.loads(line)) for line in f if line.strip()]
