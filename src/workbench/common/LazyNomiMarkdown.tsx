import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import type { NomiMarkdown } from './NomiMarkdown'

type LazyNomiMarkdownProps = React.ComponentProps<typeof NomiMarkdown>

const NomiMarkdownImpl = lazyWithChunkBoundary('Markdown', () => import('./NomiMarkdown').then((module) => ({ default: module.NomiMarkdown })))

function MarkdownFallback({ compact = false }: Pick<LazyNomiMarkdownProps, 'compact'>): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={`${compact ? 'text-body-sm' : 'text-body'} leading-relaxed text-nomi-ink-60`}>
      {t('common.rendering')}
    </div>
  )
}

export function LazyNomiMarkdown(props: LazyNomiMarkdownProps): JSX.Element {
  return (
    <React.Suspense fallback={<MarkdownFallback compact={props.compact} />}>
      <NomiMarkdownImpl {...props} />
    </React.Suspense>
  )
}
