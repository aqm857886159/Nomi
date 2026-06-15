import ReactMarkdown, { type Components } from 'react-markdown'

/**
 * Token-styled Markdown renderer (single source of truth — used by both the file
 * preview and the AI chat panel).
 *
 * react-markdown emits bare HTML tags that, after Tailwind's preflight reset,
 * render with no hierarchy — so every tag is explicitly mapped to design-system
 * tokens here (font sizes, ink ladder, mono code, accent links).
 *
 * `compact` tightens spacing + shrinks headings for narrow contexts like chat
 * bubbles; the default (doc) spacing suits the wider file-preview panel.
 */
function makeComponents(compact: boolean): Components {
  const pMy = compact ? 'my-1' : 'my-2'
  const hMt = compact ? 'mt-2.5' : 'mt-4'
  const hMb = compact ? 'mb-1' : 'mb-2'
  const h1 = compact ? 'text-title' : 'text-h2'
  const h2 = compact ? 'text-body' : 'text-title'
  const h3 = compact ? 'text-body-sm' : 'text-body'
  return {
    h1: ({ node: _n, ...p }) => <h1 className={`${h1} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h2: ({ node: _n, ...p }) => <h2 className={`${h2} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    h3: ({ node: _n, ...p }) => <h3 className={`${h3} font-semibold leading-snug text-nomi-ink ${hMt} ${hMb} first:mt-0`} {...p} />,
    p: ({ node: _n, ...p }) => <p className={`text-body leading-relaxed text-nomi-ink-80 ${pMy}`} {...p} />,
    ul: ({ node: _n, ...p }) => <ul className={`list-disc pl-5 ${pMy} text-body leading-relaxed text-nomi-ink-80`} {...p} />,
    ol: ({ node: _n, ...p }) => <ol className={`list-decimal pl-5 ${pMy} text-body leading-relaxed text-nomi-ink-80`} {...p} />,
    li: ({ node: _n, ...p }) => <li className="my-0.5" {...p} />,
    a: ({ node: _n, ...p }) => <a className="text-nomi-accent underline underline-offset-2" target="_blank" rel="noreferrer" {...p} />,
    blockquote: ({ node: _n, ...p }) => <blockquote className={`border-l-2 border-nomi-line pl-3 ${pMy} text-nomi-ink-60`} {...p} />,
    hr: ({ node: _n, ...p }) => <hr className="border-nomi-line my-3" {...p} />,
    code: ({ node: _n, className, children, ...p }) => {
      const isBlock = String(className || '').includes('language-')
      return isBlock
        ? <code className={`font-nomi-mono text-caption ${className || ''}`.trim()} {...p}>{children}</code>
        : <code className="font-nomi-mono text-caption bg-nomi-ink-05 rounded-nomi-sm px-1 py-0.5" {...p}>{children}</code>
    },
    pre: ({ node: _n, ...p }) => <pre className={`bg-nomi-ink-05 rounded-nomi-sm p-3 ${pMy} overflow-auto text-nomi-ink-80`} {...p} />,
  }
}

const docComponents = makeComponents(false)
const compactComponents = makeComponents(true)

export function NomiMarkdown({ children, compact = false }: { children: string; compact?: boolean }): JSX.Element {
  return <ReactMarkdown components={compact ? compactComponents : docComponents}>{children}</ReactMarkdown>
}
