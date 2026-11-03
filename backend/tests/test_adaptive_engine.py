from app.services.adaptive_engine import choose_adaptive_plan


def test_starts_with_steady_questions_without_enough_answers():
    plan = choose_adaptive_plan(2, 100)

    assert plan.difficulty == "steady"
    assert "starting point" in plan.recommendation


def test_recommends_supported_questions_after_low_recent_accuracy():
    plan = choose_adaptive_plan(5, 40)

    assert plan.difficulty == "supported"
    assert "shorter questions" in plan.strategy


def test_recommends_gentle_stretch_after_high_recent_accuracy():
    plan = choose_adaptive_plan(5, 80)

    assert plan.difficulty == "stretch"
    assert "connect related ideas" in plan.recommendation


def test_uses_steady_questions_in_middle_band():
    plan = choose_adaptive_plan(4, 67)

    assert plan.difficulty == "steady"


def test_every_plan_explains_why_with_the_actual_numbers():
    low = choose_adaptive_plan(5, 40)
    high = choose_adaptive_plan(5, 100)
    middle = choose_adaptive_plan(4, 75)
    new_learner = choose_adaptive_plan(1, 100)

    assert "2 of your last 5" in low.reason and "40%" in low.reason and "under 50%" in low.reason
    assert "5 of your last 5" in high.reason and "80% or more" in high.reason
    assert "3 of your last 4" in middle.reason and "between 50% and 79%" in middle.reason
    assert "not enough saved answers" in new_learner.reason


def test_threshold_boundaries():
    assert choose_adaptive_plan(5, 49).difficulty == "supported"
    assert choose_adaptive_plan(5, 50).difficulty == "steady"
    assert choose_adaptive_plan(5, 79).difficulty == "steady"
    assert choose_adaptive_plan(5, 80).difficulty == "stretch"
    assert choose_adaptive_plan(2, 0).difficulty == "steady"
