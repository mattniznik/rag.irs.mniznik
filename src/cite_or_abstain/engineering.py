"""Read the numbers the demo page's "How it was built" section shows: test counts from each tool's own listing
output, and the number, title and distinct external sources of each decision record. Pure functions over text;
scripts/export_site.py runs the tools and reads the files. A number that cannot be read raises instead of
becoming 0, so the page never shows a made-up count."""
from __future__ import annotations

import re

_LINK = re.compile(r"\]\((https?://[^)\s]+)\)")


def count_pytest(collect_output: str) -> int:
    """From `pytest --collect-only -q`: "54 tests collected in 0.25s"."""
    m = re.search(r"(\d+) tests? collected", collect_output)
    if not m:
        raise ValueError("no 'N tests collected' line in the pytest output")
    return int(m.group(1))


def count_playwright(list_output: str) -> int:
    """From `playwright test --list`: "Total: 36 tests in 1 file" (every test once per browser project)."""
    m = re.search(r"Total: (\d+) tests?", list_output)
    if not m:
        raise ValueError("no 'Total: N tests' line in the Playwright output")
    return int(m.group(1))


def count_vitest(list_output: str) -> int:
    """From `vitest list`: one "test/<file>.test.ts > <group> > <name>" line per test."""
    n = sum(1 for line in list_output.splitlines() if re.match(r"\S+\.test\.[cm]?[jt]s > ", line))
    if not n:
        raise ValueError("no test lines in the vitest list output")
    return n


def external_links(markdown: str) -> set[str]:
    """The distinct http(s) links in Markdown link syntax."""
    return set(_LINK.findall(markdown))


def decision(markdown: str) -> dict:
    """A decision record's number and title (its "# 0001. Title" heading) and how many distinct external pages
    it cites."""
    m = re.match(r"#\s+(\d{4})\.\s+(.+)", markdown.lstrip())
    if not m:
        raise ValueError("a decision record must start with '# NNNN. Title'")
    return {"id": m.group(1), "title": m.group(2).strip(), "sources": len(external_links(markdown))}
