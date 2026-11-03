import type { SourceEvidence } from './api'

type EvidenceListProps = {
  evidence: SourceEvidence[]
  /** Label for the disclosure, e.g. "Show closest passage in the PDF". */
  summary: string
  highContrast?: boolean
}

/**
 * Shows the passage found on a cited PDF page, the words it shares with the AI text,
 * and a plain reminder that this is a keyword match, not proof. Learners are sent to
 * the full page to judge for themselves.
 */
export function EvidenceList({ evidence, summary, highContrast = false }: EvidenceListProps) {
  const linkTone = highContrast ? 'text-white' : 'text-moss'
  const bodyTone = highContrast ? 'border-white text-white' : 'border-moss text-muted'
  return (
    <details className="mt-2 text-sm">
      <summary className={`w-fit cursor-pointer underline underline-offset-2 ${linkTone}`}>{summary}</summary>
      <p className={`mt-2 text-xs leading-5 ${highContrast ? 'text-white' : 'text-muted'}`}>
        This passage is exactly as written in your PDF. It was found by matching words, so it may not prove the
        point above. Open the page and read around it to check.
      </p>
      {evidence.map((item) => (
        <blockquote key={`${item.page_number}-${item.quote}`} className={`mt-2 border-l-2 pl-3 ${bodyTone}`}>
          <a href={`#source-page-${item.page_number}`} className="mb-1 block text-xs font-semibold underline">
            Read page {item.page_number} in the PDF text
          </a>
          {item.quote}
          <span className="mt-1 block text-xs">
            {item.match_strength === 'strong' ? 'Several shared words' : 'Few shared words: check this one carefully'}
            {item.shared_terms.length > 0 && <> ({item.shared_terms.join(', ')})</>}
          </span>
        </blockquote>
      ))}
    </details>
  )
}
