from app.services.evidence import SourceEvidence, select_source_evidence, validate_source_evidence


def test_verifies_verbatim_quote_with_whitespace_normalization():
    source = {3: "The green plant\nuses light to make food."}
    evidence = [SourceEvidence(page_number=3, quote="The green plant uses light")]

    assert validate_source_evidence([3], evidence, source)


def test_rejects_paraphrase_not_present_in_the_page():
    source = {3: "The green plant uses light to make food."}
    evidence = [SourceEvidence(page_number=3, quote="Plants need sunlight to grow")]

    assert not validate_source_evidence([3], evidence, source)


def test_requires_each_cited_page_to_have_evidence():
    source = {3: "A source sentence.", 4: "Another source sentence."}
    evidence = [SourceEvidence(page_number=3, quote="A source sentence.")]

    assert not validate_source_evidence([3, 4], evidence, source)


def test_selects_a_verbatim_excerpt_related_to_generated_content():
    source = {1: "Roots absorb water. Photosynthesis uses light to make food."}

    evidence = select_source_evidence([1], source, "Plants use light to make food.")

    assert [(item.page_number, item.quote) for item in evidence] == [
        (1, "Photosynthesis uses light to make food.")
    ]
    assert evidence[0].shared_terms == ["food", "light"]
    assert validate_source_evidence([1], evidence, source)


def test_does_not_select_evidence_when_page_has_no_matching_terms():
    source = {1: "Roots absorb water."}

    assert select_source_evidence([1], source, "Photosynthesis uses light to make food.") is None


def test_reports_shared_words_and_marks_a_one_word_match_as_weak():
    source = {1: "Roots absorb water. The leaf is green."}

    evidence = select_source_evidence([1], source, "Water is moved through the stem.")

    assert evidence[0].quote == "Roots absorb water."
    assert evidence[0].shared_terms == ["water"]
    assert evidence[0].match_strength == "weak"


def test_marks_a_match_with_several_shared_words_as_strong_without_claiming_correctness():
    source = {1: "Chlorophyll in the leaf absorbs sunlight to make sugar."}

    evidence = select_source_evidence([1], source, "The leaf absorbs sunlight and makes sugar with chlorophyll.")

    assert evidence[0].match_strength == "strong"
    assert len(evidence[0].shared_terms) >= 3


def test_keyword_overlap_can_pick_a_sentence_that_does_not_support_the_claim():
    """Documents a known limit: shared words are not proof of support."""
    source = {1: "Water is NOT needed for photosynthesis in this made-up example. Light is needed."}

    evidence = select_source_evidence([1], source, "Water is needed for photosynthesis.")

    # The selected quote really appears on the page and shares words with the claim,
    # but it says the opposite. The UI tells learners to read the page for this reason.
    assert validate_source_evidence([1], evidence, source)
    assert "NOT" in evidence[0].quote
