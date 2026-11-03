import { useEffect, useRef, useState } from 'react'
import { BookOpen, Check, FileText, LoaderCircle, Sparkles, Upload, X } from 'lucide-react'
import { extractPdf, fetchOllamaStatus, fetchProgress, generateQuestions, simplifyLesson, submitAnswer, type AnswerResult, type ExtractedDocument, type OllamaStatus, type ProgressSummary, type QuestionSet, type SimplifiedLesson } from './api'
import { EvidenceList } from './EvidenceList'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_AI_SOURCE_CHARACTERS = 50_000
const MAX_AI_PAGE_CHARACTERS = 10_000

type ReadingPreferences = {
  fontSize: number
  lineSpacing: number
  letterSpacing: number
  fontFamily: 'sans' | 'serif'
  background: 'white' | 'warm' | 'contrast'
  speechRate: number
}

const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
  fontSize: 18,
  lineSpacing: 1.8,
  letterSpacing: 0.02,
  fontFamily: 'sans',
  background: 'white',
  speechRate: 0.9,
}

function loadReadingPreferences(): ReadingPreferences {
  try {
    const value = localStorage.getItem('learnable-reading-preferences')
    if (!value) return DEFAULT_READING_PREFERENCES
    const saved: unknown = JSON.parse(value)
    if (typeof saved !== 'object' || saved === null || Array.isArray(saved)) return DEFAULT_READING_PREFERENCES
    const preferences = saved as Partial<Record<keyof ReadingPreferences, unknown>>
    return {
      fontSize: safeNumber(preferences.fontSize, 16, 28, 1, DEFAULT_READING_PREFERENCES.fontSize),
      lineSpacing: safeNumber(preferences.lineSpacing, 1.4, 2.2, 0.1, DEFAULT_READING_PREFERENCES.lineSpacing),
      letterSpacing: safeNumber(preferences.letterSpacing, 0, 0.08, 0.01, DEFAULT_READING_PREFERENCES.letterSpacing),
      speechRate: safeNumber(preferences.speechRate, 0.7, 1.2, 0.1, DEFAULT_READING_PREFERENCES.speechRate),
      fontFamily: preferences.fontFamily === 'serif' ? 'serif' : 'sans',
      background: preferences.background === 'warm' || preferences.background === 'contrast' ? preferences.background : 'white',
    }
  } catch {
    return DEFAULT_READING_PREFERENCES
  }
}

function safeNumber(value: unknown, minimum: number, maximum: number, step: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const bounded = Math.min(maximum, Math.max(minimum, value))
  const stepped = minimum + Math.round((bounded - minimum) / step) * step
  return Number(stepped.toFixed(2))
}

const READING_BACKGROUNDS = {
  white: { backgroundColor: '#ffffff', color: '#252a25' },
  warm: { backgroundColor: '#fff8e8', color: '#342f25' },
  contrast: { backgroundColor: '#111827', color: '#ffffff' },
}

function getBrowserLearnerId(): string {
  try {
    const stored = localStorage.getItem('learnable-learner-id')
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) return stored
    const newId = crypto.randomUUID()
    localStorage.setItem('learnable-learner-id', newId)
    return newId
  } catch {
    return crypto.randomUUID()
  }
}

