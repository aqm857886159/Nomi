import type { Node } from '@xyflow/react'
import type { TimelineClip, TimelineTrackType } from './timelineTypes'

const DEFAULT_IMAGE_SECONDS = 3
const DEFAULT_VIDEO_SECONDS = 5

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readNumber(value: unknown): number | null {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function readFirstResultUrl(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const url = readString((item as Record<string, unknown>).url)
    if (url) return url
  }
  return ''
}

function resolveClipType(data: Record<string, unknown>): TimelineTrackType {
  const kind = readString(data.kind).toLowerCase()
  if (kind === 'image' || kind === 'keyframe' || kind === 'character' || kind === 'scene') return 'image'
  if (kind === 'video' || kind === 'composevideo') return 'video'
  return 'image'
}

function resolveFrameCount(type: TimelineTrackType, data: Record<string, unknown>, fps: number): number {
  if (type === 'image') return DEFAULT_IMAGE_SECONDS * fps
  const seconds = readNumber(data.durationSeconds) || readNumber(data.videoDurationSeconds) || DEFAULT_VIDEO_SECONDS
  return Math.max(1, Math.round(seconds * fps))
}

export function buildClipFromNode(node: Node, options?: { fps?: number; startFrame?: number }): TimelineClip | null {
  if (!node || !node.id) return null
  const data = node.data && typeof node.data === 'object' ? node.data as Record<string, unknown> : {}
  const fps = options?.fps || 30
  const startFrame = Math.max(0, Math.floor(options?.startFrame || 0))
  const type = resolveClipType(data)
  const frameCount = resolveFrameCount(type, data, fps)
  const label = readString(data.label) || readString(data.name) || readString(data.prompt) || String(node.id)
  const imageUrl = readString(data.imageUrl) || readFirstResultUrl(data.imageResults)
  const videoUrl = readString(data.videoUrl) || readFirstResultUrl(data.videoResults)
  const url = type === 'video' ? videoUrl : type === 'image' ? imageUrl : ''
  const thumbnailUrl = type === 'video' ? readString(data.thumbnailUrl) || readString(data.videoThumbnailUrl) : imageUrl
  if (!url) return null

  return {
    id: `clip-${node.id}-${type}-${startFrame}`,
    type,
    sourceNodeId: String(node.id),
    label,
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    ...(url ? { url } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  }
}
