# Architecture and implementation plan

## Current milestones

React + TypeScript frontend sends a PDF to FastAPI. FastAPI validates size, extension, PDF signature, page count, encryption, and extracted text. A PDF service uses PyMuPDF and returns page-numbered text. The browser renders the extracted text in a readable preview and communicates loading and error states accessibly. The upload is held in memory only.

The second milestone sends selected extracted page text from the browser to a simplification service. The backend calls Ollama on loopback (`127.0.0.1:11434`) and requests a Pydantic JSON schema for lesson sections and vocabulary. The default local model is `qwen3.5:4b`. The model returns page references, then the backend selects exact source sentences related to the generated text, normalizes whitespace, and verifies each excerpt occurs in its cited page. This avoids model-composed quotes, which can be slow or inaccurate. It does not prove every generated sentence is entailed by the excerpt, so the UI exposes the excerpt and asks learners to check the original page.

The third milestone creates up to three multiple-choice practice questions, each with a verbatim support excerpt validated against the cited page. The service rejects repeated questions and repeated answer choices. The learner answers one at a time, receives the generated answer explanation, and can open the source page or inspect the excerpt. The correct option stays in SQLite and is returned only after an answer is submitted. Evidence checks reduce citation errors but do not establish complete factual correctness.

The fourth milestone stores anonymous practice sessions and answers in SQLite. A random ID in browser local storage separates progress between browser profiles; it is a lightweight demo identity, not account security. The database keeps generated questions, answer options, explanations, page numbers, and attempts. It does not keep source PDFs, extracted page text, or the verbatim PDF excerpts shown as evidence; those exist only in the browser's memory. Generated questions are model-written text derived from the PDF, so they can still reflect its content. The adaptive service applies explicit thresholds to the five most recent attempts: fewer than three attempts uses steady wording; under 50% accuracy uses supported, direct questions; 80% or higher uses gentle cross-idea questions; otherwise the style remains steady. Recommendations are prompts for practice, not evidence of learning gains.

The fifth milestone adds client-side reading controls for text size, line and letter spacing, font family, background contrast, and speech speed. Web Speech API reads a simplified lesson or one extracted page at a time; playback controls pause, resume, or stop. Preferences stay in browser storage. This provides adjustable presentation but is not a dyslexia diagnosis or a claim that one style works for every learner.

The sixth milestone checks the AI request limits in the browser after PDF extraction. Learners can select pages for a lesson or question set; only checked pages are sent. Selections over 50,000 characters total, with a page over 10,000 characters, or with no selected pages are blocked with a clear message. This mirrors the backend limits and lets learners choose a shorter section without editing the PDF elsewhere.

The seventh milestone adds a visible-on-focus skip link before the header. It moves keyboard focus to the main learning workflow so keyboard users can bypass repeated navigation.

## Current structure

```text
frontend/src/          React UI, API client, and UI tests
backend/app/main.py    FastAPI routes and request/response schemas
backend/app/services/ PDF extraction, local Ollama generation, evidence, adaptation
backend/app/db/        SQLite persistence for practice attempts
backend/tests/         API and service tests
docs/                  Architecture, deployment, and manual checks
```

## Verification completed

- Lesson and question responses use validated structured schemas and require excerpts that are present in cited PDF pages. These checks do not prove all generated claims are correct; no live model quality evaluation has been run.
- Browser storage is validated before reading settings are restored, and AI text limits are checked before requests.
- Lesson and question generation use fixed maximum output-token budgets. If a response is cut off, structured parsing fails and the UI shows an error instead of presenting partial output as complete.
- Frontend tests cover keyboard skip navigation, reading controls, text-to-speech controls, source-page selection, asynchronous status announcements, and generated lesson/answer states.
- axe-core checks the initial, uploaded, generated lesson, and answered-question DOM states. Its color contrast rule is excluded under jsdom because jsdom lacks the canvas support axe uses for contrast measurement. A separate test checks the app's defined foreground/background pairs against WCAG AA's 4.5:1 threshold.
- Backend and frontend test commands are in the README.
- A GitHub Actions workflow runs both test suites and the frontend production build on pushes and pull requests, without requiring model credentials.

## Remaining launch checks

1. Follow [the manual accessibility checklist](accessibility-checklist.md) with real browsers and a screen reader. Automated DOM checks cannot confirm VoiceOver announcements, the actual visible focus treatment, browser speech voices, or PDF behavior across devices.
2. There is no hosted deployment: a remote backend cannot reach Ollama running on a developer's Mac (see `deployment.md`).
3. Run one real end-to-end lesson and practice workflow with a suitable sample PDF after installing Ollama and pulling the model. Record issues from the actual local model response; do not describe fixture tests as model evaluation.

## Decisions

- The API boundary is explicit from the first slice so the frontend can later use the same services when the workflow grows.
- PDF bytes are not stored. The app returns extracted text only; later persistence should be intentional because uploaded educational material can contain sensitive information.
- PDF parsing is isolated in a service so it can be tested independently and replaced or extended with OCR later.
- The first milestone fails clearly for image-only PDFs instead of pretending that no extracted text means the document has no content.


## Evidence: what it does and does not show

For each lesson section, key term, and question, the model names the page numbers it relied on. `evidence.py` then picks the sentence on each cited page that shares the most important words with the generated text, confirms the sentence really appears on that page, and returns the shared words and a "strong/weak" label (three or more shared words = strong). For questions, only the question, correct answer, and explanation are matched; wrong answer choices are ignored.

This is keyword matching. It shows where to look, not that the generated claim is true. A test (`test_keyword_overlap_can_pick_a_sentence_that_does_not_support_the_claim`) documents a case where the picked sentence says the opposite. The UI says so and links to the full page text.

## Local AI reliability

`GET /api/health/ollama` reports whether Ollama is reachable and the model is installed; the UI shows this on load with a re-check button. Generation retries once on an invalid structured response. A timeout is reported as "slow" rather than "not running". The HTTP client ignores proxy environment variables so loopback traffic cannot be rerouted.
