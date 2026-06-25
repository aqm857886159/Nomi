import type { ExportPreset, ExportQuality, ExportResolution } from './exportTypes'
import type { RendererRenderAsset, RendererRenderManifestRequest } from './exportTypes'
import { computeTimelineDuration } from '../timeline/timelineMath'
import type { TimelineClip, TimelineState, TimelineTrack } from '../timeline/timelineTypes'
import { isDefaultFraming, resolveClipFraming } from '../timeline/clipFraming'
import type { PreviewAspectRatio } from '../workbenchTypes'

const RESOLUTION_SIZE: Record<Exclude<ExportResolution, 'source'>, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
}

const ASPECT_RATIO_VALUE: Record<PreviewAspectRatio, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
}

const THIN_TIMELINE_MODEL_WARNING =
  'Timeline model only exposes image/video clips; audio/text/overlay/effect/keyframe entities are not first-class timeline tracks yet.'

const OMIT_UNSUPPORTED_TRACKS_WARNING =
  'Renderer request omits audio/text/overlay/effect/keyframe tracks instead of synthesizing unsupported timeline data.'

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2)
}

function dimensionsForPreset(
  resolution: Exclude<ExportResolution, 'source'>,
  aspectRatio: PreviewAspectRatio,
): { width: number; height: number } {
  if (aspectRatio === '16:9') return RESOLUTION_SIZE[resolution]
  const base = resolution === '720p' ? 720 : 1080
  const ratio = ASPECT_RATIO_VALUE[aspectRatio]
  if (ratio >= 1) return { width: even(base * ratio), height: even(base) }
  return { width: even(base), height: even(base / ratio) }
}

type TimelineClipWithFutureProbeData = TimelineClip & {
  hasAudio?: unknown
}

/**
 * 解析每个 clip 的 asset id（导出契约：asset map key === asset.id === clip.assetId）。
 *
 * 根因（P2）：旧实现一律拿 clip.sourceNodeId 当 asset id，于是「同一节点的两个不同 result
 * （不同 url）都放上时间轴」会合并成一个 asset、只留先到的 url → 后镜头放成前画面。
 * 修法：合并键纳入「内容标识」= url。同节点同 url 仍合一个（split 出的两段、同图放两处）；
 * 同节点不同 url 各自成 asset。第一/唯一 url 保留裸 sourceNodeId（不动既有单产物快照与 id 可读性），
 * 之后每个新 url 领一个稳定后缀。两遍扫描全轨 → buildAssets 与 buildClip 共用同一映射，绝不分叉。
 */
function resolveAssetIds(tracks: TimelineTrack[]): Map<string, string> {
  const clipIdToAssetId = new Map<string, string>()
  // sourceNodeId → (url → assetId)：同节点下每个 distinct url 分一个稳定 id
  const nodeUrlToAssetId = new Map<string, Map<string, string>>()
  for (const track of tracks) {
    for (const clip of track.clips) {
      const nodeId = clip.sourceNodeId
      const urlKey = clip.url ?? '' // 无 url 的 clip 归到该节点的「空 url」桶，仍共用裸 nodeId
      let urlMap = nodeUrlToAssetId.get(nodeId)
      if (!urlMap) {
        urlMap = new Map<string, string>()
        nodeUrlToAssetId.set(nodeId, urlMap)
      }
      let assetId = urlMap.get(urlKey)
      if (assetId === undefined) {
        // 第一个 url 用裸 nodeId；之后用 nodeId#2、#3…（非空、稳定、可读）
        assetId = urlMap.size === 0 ? nodeId : `${nodeId}#${urlMap.size + 1}`
        urlMap.set(urlKey, assetId)
      }
      clipIdToAssetId.set(clip.id, assetId)
    }
  }
  return clipIdToAssetId
}

function buildAssetFromClip(clip: TimelineClip, assetId: string): RendererRenderAsset {
  const clipWithProbeData = clip as TimelineClipWithFutureProbeData
  return {
    id: assetId,
    kind: clip.type,
    ...(clip.url ? { url: clip.url } : {}),
    ...(typeof clipWithProbeData.hasAudio === 'boolean' ? { hasAudio: clipWithProbeData.hasAudio } : {}),
  }
}

