"""Tests for local-Ollama reliability, loopback-only inference, and stored-data privacy."""

import sqlite3
import uuid

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.db import repository
from app.services import ollama_client
from app.services.evidence import SourceEvidence
from app.services.lesson_simplification import LessonGenerationError
from app.services.ollama_client import (
    OllamaGenerationError,
    OllamaUnavailableError,
    check_ollama_status,
    generate_structured,
)
from app.services.question_generation import (
    GeneratedQuestionDraft,
    QuestionSetDraft,
    generate_questions,
)

client = TestClient(main.app)


class StatusClient:
    def __init__(self, payload=None, error=None):
        self.payload, self.error, self.urls = payload, error, []

    def get(self, url, *, timeout):
        self.urls.append(url)
        if self.error:
            raise self.error
        outer = self

        class Response:
            def json(self_inner):
                return outer.payload

        return Response()


def test_status_reports_ollama_not_running():
    status = check_ollama_status(client=StatusClient(error=httpx.ConnectError("refused")))

    assert status["reachable"] is False
    assert "not running" in status["message"]


def test_status_reports_missing_model_with_the_pull_command(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "qwen3.5:4b")
    status = check_ollama_status(client=StatusClient(payload={"models": [{"name": "llama3.2:3b"}]}))

    assert status["reachable"] is True and status["model_installed"] is False
    assert "ollama pull qwen3.5:4b" in status["message"]


def test_status_reports_ready_and_only_contacts_loopback(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "qwen3.5:4b")
    fake = StatusClient(payload={"models": [{"name": "qwen3.5:4b"}]})

    status = check_ollama_status(client=fake)

    assert status["model_installed"] is True
    assert fake.urls == ["http://127.0.0.1:11434/api/tags"]


def test_status_rejects_cloud_model_tags_without_any_network_call(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "something:cloud")
    fake = StatusClient(payload={"models": []})

    status = check_ollama_status(client=fake)

    assert status["reachable"] is False and fake.urls == []


def test_ollama_health_endpoint_works_when_ollama_is_offline(monkeypatch):
    monkeypatch.setattr(main, "check_ollama_status", lambda: check_ollama_status(client=StatusClient(error=httpx.ConnectError("x"))))

    response = client.get("/api/health/ollama")

    assert response.status_code == 200 and response.json()["reachable"] is False


def test_http_client_ignores_proxy_environment_variables(monkeypatch):
    monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("HTTP_PROXY", "http://proxy.example:8080")
    monkeypatch.setenv("ALL_PROXY", "http://proxy.example:8080")

    with ollama_client._local_client() as http:
        assert http.trust_env is False


def test_inference_url_is_fixed_loopback():
    assert ollama_client.OLLAMA_API_URL.startswith("http://127.0.0.1:")
    assert ollama_client.OLLAMA_TAGS_URL.startswith("http://127.0.0.1:")


class SlowClient:
    def post(self, url, *, json, timeout):
        raise httpx.ReadTimeout("slow")


def test_slow_model_is_reported_as_slow_not_as_not_running():
    with pytest.raises(OllamaUnavailableError) as caught:
        generate_structured(QuestionSetDraft, [], max_output_tokens=10, client=SlowClient())

    assert "longer than" in str(caught.value)
    assert "not responding" not in str(caught.value)


class FlakyClient:
    """Returns invalid JSON first, then a valid question set."""

    def __init__(self):
        self.calls = 0

    def post(self, url, *, json, timeout):
        self.calls += 1
        content = "not json" if self.calls == 1 else QuestionSetDraft(questions=[
            GeneratedQuestionDraft(
                question="What do plants use?", options=["Water", "Sunlight", "Soil", "Wind"],
                correct_option_index=1, explanation="Plants use sunlight.", source_pages=[1],
            )
        ]).model_dump_json()

        class Response:
            status_code = 200

            def json(self_inner):
                return {"message": {"content": content}}

        return Response()


def test_retries_once_after_an_invalid_structured_response():
    flaky = FlakyClient()

    result = generate_structured(QuestionSetDraft, [], max_output_tokens=10, client=flaky)

    assert flaky.calls == 2 and len(result.questions) == 1


def test_gives_up_after_two_invalid_responses():
    class AlwaysBad(FlakyClient):
        def post(self, url, *, json, timeout):
            self.calls += 1

            class Response:
                status_code = 200

                def json(self_inner):
                    return {"message": {"content": "still not json"}}

            return Response()

    bad = AlwaysBad()
    with pytest.raises(OllamaGenerationError):
        generate_structured(QuestionSetDraft, [], max_output_tokens=10, client=bad)
    assert bad.calls == 2


def test_question_evidence_ignores_wrong_answer_choices():
    """A distractor that matches a different sentence must not steer the quote."""
    pages = [{"page_number": 1, "text": "Plants use sunlight to make food. Volcanoes erupt with lava and ash."}]
    draft = QuestionSetDraft(questions=[
        GeneratedQuestionDraft(
            question="What do plants use to make food?",
            options=["Volcanoes lava ash eruptions", "Sunlight", "Cold", "Silence"],
            correct_option_index=1,
            explanation="Plants use sunlight.",
            source_pages=[1],
        )
    ])

    class Client:
        def post(self, url, *, json, timeout):
            class Response:
                status_code = 200

                def json(self_inner):
                    return {"message": {"content": draft.model_dump_json()}}

            return Response()

    result = generate_questions(pages, client=Client())

    assert result.questions[0].source_evidence[0].quote == "Plants use sunlight to make food."


def test_pdf_quotes_are_not_saved_to_sqlite(monkeypatch, tmp_path):
    from app.services.question_generation import GeneratedQuestion, QuestionSet

    db_path = tmp_path / "privacy.sqlite3"
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(db_path))
    secret_quote = "A verbatim sentence from a private PDF."
    question_set = QuestionSet(questions=[
        GeneratedQuestion(
            question="Q?", options=["a", "b", "c", "d"], correct_option_index=0, explanation="e",
            source_pages=[1], source_evidence=[SourceEvidence(page_number=1, quote=secret_quote)],
        )
    ])

    repository.save_practice_session(str(uuid.uuid4()), question_set, "steady", "s")

    raw = sqlite3.connect(db_path)
    stored = "".join(str(value) for row in raw.execute("SELECT * FROM practice_questions") for value in row)
    raw.close()
    assert secret_quote not in stored


def test_old_databases_have_saved_quotes_cleared_on_next_open(monkeypatch, tmp_path):
    db_path = tmp_path / "legacy.sqlite3"
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(db_path))
    repository.get_progress(str(uuid.uuid4()))  # creates the schema
    raw = sqlite3.connect(db_path)
    raw.execute("INSERT INTO practice_sessions VALUES ('s1','l1','now','steady','x',1)")
    raw.execute(
        "INSERT INTO practice_questions VALUES ('s1',0,'Q','[]',0,'e','[1]','[{\"quote\":\"old private text\"}]')"
    )
    raw.commit()
    raw.close()

    repository.get_progress("l1")  # any access runs the scrub

    raw = sqlite3.connect(db_path)
    value = raw.execute("SELECT source_evidence_json FROM practice_questions").fetchone()[0]
    raw.close()
    assert value == "[]"


def test_progress_and_practice_payloads_include_the_adaptation_reason(monkeypatch, tmp_path):
    monkeypatch.setenv("LEARNABLE_DB_PATH", str(tmp_path / "reason.sqlite3"))

    response = client.get(f"/api/progress/{uuid.uuid4()}")

    assert response.status_code == 200
    assert "not enough saved answers" in response.json()["next_adaptation_reason"]
