import type { TimelineClip, TimelineState } from '../../timeline/timelineTypes'
import {
  duplicateClipById,
  moveClipToLegalFrame,
  nudgeClipById,
  removeClipById,
  resizeClipEdge,
  splitClipAtFrame,
} from '../../timeline/timelineEdit'
import { clipNodeTimeline, type ClipNodeMeta, type ClipNodeSource } from './clipNodeModel'

const DEFAULT_FPS = 30

export function clipNodeTimelineFromMeta(meta: ClipNodeMeta, fps = DEFAULT_FPS): TimelineState {
  return clipNodeTimeline(meta, fps)
}

function clipInstanceId(clipId: string): string {
  return clipId.startsWith('clip-') ? clipId.slice('clip-'.length) : clipId
}

function sourceForTimelineClip(meta: ClipNodeMeta, clip: TimelineClip): ClipNodeSource | null {
  const instanceId = clipInstanceId(clip.id)
  const exact = meta.clips.find((source) => source.id === instanceId)
  if (exact) return exact
  return meta.clips.find((source) => source.id === clip.sourceNodeId || source.sourceNodeId === clip.sourceNodeId) ?? null
}

function sourceFromTimelineClip(source: ClipNodeSource, clip: TimelineClip, fps: number, instanceId: string): ClipNodeSource {
  const isImage = clip.type === 'image'
  const durationSeconds = isImage ? Math.max(0.1, clip.frameCount / fps) : source.durationSeconds
  return {
    ...source,
    id: instanceId,
    sourceNodeId: source.sourceNodeId ?? source.id,
    durationSeconds,
    trimStart: clip.offsetStartFrame / fps,
    trimEnd: (clip.frameCount - clip.offsetEndFrame) / fps,
    timelineStartFrame: clip.startFrame,
    timelineEndFrame: clip.endFrame,
    offsetStartFrame: clip.offsetStartFrame,
    offsetEndFrame: clip.offsetEndFrame,
  }
}

export function clipNodeMetaFromTimeline(meta: ClipNodeMeta, timeline: TimelineState, fps = timeline.fps || DEFAULT_FPS): ClipNodeMeta {
  const timelineClips = timeline.tracks.flatMap((track) => track.clips).sort((left, right) => left.startFrame - right.startFrame)
  const nextClips = timelineClips.flatMap((clip) => {
    const source = sourceForTimelineClip(meta, clip)
    if (!source) return []
    return [sourceFromTimelineClip(source, clip, fps, clipInstanceId(clip.id))]
  })
  const nextSelected = meta.selectedClipId && nextClips.some((source) => source.id === meta.selectedClipId)
    ? meta.selectedClipId
    : nextClips[0]?.id
  return {
    ...meta,
    clips: nextClips,
    sourceNodeIds: nextClips.map((source) => source.id),
    ...(nextSelected ? { selectedClipId: nextSelected } : { selectedClipId: undefined }),
  }
}

function editClipNode(meta: ClipNodeMeta, edit: (timeline: TimelineState) => TimelineState, fps = DEFAULT_FPS): ClipNodeMeta {
  const timeline = edit(clipNodeTimelineFromMeta(meta, fps))
  return clipNodeMetaFromTimeline(meta, timeline, fps)
}

function editMixedVisualTrack(
  timeline: TimelineState,
  clipId: string,
  edit: (compatibleTimeline: TimelineState) => TimelineState,
): TimelineState {
  const selected = timeline.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId)
  if (!selected) return timeline
  const originalTypes = new Map(timeline.tracks.flatMap((track) => track.clips.map((clip) => [clip.id, clip.type])))
  const compatibleTimeline = {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      type: selected.type,
      clips: track.clips.map((clip) => ({ ...clip, type: selected.type })),
    })),
  }
  const edited = edit(compatibleTimeline)
  return {
    ...edited,
    tracks: edited.tracks.map((track, trackIndex) => ({
      ...track,
      type: timeline.tracks[trackIndex]?.type ?? track.type,
      clips: track.clips.map((clip) => ({ ...clip, type: originalTypes.get(clip.id) ?? selected.type })),
    })),
  }
}

export function moveClipNode(meta: ClipNodeMeta, clipId: string, startFrame: number, fps = DEFAULT_FPS): ClipNodeMeta {
  return editClipNode(meta, (timeline) => moveClipToLegalFrame(timeline, clipId, startFrame), fps)
}

export function splitClipNode(meta: ClipNodeMeta, clipId: string, frame: number, fps = DEFAULT_FPS): ClipNodeMeta {
  return editClipNode(meta, (timeline) => splitClipAtFrame(timeline, clipId, frame), fps)
}

export function resizeClipNode(meta: ClipNodeMeta, clipId: string, edge: 'left' | 'right', deltaFrame: number, fps = DEFAULT_FPS): ClipNodeMeta {
  return editClipNode(meta, (timeline) => resizeClipEdge(timeline, clipId, edge, deltaFrame), fps)
}

