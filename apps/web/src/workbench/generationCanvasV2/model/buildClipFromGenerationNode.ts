import type { TimelineClip, TimelineTrackType } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'

const DEFAULT_IMAGE_SECONDS = 3
const DEFAULT_VIDEO_SECONDS = 5

type BuildClipOptions = {
  fps?: number
  startFrame?: number
  resultId?: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPositiveNumber(value: unknown): number | null {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function normalizeFrame(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0
}

function resolveSelectedResult(node: GenerationCanvasNode, resultId?: string): GenerationNodeResult | null {
  const selectedResultId = readString(resultId)
  if (!selectedResultId) return node.result || null
  return (node.history || []).find((result) => result.id === selectedResultId) || null
}

function resolveClipType(node: GenerationCanvasNode, result: GenerationNodeResult | null): TimelineTrackType {
  if (result?.type === 'image' || result?.type === 'video') return result.type
  if (node.kind === 'image' || node.kind === 'keyframe' || node.kind === 'character' || node.kind === 'scene') return 'image'
  if (node.kind === 'video') return 'video'
  return 'image'
}

function resolveFrameCount(type: TimelineTrackType, result: GenerationNodeResult | null, fps: number): number {
  if (type === 'image') return DEFAULT_IMAGE_SECONDS * fps
  const seconds = readPositiveNumber(result?.durationSeconds) || DEFAULT_VIDEO_SECONDS
  return Math.max(1, Math.round(seconds * fps))
}

function buildClipId(nodeId: string, type: TimelineTrackType, startFrame: number, result: GenerationNodeResult | null): string {
  const resultPart = result?.id ? `-${result.id}` : ''
  return `clip-${nodeId}${resultPart}-${type}-${startFrame}`
}

function isBlockedByActiveStatus(node: GenerationCanvasNode, resultId?: string): boolean {
  if (node.status !== 'queued' && node.status !== 'running' && node.status !== 'error') return false
  return !readString(resultId)
}

export function buildClipFromGenerationNode(node: GenerationCanvasNode, options?: BuildClipOptions): TimelineClip | null {
  if (!node?.id) return null
  if (isBlockedByActiveStatus(node, options?.resultId)) return null

  const result = resolveSelectedResult(node, options?.resultId)
  if (options?.resultId && !result) return null

  const fps = readPositiveNumber(options?.fps) || 30
  const startFrame = normalizeFrame(options?.startFrame)
  const type = resolveClipType(node, result)
  const label = readString(node.title) || readString(node.prompt) || node.id
  const url = readString(result?.url)
  const thumbnailUrl = readString(result?.thumbnailUrl) || (type === 'image' ? url : '')

  if ((type === 'image' || type === 'video') && !url) return null

  const frameCount = resolveFrameCount(type, result, fps)

  return {
    id: buildClipId(node.id, type, startFrame, result),
    type,
    sourceNodeId: node.id,
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
