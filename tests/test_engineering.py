"""The numbers the page's "How it was built" section shows are read from each tool's own output and from the
decision records, never typed in. These pin the parsers to the real output formats (pytest 8 --collect-only -q,
vitest 3 list, Playwright 1.65 test --list) and fail loudly instead of returning 0."""
import pytest

from cite_or_abstain import engineering as eng


def test_pytest_count_reads_the_collect_summary():
    assert eng.count_pytest("tests/test_answer.py::test_x\n\n54 tests collected in 0.25s\n") == 54
    assert eng.count_pytest("1 test collected in 0.01s") == 1


def test_playwright_count_reads_the_total_line():
    out = "Listing tests:\n  [desktop] › site.e2e.ts:40:3 › layout 01 loads\nTotal: 36 tests in 1 file\n"
    assert eng.count_playwright(out) == 36


def test_vitest_count_is_one_line_per_listed_test():
    out = ("test/choice.test.ts > presets the page ships > has a default\n"
           "test/choice.test.ts > resolveChoice > shows the site default\n"
           "test/verify.test.ts > text helpers > forMatch ignores quote style\n"
           "\n some unrelated line\n")
    assert eng.count_vitest(out) == 3


@pytest.mark.parametrize("fn", [eng.count_pytest, eng.count_playwright, eng.count_vitest])
def test_a_count_that_cannot_be_read_raises_instead_of_writing_zero(fn):
    with pytest.raises(ValueError):
        fn("error: something went wrong\n")


def test_a_decision_record_gives_its_number_title_and_distinct_external_sources():
    md = ("# 0001. The quote check is code, not the model\n\n"
          "[a](https://platform.claude.com/x) and again [a](https://platform.claude.com/x), "
          "[b](https://developers.cloudflare.com/y), local [c](../../README.md#answers)\n")
    assert eng.decision(md) == {"id": "0001", "title": "The quote check is code, not the model", "sources": 2}


def test_a_decision_record_without_a_numbered_title_is_an_error():
    with pytest.raises(ValueError):
        eng.decision("# Decision records\n\nAn index page.\n")
