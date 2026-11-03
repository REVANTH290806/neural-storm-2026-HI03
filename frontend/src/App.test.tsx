import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import App from './App'
import { extractPdf, fetchOllamaStatus, fetchProgress, generateQuestions, simplifyLesson, submitAnswer } from './api'

vi.mock('./api', () => ({
  extractPdf: vi.fn(),
  fetchOllamaStatus: vi.fn(),
  fetchProgress: vi.fn(),
  generateQuestions: vi.fn(),
  simplifyLesson: vi.fn(),
  submitAnswer: vi.fn(),
}))

const sampleDocument = {
  filename: 'lesson.pdf',
  page_count: 1,
  character_count: 26,
  pages: [{ page_number: 1, text: 'Plants use light to make food.' }],
}

const sampleProgress = {
  attempt_count: 0,
  correct_count: 0,
  session_count: 0,
  accuracy_percent: null,
  recent_attempt_count: 0,
  recent_accuracy_percent: null,
  next_recommendation: 'Answer a few practice questions to build a starting point.',
  next_difficulty: 'steady',
  next_adaptation_reason: 'Why: there are not enough saved answers yet.',
}

const readyOllama = { reachable: true, model: 'qwen3.5:4b', model_installed: true, message: 'Local AI is ready.' }

async function uploadSamplePdf() {
  const user = userEvent.setup()
  vi.mocked(extractPdf).mockResolvedValue(sampleDocument)
  await user.upload(
    screen.getByLabelText('Choose an educational PDF') as HTMLInputElement,
    new File(['test pdf'], 'lesson.pdf', { type: 'application/pdf' }),
  )
  await screen.findByText('Plants use light to make food.')
  return user
}

