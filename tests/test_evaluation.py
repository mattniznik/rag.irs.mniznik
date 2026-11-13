from cite_or_abstain import evaluation
from cite_or_abstain.ingest import Passage

PASSAGES = [
    Passage("x:p3:0", "p17-2023", 2023, 3, "What's New", "text", "Single or Married filing separately—$13,850."),
    Passage("x:p98:0", "p17-2023", 2023, 98, "Standard Deduction", "text", "The amount for single filers is $13,850."),
    Passage("y:p1:0", "p587-2025", 2025, 1, "Home", "text", "Keep private records of the area you use."),
]
Q = {"id": "Y", "type": "year", "question": "?", "must_contain": ["$13,850"], "gold": [{"doc": "p17-2023", "page": 3}]}


def _hit(p):
    return {"doc": p.doc, "page": p.page, "text": p.text}


def test_valid_question_passes_validation():
    assert evaluation.validate([Q], PASSAGES) == []


def test_validation_fails_when_the_gold_page_lacks_the_fact():
    wrong = dict(Q, must_contain=["$14,600"])
    assert evaluation.validate([wrong], PASSAGES) == ["Y: no gold page contains '$14,600'"]


def test_absent_terms_match_whole_words_only():
    # "vat" is inside "private" but is not the word VAT
    nf = {"id": "N", "type": "not_found", "question": "?", "absent_terms": ["VAT"]}
    assert evaluation.validate([nf], PASSAGES) == []
    present = {"id": "N2", "type": "not_found", "question": "?", "absent_terms": ["records"]}
    assert evaluation.validate([present], PASSAGES) == ["N2: 'records' appears in 1 passages, so the answer may be there"]


def test_strict_recall_counts_only_the_listed_page():
    hits = [_hit(PASSAGES[1])]
    assert evaluation.recall_at_k(Q["gold"], hits, 5) == 0.0


def test_evidence_counts_another_page_of_the_same_document():
    hits = [_hit(PASSAGES[1])]
    assert evaluation.evidence_at_k(Q, hits, 5) == 1.0


def test_evidence_ignores_the_fact_in_a_different_document():
    other = {"doc": "p501-2025", "page": 25, "text": "Single $13,850"}
    assert evaluation.evidence_at_k(Q, [other], 5) == 0.0


def test_evidence_respects_k():
    hits = [_hit(PASSAGES[2]), _hit(PASSAGES[0])]
    assert evaluation.evidence_at_k(Q, hits, 1) == 0.0
    assert evaluation.evidence_at_k(Q, hits, 2) == 1.0


def test_only_the_documents_own_wording_must_be_on_the_gold_page():
    q = dict(Q, must_contain=[["$13,850", "thirteen thousand eight hundred fifty"]])
    assert evaluation.validate([q], PASSAGES) == []
    bad = dict(Q, must_contain=[["fourteen thousand", "$13,850"]])
    assert evaluation.validate([bad], PASSAGES) == ["Y: no gold page contains 'fourteen thousand'"]
