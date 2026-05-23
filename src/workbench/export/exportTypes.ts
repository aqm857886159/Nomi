import type { ExportPreset, ExportQuality, ExportResolution } from '../../../electron/export/exportTypes'
import type { ExportProfile } from '../../../electron/export/exportTypes'
import type { TimelineState } from '../timeline/timelineTypes'
import type { PreviewAspectRatio } from '../workbenchTypes'

export type {
  ExportAspectRatio,
  ExportJobStatus,
  ExportPreset,
  ExportProfile,
  ExportQuality,
  ExportResolution,
  ExportStage,
} from '../../../electron/export/exportTypes'

export type ExportRequest = {
  projectId: string
  timeline: TimelineState
  aspectRatio: PreviewAspectRatio
  preset: ExportPreset
  resolution: ExportResolution
  quality: ExportQuality
  outputName?: string
}

export type RendererRenderAsset = {
  id: string
  kind: 'image' | 'video' | 'audio'
  url?: string
  durationSeconds?: number
  width?: number
  height?: number
  fps?: number
  videoCodec?: string
  audioCodec?: string
  hasAudio?: boolean
}

export type RendererRenderClip = {
  id: string
  assetId: string
  startFrame: number
  endFrame: number
  sourceStartFrame: number
  sourceEndFrame: number
}

export type RendererRenderTrack = {
  id: string
  kind: string
  type: string
  clips: RendererRenderClip[]
}

export type RendererRenderManifestRequest = {
  version: 1
  projectId: string
  createdAt: string
  timeline: {
    fps: number
    durationFrames: number
    range: { startFrame: number; endFrame: number }
    tracks: RendererRenderTrack[]
  }
  profile: ExportProfile
  assets: Record<string, RendererRenderAsset>
  diagnostics: { warnings: string[] }
}

export type DesktopMp4ExportResult = {
  absolutePath: string
  relativePath: string
  size: number
}
