import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import PromptEditor from '../../../assets/PromptEditor'
import type { MentionSuggestionItem, MentionUploadControls } from '../../../assets/AssetMentionSuggestionList'
import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'
import { replacePromptSkeletonRange, validPromptSkeletonSegments, type PromptSkeletonViewSegment } from './promptSkeletonRangeUtils'

export default function PromptSkeletonSegments({
  prompt, profile, ranges, onChange, editorProps,
}: {
  prompt: string
  profile?: StoryboardProfile
  ranges?: PromptSegmentRange[]
  onChange: (next: { prompt: string; ranges: PromptSegmentRange[] }) => void
  editorProps: {
    placeholder?: string
    className?: string
    mentionCandidates?: string[]
    mentionSearch?: (query: string) => MentionSuggestionItem[]
    onMentionSelect?: (item: MentionSuggestionItem) => number | null
    mentionUpload?: MentionUploadControls
    onReady?: (editor: import('@tiptap/react').Editor) => void
  }
}): JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState<{ segment: PromptSkeletonViewSegment; rect: DOMRect } | null>(null)
  const shellRef = React.useRef<HTMLDivElement>(null)
  const segments = validPromptSkeletonSegments(prompt, profile, ranges)
  // 装饰段是可点元素（role=button），必须带可访问名——返工把旧胶囊按钮的 aria-label 弄丢了，这里补回。
  const decoratedSegments = React.useMemo(
    () => segments.map((segment) => ({
      ...segment,
      ariaLabel: t('storyboardEditor.promptSkeleton.segmentAria', { label: t(segment.label), value: segment.value }),
    })),
    [segments, t],
  )

  return (
    <div ref={shellRef} className="relative" data-storyboard-prompt-skeleton={segments.length > 0 ? 'true' : undefined}>
      <PromptEditor
        {...editorProps}
        value={prompt}
        onChange={(next) => onChange({ prompt: next, ranges: [] })}
        promptSegments={decoratedSegments}
        onPromptSegmentClick={(segment, rect) => {
          const found = segments.find((candidate) => candidate.key === segment.key && candidate.start === segment.start && candidate.end === segment.end)
          if (found) setOpen({ segment: found, rect })
        }}
      />
      {open ? (
        <div
          className="absolute z-20 mt-1 flex min-w-28 flex-col gap-0.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1 shadow-nomi-sm"
          style={{ left: `${Math.max(0, open.rect.left - (shellRef.current?.getBoundingClientRect().left ?? 0))}px`, top: `${open.rect.bottom - (shellRef.current?.getBoundingClientRect().top ?? 0)}px` }}
          data-storyboard-prompt-menu="true"
        >
          <span className="px-1 py-0.5 text-micro text-nomi-ink-40">{t('storyboardEditor.promptSkeleton.choose')}</span>
          {open.segment.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onChange(replacePromptSkeletonRange(prompt, ranges ?? [], open.segment, option))
                setOpen(null)
              }}
              className={cn('rounded-nomi-sm px-1.5 py-1 text-left text-micro text-nomi-ink-60 hover:bg-nomi-accent-soft hover:text-nomi-accent')}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
