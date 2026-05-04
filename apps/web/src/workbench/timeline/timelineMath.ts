import {
  TIMELINE_TRACK_DEFINITIONS,
  type TimelineClip,
  type TimelineState,
  type TimelineTrack,
  type TimelineTrackType,
} from './timelineTypes'

const DEFAULT_TIMELINE_SCALE = 1

function toFiniteNonNegativeInteger(value: unknown, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(next)) return fallback
  return Math.max(0, Math.floor(next))
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeClip(input: unknown, fallbackType: TimelineTrackType): TimelineClip | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const id = normalizeString(raw.id)
  const sourceNodeId = normalizeString(raw.sourceNodeId)
  if (!id || !sourceNodeId) return null

  const type = raw.type === 'image' || raw.type === 'video'
    ? raw.type
    : fallbackType
  const startFrame = toFiniteNonNegativeInteger(raw.startFrame, 0)
  const rawFrameCount = toFiniteNonNegativeInteger(raw.frameCount, 0)
  const rawEndFrame = toFiniteNonNegativeInteger(raw.endFrame, startFrame + rawFrameCount)
  const endFrame = Math.max(startFrame, rawEndFrame)
  const frameCount = Math.max(0, rawFrameCount || endFrame - startFrame)

  return {
    id,
    type,
    sourceNodeId,
    label: normalizeString(raw.label),
    startFrame,
    endFrame: Math.max(endFrame, startFrame + frameCount),
    frameCount,
    offsetStartFrame: toFiniteNonNegativeInteger(raw.offsetStartFrame, 0),
    offsetEndFrame: toFiniteNonNegativeInteger(raw.offsetEndFrame, 0),
    ...(normalizeString(raw.url) ? { url: normalizeString(raw.url) } : {}),
    ...(normalizeString(raw.thumbnailUrl) ? { thumbnailUrl: normalizeString(raw.thumbnailUrl) } : {}),
  }
}

function createDefaultTrack(definition: Pick<TimelineTrack, 'id' | 'type' | 'label'>): TimelineTrack {
  return {
    ...definition,
    clips: [],
  }
}

export function createDefaultTimeline(): TimelineState {
  return {
    version: 1,
    fps: 30,
    scale: DEFAULT_TIMELINE_SCALE,
    playheadFrame: 0,
    tracks: TIMELINE_TRACK_DEFINITIONS.map(createDefaultTrack),
  }
}

export function normalizeTimeline(input: unknown): TimelineState {
  if (!input || typeof input !== 'object') return createDefaultTimeline()
  const raw = input as Record<string, unknown>
  const inputTracks = Array.isArray(raw.tracks) ? raw.tracks : []

  const tracks = TIMELINE_TRACK_DEFINITIONS.map((definition) => {
    const persisted = inputTracks.find((candidate) => {
      if (!candidate || typeof candidate !== 'object') return false
      const record = candidate as Record<string, unknown>
      return record.id === definition.id || record.type === definition.type
    }) as Record<string, unknown> | undefined
    const rawClips = Array.isArray(persisted?.clips) ? persisted.clips : []
    const clips = rawClips
      .map((clip) => normalizeClip(clip, definition.type))
      .filter((clip): clip is TimelineClip => Boolean(clip))
      .filter((clip) => clip.type === definition.type)
      .sort((left, right) => left.startFrame - right.startFrame)

    return {
      ...definition,
      clips,
    }
  })

  return {
    version: 1,
    fps: 30,
    scale: Math.max(0.1, Number.isFinite(Number(raw.scale)) ? Number(raw.scale) : DEFAULT_TIMELINE_SCALE),
    playheadFrame: toFiniteNonNegativeInteger(raw.playheadFrame, 0),
    tracks,
  }
}

export function computeTimelineDuration(timeline: TimelineState): number {
  return timeline.tracks.reduce((maxFrame, track) => {
    const trackMax = track.clips.reduce((clipMax, clip) => Math.max(clipMax, clip.endFrame), 0)
    return Math.max(maxFrame, trackMax)
  }, 0)
}

export function resolveActiveClipsAtFrame(timeline: TimelineState, frame: number): TimelineClip[] {
  const targetFrame = toFiniteNonNegativeInteger(frame, 0)
  return timeline.tracks.flatMap((track) =>
    track.clips.filter((clip) => clip.startFrame <= targetFrame && targetFrame < clip.endFrame),
  )
}

export function hasClipOverlap(track: TimelineTrack, clip: TimelineClip): boolean {
  return track.clips.some((current) => {
    if (current.id === clip.id) return false
    return clip.startFrame < current.endFrame && current.startFrame < clip.endFrame
  })
}

export function findAppendFrame(track: TimelineTrack): number {
  return track.clips.reduce((maxFrame, clip) => Math.max(maxFrame, clip.endFrame), 0)
}
