import json
import os
from uuid import UUID

from pydantic import BaseModel, Field, model_validator
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from app.services.pdf_extraction import MAX_UPLOAD_BYTES, PdfProcessingError, extract_pdf_text
from app.services.lesson_simplification import (
    LessonGenerationError,
    SimplifiedLesson,
    simplify_source_pages,
)
from app.services.ollama_client import OllamaUnavailableError, check_ollama_status
from app.services.question_generation import QuestionSet, generate_questions
from app.services.evidence import SourceEvidence
from app.db.repository import get_progress, has_attempt, load_question_for_learner, save_attempt, save_practice_session
from app.services.adaptive_engine import choose_adaptive_plan

app = FastAPI(title="LearnAble AI API", version="0.1.0")

configured_origins = [origin.strip() for origin in os.getenv("FRONTEND_ORIGINS", "").split(",") if origin.strip()]
if not configured_origins:
    configured_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class SourcePage(BaseModel):
    page_number: int = Field(ge=1, le=100)
    text: str = Field(max_length=10_000)


class SimplificationRequest(BaseModel):
    pages: list[SourcePage] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_source_pages(self):
        page_numbers = [page.page_number for page in self.pages]
        if len(set(page_numbers)) != len(page_numbers):
            raise ValueError("Page numbers must be unique.")
        if sum(len(page.text) for page in self.pages) > 50_000:
            raise ValueError("This material is too long for one lesson. Upload a shorter section (50,000 characters maximum).")
        if not any(page.text.strip() for page in self.pages):
            raise ValueError("There is no extracted text to simplify.")
        return self


class QuestionGenerationRequest(SimplificationRequest):
    learner_id: UUID


class PracticeQuestionResponse(BaseModel):
    question: str
    options: list[str]
    source_pages: list[int]
    source_evidence: list[SourceEvidence]


class PracticeSetResponse(BaseModel):
    session_id: str
    difficulty: str
    strategy: str
    recommendation: str
    adaptation_reason: str
    questions: list[PracticeQuestionResponse]


class AnswerRequest(BaseModel):
    learner_id: UUID
    question_index: int = Field(ge=0, le=2)
    selected_option_index: int = Field(ge=0, le=3)


class AnswerResponse(BaseModel):
    is_correct: bool
    correct_option_index: int
    explanation: str
    source_pages: list[int]
    progress: dict
    next_recommendation: str
    next_difficulty: str
    next_adaptation_reason: str


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/health/ollama")
def ollama_health() -> dict:
    """Tell the UI whether local Ollama and the configured model are ready.

    PDF extraction, reading controls, progress, and adaptive recommendations do not
    need Ollama; lesson and question generation do.
    """
    return check_ollama_status()


@app.post("/api/documents/extract")
async def upload_and_extract(file: UploadFile = File(...)) -> dict:
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Please choose a PDF file.")

    # Read one extra byte so oversized uploads can be rejected without loading the
    # entire request body into memory.
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="The PDF must be 10 MB or smaller.")

    try:
        extracted = extract_pdf_text(filename, data)
    except PdfProcessingError as exc:
        status_code = 422
        if "10 MB" in str(exc):
            status_code = 413
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc

    return {
        "filename": filename,
        "page_count": extracted.page_count,
        "character_count": extracted.character_count,
        "pages": [
            {"page_number": page.page_number, "text": page.text}
            for page in extracted.pages
        ],
    }


@app.post("/api/lessons/simplify", response_model=SimplifiedLesson)
def simplify_lesson(request: SimplificationRequest) -> SimplifiedLesson:
    try:
        return simplify_source_pages([page.model_dump() for page in request.pages])
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LessonGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/questions/generate", response_model=PracticeSetResponse)
def create_practice_questions(request: QuestionGenerationRequest) -> PracticeSetResponse:
    try:
        progress = get_progress(str(request.learner_id))
        plan = choose_adaptive_plan(progress["recent_attempt_count"], progress["recent_accuracy_percent"])
        generated = generate_questions(
            [page.model_dump() for page in request.pages],
            difficulty=plan.difficulty,
        )
        session_id = save_practice_session(str(request.learner_id), generated, plan.difficulty, plan.strategy)
        return PracticeSetResponse(
            session_id=session_id,
            difficulty=plan.difficulty,
            strategy=plan.strategy,
            recommendation=plan.recommendation,
            adaptation_reason=plan.reason,
            questions=[
                PracticeQuestionResponse(
                    question=question.question,
                    options=question.options,
                    source_pages=question.source_pages,
                    source_evidence=question.source_evidence,
                )
                for question in generated.questions
            ],
        )
    except OllamaUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except LessonGenerationError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/sessions/{session_id}/answers", response_model=AnswerResponse)
def submit_practice_answer(session_id: str, request: AnswerRequest) -> AnswerResponse:
    question = load_question_for_learner(session_id, str(request.learner_id), request.question_index)
    if question is None:
        raise HTTPException(status_code=404, detail="Practice question was not found for this learner.")
    options = json.loads(question["options_json"])
    if request.selected_option_index >= len(options):
        raise HTTPException(status_code=422, detail="Choose one of the available answer options.")
    if has_attempt(session_id, request.question_index):
        raise HTTPException(status_code=409, detail="This question has already been answered.")

    is_correct = request.selected_option_index == question["correct_option_index"]
    if not save_attempt(session_id, request.question_index, request.selected_option_index, is_correct):
        raise HTTPException(status_code=409, detail="This question has already been answered.")
    progress = get_progress(str(request.learner_id))
    next_plan = choose_adaptive_plan(progress["recent_attempt_count"], progress["recent_accuracy_percent"])
    return AnswerResponse(
        is_correct=is_correct,
        correct_option_index=question["correct_option_index"],
        explanation=question["explanation"],
        source_pages=json.loads(question["source_pages_json"]),
        progress=progress,
        next_recommendation=next_plan.recommendation,
        next_difficulty=next_plan.difficulty,
        next_adaptation_reason=next_plan.reason,
    )


@app.get("/api/progress/{learner_id}")
def read_progress(learner_id: UUID) -> dict:
    progress = get_progress(str(learner_id))
    plan = choose_adaptive_plan(progress["recent_attempt_count"], progress["recent_accuracy_percent"])
    return {
        **progress,
        "next_recommendation": plan.recommendation,
        "next_difficulty": plan.difficulty,
        "next_adaptation_reason": plan.reason,
    }
