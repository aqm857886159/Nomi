import type { PromptSegmentRange, StoryboardProfile } from '../../../generationCanvas/agent/storyboardPlan'

export type PromptSkeletonViewSegment = PromptSegmentRange & {
  label: string
  value: string
  options: string[]
}

/** range 是可丢失的渲染标注；越界或找不到模板时直接回到纯文本。 */
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

/** 替换文本后只平移仍有效的 range，重叠标注丢弃，不产生第二份提示词真相。 */
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
