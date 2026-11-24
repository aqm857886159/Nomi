import type { PreviewAspectRatio } from '../workbenchTypes'
import { timelineHasVisualClips } from '../timeline/timelineMath'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'

type PreviewRatioOption = {
  value: PreviewAspectRatio
  label: string
  css: string
  width: number
  height: number
}

// 预览/导出可选画幅。css 给预览容器 aspect-ratio，width/height 给导出维度推算。
export const PREVIEW_RATIOS: PreviewRatioOption[] = [
  { value: '16:9', label: '16:9', css: '16 / 9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', css: '9 / 16', width: 9, height: 16 },
  { value: '1:1', label: '1:1', css: '1 / 1', width: 1, height: 1 },
  { value: '4:5', label: '4:5', css: '4 / 5', width: 4, height: 5 },
  { value: '3:4', label: '3:4', css: '3 / 4', width: 3, height: 4 },
  { value: '4:3', label: '4:3', css: '4 / 3', width: 4, height: 3 },
  { value: '21:9', label: '21:9', css: '21 / 9', width: 21, height: 9 },
]

export type PreviewAspect = {
  ratio: PreviewAspectRatio
  source: 'auto' | 'manual'
}

export function normalizePreviewAspect(value: unknown): PreviewAspect | undefined {
  if (!value || typeof value !== 'object' || !('ratio' in value) || !('source' in value)) return undefined
  const ratio = PREVIEW_RATIOS.find(option => option.value === value.ratio)
  if (!ratio || (value.source !== 'auto' && value.source !== 'manual')) return undefined
  return { ratio: ratio.value, source: value.source }
}

export function selectPreviewAspectRatio(state: { previewAspect?: PreviewAspect }): PreviewAspectRatio {
  return state.previewAspect?.ratio ?? PREVIEW_RATIOS[0].value
}

export function matchFirstVisualAspect(
  previous: TimelineState,
  next: TimelineState,
  aspect: PreviewAspect | undefined,
): PreviewAspect | undefined {
  if (aspect?.source === 'manual' || timelineHasVisualClips(previous)) return aspect
  let first: TimelineClip | undefined
  for (const track of next.tracks) {
    if (track.type === 'audio') continue
    for (const clip of track.clips) {
      if (!first || clip.startFrame < first.startFrame ||
          (clip.startFrame === first.startFrame && clip.type === 'video')) first = clip
    }
  }
  const source = first?.sourceAspectRatio
  if (!source || !Number.isFinite(source) || source <= 0) return aspect
  // Minimize proportional mismatch the same way on both landscape and portrait sources.
  const distance = (option: PreviewRatioOption) => Math.abs(Math.log(source / (option.width / option.height)))
  const closest = PREVIEW_RATIOS.reduce((best, candidate) => distance(candidate) < distance(best) ? candidate : best)
  return { ratio: closest.value, source: 'auto' }
}
