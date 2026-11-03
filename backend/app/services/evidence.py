"""Find the passage on a cited PDF page that is closest to a generated statement.

IMPORTANT LIMIT: this module does keyword matching. It can show that a quote
really appears on the cited page and which important words the quote shares with
the generated text. It CANNOT show that the passage entails (proves) the
generated claim. The UI therefore calls the result the "closest passage", shows
the shared words, and tells learners to read the page themselves.
"""

import re

from pydantic import BaseModel, ConfigDict, Field


class SourceEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page_number: int = Field(ge=1, le=100)
    quote: str = Field(min_length=1, max_length=400)
    # Important words found in both the generated text and the quote. Shown to the
    # learner so the match can be inspected rather than trusted.
    shared_terms: list[str] = Field(default_factory=list, max_length=8)
    # "strong" = several shared words; "weak" = only one or two. Neither value means
    # the claim is correct; "weak" tells the learner to check the page more carefully.
    match_strength: str = Field(default="weak", pattern="^(strong|weak)$")


STRONG_MATCH_MIN_SHARED_TERMS = 3


COMMON_WORDS = {
    "about", "after", "also", "because", "before", "being", "between", "could", "does", "from",
    "have", "into", "more", "most", "only", "other", "over", "same", "some", "such", "than",
    "that", "their", "them", "then", "there", "these", "they", "this", "through", "under", "very",
    "what", "when", "where", "which", "while", "with", "would", "your", "about", "each", "plant",
    "plants", "source", "page", "says", "make", "makes", "made",
}


def select_source_evidence(
    cited_pages: list[int],
    source_pages: dict[int, str],
    context: str,
) -> list[SourceEvidence] | None:
    """Select the exact source sentence that shares the most key words with generated content.

    The model supplies page numbers, while this function supplies the quote. This
    keeps the quote verbatim even when a small local model misquotes a sentence.
    Sharing words is NOT proof that the sentence supports the generated claim.
    """
    if not cited_pages or len(set(cited_pages)) != len(cited_pages):
        return None

    context_terms = {
        word for word in re.findall(r"[a-z0-9]+", context.casefold())
        if len(word) > 3 and word not in COMMON_WORDS
    }
    evidence: list[SourceEvidence] = []
    for page_number in cited_pages:
        source_text = source_pages.get(page_number)
        if not source_text:
            return None

        normalized_source = " ".join(source_text.split())
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+|\s*\n+\s*", normalized_source)
            if sentence.strip()
        ]
        if not sentences:
            return None

        ranked = []
        for sentence in sentences:
            sentence_terms = set(re.findall(r"[a-z0-9]+", sentence.casefold()))
            shared = context_terms & sentence_terms
            ranked.append((len(shared), sentence, shared))
        overlap, quote, shared = max(ranked, key=lambda item: (item[0], -len(item[1])))
        if overlap == 0:
            return None
        quote = quote[:400].rstrip()
        # Only report words that are visible in the (possibly truncated) quote.
        visible_terms = {word for word in re.findall(r"[a-z0-9]+", quote.casefold())}
        shared_terms = sorted(shared & visible_terms)[:8]
        evidence.append(
            SourceEvidence(
                page_number=page_number,
                quote=quote,
                shared_terms=shared_terms,
                match_strength="strong" if len(shared_terms) >= STRONG_MATCH_MIN_SHARED_TERMS else "weak",
            )
        )

    return evidence


def validate_source_evidence(
    cited_pages: list[int],
    evidence: list[SourceEvidence],
    source_pages: dict[int, str],
) -> bool:
    """Check that cited pages have short excerpts present in the supplied PDF text."""
    evidence_pages = {item.page_number for item in evidence}
    if not evidence or len(evidence_pages) != len(set(cited_pages)):
        return False
    if evidence_pages != set(cited_pages) or len(set(cited_pages)) != len(cited_pages):
        return False

    for item in evidence:
        source_text = source_pages.get(item.page_number)
        if source_text is None:
            return False
        normalized_quote = " ".join(item.quote.casefold().split())
        normalized_source = " ".join(source_text.casefold().split())
        if not normalized_quote or normalized_quote not in normalized_source:
            return False
    return True
