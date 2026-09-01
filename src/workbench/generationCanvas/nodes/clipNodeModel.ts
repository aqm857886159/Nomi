import type { AssetKind, AssetRef } from '../../assets/assetTypes'
import type { TimelineState, TimelineClip } from '../../timeline/timelineTypes'
import i18n from '../../../i18n'

export type ClipNodeSource = {
  id: string
  /** 原始素材/画布节点身份；split 后的片段实例共享此值。旧数据缺省时回退到 id。 */
  sourceNodeId?: string
  type: 'image' | 'video'
  label: string
  url: string
  thumbnailUrl?: string
  durationSeconds: number
  trimStart: number
  trimEnd: number
  /** 单轨剪辑位置和源素材 offset；未写入时由旧 trimStart/trimEnd 推导。 */
  timelineStartFrame?: number
  timelineEndFrame?: number
  offsetStartFrame?: number
  offsetEndFrame?: number
}

export type ClipNodeMeta = {
  nodeRole: 'clip'
  sourceNodeIds: string[]
  clips: ClipNodeSource[]
  /** 用户在节点内明确移除的上游节点；避免连接同步 effect 下一帧把它重新灌回来。 */
  excludedSourceNodeIds?: string[]
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
  const excludedSourceNodeIds = Array.isArray(record.excludedSourceNodeIds)
    ? record.excludedSourceNodeIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  return {
    nodeRole: 'clip',
    sourceNodeIds: clips.map((clip) => clip.id),
    clips,
    ...(excludedSourceNodeIds.length ? { excludedSourceNodeIds } : {}),
    ...(typeof record.selectedClipId === 'string' ? { selectedClipId: record.selectedClipId } : {}),
  }
}

export function clipNodeSourceFromAsset(asset: AssetRef, resolvedDurationSeconds?: number | null): ClipNodeSource | null {
  if (asset.kind !== 'image' && asset.kind !== 'video') return null
  const durationSeconds = asset.kind === 'image'
    ? 4
    : Number.isFinite(resolvedDurationSeconds) && Number(resolvedDurationSeconds) > 0
      ? Number(resolvedDurationSeconds)
      : 6
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
  const excludedSourceNodeIds = (meta.excludedSourceNodeIds ?? []).filter((id) => id !== source.id && id !== source.sourceNodeId)
  return {
    ...meta,
    sourceNodeIds: [...meta.sourceNodeIds, source.id],
    clips: [...meta.clips, source],
    ...(excludedSourceNodeIds.length ? { excludedSourceNodeIds } : { excludedSourceNodeIds: undefined }),
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
    const legacyOffsetStartFrame = Math.min(frameCount - 1, Math.max(0, Math.round(source.trimStart * safeFps)))
    const legacySourceEndFrame = Math.min(frameCount, Math.max(legacyOffsetStartFrame + 1, Math.round(Math.max(source.trimStart + 0.1, source.trimEnd) * safeFps)))
    const offsetStartFrame = Math.min(frameCount - 1, Math.max(0, Math.round(source.offsetStartFrame ?? legacyOffsetStartFrame)))
    const offsetEndFrame = Math.min(frameCount - offsetStartFrame - 1, Math.max(0, Math.round(source.offsetEndFrame ?? (frameCount - legacySourceEndFrame))))
    const visibleFrames = Math.max(1, source.timelineEndFrame !== undefined && source.timelineStartFrame !== undefined
      ? Math.round(source.timelineEndFrame - source.timelineStartFrame)
      : frameCount - offsetStartFrame - offsetEndFrame)
    const startFrame = source.timelineStartFrame !== undefined ? Math.max(0, Math.round(source.timelineStartFrame)) : cursor
    const clip: TimelineClip = {
      id: `clip-${source.id}`,
      type: source.type,
      sourceNodeId: source.sourceNodeId ?? source.id,
      label: source.label,
      startFrame,
      endFrame: startFrame + visibleFrames,
      frameCount,
      offsetStartFrame,
      offsetEndFrame,
      url: source.url,
      ...(source.thumbnailUrl ? { thumbnailUrl: source.thumbnailUrl } : {}),
    }
    cursor = Math.max(cursor, clip.endFrame)
    return clip
  }).sort((left, right) => left.startFrame - right.startFrame)
  return {
    version: 1,
    fps: safeFps,
    scale: 1,
    playheadFrame: 0,
    tracks: [{ id: 'videoTrack', type: 'video', label: i18n.t('timelineEditor.track.videoLabel'), clips }],
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
