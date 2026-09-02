import type { TimelineClip, TimelineClipType } from '../../timeline/timelineTypes'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import { getGenerationNodeExecutionKind } from './generationNodeKinds'

/**
 * 图片素材的默认停留秒数——时间轴 clip 与分镜表「图片镜停留时长」的**单一真相源**
 * （分镜 v5：`PlanShot.durationSec` 对图片镜生效为停留时长，默认值必须与 clip 落轨一致，
 * 禁止在别处再写字面量 3）。
 */
export const DEFAULT_IMAGE_SECONDS = 3
const DEFAULT_VIDEO_SECONDS = 5

type BuildClipOptions = {
  fps?: number
  startFrame?: number
  resultId?: string
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * clip 播放 URL 口径：本地 url > providerUrl > thumbnailUrl（PR#54：本地持久文件优先，
 * 不再优先会过期的 ComfyUI/CDN providerUrl；providerUrl 仅在无本地拷贝时兜底）。
 * 与 referenceUrl.resultUrl 同序但**不过 asUrl 的 vendor 白名单**——clip.url 供本地 <video>/<img>
 * 播放，file:// / nomi-local:// 等本地 scheme 都合法；被 vendor 白名单收紧会把 file:// 产物误丢成 null clip（记忆 url-priority-inconsistency）。
 */
function pickClipUrl(result: GenerationNodeResult | null | undefined): string {
  return readString(result?.url) || readString(result?.providerUrl) || readString(result?.thumbnailUrl)
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

function resolveClipType(node: GenerationCanvasNode, result: GenerationNodeResult | null): TimelineClipType {
  // v0.7.1: audio category 优先级最高（即使 kind 占位是 image）
  if (node.categoryId === 'audio') return 'audio'
  if (result?.type === 'image' || result?.type === 'video') return result.type
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind === 'image') return 'image'
  if (executionKind === 'video') return 'video'
  return 'image'
}

function resolveFrameCount(
  type: TimelineClipType,
  result: GenerationNodeResult | null,
  fps: number,
  metaDurationSeconds?: number | null,
): number {
  if (type === 'image') return DEFAULT_IMAGE_SECONDS * fps
  // 时长真相序：生成参数 result.durationSeconds > 文件真实时长 meta.videoDuration（拖入/上传的视频
  // 渲染/导入时离屏测得，见 readVideoDurationSeconds）> 默认 5 秒。修「拖入视频一律 5 秒」的根因。
  const seconds = readPositiveNumber(result?.durationSeconds)
    ?? readPositiveNumber(metaDurationSeconds)
    ?? DEFAULT_VIDEO_SECONDS
  return Math.max(1, Math.round(seconds * fps))
}

function buildClipId(nodeId: string, type: TimelineClipType, startFrame: number, result: GenerationNodeResult | null): string {
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
  const url = pickClipUrl(result)
  const thumbnailUrl = readString(result?.thumbnailUrl) || (type === 'image' ? url : '')

  // v0.7.1: image / video / audio 都要求有 url（生成或上传后才允许拖）
  if (!url) return null

  const metaDurationSeconds = readPositiveNumber((node.meta as Record<string, unknown> | undefined)?.videoDuration)
  const frameCount = resolveFrameCount(type, result, fps, metaDurationSeconds)

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

/**
 * 把「重生成后的新产物」回填进一条已存在的 clip（C0 回填闸的纯函数核）。
 * 铁律（评审挖出的三个坑）：
 *  - 位置不变：startFrame 保持（"位置不变 = 起点不变"，时长真变了 endFrame 才变）。
 *  - URL 口径：本地 url > providerUrl > thumbnailUrl（pickClipUrl，不过 vendor 白名单，保 file://）。
 *  - trim 越界夹取：新产物时长可能变短/变长，offset 夹进新 frameCount，保可见 ≥1 帧。
 * image clip 的时长是用户设的、与产物无关 → 只换 URL；video/audio 才按新 durationSeconds 重算。
 * 无可用产物（url 空）→ 原样返回（防御，不破坏既有 clip）。
 */
export function applyRegeneratedResultToClip(
  clip: TimelineClip,
  result: GenerationNodeResult | null,
  fps?: number,
): TimelineClip {
  const url = pickClipUrl(result)
  if (!url) return clip
  const thumbnailUrl = readString(result?.thumbnailUrl) || (clip.type === 'image' ? url : clip.thumbnailUrl || '')

  if (clip.type === 'image') {
    return { ...clip, url, ...(thumbnailUrl ? { thumbnailUrl } : {}) }
  }

  const safeFps = readPositiveNumber(fps) || 30
  const nextFrameCount = resolveFrameCount(clip.type, result, safeFps)
  const offsetStartFrame = Math.min(Math.max(0, clip.offsetStartFrame), Math.max(0, nextFrameCount - 1))
  const offsetEndFrame = Math.min(Math.max(0, clip.offsetEndFrame), Math.max(0, nextFrameCount - offsetStartFrame - 1))
  const visible = Math.max(1, nextFrameCount - offsetStartFrame - offsetEndFrame)
  return {
    ...clip,
    url,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    frameCount: nextFrameCount,
    offsetStartFrame,
    offsetEndFrame,
    endFrame: clip.startFrame + visible,
  }
}
