import type { AssetKind, AssetRef } from '../../assets/assetTypes'
import type { TimelineState, TimelineClip } from '../../timeline/timelineTypes'
import i18n from '../../../i18n'

export type ClipNodeSource = {
  id: string
  type: 'image' | 'video'
  label: string
  url: string
  thumbnailUrl?: string
  durationSeconds: number
  trimStart: number
  trimEnd: number
}

export type ClipNodeMeta = {
  nodeRole: 'clip'
  sourceNodeIds: string[]
  clips: ClipNodeSource[]
  selectedClipId?: string
}

export function emptyClipNodeMeta(): ClipNodeMeta {
  return { nodeRole: 'clip', sourceNodeIds: [], clips: [] }
}

export function readClipNodeMeta(meta: Record<string, unknown> | undefined): ClipNodeMeta {
  const raw = meta?.clip
  if (!raw || typeof raw !== 'object') return emptyClipNodeMeta()
  const record = raw as Partial<ClipNodeMeta>
  const clips = Array.isArray(record.clips)
    ? record.clips.filter((clip): clip is ClipNodeSource => Boolean(clip && typeof clip === 'object' && typeof (clip as ClipNodeSource).url === 'string'))
    : []
  return {
    nodeRole: 'clip',
    sourceNodeIds: clips.map((clip) => clip.id),
    clips,
    ...(typeof record.selectedClipId === 'string' ? { selectedClipId: record.selectedClipId } : {}),
  }
}

export function clipNodeSourceFromAsset(asset: AssetRef): ClipNodeSource | null {
  if (asset.kind !== 'image' && asset.kind !== 'video') return null
  const durationSeconds = asset.kind === 'image' ? 4 : 6
  return {
    id: asset.id,
    type: asset.kind,
    label: asset.name || (asset.kind === 'image' ? '图片' : '视频'),
    url: asset.renderUrl,
    ...(asset.thumbUrl ? { thumbnailUrl: asset.thumbUrl } : {}),
    durationSeconds,
    trimStart: 0,
    trimEnd: durationSeconds,
  }
}

export function appendClipNodeSource(meta: ClipNodeMeta, source: ClipNodeSource): ClipNodeMeta {
  if (meta.clips.some((clip) => clip.id === source.id)) return meta
  return {
    ...meta,
    sourceNodeIds: [...meta.sourceNodeIds, source.id],
    clips: [...meta.clips, source],
    selectedClipId: source.id,
  }
}

export function updateClipNodeSource(meta: ClipNodeMeta, sourceId: string, patch: Partial<ClipNodeSource>): ClipNodeMeta {
  return { ...meta, clips: meta.clips.map((clip) => (clip.id === sourceId ? { ...clip, ...patch } : clip)) }
}

export function clipNodeTimeline(meta: ClipNodeMeta, fps = 30): TimelineState {
  const safeFps = Math.max(1, Math.round(fps))
  let cursor = 0
  const clips: TimelineClip[] = meta.clips.map((source) => {
    const frameCount = Math.max(1, Math.round(Math.max(0.1, source.durationSeconds) * safeFps))
    const offsetStartFrame = Math.min(frameCount - 1, Math.max(0, Math.round(source.trimStart * safeFps)))
    const requestedEndFrame = Math.round(Math.max(source.trimStart + 0.1, source.trimEnd) * safeFps)
    const sourceEndFrame = Math.min(frameCount, Math.max(offsetStartFrame + 1, requestedEndFrame))
    const visibleFrames = Math.max(1, sourceEndFrame - offsetStartFrame)
    const clip: TimelineClip = {
      id: `clip-${source.id}`,
      type: source.type,
      sourceNodeId: source.id,
      label: source.label,
      startFrame: cursor,
      endFrame: cursor + visibleFrames,
      frameCount,
      offsetStartFrame,
      offsetEndFrame: frameCount - sourceEndFrame,
      url: source.url,
      ...(source.thumbnailUrl ? { thumbnailUrl: source.thumbnailUrl } : {}),
    }
    cursor += visibleFrames
    return clip
  })
  return {
    version: 1,
    fps: safeFps,
    scale: 1,
    playheadFrame: 0,
    tracks: [{ id: 'videoTrack', type: 'video', label: i18n.t('timelineEditor.videoLabel'), clips }],
    textClips: [],
  }
}

export function removeClipNodeSource(meta: ClipNodeMeta, sourceId: string): ClipNodeMeta {
  const clips = meta.clips.filter((clip) => clip.id !== sourceId)
  return {
    ...meta,
    clips,
    sourceNodeIds: clips.map((clip) => clip.id),
    ...(meta.selectedClipId === sourceId ? { selectedClipId: clips[0]?.id } : {}),
  }
}

export function isClipAssetKind(kind: AssetKind): kind is 'image' | 'video' {
  return kind === 'image' || kind === 'video'
}
