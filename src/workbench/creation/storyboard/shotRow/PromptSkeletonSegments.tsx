import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import type { PromptSegmentRange, StoryboardProfile, StoryboardPromptSkeletonSegment } from '../../../generationCanvas/agent/storyboardPlan'

export type PromptSkeletonViewSegment = PromptSegmentRange & {
  label: string
  value: string
  options: string[]
}

export function validPromptSkeletonSegments(
  prompt: string,
  profile: StoryboardProfile | undefined,
  ranges: PromptSegmentRange[] | undefined,
): PromptSkeletonViewSegment[] {
  if (!profile || !ranges?.length) return []
  const byKey = new Map(profile.promptSkeleton.map((segment) => [segment.key, segment]))
  return ranges.flatMap((range) => {
    const schema = byKey.get(range.key)
    if (!schema || !Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end <= range.start || range.end > prompt.length) return []
    return [{ ...range, label: schema.label, value: prompt.slice(range.start, range.end), options: schema.options }]
  })
}

export function replacePromptSkeletonRange(
  prompt: string,
  ranges: PromptSegmentRange[],
  target: PromptSegmentRange,
  replacement: string,
): { prompt: string; ranges: PromptSegmentRange[] } {
  const nextPrompt = `${prompt.slice(0, target.start)}${replacement}${prompt.slice(target.end)}`
  const delta = replacement.length - (target.end - target.start)
  const nextRanges = ranges.flatMap((range) => {
    if (range.key === target.key && range.start === target.start && range.end === target.end) {
      return [{ ...range, end: range.start + replacement.length }]
    }
    if (range.start >= target.end) return [{ ...range, start: range.start + delta, end: range.end + delta }]
    if (range.end <= target.start) return [range]
    return []
  })
  return { prompt: nextPrompt, ranges: nextRanges }
}

function schemaFor(segment: PromptSkeletonViewSegment): StoryboardPromptSkeletonSegment {
  return { key: segment.key, label: segment.label, kind: 'enum', options: segment.options }
}

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
                {schemaFor(segment).options.map((option) => (
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
