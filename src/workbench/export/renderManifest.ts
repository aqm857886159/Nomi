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

function buildAssetFromClip(clip: TimelineClip): RendererRenderAsset {
  const clipWithProbeData = clip as TimelineClipWithFutureProbeData
  return {
    id: clip.sourceNodeId,
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

function buildAssets(tracks: TimelineTrack[]): Record<string, RendererRenderAsset> {
  return tracks.reduce<Record<string, RendererRenderAsset>>((assets, track) => {
    track.clips.forEach((clip) => {
      const next = buildAssetFromClip(clip)
      assets[next.id] = mergeAsset(assets[next.id], next)
    })
    return assets
  }, {})
}

function buildClip(clip: TimelineClip): RendererRenderManifestRequest['timeline']['tracks'][number]['clips'][number] {
  // 取景只在非默认时携带 → 默认构图的 clip 不增 manifest 体积、不动既有快照。
  const framing = resolveClipFraming(clip)
  return {
    id: clip.id,
    assetId: clip.sourceNodeId,
    startFrame: clip.startFrame,
    endFrame: clip.endFrame,
    sourceStartFrame: clip.offsetStartFrame,
    sourceEndFrame: clip.offsetEndFrame,
    ...(isDefaultFraming(framing) ? {} : { transform: framing }),
  }
}

function buildTrack(track: TimelineTrack): RendererRenderManifestRequest['timeline']['tracks'][number] {
  return {
    id: track.id,
    kind: track.type,
    type: track.type,
    clips: track.clips.map(buildClip),
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
  const tracks = options.timeline.tracks
    .map(buildTrack)
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
    assets: buildAssets(options.timeline.tracks),
    diagnostics: { warnings },
  }
}
