from dataclasses import dataclass


@dataclass(frozen=True)
class AdaptivePlan:
    difficulty: str
    strategy: str
    recommendation: str
    # Plain-language "why": the numbers and the rule that produced this plan.
    reason: str


MIN_ANSWERS_FOR_ADAPTATION = 3
SUPPORTED_BELOW_PERCENT = 50
STRETCH_AT_OR_ABOVE_PERCENT = 80


def choose_adaptive_plan(attempt_count: int, recent_accuracy_percent: int | None) -> AdaptivePlan:
    """Choose a small, explainable question-style adjustment from recent answers.

    This is a transparent rule over the last five saved answers. It is not a
    learned model and it is not a measure of learning or of any learning
    difference. Thresholds: fewer than 3 answers -> steady; under 50% ->
    supported; 80% or more -> stretch; otherwise steady.
    """
    if attempt_count < MIN_ANSWERS_FOR_ADAPTATION or recent_accuracy_percent is None:
        return AdaptivePlan(
            difficulty="steady",
            strategy="Starting with direct comprehension questions and clear wording.",
            recommendation="Answer a few practice questions to build a starting point.",
            reason="Why: there are not enough saved answers yet. The rule needs at least 3 of your last 5.",
        )

    correct = round(recent_accuracy_percent * attempt_count / 100)
    basis = f"Why: you answered {correct} of your last {attempt_count} questions correctly ({recent_accuracy_percent}%)"
    if recent_accuracy_percent < SUPPORTED_BELOW_PERCENT:
        return AdaptivePlan(
            difficulty="supported",
            strategy="Using shorter questions that focus on one key idea at a time.",
            recommendation="A short review of the key ideas may help before trying another question set.",
            reason=f"{basis}. That is under 50%, so the next set uses shorter, one-idea questions.",
        )
    if recent_accuracy_percent >= STRETCH_AT_OR_ABOVE_PERCENT:
        return AdaptivePlan(
            difficulty="stretch",
            strategy="Adding gentle questions that connect ideas from the source.",
            recommendation="Try another set that asks you to connect related ideas.",
            reason=f"{basis}. That is 80% or more, so the next set adds gentle questions that connect ideas.",
        )
    return AdaptivePlan(
        difficulty="steady",
        strategy="Continuing with direct questions about the source’s key ideas.",
        recommendation="Keep practising with clear questions about the key ideas.",
        reason=f"{basis}. That is between 50% and 79%, so the next set keeps the same direct style.",
    )
