"""Download the IRS publications this project answers from, and pin them by checksum.

Usage:
    python scripts/fetch_corpus.py           download anything missing, then verify every file
    python scripts/fetch_corpus.py --verify  verify only; exits 1 if a file is missing or changed

The PDFs are US government works (public domain). corpus/manifest.json records each file's
source URL, size, SHA-256 and the server's Last-Modified date, so a silent change on irs.gov
cannot slip into the eval set: refreshing the snapshot is a deliberate edit to the manifest.
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "corpus" / "raw"
MANIFEST = ROOT / "corpus" / "manifest.json"
USER_AGENT = "cite-or-abstain corpus fetch (public portfolio project)"

# (file name, url, short description). Current editions live in irs-pdf/, earlier ones in irs-prior/.
SOURCES = [
    ("p17.pdf", "https://www.irs.gov/pub/irs-pdf/p17.pdf", "Your Federal Income Tax (current edition)"),
    ("p17--2024.pdf", "https://www.irs.gov/pub/irs-prior/p17--2024.pdf", "Your Federal Income Tax, 2024 edition"),
    ("p17--2023.pdf", "https://www.irs.gov/pub/irs-prior/p17--2023.pdf", "Your Federal Income Tax, 2023 edition"),
    ("p501.pdf", "https://www.irs.gov/pub/irs-pdf/p501.pdf", "Dependents, Standard Deduction, and Filing Information"),
    ("p587.pdf", "https://www.irs.gov/pub/irs-pdf/p587.pdf", "Business Use of Your Home"),
    ("p334.pdf", "https://www.irs.gov/pub/irs-pdf/p334.pdf", "Tax Guide for Small Business"),
    ("p463.pdf", "https://www.irs.gov/pub/irs-pdf/p463.pdf", "Travel, Gift, and Car Expenses"),
    ("p970.pdf", "https://www.irs.gov/pub/irs-pdf/p970.pdf", "Tax Benefits for Education"),
    ("p596.pdf", "https://www.irs.gov/pub/irs-pdf/p596.pdf", "Earned Income Credit"),
    ("p590a.pdf", "https://www.irs.gov/pub/irs-pdf/p590a.pdf", "Contributions to Individual Retirement Arrangements"),
    ("p519.pdf", "https://www.irs.gov/pub/irs-pdf/p519.pdf", "U.S. Tax Guide for Aliens"),
]


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def download(url: str, dest: Path) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
        last_modified = resp.headers.get("Last-Modified", "")
    dest.write_bytes(data)
    return last_modified


def main() -> int:
    verify_only = "--verify" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"files": {}}
    files = manifest["files"]
    problems = 0
    for name, url, title in SOURCES:
        path = RAW / name
        entry = files.get(name)
        if not path.exists():
            if verify_only:
                print(f"MISSING  {name}")
                problems += 1
                continue
            last_modified = download(url, path)
            entry = {"url": url, "title": title, "bytes": path.stat().st_size,
                     "sha256": sha256(path), "last_modified": last_modified}
            files[name] = entry
            print(f"fetched  {name}  {entry['bytes']:>9,} bytes")
        digest = sha256(path)
        if entry is None:
            print(f"UNPINNED {name}: on disk but not in the manifest")
            problems += 1
        elif digest != entry["sha256"]:
            print(f"CHANGED  {name}: sha256 {digest[:12]} != pinned {entry['sha256'][:12]}")
            problems += 1
        else:
            print(f"ok       {name}  {digest[:12]}")
    if not verify_only:
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{len(SOURCES) - problems} of {len(SOURCES)} files verified")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
