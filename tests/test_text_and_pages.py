from cite_or_abstain import pages, text


def test_clean_rejoins_words_split_across_lines():
    assert text.clean("a sales representa- tive for several") == "a sales representative for several"


def test_clean_keeps_real_hyphenated_words():
    assert text.clean("a self-employed person") == "a self-employed person"


def test_clean_shortens_dot_leaders_but_keeps_values():
    assert text.clean("Fully taxable pension . . . . . . . . $18,600") == "Fully taxable pension ... $18,600"


def test_toc_line_is_text_dots_and_a_bare_page_number():
    assert text.is_toc_line("What's New for 2025 . . . . . . . . . . 1")
    assert not text.is_toc_line("Fully taxable pension . . . . . . . . $18,600")
    assert not text.is_toc_line("11. Enter $12,000 if married filing jointly")


def test_toc_line_that_wraps_and_starts_with_an_amount():
    # p596 contents: "Rule 6-Your Investment Income Must Be" / "$11,950 or Less . . . . 6"
    assert text.is_toc_line("$11,950 or Less . . . . . . . . . 6")
    assert not text.is_toc_line("$11,950 or less . . . . . . . . . $11,950")


def test_for_match_ignores_quote_style_dashes_spacing_and_case():
    assert text.for_match("What’s  New — Standard") == text.for_match("what's new - standard")


def test_split_long_respects_the_limit_and_keeps_every_word():
    sentence = "This sentence has exactly seven words. "
    long_text = sentence * 30
    parts = text.split_long(long_text, 50)
    assert all(text.words(p) <= 50 for p in parts)
    assert sum(text.words(p) for p in parts) == text.words(long_text)


def test_split_long_cuts_a_single_overlong_sentence_by_words():
    parts = text.split_long("word " * 120, 50)
    assert [text.words(p) for p in parts] == [50, 50, 20]


def _numbers_page(lines: int) -> str:
    # IRS lookup tables print comma-grouped numbers, e.g. "93,000 93,050 15,380" (p17 Tax Table)
    return "\n".join(f"{40000 + i * 50:,} {40050 + i * 50:,} {4500 + i:,}" for i in range(lines))


def test_lookup_table_page_is_skipped_and_prose_is_kept():
    prose = "\n".join(["You can deduct expenses for the business use of your home if you meet the tests."] * 20)
    assert pages.classify([prose, _numbers_page(40)]) == ["keep", "lookup_table"]


def test_index_runs_from_the_marker_page_to_the_end():
    prose = "Chapter text about filing status and dependents.\n" * 10
    labels = pages.classify([prose, f"{pages.INDEX_MARKER} on the next pages\nAlimony 12", "Wages 40\nTips 41"])
    assert labels == ["keep", "index", "index"]
