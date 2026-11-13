import sqlite3

from cite_or_abstain import keyword_index
from cite_or_abstain.ingest import Passage

PASSAGES = [
    Passage("a:p1:0", "p587-2025", 2025, 1, "Home Office", "text",
            "You can deduct expenses for the business use of your home if you meet the tests."),
    Passage("b:p2:0", "p501-2025", 2025, 2, "Filing Status", "text",
            "Head of household status requires a qualifying person who lived with you."),
    Passage("c:p3:0", "p970-2025", 2025, 3, "Scholarships", "text",
            "A scholarship is generally tax free if you are a degree candidate."),
]


def _con(tmp_path):
    path = tmp_path / "k.sqlite"
    keyword_index.build(PASSAGES, path)
    return sqlite3.connect(path)


def test_query_drops_stopwords_and_duplicates():
    assert keyword_index.to_query("Can I deduct my home office? Home office!") == '"deduct" OR "home" OR "office"'


def test_query_keeps_numbers_with_commas():
    assert '"15,750"' in keyword_index.to_query("Is the deduction 15,750?")


def test_search_ranks_the_matching_passage_first(tmp_path):
    hits = keyword_index.search(_con(tmp_path), "Can I deduct my home office?", k=3)
    assert hits[0]["doc"] == "p587-2025"


def test_stemming_matches_other_word_forms(tmp_path):
    hits = keyword_index.search(_con(tmp_path), "scholarships taxed", k=1)
    assert hits[0]["doc"] == "p970-2025"


def test_question_of_only_stopwords_returns_nothing(tmp_path):
    assert keyword_index.search(_con(tmp_path), "what is it?", k=3) == []