async function expectNoAccessibilityViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    // jsdom does not implement the canvas APIs axe needs to measure contrast.
    rules: { 'color-contrast': { enabled: false } },
  })
  expect(results.violations.map(({ id, help }) => `${id}: ${help}`)).toEqual([])
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
    const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  }
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('reading accessibility controls', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(fetchProgress).mockResolvedValue(sampleProgress)
    vi.mocked(fetchOllamaStatus).mockResolvedValue(readyOllama)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('offers a keyboard skip link that moves focus to the learning workflow', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.tab()
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' })
    expect(document.activeElement).toBe(skipLink)
    await user.click(skipLink)

    expect(document.activeElement).toBe(document.getElementById('main'))
  })

  it('passes automated accessibility checks on the initial screen', async () => {
    const { container } = render(<App />)
    await expectNoAccessibilityViolations(container)
  })

  it('passes automated accessibility checks after a PDF is ready', async () => {
    const { container } = render(<App />)
    await uploadSamplePdf()
    expect(await screen.findByText('PDF text is ready. Choose the source pages to use for AI.')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)
  })

  it('passes automated accessibility checks for generated lesson and answer states', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await uploadSamplePdf()
    vi.mocked(simplifyLesson).mockResolvedValue({
      title: 'Plants make food',
      sections: [{
        heading: 'The main idea',
        explanation: 'Plants use light to make food.',
        source_pages: [1],
        source_evidence: [{ page_number: 1, quote: 'Plants use light to make food.', shared_terms: ['light'], match_strength: 'weak' as const }],
      }],
      key_terms: [],
    })
    await user.click(screen.getByRole('button', { name: 'Make this easier to understand' }))
    await screen.findByRole('heading', { name: 'Plants make food' })
    expect(screen.getByText('Simplified explanation is ready.')).toBeInTheDocument()
    await expectNoAccessibilityViolations(container)

    vi.mocked(generateQuestions).mockResolvedValue({
      session_id: 'session-1',
      difficulty: 'steady',
      strategy: 'Use direct questions.',
      recommendation: 'Keep practicing.',
      adaptation_reason: 'Why: not enough saved answers yet.',
      questions: [{
        question: 'What do plants use?',
        options: ['Water', 'Light', 'Soil', 'Wind'],
        source_pages: [1],
        source_evidence: [{ page_number: 1, quote: 'Plants use light to make food.', shared_terms: ['light'], match_strength: 'weak' as const }],
      }],
    })
    await user.click(screen.getByRole('button', { name: 'Practice with questions' }))
    await screen.findByRole('radio', { name: 'Light' })
    expect(screen.getByText('Practice questions are ready.')).toBeInTheDocument()
    vi.mocked(submitAnswer).mockResolvedValue({
      is_correct: true,
      correct_option_index: 1,
      explanation: 'The source says plants use light.',
      source_pages: [1],
      progress: { attempt_count: 1, correct_count: 1, session_count: 1, accuracy_percent: 100, recent_attempt_count: 1, recent_accuracy_percent: 100 },
      next_recommendation: 'Try another question.',
      next_difficulty: 'steady',
      next_adaptation_reason: 'Why: you answered 1 of your last 1 questions correctly (100%).',
    })
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    await screen.findByText('That’s right.')
    await expectNoAccessibilityViolations(container)
  })

  it('keeps core reading and feedback color pairs above WCAG AA contrast', () => {
    const colorPairs = [
      ['#666f65', '#f7f7f2'], // muted text on the app background
      ['#666f65', '#ffffff'], // muted text on cards
      ['#37664d', '#e5eee6'], // moss text on mint controls
      ['#ffffff', '#37664d'], // white text on primary buttons
      ['#342f25', '#fff8e8'], // warm reading presentation
      ['#ffffff', '#111827'], // high contrast reading presentation
      ['#ffffff', '#273244'], // links on high contrast presentation
      ['#7f1d1d', '#fef2f2'], // error text and background
      ['#451a03', '#fffbeb'], // limit notice text and background
    ]

    for (const [foreground, background] of colorPairs) {
      expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('exposes labelled, focusable native reading controls', async () => {
    render(<App />)
    await uploadSamplePdf()

    expect(screen.getByRole('group', { name: 'Adjust reading display' })).toBeInTheDocument()
    const textSize = screen.getByRole('slider', { name: /Text size/ })
    textSize.focus()

    expect(textSize).toHaveAttribute('type', 'range')
    expect(document.activeElement).toBe(textSize)
  })

  it('applies and saves the selected text size and high contrast background', async () => {
    const user = userEvent.setup()
    render(<App />)
    await uploadSamplePdf()

    fireEvent.change(screen.getByRole('slider', { name: /Text size/ }), { target: { value: '24' } })
    await user.selectOptions(screen.getByRole('combobox', { name: 'Text background' }), 'contrast')

    const textPreview = screen.getByLabelText('Extracted text preview')
    expect(textPreview).toHaveStyle({ fontSize: '24px', backgroundColor: 'rgb(17, 24, 39)', color: 'rgb(255, 255, 255)' })
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('learnable-reading-preferences') ?? '{}')).toMatchObject({
        fontSize: 24,
        background: 'contrast',
      })
    })
  })

  it('keeps AI actions disabled when one source page exceeds the API text limit', async () => {
    render(<App />)
    vi.mocked(extractPdf).mockResolvedValue({
      filename: 'long-page.pdf',
      page_count: 1,
      character_count: 10_001,
      pages: [{ page_number: 1, text: 'x'.repeat(10_001) }],
    })
    await userEvent.setup().upload(
      screen.getByLabelText('Choose an educational PDF') as HTMLInputElement,
      new File(['test pdf'], 'long-page.pdf', { type: 'application/pdf' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('more than 10,000 characters')
    expect(screen.getByRole('button', { name: /Make this easier to understand/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Practice with questions/ })).toBeDisabled()
    expect(screen.getByLabelText('Extracted text preview')).toBeInTheDocument()
  })

  it('lets learners select a shorter group of pages for lessons and questions', async () => {
    const user = userEvent.setup()
    const pages = Array.from({ length: 6 }, (_, index) => ({ page_number: index + 1, text: 'x'.repeat(9_000) }))
    vi.mocked(extractPdf).mockResolvedValue({
      filename: 'long-chapter.pdf',
      page_count: pages.length,
      character_count: 54_000,
      pages,
    })
    vi.mocked(simplifyLesson).mockResolvedValue({ title: 'Short lesson', sections: [], key_terms: [] })
    render(<App />)
    await user.upload(
      screen.getByLabelText('Choose an educational PDF') as HTMLInputElement,
      new File(['test pdf'], 'long-chapter.pdf', { type: 'application/pdf' }),
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('more than 50,000 characters')
    await user.click(screen.getByRole('checkbox', { name: 'Include page 1 in AI requests' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const lessonButton = screen.getByRole('button', { name: 'Make this easier to understand' })
    expect(lessonButton).toBeEnabled()
    await user.click(lessonButton)
    await screen.findByRole('heading', { name: 'Short lesson' })
    expect(simplifyLesson).toHaveBeenCalledWith(pages.slice(1))

    vi.mocked(generateQuestions).mockResolvedValue({
      session_id: 'short-source-session',
      difficulty: 'steady',
      strategy: 'Use direct questions.',
      recommendation: 'Keep practicing.',
      adaptation_reason: 'Why: not enough saved answers yet.',
      questions: [{
        question: 'What is described?',
        options: ['A', 'B', 'C', 'D'],
        source_pages: [2],
        source_evidence: [{ page_number: 2, quote: 'Source quote', shared_terms: ['light'], match_strength: 'weak' as const }],
      }],
    })
    await user.click(screen.getByRole('button', { name: 'Practice with questions' }))
    await screen.findByRole('radio', { name: 'A' })
    expect(generateQuestions).toHaveBeenCalledWith(pages.slice(1), expect.any(String))
  })

  it('ignores a lesson response after the learner switches to another PDF', async () => {
    const user = userEvent.setup()
    const secondDocument = {
      filename: 'second.pdf',
      page_count: 1,
      character_count: 20,
      pages: [{ page_number: 1, text: 'A different source document.' }],
    }
    vi.mocked(extractPdf).mockResolvedValueOnce(sampleDocument).mockResolvedValueOnce(secondDocument)
    let resolveOldLesson!: (lesson: Awaited<ReturnType<typeof simplifyLesson>>) => void
    vi.mocked(simplifyLesson).mockReturnValue(new Promise((resolve) => { resolveOldLesson = resolve }))
    render(<App />)
    await user.upload(
      screen.getByLabelText('Choose an educational PDF') as HTMLInputElement,
      new File(['first'], 'lesson.pdf', { type: 'application/pdf' }),
    )
    await screen.findByText('Plants use light to make food.')
    await user.click(screen.getByRole('button', { name: 'Make this easier to understand' }))
    await user.click(screen.getByRole('button', { name: 'Choose another PDF' }))
    await user.upload(
      screen.getByLabelText('Choose an educational PDF') as HTMLInputElement,
      new File(['second'], 'second.pdf', { type: 'application/pdf' }),
    )
    await screen.findByText('A different source document.')

    await act(async () => {
      resolveOldLesson({ title: 'Old lesson', sections: [], key_terms: [] })
    })

    expect(screen.queryByRole('heading', { name: 'Old lesson' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make this easier to understand' })).toBeEnabled()
  })

  it('safely restores malformed reading preferences from browser storage', async () => {
    localStorage.setItem('learnable-reading-preferences', JSON.stringify({
      fontSize: 99,
      lineSpacing: 'wide',
      letterSpacing: -1,
      speechRate: 1.13,
      fontFamily: 'comic',
      background: 'transparent',
    }))

    render(<App />)
    await uploadSamplePdf()

    expect(screen.getByRole('slider', { name: /Text size/ })).toHaveValue('28')
    expect(screen.getByRole('slider', { name: /Line spacing/ })).toHaveValue('1.8')
    expect(screen.getByRole('slider', { name: /Letter spacing/ })).toHaveValue('0')
    expect(screen.getByRole('slider', { name: /Speech speed/ })).toHaveValue('1.1')
    expect(screen.getByRole('combobox', { name: 'Font style' })).toHaveValue('sans')
    expect(screen.getByRole('combobox', { name: 'Text background' })).toHaveValue('white')
  })

  it('replaces a malformed anonymous learner ID with a valid UUID', () => {
    localStorage.setItem('learnable-learner-id', 'old-invalid-value')

    render(<App />)

    expect(localStorage.getItem('learnable-learner-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('reads a source page aloud and exposes pause and stop controls', async () => {
    const synthesis = { speak: vi.fn(), cancel: vi.fn(), pause: vi.fn(), resume: vi.fn() }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synthesis })
    class FakeUtterance {
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(public text: string) {}
    }
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)

    const user = userEvent.setup()
    render(<App />)
    await uploadSamplePdf()
    await user.click(screen.getByRole('button', { name: 'Listen' }))

    expect(synthesis.speak).toHaveBeenCalledOnce()
    expect(synthesis.speak.mock.calls[0][0].text).toBe('Plants use light to make food.')
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(synthesis.pause).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(synthesis.cancel).toHaveBeenCalledTimes(3)
  })

  it('explains when local AI is unavailable, keeps PDF upload usable, and can re-check', async () => {
    vi.mocked(fetchOllamaStatus).mockResolvedValueOnce({ reachable: false, model: 'qwen3.5:4b', model_installed: false, message: 'Ollama is not running. Open the Ollama app on this Mac, then check again.' })
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText(/Ollama is not running/)).toBeInTheDocument()
    expect(screen.getByText(/You can still upload a PDF/)).toBeInTheDocument()
    expect(screen.getByLabelText('Choose an educational PDF')).toBeEnabled()

    vi.mocked(fetchOllamaStatus).mockResolvedValueOnce(readyOllama)
    await user.click(screen.getByRole('button', { name: 'Check local AI again' }))
    expect(await screen.findByText(/Local AI is ready \(qwen3.5:4b/)).toBeInTheDocument()
  })

  it('shows the closest passage with shared words and a warning that it is not proof', async () => {
    const user = userEvent.setup()
    render(<App />)
    await uploadSamplePdf()
    vi.mocked(simplifyLesson).mockResolvedValue({
      title: 'Plants make food',
      sections: [{
        heading: 'The main idea',
        explanation: 'Plants use light to make food.',
        source_pages: [1],
        source_evidence: [{ page_number: 1, quote: 'Plants use light to make food.', shared_terms: ['food', 'light'], match_strength: 'weak' }],
      }],
      key_terms: [],
    })
    await user.click(screen.getByRole('button', { name: 'Make this easier to understand' }))
    await screen.findByRole('heading', { name: 'Plants make food' })
    await user.click(screen.getByText('Show closest passage in the PDF'))

    expect(screen.getByText(/may not prove the point above/)).toBeInTheDocument()
    expect(screen.getByText(/Few shared words: check this one carefully \(food, light\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Read page 1 in the PDF text' })).toHaveAttribute('href', '#source-page-1')
  })

  it('shows why the next practice set was chosen after an answer', async () => {
    const user = userEvent.setup()
    render(<App />)
    await uploadSamplePdf()
    vi.mocked(generateQuestions).mockResolvedValue({
      session_id: 's', difficulty: 'steady', strategy: 'Use direct questions.', recommendation: 'Keep practicing.',
      adaptation_reason: 'Why: not enough saved answers yet.',
      questions: [{ question: 'What do plants use?', options: ['Water', 'Light', 'Soil', 'Wind'], source_pages: [1],
        source_evidence: [{ page_number: 1, quote: 'Plants use light to make food.', shared_terms: ['light'], match_strength: 'weak' }] }],
    })
    await user.click(screen.getByRole('button', { name: 'Practice with questions' }))
    await screen.findByRole('radio', { name: 'Light' })
    expect(screen.getByText('Why: not enough saved answers yet.')).toBeInTheDocument()
    vi.mocked(submitAnswer).mockResolvedValue({
      is_correct: true, correct_option_index: 1, explanation: 'x', source_pages: [1],
      progress: { attempt_count: 1, correct_count: 1, session_count: 1, accuracy_percent: 100, recent_attempt_count: 1, recent_accuracy_percent: 100 },
      next_recommendation: 'Try another question.', next_difficulty: 'steady',
      next_adaptation_reason: 'Why: you answered 1 of your last 1 questions correctly (100%).',
    })
    await user.click(screen.getByRole('radio', { name: 'Light' }))
    await user.click(screen.getByRole('button', { name: 'Check answer' }))
    expect((await screen.findAllByText(/you answered 1 of your last 1 questions correctly/)).length).toBeGreaterThan(0)
  })
})
