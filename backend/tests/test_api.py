import pymupdf as fitz
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def make_pdf(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_upload_extracts_pdf_text():
    response = client.post(
        "/api/documents/extract",
        files={"file": ("lesson.pdf", make_pdf("Photosynthesis uses light."), "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "lesson.pdf"
    assert body["page_count"] == 1
    assert body["pages"] == [{"page_number": 1, "text": "Photosynthesis uses light."}]


def test_upload_rejects_wrong_extension():
    response = client.post(
        "/api/documents/extract",
        files={"file": ("lesson.txt", b"not a pdf", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Please choose a PDF file."


def test_upload_rejects_pdf_without_text():
    document = fitz.open()
    document.new_page()
    data = document.tobytes()
    document.close()

    response = client.post(
        "/api/documents/extract",
        files={"file": ("scan.pdf", data, "application/pdf")},
    )

    assert response.status_code == 422
    assert "No selectable text" in response.json()["detail"]


def test_simplify_endpoint_returns_structured_lesson(monkeypatch):
    from app.services.lesson_simplification import SimplifiedLesson, LessonSection
    from app.services.evidence import SourceEvidence
    import app.main as main

    monkeypatch.setattr(
        main,
        "simplify_source_pages",
        lambda pages: SimplifiedLesson(
            title="A simple lesson",
            sections=[LessonSection(
                heading="Main idea",
                explanation="Plants make food.",
                source_pages=[1],
                source_evidence=[SourceEvidence(page_number=1, quote="Plants use light to make food.")],
            )],
            key_terms=[],
        ),
    )
    response = client.post(
        "/api/lessons/simplify",
        json={"pages": [{"page_number": 1, "text": "Plants use light to make food."}]},
    )

    assert response.status_code == 200
    assert response.json()["sections"][0]["source_pages"] == [1]


def test_simplify_endpoint_explains_local_ollama_unavailable(monkeypatch):
    from app.main import OllamaUnavailableError
    import app.main as main

    def missing_key(_pages):
        raise OllamaUnavailableError("Ollama is not responding on this Mac. Open the Ollama app, then retry.")

    monkeypatch.setattr(main, "simplify_source_pages", missing_key)
    response = client.post(
        "/api/lessons/simplify",
        json={"pages": [{"page_number": 1, "text": "Plants use light."}]},
    )

    assert response.status_code == 503
    assert "Ollama" in response.json()["detail"]


def test_simplify_endpoint_rejects_duplicate_source_pages():
    response = client.post(
        "/api/lessons/simplify",
        json={"pages": [
            {"page_number": 1, "text": "First"},
            {"page_number": 1, "text": "Duplicate"},
        ]},
    )

    assert response.status_code == 422


def test_question_generation_endpoint_returns_three_practice_questions(monkeypatch, tmp_path):
    from app.services.question_generation import GeneratedQuestion, QuestionSet
    from app.services.evidence import SourceEvidence
    import app.main as main
    import uuid

    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "questions.sqlite3"))

    monkeypatch.setattr(
        main,
        "generate_questions",
        lambda pages, *, difficulty: QuestionSet(questions=[
            GeneratedQuestion(
                question=f"Question {index + 1}?",
                options=["Water", "Sunlight", "Soil", "Wind"],
                correct_option_index=1,
                explanation="Plants use sunlight.",
                source_pages=[1],
                source_evidence=[SourceEvidence(page_number=1, quote="Plants use sunlight.")],
            )
            for index in range(3)
        ]),
    )
    response = client.post(
        "/api/questions/generate",
        json={"learner_id": str(uuid.uuid4()), "pages": [{"page_number": 1, "text": "Plants use sunlight."}]},
    )

    assert response.status_code == 200
    assert len(response.json()["questions"]) == 3
    assert response.json()["questions"][0]["source_pages"] == [1]
    assert "correct_option_index" not in response.json()["questions"][0]


def test_answer_endpoint_records_attempt_and_returns_progress(monkeypatch, tmp_path):
    from app.services.question_generation import GeneratedQuestion, QuestionSet
    from app.services.evidence import SourceEvidence
    import app.main as main
    import uuid

    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "progress.sqlite3"))
    monkeypatch.setattr(
        main,
        "generate_questions",
        lambda pages, *, difficulty: QuestionSet(questions=[
            GeneratedQuestion(
                question="What do plants use?",
                options=["Water", "Sunlight", "Soil", "Wind"],
                correct_option_index=1,
                explanation="The source says plants use sunlight.",
                source_pages=[1],
                source_evidence=[SourceEvidence(page_number=1, quote="Plants use sunlight.")],
            )
        ]),
    )
    learner_id = str(uuid.uuid4())
    generated = client.post(
        "/api/questions/generate",
        json={"learner_id": learner_id, "pages": [{"page_number": 1, "text": "Plants use sunlight."}]},
    )
    session_id = generated.json()["session_id"]

    answer = client.post(
        f"/api/sessions/{session_id}/answers",
        json={"learner_id": learner_id, "question_index": 0, "selected_option_index": 1},
    )

    assert answer.status_code == 200
    assert answer.json()["is_correct"] is True
    assert answer.json()["progress"]["attempt_count"] == 1
    assert answer.json()["progress"]["correct_count"] == 1
    assert answer.json()["next_difficulty"] == "steady"

    progress = client.get(f"/api/progress/{learner_id}")
    assert progress.status_code == 200
    assert progress.json()["attempt_count"] == 1
    assert progress.json()["accuracy_percent"] == 100

    # Simulate another request winning the unique-index race after the precheck.
    monkeypatch.setattr(main, "has_attempt", lambda *_args: False)
    monkeypatch.setattr(main, "save_attempt", lambda *_args: False)
    duplicate = client.post(
        f"/api/sessions/{session_id}/answers",
        json={"learner_id": learner_id, "question_index": 0, "selected_option_index": 1},
    )
    assert duplicate.status_code == 409


def test_progress_is_isolated_by_anonymous_learner_id(monkeypatch, tmp_path):
    import uuid
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "isolated.sqlite3"))
    learner_id = str(uuid.uuid4())

    response = client.get(f"/api/progress/{learner_id}")

    assert response.status_code == 200
    assert response.json()["attempt_count"] == 0
    assert response.json()["accuracy_percent"] is None


def test_adaptive_recommendation_remains_available_when_ollama_is_offline(monkeypatch, tmp_path):
    import uuid
    import app.main as main
    from app.services.ollama_client import OllamaUnavailableError

    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "offline.sqlite3"))

    def unavailable(*_args, **_kwargs):
        raise OllamaUnavailableError("Ollama is not responding on this Mac. Open the Ollama app, then retry.")

    monkeypatch.setattr(main, "generate_questions", unavailable)
    learner_id = str(uuid.uuid4())

    generation = client.post(
        "/api/questions/generate",
        json={"learner_id": learner_id, "pages": [{"page_number": 1, "text": "Plants use sunlight."}]},
    )
    progress = client.get(f"/api/progress/{learner_id}")

    assert generation.status_code == 503
    assert "Ollama" in generation.json()["detail"]
    assert progress.status_code == 200
    assert progress.json()["next_difficulty"] == "steady"