function compactTimeline(timeline: TimelineState): TimelineState {
  let cursor = 0
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips
        .slice()
        .sort((left, right) => left.startFrame - right.startFrame)
        .map((clip) => {
          const visibleFrames = Math.max(1, clip.endFrame - clip.startFrame)
          const next = { ...clip, startFrame: cursor, endFrame: cursor + visibleFrames }
          cursor += visibleFrames
          return next
        }),
    })),
  }
}

export function removeClipNode(meta: ClipNodeMeta, clipId: string, fps = DEFAULT_FPS): ClipNodeMeta {
  const removed = meta.clips.find((source) => `clip-${source.id}` === clipId || source.id === clipId)
  const next = editClipNode(meta, (timeline) => compactTimeline(removeClipById(timeline, clipId)), fps)
  if (!removed) return next
  const sourceNodeId = removed.sourceNodeId ?? removed.id
  const sourceStillPresent = next.clips.some((source) => (source.sourceNodeId ?? source.id) === sourceNodeId)
  if (sourceStillPresent) return next
  const excludedSourceNodeIds = Array.from(new Set([...(next.excludedSourceNodeIds ?? []), sourceNodeId]))
  return { ...next, excludedSourceNodeIds }
}

export function duplicateClipNode(meta: ClipNodeMeta, clipId: string, fps = DEFAULT_FPS): ClipNodeMeta {
  const timeline = clipNodeTimelineFromMeta(meta, fps)
  const existingIds = new Set(timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.id)))
  // The compact node intentionally displays images and videos on one visual track.
  // Adapt that track to the shared editor's type invariant, then restore the real media types.
  const edited = editMixedVisualTrack(timeline, clipId, (compatible) => duplicateClipById(compatible, clipId))
  const duplicate = edited.tracks.flatMap((track) => track.clips).find((clip) => !existingIds.has(clip.id))
  const next = clipNodeMetaFromTimeline(meta, edited, fps)
  return duplicate ? { ...next, selectedClipId: clipInstanceId(duplicate.id) } : next
}

export function nudgeClipNode(meta: ClipNodeMeta, clipId: string, deltaFrame: number, fps = DEFAULT_FPS): ClipNodeMeta {
  return editClipNode(meta, (timeline) => editMixedVisualTrack(
    timeline,
    clipId,
    (compatible) => nudgeClipById(compatible, clipId, deltaFrame),
  ), fps)
}

/**
 * 在 boundaryFrame 处插入一个新片段（素材拖进剪辑节点）。新片段占 [boundary, boundary + 时长)；
 * 起点不早于 boundary 的片段只在会重叠时整体后推（够放就不动，空档不被无谓挤掉）。
 * 同一份素材可以多次拖入：已有同 id 时给实例起新 id，sourceNodeId 仍指向原素材。
 */
export function insertClipNodeSourceAt(meta: ClipNodeMeta, source: ClipNodeSource, boundaryFrame: number, fps = DEFAULT_FPS): ClipNodeMeta {
  const taken = new Set(meta.clips.map((clip) => clip.id))
  let id = source.id
  for (let n = 2; taken.has(id); n += 1) id = `${source.id}~${n}`
  const instance: ClipNodeSource = { ...source, id, sourceNodeId: source.sourceNodeId ?? source.id }
  const withSource: ClipNodeMeta = {
    ...meta,
    sourceNodeIds: [...meta.sourceNodeIds, id],
    clips: [...meta.clips, instance],
    excludedSourceNodeIds: (meta.excludedSourceNodeIds ?? []).filter((excluded) => excluded !== source.id && excluded !== source.sourceNodeId),
    selectedClipId: id,
  }
  const timeline = clipNodeTimelineFromMeta(withSource, fps)
  const newClipId = `clip-${id}`
  const clips = timeline.tracks[0]?.clips ?? []
  const added = clips.find((clip) => clip.id === newClipId)
  if (!added) return meta
  const length = added.endFrame - added.startFrame
  const boundary = Math.max(0, Math.round(boundaryFrame))
  const later = clips.filter((clip) => clip.id !== newClipId && clip.startFrame >= boundary)
  const nextStart = later.length ? Math.min(...later.map((clip) => clip.startFrame)) : Infinity
  const shift = Math.max(0, boundary + length - nextStart)
  const edited: TimelineState = {
    ...timeline,
    tracks: timeline.tracks.map((track, index) => index !== 0 ? track : {
      ...track,
      clips: track.clips.map((clip) => {
        if (clip.id === newClipId) return { ...clip, startFrame: boundary, endFrame: boundary + length }
        return clip.startFrame >= boundary && shift > 0 ? { ...clip, startFrame: clip.startFrame + shift, endFrame: clip.endFrame + shift } : clip
      }),
    }),
  }
  return clipNodeMetaFromTimeline(withSource, edited, fps)
}
