import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'
import { replacePromptSkeletonRange, validPromptSkeletonSegments } from './promptSkeletonRangeUtils'

export default function PromptSkeletonSegments({
  prompt, profile, ranges, onChange,
}: {
  prompt: string
  profile?: StoryboardProfile
  ranges?: PromptSegmentRange[]
  onChange: (next: { prompt: string; ranges: PromptSegmentRange[] }) => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const [openKey, setOpenKey] = React.useState<string | null>(null)
  const segments = validPromptSkeletonSegments(prompt, profile, ranges)
  if (!segments.length) return null

  return (
    <div className="flex flex-wrap items-center gap-1" data-storyboard-prompt-skeleton="true">
      <span className="text-micro text-nomi-ink-40">{t('storyboardEditor.promptSkeleton.label')}</span>
      {segments.map((segment) => {
        const token = `${segment.key}:${segment.start}:${segment.end}`
        const open = openKey === token
        return (
          <span key={token} className="relative">
            <button
              type="button"
              data-storyboard-prompt-segment={segment.key}
              aria-label={t('storyboardEditor.promptSkeleton.segmentAria', { label: segment.label, value: segment.value })}
              onClick={() => setOpenKey(open ? null : token)}
              className={cn('rounded-nomi-sm border border-dashed border-nomi-ink-30 bg-nomi-paper px-1.5 py-0.5 text-micro text-nomi-ink-60 hover:border-nomi-accent hover:text-nomi-accent')}
            >
              {t(segment.label)} · {segment.value}
            </button>
            {open ? (
              <div className="absolute left-0 top-full z-20 mt-1 flex min-w-28 flex-col gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 shadow-nomi-sm">
                <span className="px-1 py-0.5 text-micro text-nomi-ink-40">{t('storyboardEditor.promptSkeleton.choose')}</span>
                {segment.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      onChange(replacePromptSkeletonRange(prompt, ranges ?? [], segment, option))
                      setOpenKey(null)
                    }}
                    className="rounded-nomi-sm px-1.5 py-1 text-left text-micro text-nomi-ink-70 hover:bg-nomi-accent-soft hover:text-nomi-accent"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </span>
        )
      })}
    </div>
  )
}
