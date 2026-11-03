"""End-to-end SMOKE TEST against a running backend and real local Ollama.

This checks that the pipeline runs and returns well-formed output. It is NOT a
model-accuracy evaluation: it does not judge whether explanations or questions are
correct. Latency numbers are one run on one machine.

Usage (backend running on :8000):  python scripts/smoke_test.py [path/to/file.pdf]
Exit code 0 = all steps passed, 1 = a step failed, 2 = local AI not ready (nothing generated).
"""
import sys
import time
import uuid
from pathlib import Path

import httpx

BASE = "http://127.0.0.1:8000"
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "samples" / "photosynthesis-sample.pdf"
results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, detail: str = "") -> bool:
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f": {detail}" if detail else ""), flush=True)
    return ok


def finish(code: int) -> None:
    print(f"\nSmoke test (not an accuracy evaluation): {sum(r[1] for r in results)}/{len(results)} checks passed.")
    sys.exit(code)


http = httpx.Client(base_url=BASE, timeout=httpx.Timeout(300.0, connect=3.0), trust_env=False)
try:
    http.get("/api/health").raise_for_status()
except httpx.HTTPError as exc:
    record("backend reachable", False, f"{exc}. Start it first: uvicorn app.main:app")
    finish(1)
record("backend reachable", True)

started = time.perf_counter()
with PDF.open("rb") as handle:
    extracted = http.post("/api/documents/extract", files={"file": (PDF.name, handle, "application/pdf")})
record("PDF extraction", extracted.status_code == 200, f"{time.perf_counter() - started:.2f}s")
if extracted.status_code != 200:
    finish(1)
pages = extracted.json()["pages"]
page_text = {p["page_number"]: " ".join(p["text"].casefold().split()) for p in pages}


def quotes_present(items) -> bool:
    """Independent re-check that every quote really appears on its cited page."""
    return all(" ".join(e["quote"].casefold().split()) in page_text[e["page_number"]] for item in items for e in item["source_evidence"])


status = http.get("/api/health/ollama").json()
if not (status["reachable"] and status["model_installed"]):
    print(f"Local AI not ready: {status['message']}")
    print("PDF extraction (which does not need Ollama) was checked above; generation steps were not run.")
    finish(2)
record("local Ollama ready", True, status["model"])

started = time.perf_counter()
lesson = http.post("/api/lessons/simplify", json={"pages": pages})
lesson_seconds = time.perf_counter() - started
if record("lesson generation", lesson.status_code == 200, f"HTTP {lesson.status_code}, {lesson_seconds:.1f}s" + ("" if lesson.status_code == 200 else f", {lesson.text[:200]}")):
    body = lesson.json()
    record("lesson quotes appear on cited pages (not a correctness check)", quotes_present(body["sections"] + body["key_terms"]), f"{len(body['sections'])} sections")

learner = str(uuid.uuid4())
started = time.perf_counter()
questions = http.post("/api/questions/generate", json={"pages": pages, "learner_id": learner})
question_seconds = time.perf_counter() - started
if record("question generation", questions.status_code == 200, f"HTTP {questions.status_code}, {question_seconds:.1f}s" + ("" if questions.status_code == 200 else f", {questions.text[:200]}")):
    qset = questions.json()
    record("question quotes appear on cited pages (not a correctness check)", quotes_present(qset["questions"]), f"{len(qset['questions'])} questions")
    answer = http.post(f"/api/sessions/{qset['session_id']}/answers", json={"learner_id": learner, "question_index": 0, "selected_option_index": 0})
    record("answer saved and progress returned", answer.status_code == 200 and answer.json()["progress"]["attempt_count"] == 1)
    progress = http.get(f"/api/progress/{learner}").json()
    record("adaptation reason present", bool(progress.get("next_adaptation_reason")), progress.get("next_adaptation_reason", ""))

finish(0 if all(r[1] for r in results) else 1)
