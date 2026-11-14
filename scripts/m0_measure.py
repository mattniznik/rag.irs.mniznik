"""M0: measure the corpus before building on it.

Usage:  python scripts/m0_measure.py            (needs the `cf` CLI logged in for the parity check)
        python scripts/m0_measure.py --no-cloud (skips the Workers AI parity check)

Writes docs/results/m0.json and docs/results/m0-tables/*.md. Answers three questions:
  1. size  - pages, characters, stated tax year, passages at three chunk sizes
             (must stay under ~13,000 passages for Vectorize's free 5M stored dimensions at 384 dims)
  2. tables - PyMuPDF vs pdfplumber on the five most table-heavy pages, saved side by side
  3. parity - the same 100 passages embedded by local bge-small (fastembed) and by Workers AI,
              with mean and cls pooling; cosine > 0.99 means one model can serve both sides
"""
from __future__ import annotations

import json
import random
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import pdfplumber
import pymupdf

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "corpus" / "raw"
OUT = ROOT / "docs" / "results"
CHUNK_WORDS = [180, 300, 450]  # ~240, ~400, ~600 tokens at ~1.33 tokens per word
PARITY_N = 100
SEED = 7


def stated_year(doc: pymupdf.Document) -> str | None:
    head = " ".join(doc[i].get_text() for i in range(min(2, len(doc))))
    m = re.search(r"For use in preparing\s+(\d{4})\s+Returns", head, re.I)
    return m.group(1) if m else None


def paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n|(?<=[.:;])\n(?=[A-Z])", text)
    return [re.sub(r"\s+", " ", p).strip() for p in parts if len(p.split()) >= 3]


def chunk(paras: list[str], max_words: int) -> list[str]:
    out, cur, n = [], [], 0
    for p in paras:
        w = len(p.split())
        if cur and n + w > max_words:
            out.append(" ".join(cur))
            cur, n = [], 0
        cur.append(p)
        n += w
    if cur:
        out.append(" ".join(cur))
    return out


def table_md(rows: list[list]) -> str:
    rows = [[(c or "").replace("\n", " ").strip() for c in r] for r in rows if r]
    if not rows:
        return "(empty)"
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def cf_embed(texts: list[str], pooling: str) -> np.ndarray:
    body = {"text": texts, "pooling": pooling}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(body, f)
        path = f.name
    r = subprocess.run(["cf", "ai", "run", "@cf/baai/bge-small-en-v1.5", "--body", f"@{path}"],
                       capture_output=True, text=True, encoding="utf-8", shell=(sys.platform == "win32"))
    Path(path).unlink()
    j = json.loads(r.stdout)
    data = (j.get("result") or j)["data"]
    return np.asarray(data, dtype=np.float32)


def unit(m: np.ndarray) -> np.ndarray:
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "m0-tables").mkdir(exist_ok=True)
    report: dict = {"documents": {}, "chunks": {}, "tables": [], "parity": None}
    all_paras: list[tuple[str, int, str]] = []
    table_pages: list[tuple[int, str, int]] = []

    for pdf in sorted(RAW.glob("*.pdf")):
        t0 = time.perf_counter()
        doc = pymupdf.open(pdf)
        chars, n_tables = 0, 0
        for i, page in enumerate(doc):
            text = page.get_text()
            chars += len(text)
            all_paras += [(pdf.stem, i + 1, p) for p in paragraphs(text)]
            found = page.find_tables()
            cells = sum(len(t.extract()) * max(1, t.col_count) for t in found.tables)
            n_tables += len(found.tables)
            if cells:
                table_pages.append((cells, pdf.name, i))
        report["documents"][pdf.name] = {
            "pages": len(doc), "chars": chars, "stated_year": stated_year(doc),
            "tables_pymupdf": n_tables, "extract_seconds": round(time.perf_counter() - t0, 2),
        }
        print(f"{pdf.name:16} {len(doc):4} pages  {chars:>9,} chars  year={report['documents'][pdf.name]['stated_year']}  tables={n_tables}")

    by_doc: dict[str, list[str]] = {}
    for doc_name, _, p in all_paras:
        by_doc.setdefault(doc_name, []).append(p)
    for w in CHUNK_WORDS:
        chunks = [c for paras in by_doc.values() for c in chunk(paras, w)]
        lengths = [len(c.split()) for c in chunks]
        report["chunks"][str(w)] = {"passages": len(chunks), "median_words": int(np.median(lengths)),
                                     "max_words": max(lengths), "fits_free_vectorize": len(chunks) * 384 <= 5_000_000}
        print(f"chunk ~{w} words: {len(chunks):,} passages (median {int(np.median(lengths))} words)")

    for _cells, name, idx in sorted(table_pages, reverse=True)[:5]:
        mu = [t.extract() for t in pymupdf.open(RAW / name)[idx].find_tables().tables]
        with pdfplumber.open(RAW / name) as p:
            pl = p.pages[idx].extract_tables()
        md = [f"# {name} page {idx + 1}", "", "## PyMuPDF find_tables", ""]
        md += [table_md(t) + "\n" for t in mu] or ["(none)"]
        md += ["## pdfplumber extract_tables", ""] + ([table_md(t) + "\n" for t in pl] or ["(none)"])
        out = OUT / "m0-tables" / f"{Path(name).stem}-p{idx + 1}.md"
        out.write_text("\n".join(md), encoding="utf-8")
        report["tables"].append({"file": name, "page": idx + 1, "pymupdf_tables": len(mu),
                                 "pymupdf_rows": sum(len(t) for t in mu), "pdfplumber_tables": len(pl),
                                 "pdfplumber_rows": sum(len(t) for t in pl), "saved": out.name})
        print(f"tables {name} p{idx + 1}: pymupdf {len(mu)} tables/{sum(len(t) for t in mu)} rows, pdfplumber {len(pl)}/{sum(len(t) for t in pl)}")

    if "--no-cloud" not in sys.argv:
        from fastembed import TextEmbedding
        rng = random.Random(SEED)
        sample = rng.sample([c for paras in by_doc.values() for c in chunk(paras, 300)], PARITY_N)
        local = unit(np.asarray(list(TextEmbedding("BAAI/bge-small-en-v1.5").embed(sample)), dtype=np.float32))
        parity = {}
        for pooling in ("mean", "cls"):
            cloud = unit(cf_embed(sample, pooling))
            cos = np.sum(local * cloud, axis=1)
            parity[pooling] = {"n": PARITY_N, "mean_cosine": round(float(cos.mean()), 4),
                               "min_cosine": round(float(cos.min()), 4),
                               "share_above_0_99": round(float((cos > 0.99).mean()), 3)}
            print(f"parity local vs workers-ai ({pooling}): mean {cos.mean():.4f}  min {cos.min():.4f}  >0.99: {(cos > 0.99).mean():.0%}")
        report["parity"] = parity

    (OUT / "m0.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT / 'm0.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
