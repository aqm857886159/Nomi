import type { TimelineClip, TimelineState, TimelineTrack, TimelineTrackType } from './timelineTypes'

export const TIMELINE_MIN_SCALE = 0.35
export const TIMELINE_MAX_SCALE = 4

function clampInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return min
  return Math.min(max, Math.max(min, Math.floor(next)))
}

export function clampTimelineScale(value: unknown): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return 1
  return Math.min(TIMELINE_MAX_SCALE, Math.max(TIMELINE_MIN_SCALE, next))
}

export function frameToPixel(frame: number, scale: number): number {
  return clampInteger(frame, 0) * clampTimelineScale(scale)
}

export function pixelToFrame(pixel: number, scale: number): number {
  return clampInteger(pixel / clampTimelineScale(scale), 0)
}

export function clientXToFrame(clientX: number, trackLeft: number, scale: number): number {
  return pixelToFrame(clientX - trackLeft, scale)
}

function getVisibleFrameCount(clip: TimelineClip): number {
  return Math.max(1, clip.endFrame - clip.startFrame)
}

function buildUniqueClipId(track: TimelineTrack, baseId: string): string {
  const normalizedBaseId = String(baseId || 'clip').trim() || 'clip'
  const existingIds = new Set(track.clips.map((clip) => clip.id))
  if (!existingIds.has(normalizedBaseId)) return normalizedBaseId
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${normalizedBaseId}-${index}`
    if (!existingIds.has(candidate)) return candidate
  }
  throw new Error(`Unable to allocate unique timeline clip id for ${normalizedBaseId}`)
}

function findAppendFrame(track: TimelineTrack): number {
  return track.clips.reduce((maxFrame, clip) => Math.max(maxFrame, clip.endFrame), 0)
}

export function withClipStartFrame(clip: TimelineClip, startFrame: number): TimelineClip {
  const nextStartFrame = clampInteger(startFrame, 0)
  return {
    ...clip,
    startFrame: nextStartFrame,
    endFrame: nextStartFrame + getVisibleFrameCount(clip),
  }
}

export function canPlaceClip(track: TimelineTrack, clip: TimelineClip): boolean {
  if (track.type !== clip.type) return false
  return !track.clips.some((current) => {
    if (current.id === clip.id) return false
    return clip.startFrame < current.endFrame && current.startFrame < clip.endFrame
  })
}

export function addClipAtFrame(timeline: TimelineState, clip: TimelineClip, trackType: TimelineTrackType, startFrame: number): TimelineState {
  const placed = withClipStartFrame(clip, startFrame)
  if (placed.type !== trackType) return timeline
  let inserted = false
  const tracks = timeline.tracks.map((track) => {
    if (track.type !== trackType) return track
    if (!canPlaceClip(track, placed)) return track
    inserted = true
    return {
      ...track,
      clips: [...track.clips, placed].sort((left, right) => left.startFrame - right.startFrame),
    }
  })
  return inserted ? { ...timeline, tracks } : timeline
}

export function moveClipToFrame(timeline: TimelineState, clipId: string, startFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  let moved = false
  const tracks = timeline.tracks.map((track) => {
    const current = track.clips.find((clip) => clip.id === id)
    if (!current) return track
    const movedClip = withClipStartFrame(current, startFrame)
    if (!canPlaceClip(track, movedClip)) return track
    moved = true
    return {
      ...track,
      clips: track.clips.map((clip) => (clip.id === id ? movedClip : clip)).sort((left, right) => left.startFrame - right.startFrame),
    }
  })
  return moved ? { ...timeline, tracks } : timeline
}

export function removeClipById(timeline: TimelineState, clipId: string): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== id),
    })),
  }
}

export function splitClipAtFrame(timeline: TimelineState, clipId: string, frame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const splitFrame = clampInteger(frame, 0)
  let split = false

  const tracks = timeline.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index < 0) return track
    const current = track.clips[index]
    if (splitFrame <= current.startFrame || splitFrame >= current.endFrame) return track

    const leftVisibleFrames = splitFrame - current.startFrame
    const rightVisibleFrames = current.endFrame - splitFrame
    const rightId = buildUniqueClipId(track, `${current.id}-split`)

    const leftClip: TimelineClip = current.type === 'video'
      ? {
          ...current,
          endFrame: splitFrame,
          offsetEndFrame: current.offsetEndFrame + rightVisibleFrames,
        }
      : {
          ...current,
          endFrame: splitFrame,
          frameCount: leftVisibleFrames,
        }

    const rightClip: TimelineClip = current.type === 'video'
      ? {
          ...current,
          id: rightId,
          startFrame: splitFrame,
          offsetStartFrame: current.offsetStartFrame + leftVisibleFrames,
        }
      : {
          ...current,
          id: rightId,
          startFrame: splitFrame,
          frameCount: rightVisibleFrames,
        }

    split = true
    return {
      ...track,
      clips: [
        ...track.clips.slice(0, index),
        leftClip,
        rightClip,
        ...track.clips.slice(index + 1),
      ].sort((left, right) => left.startFrame - right.startFrame),
    }
  })

  return split ? { ...timeline, tracks } : timeline
}

export function duplicateClipById(timeline: TimelineState, clipId: string): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  let duplicated = false

  const tracks = timeline.tracks.map((track) => {
    const current = track.clips.find((clip) => clip.id === id)
    if (!current) return track

    const baseCopy = {
      ...current,
      id: buildUniqueClipId(track, `${current.id}-copy`),
    }
    const preferred = withClipStartFrame(baseCopy, current.endFrame)
    const placed = canPlaceClip(track, preferred)
      ? preferred
      : withClipStartFrame(baseCopy, findAppendFrame(track))
    if (!canPlaceClip(track, placed)) return track

    duplicated = true
    return {
      ...track,
      clips: [...track.clips, placed].sort((left, right) => left.startFrame - right.startFrame),
    }
  })

  return duplicated ? { ...timeline, tracks } : timeline
}

export function nudgeClipById(timeline: TimelineState, clipId: string, deltaFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const delta = clampInteger(deltaFrame, Number.MIN_SAFE_INTEGER)
  if (delta === 0) return timeline

  const track = timeline.tracks.find((candidate) => candidate.clips.some((clip) => clip.id === id))
  const current = track?.clips.find((clip) => clip.id === id)
  if (!track || !current) return timeline
  return moveClipToFrame(timeline, id, current.startFrame + delta)
}

export function resizeClipEdge(timeline: TimelineState, clipId: string, edge: 'left' | 'right', deltaFrame: number): TimelineState {
  const id = String(clipId || '').trim()
  if (!id) return timeline
  const delta = clampInteger(deltaFrame, Number.MIN_SAFE_INTEGER)
  let resized = false
  const tracks = timeline.tracks.map((track) => {
    const index = track.clips.findIndex((clip) => clip.id === id)
    if (index < 0) return track
    const current = track.clips[index]
    const before = index > 0 ? track.clips[index - 1] : null
    const after = index < track.clips.length - 1 ? track.clips[index + 1] : null
    const minStart = before ? before.endFrame : 0
    const maxEnd = after ? after.startFrame : Number.MAX_SAFE_INTEGER
    const minFrameCount = 1

    let next = current
    if (edge === 'left') {
      const rawStart = current.startFrame + delta
      const maxStart = current.endFrame - minFrameCount
      const nextStart = Math.min(maxStart, Math.max(minStart, rawStart))
      const diff = nextStart - current.startFrame
      next = {
        ...current,
        startFrame: nextStart,
        frameCount: current.type === 'video' ? current.frameCount : current.endFrame - nextStart,
        offsetStartFrame: current.type === 'video' ? Math.max(0, current.offsetStartFrame + diff) : current.offsetStartFrame,
      }
    } else {
      const rawEnd = current.endFrame + delta
      const minEnd = current.startFrame + minFrameCount
      const naturalMaxEnd = current.type === 'video'
        ? current.startFrame + current.frameCount - current.offsetStartFrame
        : maxEnd
      const nextEnd = Math.max(minEnd, Math.min(maxEnd, naturalMaxEnd, rawEnd))
      const diff = nextEnd - current.endFrame
      next = {
        ...current,
        endFrame: nextEnd,
        frameCount: current.type === 'video' ? current.frameCount : nextEnd - current.startFrame,
        offsetEndFrame: current.type === 'video' ? Math.max(0, current.offsetEndFrame - diff) : current.offsetEndFrame,
      }
    }

    resized = true
    return {
      ...track,
      clips: track.clips.map((clip) => (clip.id === id ? next : clip)),
    }
  })
  return resized ? { ...timeline, tracks } : timeline
}

export function setTimelinePlayheadFrame(timeline: TimelineState, frame: number): TimelineState {
  return {
    ...timeline,
    playheadFrame: clampInteger(frame, 0),
  }
}

export function setTimelineScale(timeline: TimelineState, scale: number): TimelineState {
  return {
    ...timeline,
    scale: clampTimelineScale(scale),
  }
}
