export type ExtractedPage = {
  page_number: number
  text: string
}

export type ExtractedDocument = {
  filename: string
  page_count: number
  character_count: number
  pages: ExtractedPage[]
}

export type LessonSection = {
  heading: string
  explanation: string
  source_pages: number[]
  source_evidence: SourceEvidence[]
}

export type LessonTerm = {
  term: string
  definition: string
  source_pages: number[]
  source_evidence: SourceEvidence[]
}

export type SourceEvidence = {
  page_number: number
  quote: string
  /** Important words found in both the AI text and the quote. */
  shared_terms: string[]
  /** "strong" = several shared words. Neither value proves the AI text is correct. */
  match_strength: 'strong' | 'weak'
}

export type OllamaStatus = {
  reachable: boolean
  model: string
  model_installed: boolean
  message: string
}

export type SimplifiedLesson = {
  title: string
  sections: LessonSection[]
  key_terms: LessonTerm[]
}

export type PracticeQuestion = {
  question: string
  options: string[]
  source_pages: number[]
  source_evidence: SourceEvidence[]
}

export type QuestionSet = {
  session_id: string
  difficulty: string
  strategy: string
  recommendation: string
  adaptation_reason: string
  questions: PracticeQuestion[]
}

export type ProgressSummary = {
  attempt_count: number
  correct_count: number
  session_count: number
  accuracy_percent: number | null
  recent_attempt_count: number
  recent_accuracy_percent: number | null
  next_recommendation: string
  next_difficulty: string
  next_adaptation_reason: string
}

export type AnswerResult = {
  is_correct: boolean
  correct_option_index: number
  explanation: string
  source_pages: number[]
  progress: Omit<ProgressSummary, 'next_recommendation' | 'next_difficulty' | 'next_adaptation_reason'>
  next_recommendation: string
  next_difficulty: string
  next_adaptation_reason: string
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export async function extractPdf(file: File): Promise<ExtractedDocument> {
  const formData = new FormData()
  formData.append('file', file)

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/documents/extract`, {
      method: 'POST',
      body: formData,
    })
  } catch {
    throw new Error('Could not connect to LearnAble AI. Check that the API is running and try again.')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'The PDF could not be processed. Please try another file.')
  }

  return (await response.json()) as ExtractedDocument
}

export async function simplifyLesson(pages: ExtractedDocument['pages']): Promise<SimplifiedLesson> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/lessons/simplify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    })
  } catch {
    throw new Error('Could not connect to LearnAble AI. Check that the API is running and try again.')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'The explanation could not be created. Please try again.')
  }
  return (await response.json()) as SimplifiedLesson
}

export async function generateQuestions(pages: ExtractedDocument['pages'], learnerId: string): Promise<QuestionSet> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/api/questions/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages, learner_id: learnerId }),
    })
  } catch {
    throw new Error('Could not connect to LearnAble AI. Check that the API is running and try again.')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'Practice questions could not be created. Please try again.')
  }
  return (await response.json()) as QuestionSet
}

export async function submitAnswer(
  sessionId: string,
  learnerId: string,
  questionIndex: number,
  selectedOptionIndex: number,
): Promise<AnswerResult> {
  const response = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ learner_id: learnerId, question_index: questionIndex, selected_option_index: selectedOptionIndex }),
  }).catch(() => {
    throw new Error('Could not connect to LearnAble AI. Check that the API is running and try again.')
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail ?? 'Your answer could not be saved. Please try again.')
  }
  return (await response.json()) as AnswerResult
}

export async function fetchProgress(learnerId: string): Promise<ProgressSummary> {
  const response = await fetch(`${API_BASE_URL}/api/progress/${learnerId}`).catch(() => {
    throw new Error('Could not load practice progress.')
  })
  if (!response.ok) throw new Error('Could not load practice progress.')
  return (await response.json()) as ProgressSummary
}

export async function fetchOllamaStatus(): Promise<OllamaStatus> {
  const response = await fetch(`${API_BASE_URL}/api/health/ollama`).catch(() => {
    throw new Error('Could not connect to LearnAble AI. Check that the API is running.')
  })
  if (!response.ok) throw new Error('Could not check local AI status.')
  return (await response.json()) as OllamaStatus
}
