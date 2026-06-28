import type { TimelineClip } from './timelineTypes'

export type TimelineClipPreviewMedia =
  | { kind: 'image'; src: string }
  | { kind: 'video'; src: string }
  | { kind: 'placeholder' }
  | { kind: 'none' }

const IMAGE_URL_RE = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i

function cleanMediaUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isLikelyStillImageUrl(value: unknown): boolean {
  const url = cleanMediaUrl(value)
  if (!url) return false
  if (/^data:image\//i.test(url)) return true
  if (/^blob:/i.test(url)) return false
  return IMAGE_URL_RE.test(url)
}

export function shouldMountTimelineClipVideoPreview(
  clip: TimelineClip,
  options: { isSingleSelected: boolean },
): boolean {
  const url = cleanMediaUrl(clip.url)
  return clip.type === 'video'
    && options.isSingleSelected
    && Boolean(url)
    && !isLikelyStillImageUrl(url)
}

export function resolveTimelineClipPreviewMedia(
  clip: TimelineClip,
  options: { isSingleSelected: boolean },
): TimelineClipPreviewMedia {
  const url = cleanMediaUrl(clip.url)
  const thumbnailUrl = cleanMediaUrl(clip.thumbnailUrl)

  if (clip.type === 'image') {
    const src = url || thumbnailUrl
    return src ? { kind: 'image', src } : { kind: 'none' }
  }

  if (clip.type !== 'video') return { kind: 'none' }

  if (shouldMountTimelineClipVideoPreview(clip, options)) {
    return { kind: 'video', src: url }
  }

  if (isLikelyStillImageUrl(thumbnailUrl)) {
    return { kind: 'image', src: thumbnailUrl }
  }

  if (isLikelyStillImageUrl(url)) {
    return { kind: 'image', src: url }
  }

  return url || thumbnailUrl ? { kind: 'placeholder' } : { kind: 'none' }
}