function mergeAsset(existing: RendererRenderAsset | undefined, next: RendererRenderAsset): RendererRenderAsset {
  const merged: RendererRenderAsset = {
    ...next,
    ...existing,
  }
  const url = existing?.url ?? next.url
  const hasAudio = existing?.hasAudio ?? next.hasAudio

  if (url !== undefined) merged.url = url
  if (hasAudio !== undefined) merged.hasAudio = hasAudio

  return merged
}

function buildAssets(tracks: TimelineTrack[], clipIdToAssetId: Map<string, string>): Record<string, RendererRenderAsset> {
  return tracks.reduce<Record<string, RendererRenderAsset>>((assets, track) => {
    track.clips.forEach((clip) => {
      const assetId = clipIdToAssetId.get(clip.id) ?? clip.sourceNodeId
      const next = buildAssetFromClip(clip, assetId)
      assets[next.id] = mergeAsset(assets[next.id], next)
    })
    return assets
  }, {})
}

function buildClip(
  clip: TimelineClip,
  clipIdToAssetId: Map<string, string>,
): RendererRenderManifestRequest['timeline']['tracks'][number]['clips'][number] {
  // 取景只在非默认时携带 → 默认构图的 clip 不增 manifest 体积、不动既有快照。
  const framing = resolveClipFraming(clip)
  // 源帧窗口 = [offsetStartFrame, frameCount − offsetEndFrame]。offset* 是「从两端裁掉的帧数」，
  // 不是源位置——直接把 offsetEndFrame 当 sourceEndFrame 是 P2 根因 bug：未裁剪 clip(offsetEnd=0)
  // 会得到 sourceEnd=0 ≤ sourceStart=0，assertValidManifest 拒收 → 整个导出静默回退无声 WebM
  // （filtergraph「所见即所得」主路径形同虚设，配乐也因此从来出不来）。
  return {
    id: clip.id,
    assetId: clipIdToAssetId.get(clip.id) ?? clip.sourceNodeId,
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
    sourceStartFrame: clip.offsetStartFrame,
    sourceEndFrame: Math.max(clip.offsetStartFrame + 1, clip.frameCount - clip.offsetEndFrame),
    ...(isDefaultFraming(framing) ? {} : { transform: framing }),
  }
}

function buildTrack(
  track: TimelineTrack,
  clipIdToAssetId: Map<string, string>,
): RendererRenderManifestRequest['timeline']['tracks'][number] {
  return {
    id: track.id,
    kind: track.type,
    type: track.type,
    clips: track.clips.map((clip) => buildClip(clip, clipIdToAssetId)),
  }
}

export function buildRenderManifestRequest(options: {
  projectId: string
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  resolution: Exclude<ExportResolution, 'source'>
  quality: ExportQuality
  preset: Exclude<ExportPreset, 'webm'>
}): RendererRenderManifestRequest {
  const durationFrames = computeTimelineDuration(options.timeline)
  const dimensions = dimensionsForPreset(options.resolution, options.aspectRatio)
  // 单一来源:clip→assetId 映射先算一次,track 与 assets 共用,保证 assetId/asset.id/map key 三处一致。
  const clipIdToAssetId = resolveAssetIds(options.timeline.tracks)
  const tracks = options.timeline.tracks
    .map((track) => buildTrack(track, clipIdToAssetId))
    .filter((track) => track.clips.length > 0)
  const warnings = [THIN_TIMELINE_MODEL_WARNING, OMIT_UNSUPPORTED_TRACKS_WARNING]

  if (tracks.length === 0) {
    warnings.unshift('Timeline has no image or video clips to render.')
  }

  return {
    version: 1,
    projectId: options.projectId,
    createdAt: new Date().toISOString(),
    timeline: {
      fps: options.timeline.fps,
      durationFrames,
      range: { startFrame: 0, endFrame: durationFrames },
      tracks,
    },
    profile: {
      preset: options.preset,
      container: 'mp4',
      videoCodec: 'h264',
      audioCodec: 'none',
      audioMode: 'mute',
      width: dimensions.width,
      height: dimensions.height,
      fps: options.timeline.fps,
      pixelFormat: 'yuv420p',
      quality: options.quality,
    },
    assets: buildAssets(options.timeline.tracks, clipIdToAssetId),
    diagnostics: { warnings },
  }
}