export default function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const documentRevision = useRef(0)
  const practiceSetVersion = useRef(0)
  const practiceSetRequestId = useRef(0)
  const [learnerId] = useState(getBrowserLearnerId)
  const [progress, setProgress] = useState<ProgressSummary | null>(null)
  const [readingPreferences, setReadingPreferences] = useState<ReadingPreferences>(loadReadingPreferences)
  const [speechStatus, setSpeechStatus] = useState<'idle' | 'speaking' | 'paused'>('idle')
  const [speechMessage, setSpeechMessage] = useState('')
  const [speechLabel, setSpeechLabel] = useState('')
  const speechId = useRef(0)
  const [document, setDocument] = useState<ExtractedDocument | null>(null)
  const [selectedPageNumbers, setSelectedPageNumbers] = useState<number[]>([])
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [lesson, setLesson] = useState<SimplifiedLesson | null>(null)
  const [isSimplifying, setIsSimplifying] = useState(false)
  const [lessonError, setLessonError] = useState('')
  const [practiceSet, setPracticeSet] = useState<QuestionSet | null>(null)
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null)
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [ollamaStatusError, setOllamaStatusError] = useState('')
  const [isCheckingOllama, setIsCheckingOllama] = useState(false)
  const [secondsWaiting, setSecondsWaiting] = useState(0)

  async function checkOllama() {
    setIsCheckingOllama(true)
    setOllamaStatusError('')
    try {
      setOllamaStatus(await fetchOllamaStatus())
    } catch (caught) {
      setOllamaStatus(null)
      setOllamaStatusError(caught instanceof Error ? caught.message : 'Could not check local AI status.')
    } finally {
      setIsCheckingOllama(false)
    }
  }

  useEffect(() => {
    void checkOllama()
  }, [])

  // Local models can take a minute. Counting seconds shows the app is still working.
  useEffect(() => {
    if (!isSimplifying && !isGeneratingQuestions) {
      setSecondsWaiting(0)
      return
    }
    const timer = window.setInterval(() => setSecondsWaiting((seconds) => seconds + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isSimplifying, isGeneratingQuestions])

  useEffect(() => {
    void fetchProgress(learnerId).then(setProgress).catch(() => setProgress(null))
  }, [learnerId])

  useEffect(() => {
    try {
      localStorage.setItem('learnable-reading-preferences', JSON.stringify(readingPreferences))
    } catch {
      // Preferences still apply for this page view when browser storage is unavailable.
    }
  }, [readingPreferences])

  useEffect(() => () => {
    speechId.current += 1
    window.speechSynthesis?.cancel()
  }, [])

  const readingStyle = {
    ...READING_BACKGROUNDS[readingPreferences.background],
    fontFamily: readingPreferences.fontFamily === 'serif' ? 'Georgia, serif' : 'Arial, Helvetica, sans-serif',
    fontSize: `${readingPreferences.fontSize}px`,
    lineHeight: readingPreferences.lineSpacing,
    letterSpacing: `${readingPreferences.letterSpacing}em`,
  }
  const selectedPages = document?.pages.filter((page) => selectedPageNumbers.includes(page.page_number)) ?? []
  const selectedCharacterCount = selectedPages.reduce((total, page) => total + page.text.length, 0)
  const selectedPagesOverLimit = selectedPages.some((page) => page.text.length > MAX_AI_PAGE_CHARACTERS)
  const sourceTooLongForAi = selectedPages.length === 0 || selectedCharacterCount > MAX_AI_SOURCE_CHARACTERS || selectedPagesOverLimit

  function updateReadingPreferences<K extends keyof ReadingPreferences>(key: K, value: ReadingPreferences[K]) {
    setReadingPreferences((current) => ({ ...current, [key]: value }))
  }

  function toggleSourcePage(pageNumber: number, checked: boolean) {
    setSelectedPageNumbers((current) => checked
      ? [...current, pageNumber].sort((left, right) => left - right)
      : current.filter((number) => number !== pageNumber))
  }

  function speakText(text: string, label: string) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      setSpeechMessage('Text-to-speech is not available in this browser. You can still read the text on screen.')
      return
    }
    speechId.current += 1
    const requestId = speechId.current
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = readingPreferences.speechRate
    utterance.onend = () => {
      if (speechId.current === requestId) setSpeechStatus('idle')
    }
    utterance.onerror = () => {
      if (speechId.current === requestId) {
        setSpeechStatus('idle')
        setSpeechMessage('The browser could not read this text aloud. Try again or use another browser.')
      }
    }
    setSpeechLabel(label)
    setSpeechMessage('')
    setSpeechStatus('speaking')
    window.speechSynthesis.speak(utterance)
  }

  function toggleSpeech() {
    if (!('speechSynthesis' in window)) return
    if (speechStatus === 'speaking') {
      window.speechSynthesis.pause()
      setSpeechStatus('paused')
    } else if (speechStatus === 'paused') {
      window.speechSynthesis.resume()
      setSpeechStatus('speaking')
    }
  }

  function stopSpeech() {
    speechId.current += 1
    window.speechSynthesis?.cancel()
    setSpeechStatus('idle')
    setSpeechLabel('')
  }

  async function handleFile(file?: File) {
    if (!file) return
    const revision = ++documentRevision.current
    practiceSetVersion.current += 1
    practiceSetRequestId.current += 1
    stopSpeech()
    setDocument(null)
    setSelectedPageNumbers([])
    setLesson(null)
    setLessonError('')
    setPracticeSet(null)
    setQuestionError('')
    setQuestionIndex(0)
    setSelectedOption(null)
    setAnswerResult(null)
    setIsSimplifying(false)
    setIsGeneratingQuestions(false)
    setIsSubmittingAnswer(false)
    setError('')
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Please choose a PDF file.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      setError('The PDF must be 10 MB or smaller.')
      return
    }
    setIsLoading(true)
    try {
      const extracted = await extractPdf(file)
      if (revision !== documentRevision.current) return
      setDocument(extracted)
      setSelectedPageNumbers(extracted.pages.map((page) => page.page_number))
    } catch (caught) {
      if (revision === documentRevision.current) {
        setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.')
      }
    } finally {
      if (revision === documentRevision.current) setIsLoading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function reset() {
    documentRevision.current += 1
    practiceSetVersion.current += 1
    practiceSetRequestId.current += 1
    stopSpeech()
    setDocument(null)
    setSelectedPageNumbers([])
    setLesson(null)
    setError('')
    setLessonError('')
    setPracticeSet(null)
    setQuestionError('')
    setQuestionIndex(0)
    setSelectedOption(null)
    setAnswerResult(null)
    setIsLoading(false)
    setIsSimplifying(false)
    setIsGeneratingQuestions(false)
    setIsSubmittingAnswer(false)
  }

  async function createLesson() {
    if (!document) return
    const revision = documentRevision.current
    const sourcePages = selectedPages
    setIsSimplifying(true)
    setLessonError('')
    try {
      const generatedLesson = await simplifyLesson(sourcePages)
      if (revision === documentRevision.current) setLesson(generatedLesson)
    } catch (caught) {
      if (revision === documentRevision.current) {
        setLessonError(caught instanceof Error ? caught.message : 'The explanation could not be created. Please try again.')
        void checkOllama()
      }
    } finally {
      if (revision === documentRevision.current) setIsSimplifying(false)
    }
  }

  async function createPracticeSet() {
    if (!document) return
    const revision = documentRevision.current
    const requestId = ++practiceSetRequestId.current
    const sourcePages = selectedPages
    setIsGeneratingQuestions(true)
    setQuestionError('')
    try {
      const generatedPracticeSet = await generateQuestions(sourcePages, learnerId)
      if (revision !== documentRevision.current || requestId !== practiceSetRequestId.current) return
      practiceSetVersion.current += 1
      setPracticeSet(generatedPracticeSet)
      setQuestionIndex(0)
      setSelectedOption(null)
      setAnswerResult(null)
      setIsSubmittingAnswer(false)
    } catch (caught) {
      if (revision === documentRevision.current && requestId === practiceSetRequestId.current) {
        setQuestionError(caught instanceof Error ? caught.message : 'Practice questions could not be created. Please try again.')
        void checkOllama()
      }
    } finally {
      if (revision === documentRevision.current && requestId === practiceSetRequestId.current) setIsGeneratingQuestions(false)
    }
  }

  function moveToNextQuestion() {
    setQuestionIndex((index) => index + 1)
    setSelectedOption(null)
    setAnswerResult(null)
  }

  async function checkAnswer() {
    if (!practiceSet || selectedOption === null || isSubmittingAnswer) return
    const revision = documentRevision.current
    const version = practiceSetVersion.current
    setIsSubmittingAnswer(true)
    setQuestionError('')
    try {
      const result = await submitAnswer(practiceSet.session_id, learnerId, questionIndex, selectedOption)
      if (revision === documentRevision.current && version === practiceSetVersion.current) {
        setAnswerResult(result)
        setProgress({ ...result.progress, next_recommendation: result.next_recommendation, next_difficulty: result.next_difficulty, next_adaptation_reason: result.next_adaptation_reason })
      }
    } catch (caught) {
      if (revision === documentRevision.current && version === practiceSetVersion.current) {
        setQuestionError(caught instanceof Error ? caught.message : 'Your answer could not be saved. Please try again.')
      }
    } finally {
      if (revision === documentRevision.current && version === practiceSetVersion.current) setIsSubmittingAnswer(false)
    }
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <a href="#main" onClick={() => mainRef.current?.focus()} className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-3 focus:font-semibold focus:text-moss focus:shadow-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-moss">Skip to main content</a>
      <header className="border-b border-line bg-white/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <a href="#main" className="flex items-center gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-moss">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-moss text-white" aria-hidden="true">
              <BookOpen size={21} strokeWidth={1.8} />
            </span>
            <span>
              <span className="block text-[17px] font-semibold tracking-tight">LearnAble <span className="text-moss">AI</span></span>
              <span className="block text-xs text-muted">A calmer way to learn</span>
            </span>
          </a>
          <span className="hidden rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-muted sm:inline-flex">Neural Storm 2026 · HI-03</span>
        </div>
      </header>

      <main ref={mainRef} id="main" tabIndex={-1} className="mx-auto max-w-6xl px-5 pb-20 pt-10 focus:outline-none sm:px-8 sm:pt-14">
        <section className="mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#d9e5da] bg-mint/70 px-3 py-1.5 text-xs font-semibold text-moss">
            <Sparkles size={14} aria-hidden="true" /> Your learning space
          </div>
          <h1 className="text-3xl font-semibold leading-tight tracking-[-0.04em] sm:text-5xl">Let’s make this material <span className="text-moss">easier to work through.</span></h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">Start with a lesson or textbook chapter. We’ll prepare the text so you can work with it at your own pace.</p>
        </section>

        {progress && <section aria-labelledby="progress-heading" className="mx-auto mt-6 max-w-3xl rounded-2xl border border-line bg-white px-5 py-4 sm:flex sm:items-center sm:justify-between sm:gap-6">
          <div>
            <h2 id="progress-heading" className="text-sm font-semibold">Your practice progress</h2>
            <p className="mt-1 text-sm leading-6 text-muted">{progress.attempt_count === 0 ? 'Your answers will build a progress record for this browser.' : `${progress.attempt_count} ${progress.attempt_count === 1 ? 'question' : 'questions'} answered · ${progress.correct_count} correct`}{progress.accuracy_percent !== null && ` · ${progress.accuracy_percent}% correct`}</p>
          </div>
          <div className="mt-3 sm:mt-0 sm:max-w-sm"><p className="text-sm leading-6 text-moss">{progress.next_recommendation}</p><p className="mt-1 text-xs leading-5 text-muted">{progress.next_adaptation_reason}</p></div>
        </section>}

        {isLoading && <p className="sr-only" role="status" aria-live="polite">Reading PDF text.</p>}
        {document && !isLoading && <p className="sr-only" role="status" aria-live="polite">PDF text is ready. Choose the source pages to use for AI.</p>}

        <div className="mx-auto mt-6 max-w-3xl" aria-live="polite">
          {ollamaStatus && ollamaStatus.reachable && ollamaStatus.model_installed && <p role="status" className="text-xs text-muted">Local AI is ready ({ollamaStatus.model}, running on this Mac).</p>}
          {(ollamaStatusError || (ollamaStatus && !(ollamaStatus.reachable && ollamaStatus.model_installed))) && <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            <p>{ollamaStatusError || ollamaStatus?.message} You can still upload a PDF, read it with the reading controls, and see saved progress. Explanations and practice questions need local AI.</p>
            <button type="button" onClick={() => void checkOllama()} disabled={isCheckingOllama} className="mt-2 min-h-11 rounded-lg border border-amber-700 bg-white px-4 py-2 text-sm font-semibold text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:opacity-60">{isCheckingOllama ? 'Checking…' : 'Check local AI again'}</button>
          </div>}
        </div>

        <section aria-labelledby="upload-heading" aria-busy={isLoading} className="mx-auto mt-10 max-w-3xl rounded-3xl border border-line bg-white p-5 shadow-card sm:mt-12 sm:p-8">
          {!document ? (
            <>
              <div className="mb-5 flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint text-moss" aria-hidden="true"><FileText size={20} /></span>
                <div>
                  <h2 id="upload-heading" className="font-semibold">Add your learning material</h2>
                  <p className="mt-1 text-sm leading-6 text-muted">Upload a PDF with selectable text to get started.</p>
                </div>
              </div>
              <button
                type="button"
                className="group flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-[#cfd9ce] bg-[#fbfcf9] px-5 text-center transition hover:border-moss hover:bg-[#f6faf6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:opacity-70"
                onClick={() => inputRef.current?.click()}
                disabled={isLoading}
                aria-describedby="upload-help"
              >
                <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-moss shadow-sm ring-1 ring-line" aria-hidden="true">
                  {isLoading ? <LoaderCircle size={23} className="animate-spin" /> : <Upload size={22} />}
                </span>
                <span className="font-semibold">{isLoading ? 'Reading your PDF…' : 'Choose a PDF to upload'}</span>
                <span className="mt-1 text-sm text-muted">Select a file from your device</span>
                <span id="upload-help" className="mt-4 rounded-full bg-[#f0f2ed] px-3 py-1 text-xs font-medium text-muted">PDF · Up to 10 MB · 100 pages</span>
              </button>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label="Choose an educational PDF"
                onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
              />
              {error && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert"><X size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{error}</p></div>}
              <p className="mt-5 text-center text-xs leading-5 text-muted">The PDF itself is not saved. Generated practice questions and submitted answers are saved to this browser’s anonymous progress profile.</p>
            </>
          ) : (
            <div>
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint text-moss" aria-hidden="true"><Check size={20} /></span>
                  <div>
                    <h2 id="upload-heading" className="font-semibold">Text is ready to review</h2>
                    <p className="mt-1 break-all text-sm text-muted">{document.filename}</p>
                  </div>
                </div>
                <button type="button" onClick={reset} className="self-start rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink transition hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss sm:self-auto">Choose another PDF</button>
              </div>
              <div className="mt-6 flex flex-wrap gap-2 text-xs font-medium text-muted" aria-label="Document details">
                <span className="rounded-full bg-paper px-3 py-1.5">{document.page_count} {document.page_count === 1 ? 'page' : 'pages'}</span>
                <span className="rounded-full bg-paper px-3 py-1.5">{document.character_count.toLocaleString()} characters extracted</span>
              </div>
              {sourceTooLongForAi && <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950" role="alert">{selectedPages.length === 0 ? 'Select at least one page for a lesson or practice set.' : selectedPagesOverLimit ? 'A selected page has more than 10,000 characters. Uncheck that page or choose other pages.' : 'The selected pages have more than 50,000 characters. Uncheck pages to choose a shorter section.'} You can still read all extracted text below.</p>}
              <fieldset className="mt-5 rounded-2xl border border-line bg-[#fbfcf9] p-4">
                <legend className="px-1 text-sm font-semibold">Adjust reading display</legend>
                <p className="mb-4 text-xs leading-5 text-muted">These settings change the lesson and extracted text on this screen. Your choices are saved in this browser.</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium" htmlFor="reading-size">Text size <output className="float-right text-muted">{readingPreferences.fontSize}px</output>
                    <input id="reading-size" type="range" min="16" max="28" step="1" value={readingPreferences.fontSize} onChange={(event) => updateReadingPreferences('fontSize', Number(event.currentTarget.value))} className="mt-2 block w-full accent-[#37664d]" />
                  </label>
                  <label className="block text-sm font-medium" htmlFor="reading-line-spacing">Line spacing <output className="float-right text-muted">{readingPreferences.lineSpacing.toFixed(1)}×</output>
                    <input id="reading-line-spacing" type="range" min="1.4" max="2.2" step="0.1" value={readingPreferences.lineSpacing} onChange={(event) => updateReadingPreferences('lineSpacing', Number(event.currentTarget.value))} className="mt-2 block w-full accent-[#37664d]" />
                  </label>
                  <label className="block text-sm font-medium" htmlFor="reading-letter-spacing">Letter spacing <output className="float-right text-muted">{readingPreferences.letterSpacing.toFixed(2)}em</output>
                    <input id="reading-letter-spacing" type="range" min="0" max="0.08" step="0.01" value={readingPreferences.letterSpacing} onChange={(event) => updateReadingPreferences('letterSpacing', Number(event.currentTarget.value))} className="mt-2 block w-full accent-[#37664d]" />
                  </label>
                  <label className="block text-sm font-medium" htmlFor="reading-font">Font style
                    <select id="reading-font" value={readingPreferences.fontFamily} onChange={(event) => updateReadingPreferences('fontFamily', event.currentTarget.value as ReadingPreferences['fontFamily'])} className="mt-2 block min-h-10 w-full rounded-lg border border-line bg-white px-3 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">
                      <option value="sans">Sans serif</option><option value="serif">Serif</option>
                    </select>
                  </label>
                  <label className="block text-sm font-medium" htmlFor="reading-background">Text background
                    <select id="reading-background" value={readingPreferences.background} onChange={(event) => updateReadingPreferences('background', event.currentTarget.value as ReadingPreferences['background'])} className="mt-2 block min-h-10 w-full rounded-lg border border-line bg-white px-3 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">
                      <option value="white">White</option><option value="warm">Warm</option><option value="contrast">High contrast</option>
                    </select>
                  </label>
                  <label className="block text-sm font-medium" htmlFor="speech-rate">Speech speed <output className="float-right text-muted">{readingPreferences.speechRate.toFixed(1)}×</output>
                    <input id="speech-rate" type="range" min="0.7" max="1.2" step="0.1" value={readingPreferences.speechRate} onChange={(event) => updateReadingPreferences('speechRate', Number(event.currentTarget.value))} className="mt-2 block w-full accent-[#37664d]" />
                  </label>
                </div>
                <button type="button" onClick={() => setReadingPreferences(DEFAULT_READING_PREFERENCES)} className="mt-4 rounded-lg px-2 py-1 text-xs font-semibold text-moss underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">Reset reading settings</button>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="mr-1 text-xs font-medium text-muted">Text-to-speech</span>
                  {speechStatus !== 'idle' && <>
                    <span className="text-xs text-muted" role="status" aria-live="polite">{speechStatus === 'speaking' ? `Reading ${speechLabel}` : `Paused: ${speechLabel}`}</span>
                    <button type="button" onClick={toggleSpeech} className="min-h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">{speechStatus === 'speaking' ? 'Pause' : 'Resume'}</button>
                    <button type="button" onClick={stopSpeech} className="min-h-9 rounded-lg border border-line bg-white px-3 text-xs font-semibold hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">Stop</button>
                  </>}
                  {speechMessage && <span className="text-xs text-muted" role="status" aria-live="polite">{speechMessage}</span>}
                </div>
              </fieldset>
              <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start" aria-busy={isSimplifying || isGeneratingQuestions}>
                <div>
                  <button type="button" onClick={() => void createLesson()} disabled={isSimplifying || sourceTooLongForAi} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-moss px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2b533d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:opacity-70">
                    {isSimplifying ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
                    {isSimplifying ? 'Making an easier explanation…' : lesson ? 'Create explanation again' : 'Make this easier to understand'}
                  </button>
                  <p className="mt-2 text-xs leading-5 text-muted">A shorter, clearer lesson from your PDF.</p>
                  <p className="sr-only" role="status" aria-live="polite">{isSimplifying ? 'Creating a simplified explanation.' : lesson ? 'Simplified explanation is ready.' : ''}</p>
                </div>
                <div>
                  <button type="button" onClick={() => void createPracticeSet()} disabled={isGeneratingQuestions || sourceTooLongForAi} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-moss bg-white px-5 py-3 text-sm font-semibold text-moss transition hover:bg-mint/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-wait disabled:opacity-70">
                    {isGeneratingQuestions ? <LoaderCircle size={17} className="animate-spin" aria-hidden="true" /> : <BookOpen size={17} aria-hidden="true" />}
                    {isGeneratingQuestions ? 'Making practice questions…' : practiceSet ? 'Create new question set' : 'Practice with questions'}
                  </button>
                  <p className="mt-2 text-xs leading-5 text-muted">Up to three questions, one at a time.</p>
                  <p className="sr-only" role="status" aria-live="polite">{isGeneratingQuestions ? 'Creating practice questions.' : practiceSet ? 'Practice questions are ready.' : ''}</p>
                </div>
              </div>
              {(isSimplifying || isGeneratingQuestions) && secondsWaiting >= 5 && <p className="mt-3 text-sm text-muted">Still working on this Mac… {secondsWaiting} seconds. Local AI can take a minute or more, especially the first time.</p>}
              {lessonError && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert"><X size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{lessonError}</p></div>}
              {questionError && <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" role="alert"><X size={18} className="mt-0.5 shrink-0" aria-hidden="true" /><p>{questionError}</p></div>}
              {lesson && (
                <section aria-labelledby="lesson-title" style={readingStyle} className="mt-6 rounded-2xl border border-[#d9e5da] p-4 sm:p-6">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-moss ring-1 ring-[#d9e5da]" aria-hidden="true"><Sparkles size={18} /></span>
                    <div>
                      <p className={`text-xs font-semibold uppercase tracking-wide ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-moss'}`}>Simplified lesson</p>
                      <h3 id="lesson-title" className="mt-1 text-xl font-semibold tracking-tight">{lesson.title}</h3>
                      <button type="button" onClick={() => speakText(lesson.sections.map((section) => `${section.heading}. ${section.explanation}`).join('\n\n'), 'the simplified lesson')} className={`mt-2 rounded-lg px-2 py-1 text-xs font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-moss'}`}>Listen to lesson</button>
                    </div>
                  </div>
                  <div className="mt-5 space-y-5">
                    {lesson.sections.map((section, index) => (
                      <article key={`${section.heading}-${index}`}>
                        <h4 className="font-semibold">{section.heading}</h4>
                        <p className="mt-1 whitespace-pre-wrap">{section.explanation}</p>
                        <p className={`mt-2 flex flex-wrap items-center gap-2 text-xs ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-muted'}`}><span>Source:</span>{section.source_pages.map((page) => <a key={page} href={`#source-page-${page}`} className={`rounded-full px-2.5 py-1 font-medium underline decoration-transparent underline-offset-2 hover:decoration-current focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${readingPreferences.background === 'contrast' ? 'bg-[#273244] text-white' : 'bg-white text-moss'}`}>Page {page}</a>)}</p>
                        <EvidenceList evidence={section.source_evidence} summary="Show closest passage in the PDF" highContrast={readingPreferences.background === 'contrast'} />
                      </article>
                    ))}
                  </div>
                  {lesson.key_terms.length > 0 && <div className="mt-5 border-t border-[#d9e5da] pt-4">
                    <h4 className="font-semibold">Key words</h4>
                    <dl className="mt-3 space-y-3">
                      {lesson.key_terms.map((term) => <div key={term.term}>
                        <dt className="font-medium">{term.term}</dt>
                        <dd className={`mt-0.5 ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-muted'}`}>{term.definition} <span className="inline-flex flex-wrap gap-1">{term.source_pages.map((page) => <a key={page} href={`#source-page-${page}`} className={`font-medium underline underline-offset-2 ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-moss'}`}>Page {page}</a>)}</span></dd>
                        <EvidenceList evidence={term.source_evidence} summary="Show closest passage in the PDF" highContrast={readingPreferences.background === 'contrast'} />
                      </div>)}
                    </dl>
                  </div>}
                    <p className={`mt-5 border-t border-[#d9e5da] pt-4 text-xs leading-5 ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-muted'}`}>AI-generated from your PDF. Check each linked source page to confirm the explanation matches the original.</p>
                </section>
              )}
              {practiceSet && <section aria-labelledby="practice-title" className="mt-6 rounded-2xl border border-line bg-white p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-moss">Practice</p>
                    <h3 id="practice-title" className="mt-1 text-xl font-semibold tracking-tight">Check what you understood</h3>
                    <p className="mt-1 text-sm leading-6 text-muted">{practiceSet.strategy}</p>
                    <p className="mt-1 text-sm leading-6 text-moss">{practiceSet.recommendation}</p>
                    <p className="mt-1 text-xs leading-5 text-muted">{practiceSet.adaptation_reason}</p>
                  </div>
                  {questionIndex < practiceSet.questions.length && <span className="rounded-full bg-paper px-3 py-1.5 text-xs font-medium text-muted">Question {questionIndex + 1} of {practiceSet.questions.length}</span>}
                </div>
                {questionIndex >= practiceSet.questions.length ? (
                  <div className="mt-5 rounded-xl bg-mint/60 p-4" aria-live="polite">
                    <p className="font-semibold">You finished this practice set.</p>
                    <p className="mt-1 text-sm leading-6 text-muted">Use the source pages to review anything you want to revisit.</p>
                    <button type="button" onClick={() => void createPracticeSet()} disabled={isGeneratingQuestions || sourceTooLongForAi} className="mt-3 rounded-lg px-3 py-2 text-sm font-semibold text-moss underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-50">Create a fresh set</button>
                  </div>
                ) : (() => {
                  const question = practiceSet.questions[questionIndex]
                  const isCorrect = answerResult?.is_correct ?? false
                  return <div className="mt-5" aria-live="polite">
                    <fieldset>
                      <legend className="text-base font-medium leading-7">{question.question}</legend>
                      <div className="mt-3 space-y-2">
                        {question.options.map((option, index) => <label key={`${index}-${option}`} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 leading-6 transition focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-moss ${selectedOption === index ? 'border-moss bg-mint/50' : 'border-line hover:bg-paper'} ${answerResult ? 'cursor-default' : ''}`}>
                          <input type="radio" name={`practice-question-${questionIndex}`} value={index} checked={selectedOption === index} onChange={() => setSelectedOption(index)} disabled={Boolean(answerResult) || isSubmittingAnswer} className="mt-1 h-4 w-4 accent-[#37664d]" />
                          <span>{option}</span>
                        </label>)}
                      </div>
                    </fieldset>
                    {answerResult && <div className={`mt-4 rounded-xl p-4 ${isCorrect ? 'bg-[#edf6ee]' : 'bg-[#f6f4ea]'}`} aria-live="polite">
                      <p className="font-semibold">{isCorrect ? 'That’s right.' : 'Not quite. Review this idea.'}</p>
                      {!isCorrect && <p className="mt-1 text-sm">The correct answer is <strong>{question.options[answerResult.correct_option_index]}</strong>.</p>}
                      <p className="mt-1 text-sm leading-6">{answerResult.explanation}</p>
                      <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted"><span>Source:</span>{answerResult.source_pages.map((page) => <a key={page} href={`#source-page-${page}`} className="rounded-full bg-white px-2.5 py-1 font-medium text-moss underline underline-offset-2">Page {page}</a>)}</p>
                      <EvidenceList evidence={question.source_evidence} summary="Show closest passage in the PDF" />
                      <p className="mt-3 text-xs leading-5 text-muted">{answerResult.next_recommendation} {answerResult.next_adaptation_reason}</p>
                    </div>}
                    {!answerResult ? <button type="button" onClick={() => void checkAnswer()} disabled={selectedOption === null || isSubmittingAnswer} className="mt-4 min-h-11 rounded-xl bg-moss px-5 py-3 text-sm font-semibold text-white hover:bg-[#2b533d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:cursor-not-allowed disabled:opacity-50">{isSubmittingAnswer ? 'Saving answer…' : 'Check answer'}</button> : <button type="button" onClick={moveToNextQuestion} className="mt-4 min-h-11 rounded-xl bg-moss px-5 py-3 text-sm font-semibold text-white hover:bg-[#2b533d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss">{questionIndex + 1 === practiceSet.questions.length ? 'Finish practice' : 'Next question'}</button>}
                  </div>
                })()}
                <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-muted">Practice feedback is for review. Your answers are saved to this anonymous profile so future question sets can adjust their style.</p>
              </section>}
              <fieldset className="mt-5 rounded-2xl border border-line p-3 sm:p-4">
                <legend className="px-1 text-sm font-semibold">Choose pages for AI</legend>
                <p id="source-selection-help" className="mb-2 text-xs leading-5 text-muted">Only checked pages are sent when you create a new lesson or question set. You can still read and listen to every page.</p>
                <p className="mb-3 text-xs font-medium text-moss" role="status" aria-live="polite">{selectedPages.length} of {document.page_count} pages selected · {selectedCharacterCount.toLocaleString()} selected characters</p>
              <div style={readingStyle} className="max-h-[28rem] space-y-4 overflow-y-auto rounded-xl border border-line p-4 sm:p-6" aria-label="Extracted text preview" role="region">
                {document.pages.map((page) => (
                  <article id={`source-page-${page.page_number}`} key={page.page_number} className="scroll-mt-4 border-b border-line pb-4 last:border-0 last:pb-0">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className={`text-xs font-semibold uppercase tracking-wide ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-muted'}`}>Page {page.page_number}</h3>
                      <div className="flex shrink-0 items-center gap-3">
                        <label className={`inline-flex items-center gap-1.5 text-xs font-medium ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-moss'}`}>
                          <input type="checkbox" checked={selectedPageNumbers.includes(page.page_number)} onChange={(event) => toggleSourcePage(page.page_number, event.currentTarget.checked)} disabled={isSimplifying || isGeneratingQuestions} aria-describedby="source-selection-help" aria-label={`Include page ${page.page_number} in AI requests`} className="h-4 w-4 accent-[#37664d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss disabled:opacity-60" />
                          Use for AI
                        </label>
                        <button type="button" onClick={() => speakText(page.text, `page ${page.page_number}`)} className={`rounded-lg px-2 py-1 text-xs font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss ${readingPreferences.background === 'contrast' ? 'text-white' : 'text-moss'}`}>Listen</button>
                      </div>
                    </div>
                      <p className="whitespace-pre-wrap">{page.text}</p>
                  </article>
                ))}
              </div>
              </fieldset>
              <p className="mt-4 text-sm leading-6 text-muted">This is the text extracted from your PDF. Scanned pages without selectable text need OCR support, which is not included yet.</p>
            </div>
          )}
        </section>

        <p className="mx-auto mt-6 max-w-3xl text-center text-xs leading-5 text-muted">LearnAble AI is a learning support tool. It does not diagnose dyslexia or replace a teacher’s guidance.</p>
      </main>
    </div>
  )
}
