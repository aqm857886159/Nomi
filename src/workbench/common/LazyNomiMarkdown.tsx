import React from 'react'

type LazyNomiMarkdownProps = {
  children: string
  compact?: boolean
}

const NomiMarkdownImpl = React.lazy(() =>
  import('./NomiMarkdown').then((module) => ({ default: module.NomiMarkdown })),
)

function MarkdownFallback({ compact = false }: Pick<LazyNomiMarkdownProps, 'compact'>): JSX.Element {
  return (
    <div className={`${compact ? 'text-body-sm' : 'text-body'} leading-relaxed text-nomi-ink-60`}>
      正在渲染...
    </div>
  )
}

export function LazyNomiMarkdown({ children, compact = false }: LazyNomiMarkdownProps): JSX.Element {
  return (
    <React.Suspense fallback={<MarkdownFallback compact={compact} />}>
      <NomiMarkdownImpl compact={compact}>{children}</NomiMarkdownImpl>
    </React.Suspense>
  )
}
