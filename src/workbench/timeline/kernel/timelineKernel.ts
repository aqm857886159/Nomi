import type { TimelineClip, TimelineClipAudio, TimelineState, TimelineTextClip, TimelineTrack, TimelineTrackType, TimelineTransition } from '../timelineTypes'
import { MAX_CLIP_GAIN_DB, MIN_CLIP_GAIN_DB, resolveClipAudio } from '../clipAudio'
import { resolveTimelineTransitionFeedback } from '../timelineVisualFeedback'

/**
 * P0 editor operations deliberately operate on the existing TimelineState.
 * The kernel owns validation and transaction semantics; UI/store adapters can
 * translate richer commands into this small, deterministic set later.
 */
export type TimelineOperation =
  | {
      kind: 'move'
      clipId: string
      startFrame: number
      targetTrackId?: string
    }
  | {
      kind: 'remove'
      clipId?: string
      clipIds?: readonly string[]
      ripple?: boolean
    }
  | {
      kind: 'split'
      clipId: string
      atFrame: number
      rightClipId?: string
    }
  | {
      kind: 'trim'
      clipId: string
      edge: 'left' | 'right'
      deltaFrame: number
    }
  | {
      kind: 'source-window'
      clipId: string
      sourceStartFrame: number
      sourceEndFrame: number
    }
  | {
      kind: 'ripple'
      fromFrame: number
      deltaFrame: number
      trackId?: string
      includeText?: boolean
    }
  | {
      kind: 'transition'
      action: 'set' | 'remove'
      fromClipId: string
      toClipId: string
      type?: TimelineTransition['type']
      durationFrames?: number
    }
  | {
      kind: 'text'
      action: 'add'
      id: string
      sourceNodeId?: string
      text: string
      style: TimelineTextClip['style']
      startFrame: number
      endFrame: number
    }
  | {
      kind: 'text'
      action: 'edit'
      clipId: string
      text: string
    }
  | {
      kind: 'text'
      action: 'style'
      clipId: string
      style: TimelineTextClip['style']
    }
  | {
      kind: 'text'
      action: 'time'
      clipId: string
      startFrame: number
      endFrame: number
    }
  | {
      kind: 'audio'
      clipId: string
      gainDb?: number
      muted?: boolean
      fadeInFrames?: number
      fadeOutFrames?: number
    }

export type TimelineDiagnosticSeverity = 'error' | 'warning'

export type TimelineDiagnostic = {
  code: string
  severity: TimelineDiagnosticSeverity
  path: string
  message: string
  operationIndex?: number
}

export type TimelineValidationResult = {
  ok: boolean
  diagnostics: TimelineDiagnostic[]
}

export type TimelineDiffEntry = {
  path: string
  before: unknown
  after: unknown
}

export type TimelineDiff = {
  changed: boolean
  entries: TimelineDiffEntry[]
}

export type TimelineApplyOptions = {
  /** Check the complete batch without committing it. */
  validateOnly?: boolean
  /** Optional compare-and-swap guard for Agent callers. */
  expectedRevision?: string
}

export type TimelineApplyResult = {
  ok: boolean
  timeline: TimelineState
  /** Candidate state, even for validateOnly calls. */
  previewTimeline: TimelineState
  diff: TimelineDiff
  diagnostics: TimelineDiagnostic[]
  appliedOperationCount: number
  revision: string
}

type OperationResult = {
  timeline: TimelineState
  diagnostics: TimelineDiagnostic[]
}

type ClipLocation = {
  trackIndex: number
  clipIndex: number
  track: TimelineTrack
  clip: TimelineClip
}

const TRACK_TYPES: readonly TimelineTrackType[] = ['image', 'video', 'audio']
const MEDIA_TYPES = new Set(TRACK_TYPES)

function diagnostic(
  code: string,
  path: string,
  message: string,
  severity: TimelineDiagnosticSeverity = 'error',
): TimelineDiagnostic {
  return { code, severity, path, message }
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function clipPath(trackIndex: number, clipIndex: number, field?: string): string {
  const base = `tracks[${trackIndex}].clips[${clipIndex}]`
  return field ? `${base}.${field}` : base
}

function textPath(index: number, field?: string): string {
  const base = `textClips[${index}]`
  return field ? `${base}.${field}` : base
}

function compareByStartAndId(left: { startFrame: number; id: string }, right: { startFrame: number; id: string }): number {
  return left.startFrame - right.startFrame || left.id.localeCompare(right.id)
}

function compareTransitions(left: { fromClipId: string; toClipId: string }, right: { fromClipId: string; toClipId: string }): number {
  return left.fromClipId.localeCompare(right.fromClipId) || left.toClipId.localeCompare(right.toClipId)
}

function cloneAndSortTrack(track: TimelineTrack): TimelineTrack {
  return { ...track, clips: [...track.clips].sort(compareByStartAndId) }
}

/** Canonical ordering used by previews, diffs, and persisted edit plans. */
export function normalizeKernelTimeline(timeline: TimelineState): TimelineState {
  return {
    ...timeline,
    tracks: timeline.tracks.map(cloneAndSortTrack),
    textClips: [...timeline.textClips].sort(compareByStartAndId),
    ...(timeline.transitions
      ? { transitions: [...timeline.transitions].sort(compareTransitions) }
      : {}),
  }
}

function validateClip(
  clip: TimelineClip,
  track: TimelineTrack,
  trackIndex: number,
  clipIndex: number,
  seenClipIds: Set<string>,
  diagnostics: TimelineDiagnostic[],
): void {
  const path = clipPath(trackIndex, clipIndex)
  if (!clip || typeof clip !== 'object') {
    diagnostics.push(diagnostic('clip_invalid', path, 'Clip must be an object'))
    return
  }
  if (typeof clip.id !== 'string' || !clip.id.trim()) diagnostics.push(diagnostic('clip_id_required', `${path}.id`, 'Clip id must be a non-empty string'))
  else if (seenClipIds.has(clip.id)) diagnostics.push(diagnostic('clip_id_duplicate', `${path}.id`, `Duplicate clip id: ${clip.id}`))
  else seenClipIds.add(clip.id)

  if (!MEDIA_TYPES.has(clip.type)) diagnostics.push(diagnostic('clip_type_invalid', `${path}.type`, `Unsupported clip type: ${String(clip.type)}`))
  if (clip.type !== track.type) diagnostics.push(diagnostic('clip_track_type_mismatch', `${path}.type`, 'Clip type must match its track type'))
  if (typeof clip.sourceNodeId !== 'string' || !clip.sourceNodeId.trim()) diagnostics.push(diagnostic('source_node_required', `${path}.sourceNodeId`, 'sourceNodeId must be a non-empty string'))
  if (!isNonNegativeInteger(clip.startFrame)) diagnostics.push(diagnostic('start_frame_invalid', `${path}.startFrame`, 'startFrame must be a non-negative integer'))
  if (!isInteger(clip.endFrame) || clip.endFrame <= clip.startFrame) diagnostics.push(diagnostic('end_frame_invalid', `${path}.endFrame`, 'endFrame must be an integer greater than startFrame'))
  if (!isInteger(clip.frameCount) || clip.frameCount < 1) diagnostics.push(diagnostic('frame_count_invalid', `${path}.frameCount`, 'frameCount must be a positive integer'))
  if (!isNonNegativeInteger(clip.offsetStartFrame)) diagnostics.push(diagnostic('source_start_invalid', `${path}.offsetStartFrame`, 'offsetStartFrame must be a non-negative integer'))
  if (!isNonNegativeInteger(clip.offsetEndFrame)) diagnostics.push(diagnostic('source_end_invalid', `${path}.offsetEndFrame`, 'offsetEndFrame must be a non-negative integer'))

  if (clip.type === 'video' || clip.type === 'audio') {
    if (isInteger(clip.frameCount) && isNonNegativeInteger(clip.offsetStartFrame) && isNonNegativeInteger(clip.offsetEndFrame)
      && clip.offsetStartFrame + clip.offsetEndFrame >= clip.frameCount) {
      diagnostics.push(diagnostic('source_window_empty', `${path}.offsetStartFrame`, 'Video/audio source window must contain at least one frame'))
    }
  }

  if (clip.audio !== undefined) {
    if (clip.type === 'image') diagnostics.push(diagnostic('clip_audio_unsupported', `${path}.audio`, 'Image clips cannot carry audio settings'))
    if (!clip.audio || typeof clip.audio !== 'object' || Array.isArray(clip.audio)) {
      diagnostics.push(diagnostic('clip_audio_invalid', `${path}.audio`, 'audio must be an object when present'))
    } else {
      const { gainDb, muted, fadeInFrames, fadeOutFrames } = clip.audio
      if (gainDb !== undefined && (!Number.isFinite(gainDb) || gainDb < MIN_CLIP_GAIN_DB || gainDb > MAX_CLIP_GAIN_DB)) {
        diagnostics.push(diagnostic('clip_audio_gain_invalid', `${path}.audio.gainDb`, `gainDb must be between ${MIN_CLIP_GAIN_DB} and ${MAX_CLIP_GAIN_DB}`))
      }
      if (muted !== undefined && typeof muted !== 'boolean') diagnostics.push(diagnostic('clip_audio_mute_invalid', `${path}.audio.muted`, 'muted must be boolean when present'))
      if (fadeInFrames !== undefined && !isNonNegativeInteger(fadeInFrames)) diagnostics.push(diagnostic('clip_audio_fade_invalid', `${path}.audio.fadeInFrames`, 'fadeInFrames must be a non-negative integer'))
      if (fadeOutFrames !== undefined && !isNonNegativeInteger(fadeOutFrames)) diagnostics.push(diagnostic('clip_audio_fade_invalid', `${path}.audio.fadeOutFrames`, 'fadeOutFrames must be a non-negative integer'))
      if (isNonNegativeInteger(fadeInFrames ?? 0) && isNonNegativeInteger(fadeOutFrames ?? 0)
        && (fadeInFrames ?? 0) + (fadeOutFrames ?? 0) > clip.endFrame - clip.startFrame) {
        diagnostics.push(diagnostic('clip_audio_fade_overlap', `${path}.audio`, 'Audio fades cannot exceed the visible clip duration'))
      }
    }
  }
}

function validateTextClip(clip: TimelineTextClip, index: number, seenClipIds: Set<string>, diagnostics: TimelineDiagnostic[]): void {
  if (!clip || typeof clip !== 'object') {
    diagnostics.push(diagnostic('text_clip_invalid', textPath(index), 'Text clip must be an object'))
    return
  }
  if (typeof clip.id !== 'string' || !clip.id.trim()) diagnostics.push(diagnostic('text_id_required', `${textPath(index)}.id`, 'Text clip id must be a non-empty string'))
  else if (seenClipIds.has(clip.id)) diagnostics.push(diagnostic('clip_id_duplicate', `${textPath(index)}.id`, `Duplicate clip id: ${clip.id}`))
  else seenClipIds.add(clip.id)
  if (!isNonNegativeInteger(clip.startFrame)) diagnostics.push(diagnostic('text_start_invalid', `${textPath(index)}.startFrame`, 'Text startFrame must be a non-negative integer'))
  if (!isInteger(clip.endFrame) || clip.endFrame <= clip.startFrame) diagnostics.push(diagnostic('text_end_invalid', `${textPath(index)}.endFrame`, 'Text endFrame must be an integer greater than startFrame'))
}

/** Validate all invariants that P0 operations rely on. */
export function validateTimeline(timeline: TimelineState): TimelineValidationResult {
  const diagnostics: TimelineDiagnostic[] = []
  if (!timeline || typeof timeline !== 'object') return { ok: false, diagnostics: [diagnostic('timeline_required', '$', 'Timeline is required')] }
  if (timeline.version !== 1) diagnostics.push(diagnostic('timeline_version_invalid', 'version', 'Only timeline version 1 is supported'))
  if (!isFinitePositive(timeline.fps)) diagnostics.push(diagnostic('fps_invalid', 'fps', 'fps must be a finite positive number'))
  if (!isNonNegativeInteger(timeline.playheadFrame)) diagnostics.push(diagnostic('playhead_invalid', 'playheadFrame', 'playheadFrame must be a non-negative integer'))
  if (!Array.isArray(timeline.tracks)) diagnostics.push(diagnostic('tracks_required', 'tracks', 'tracks must be an array'))
  if (!Array.isArray(timeline.textClips)) diagnostics.push(diagnostic('text_clips_required', 'textClips', 'textClips must be an array'))

  const seenTrackIds = new Set<string>()
  const seenClipIds = new Set<string>()
  if (Array.isArray(timeline.tracks)) {
    timeline.tracks.forEach((track, trackIndex) => {
      const path = `tracks[${trackIndex}]`
      if (!track || typeof track !== 'object') {
        diagnostics.push(diagnostic('track_invalid', path, 'Track must be an object'))
        return
      }
      if (typeof track.id !== 'string' || !track.id.trim()) diagnostics.push(diagnostic('track_id_required', `${path}.id`, 'Track id must be a non-empty string'))
      else if (seenTrackIds.has(track.id)) diagnostics.push(diagnostic('track_id_duplicate', `${path}.id`, `Duplicate track id: ${track.id}`))
      else seenTrackIds.add(track.id)
      if (!TRACK_TYPES.includes(track.type)) diagnostics.push(diagnostic('track_type_invalid', `${path}.type`, `Unsupported track type: ${String(track.type)}`))
      if (!Array.isArray(track.clips)) diagnostics.push(diagnostic('clips_required', `${path}.clips`, 'clips must be an array'))
      if (!Array.isArray(track.clips)) return
      track.clips.forEach((clip, clipIndex) => validateClip(clip, track, trackIndex, clipIndex, seenClipIds, diagnostics))
      for (let i = 1; i < track.clips.length; i += 1) {
        const previous = track.clips[i - 1]
        const current = track.clips[i]
        if (isInteger(previous.endFrame) && isInteger(current.startFrame) && previous.endFrame > current.startFrame) {
          diagnostics.push(diagnostic('clips_overlap', clipPath(trackIndex, i), 'Clips on a track must not overlap'))
        }
      }
    })
  }

  if (Array.isArray(timeline.textClips)) timeline.textClips.forEach((clip, index) => validateTextClip(clip, index, seenClipIds, diagnostics))

  if (timeline.transitions !== undefined) {
    if (!Array.isArray(timeline.transitions)) diagnostics.push(diagnostic('transitions_required', 'transitions', 'transitions must be an array when present'))
    else {
      const knownIds = seenClipIds
      timeline.transitions.forEach((transition, index) => {
        const path = `transitions[${index}]`
        if (!transition || typeof transition !== 'object') {
          diagnostics.push(diagnostic('transition_invalid', path, 'Transition must be an object'))
          return
        }
        if (!knownIds.has(transition.fromClipId) || !knownIds.has(transition.toClipId)) diagnostics.push(diagnostic('transition_clip_missing', path, 'Transition endpoints must reference existing clips'))
        if (transition.fromClipId === transition.toClipId) diagnostics.push(diagnostic('transition_self_reference', path, 'Transition endpoints must be different'))
        if (transition.durationFrames !== undefined && (!isInteger(transition.durationFrames) || transition.durationFrames < 1)) diagnostics.push(diagnostic('transition_duration_invalid', `${path}.durationFrames`, 'Transition duration must be a positive integer'))
      })
    }
  }

  return { ok: diagnostics.every((entry) => entry.severity !== 'error'), diagnostics }
}

function findClip(timeline: TimelineState, clipId: string): ClipLocation | null {
  let result: ClipLocation | null = null
  timeline.tracks.forEach((track, trackIndex) => track.clips.forEach((clip, clipIndex) => {
    if (clip.id === clipId && result === null) result = { trackIndex, clipIndex, track, clip }
  }))
  return result
}

function findTrackIndex(timeline: TimelineState, trackId: string): number {
  return timeline.tracks.findIndex((track) => track.id === trackId)
}

function makeTracks(timeline: TimelineState, tracks: TimelineTrack[]): TimelineState {
  return { ...timeline, tracks: tracks.map(cloneAndSortTrack) }
}

function validateOperationFrame(value: number, path: string): TimelineDiagnostic[] {
  return isNonNegativeInteger(value) ? [] : [diagnostic('operation_frame_invalid', path, 'Frame must be a non-negative safe integer')]
}

function operationError(code: string, path: string, message: string): OperationResult {
  return { timeline: null as unknown as TimelineState, diagnostics: [diagnostic(code, path, message)] }
}

function applyMove(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'move' }>): OperationResult {
  const frameDiagnostics = validateOperationFrame(operation.startFrame, 'operation.startFrame')
  if (frameDiagnostics.length > 0) return { timeline, diagnostics: frameDiagnostics }
  const source = findClip(timeline, operation.clipId)
  if (!source) return operationError('clip_not_found', 'operation.clipId', `Clip not found: ${operation.clipId}`)
  const targetTrackIndex = operation.targetTrackId === undefined ? source.trackIndex : findTrackIndex(timeline, operation.targetTrackId)
  if (targetTrackIndex < 0) return operationError('track_not_found', 'operation.targetTrackId', `Track not found: ${operation.targetTrackId}`)
  const targetTrack = timeline.tracks[targetTrackIndex]
  if (targetTrack.type !== source.clip.type) return operationError('track_type_mismatch', 'operation.targetTrackId', 'Target track type must match clip type')
  const duration = source.clip.endFrame - source.clip.startFrame
  const movedClip: TimelineClip = { ...source.clip, startFrame: operation.startFrame, endFrame: operation.startFrame + duration }
  const collides = targetTrack.clips.some((clip) => clip.id !== source.clip.id && movedClip.startFrame < clip.endFrame && clip.startFrame < movedClip.endFrame)
  if (collides) return operationError('move_overlap', 'operation.startFrame', 'Moved clip would overlap another clip')
  const tracks = timeline.tracks.map((track, index) => {
    const without = index === source.trackIndex ? track.clips.filter((clip) => clip.id !== source.clip.id) : track.clips
    if (index !== targetTrackIndex) return { ...track, clips: without }
    return { ...track, clips: [...without, movedClip] }
  })
  return { timeline: makeTracks(timeline, tracks), diagnostics: [] }
}

function clipIdsOf(operation: Extract<TimelineOperation, { kind: 'remove' }>): string[] {
  return [...new Set([...(operation.clipId ? [operation.clipId] : []), ...(operation.clipIds ?? [])].map((id) => String(id).trim()).filter(Boolean))]
}

function shiftTrackSuffix(track: TimelineTrack, fromFrame: number, deltaFrame: number): TimelineTrack {
  return {
    ...track,
    clips: track.clips.map((clip) => clip.startFrame >= fromFrame
      ? { ...clip, startFrame: clip.startFrame + deltaFrame, endFrame: clip.endFrame + deltaFrame }
      : clip),
  }
}

function shiftTextSuffix(textClips: TimelineTextClip[], fromFrame: number, deltaFrame: number): TimelineTextClip[] {
  return textClips.map((clip) => clip.startFrame >= fromFrame
    ? { ...clip, startFrame: clip.startFrame + deltaFrame, endFrame: clip.endFrame + deltaFrame }
    : clip)
}

function applyRemove(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'remove' }>): OperationResult {
  const ids = clipIdsOf(operation)
  if (ids.length === 0) return operationError('remove_ids_required', 'operation.clipIds', 'At least one clip id is required')
  const locations = ids.map((id) => findClip(timeline, id))
  const missing = ids.filter((_id, index) => locations[index] === null)
  if (missing.length > 0) return operationError('clip_not_found', 'operation.clipIds', `Clip not found: ${missing.join(', ')}`)
  if (operation.ripple && new Set(locations.map((location) => location?.trackIndex)).size > 1) {
    return operationError('ripple_requires_single_track', 'operation.ripple', 'Ripple remove must target clips on one track; use an explicit ripple operation per track to avoid A/V drift')
  }
  const removedByTrack = new Map<number, TimelineClip[]>()
  locations.forEach((location) => {
    if (!location) return
    const current = removedByTrack.get(location.trackIndex) ?? []
    current.push(location.clip)
    removedByTrack.set(location.trackIndex, current)
  })
  const tracks = timeline.tracks.map((track, trackIndex) => {
    const removed = removedByTrack.get(trackIndex) ?? []
    let clips = track.clips.filter((clip) => !ids.includes(clip.id))
    if (operation.ripple && removed.length > 0) {
      const ordered = [...removed].sort((left, right) => left.startFrame - right.startFrame)
      clips = clips.map((clip) => {
        const shift = ordered
          .filter((removedClip) => removedClip.endFrame <= clip.startFrame)
          .reduce((sum, removedClip) => sum + (removedClip.endFrame - removedClip.startFrame), 0)
        return shift === 0 ? clip : { ...clip, startFrame: clip.startFrame - shift, endFrame: clip.endFrame - shift }
      })
    }
    return { ...track, clips }
  })
  const transitions = timeline.transitions?.filter((transition) => !ids.includes(transition.fromClipId) && !ids.includes(transition.toClipId))
  return {
    timeline: { ...makeTracks(timeline, tracks), ...(transitions ? { transitions } : {}) },
    diagnostics: [],
  }
}

function uniqueClipId(track: TimelineTrack, baseId: string, requested?: string): string | null {
  const candidate = requested?.trim() || `${baseId}-split`
  const existing = new Set(track.clips.map((clip) => clip.id))
  if (!existing.has(candidate)) return candidate
  if (requested) return null
  for (let index = 2; index < 10000; index += 1) {
    const next = `${candidate}-${index}`
    if (!existing.has(next)) return next
  }
  return null
}

function applySplit(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'split' }>): OperationResult {
  const frameDiagnostics = validateOperationFrame(operation.atFrame, 'operation.atFrame')
  if (frameDiagnostics.length > 0) return { timeline, diagnostics: frameDiagnostics }
  const source = findClip(timeline, operation.clipId)
  if (!source) return operationError('clip_not_found', 'operation.clipId', `Clip not found: ${operation.clipId}`)
  if (operation.atFrame <= source.clip.startFrame || operation.atFrame >= source.clip.endFrame) return operationError('split_out_of_range', 'operation.atFrame', 'Split frame must be inside the visible clip range')
  const rightId = uniqueClipId(source.track, source.clip.id, operation.rightClipId)
  if (!rightId) return operationError('split_id_conflict', 'operation.rightClipId', 'Requested split clip id already exists')
  const leftFrames = operation.atFrame - source.clip.startFrame
  const rightFrames = source.clip.endFrame - operation.atFrame
  const leftClip: TimelineClip = source.clip.type === 'image'
    ? { ...source.clip, endFrame: operation.atFrame, frameCount: leftFrames }
    : { ...source.clip, endFrame: operation.atFrame, offsetEndFrame: source.clip.offsetEndFrame + rightFrames }
  const rightClip: TimelineClip = source.clip.type === 'image'
    ? { ...source.clip, id: rightId, startFrame: operation.atFrame, frameCount: rightFrames }
    : { ...source.clip, id: rightId, startFrame: operation.atFrame, offsetStartFrame: source.clip.offsetStartFrame + leftFrames }
  const tracks = timeline.tracks.map((track, trackIndex) => trackIndex === source.trackIndex
    ? { ...track, clips: [...track.clips.filter((clip) => clip.id !== source.clip.id), leftClip, rightClip] }
    : track)
  return { timeline: makeTracks(timeline, tracks), diagnostics: [] }
}

function applyTrim(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'trim' }>): OperationResult {
  if (!isInteger(operation.deltaFrame)) return operationError('operation_delta_invalid', 'operation.deltaFrame', 'deltaFrame must be an integer')
  const source = findClip(timeline, operation.clipId)
  if (!source) return operationError('clip_not_found', 'operation.clipId', `Clip not found: ${operation.clipId}`)
  const previous = source.track.clips[source.clipIndex - 1]
  const next = source.track.clips[source.clipIndex + 1]
  let updated: TimelineClip
  let requestedBoundary: number
  let appliedBoundary: number
  if (operation.edge === 'left') {
    const sourceMinimum = source.clip.type === 'image'
      ? 0
      : source.clip.startFrame - source.clip.offsetStartFrame
    const minimum = Math.max(previous?.endFrame ?? 0, sourceMinimum)
    const maximum = source.clip.endFrame - 1
    const desired = source.clip.startFrame + operation.deltaFrame
    const start = Math.max(minimum, Math.min(maximum, desired))
    requestedBoundary = desired
    appliedBoundary = start
    const actualDelta = start - source.clip.startFrame
    if (source.clip.type === 'image') updated = { ...source.clip, startFrame: start, frameCount: source.clip.endFrame - start }
    else updated = { ...source.clip, startFrame: start, offsetStartFrame: source.clip.offsetStartFrame + actualDelta }
  } else {
    const sourceEnd = source.clip.type === 'image' ? Number.MAX_SAFE_INTEGER : source.clip.frameCount - source.clip.offsetEndFrame
    const minimum = source.clip.startFrame + 1
    const maximum = Math.min(next?.startFrame ?? Number.MAX_SAFE_INTEGER, source.clip.startFrame + sourceEnd - source.clip.offsetStartFrame)
    const desired = source.clip.endFrame + operation.deltaFrame
    const end = Math.max(minimum, Math.min(maximum, desired))
    requestedBoundary = desired
    appliedBoundary = end
    const actualDelta = end - source.clip.endFrame
    if (source.clip.type === 'image') updated = { ...source.clip, endFrame: end, frameCount: end - source.clip.startFrame }
    else updated = { ...source.clip, endFrame: end, offsetEndFrame: Math.max(0, source.clip.offsetEndFrame - actualDelta) }
  }
  const tracks = timeline.tracks.map((track, index) => index === source.trackIndex
    ? { ...track, clips: track.clips.map((clip) => clip.id === source.clip.id ? updated : clip) }
    : track)
  const diagnostics = requestedBoundary !== appliedBoundary && operation.deltaFrame !== 0
    ? [diagnostic('trim_clamped', 'operation', 'Trim was clamped by the track boundary or source window', 'warning')]
    : []
  return { timeline: makeTracks(timeline, tracks), diagnostics }
}

function applySourceWindow(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'source-window' }>): OperationResult {
  const source = findClip(timeline, operation.clipId)
  if (!source) return operationError('clip_not_found', 'operation.clipId', `Clip not found: ${operation.clipId}`)
  if (source.clip.type === 'image') return operationError('source_window_unsupported', 'operation.clipId', 'Image clips do not have a source window')
  if (!isNonNegativeInteger(operation.sourceStartFrame) || !isInteger(operation.sourceEndFrame) || operation.sourceEndFrame <= operation.sourceStartFrame) return operationError('source_window_invalid', 'operation', 'Source window must be a non-empty integer range')
  if (operation.sourceEndFrame > source.clip.frameCount) return operationError('source_window_out_of_range', 'operation.sourceEndFrame', 'Source window cannot exceed frameCount')
  const duration = operation.sourceEndFrame - operation.sourceStartFrame
  const endFrame = source.clip.startFrame + duration
  const nextClip = source.track.clips[source.clipIndex + 1]
  if (nextClip && endFrame > nextClip.startFrame) return operationError('source_window_overlap', 'operation.sourceEndFrame', 'Source window duration would overlap the next clip')
  const updated: TimelineClip = {
    ...source.clip,
    endFrame,
    offsetStartFrame: operation.sourceStartFrame,
    offsetEndFrame: source.clip.frameCount - operation.sourceEndFrame,
  }
  const tracks = timeline.tracks.map((track, index) => index === source.trackIndex
    ? { ...track, clips: track.clips.map((clip) => clip.id === source.clip.id ? updated : clip) }
    : track)
  return { timeline: makeTracks(timeline, tracks), diagnostics: [] }
}

function applyRipple(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'ripple' }>): OperationResult {
  const frameDiagnostics = [...validateOperationFrame(operation.fromFrame, 'operation.fromFrame')]
  if (!isInteger(operation.deltaFrame)) frameDiagnostics.push(diagnostic('operation_delta_invalid', 'operation.deltaFrame', 'deltaFrame must be an integer'))
  if (frameDiagnostics.length > 0) return { timeline, diagnostics: frameDiagnostics }
  if (operation.deltaFrame === 0) return { timeline, diagnostics: [diagnostic('ripple_noop', 'operation.deltaFrame', 'deltaFrame is zero', 'warning')] }
  const selected = operation.trackId === undefined
    ? timeline.tracks.map((_track, index) => index)
    : [findTrackIndex(timeline, operation.trackId)]
  if (selected.some((index) => index < 0)) return operationError('track_not_found', 'operation.trackId', `Track not found: ${operation.trackId}`)
  const diagnostics: TimelineDiagnostic[] = []
  for (const index of selected) {
    const track = timeline.tracks[index]
    const crossing = track.clips.find((clip) => clip.startFrame < operation.fromFrame && clip.endFrame > operation.fromFrame)
    if (crossing) diagnostics.push(diagnostic('ripple_inside_clip', `tracks[${index}]`, 'Ripple boundary cannot fall inside a clip'))
    const shifted = track.clips.filter((clip) => clip.startFrame >= operation.fromFrame)
    if (shifted.some((clip) => clip.startFrame + operation.deltaFrame < 0)) diagnostics.push(diagnostic('ripple_before_zero', `tracks[${index}]`, 'Ripple would move a clip before frame zero'))
    if (operation.deltaFrame < 0) {
      const candidate = shiftTrackSuffix(track, operation.fromFrame, operation.deltaFrame)
      for (let clipIndex = 1; clipIndex < candidate.clips.length; clipIndex += 1) {
        if (candidate.clips[clipIndex - 1].endFrame > candidate.clips[clipIndex].startFrame) {
          diagnostics.push(diagnostic('ripple_overlap', `tracks[${index}]`, 'Ripple would make clips overlap'))
          break
        }
      }
    }
  }
  if (diagnostics.length > 0) return { timeline, diagnostics }
  const tracks = timeline.tracks.map((track, index) => selected.includes(index) ? shiftTrackSuffix(track, operation.fromFrame, operation.deltaFrame) : track)
  const textClips = operation.includeText ? shiftTextSuffix(timeline.textClips, operation.fromFrame, operation.deltaFrame) : timeline.textClips
  return { timeline: { ...makeTracks(timeline, tracks), textClips }, diagnostics: [] }
}

function applyTransition(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'transition' }>): OperationResult {
  const transitions = [...(timeline.transitions ?? [])]
    .filter((transition) => !(transition.fromClipId === operation.fromClipId && transition.toClipId === operation.toClipId))
  if (operation.action === 'remove') return { timeline: { ...timeline, transitions }, diagnostics: [] }
  if (!operation.type) return operationError('transition_type_required', 'operation.type', 'Transition type is required when setting a transition')
  if (operation.durationFrames !== undefined && (!isInteger(operation.durationFrames) || operation.durationFrames < 1)) {
    return operationError('transition_duration_invalid', 'operation.durationFrames', 'Transition duration must be a positive integer')
  }
  const transition: TimelineTransition = {
    fromClipId: operation.fromClipId,
    toClipId: operation.toClipId,
    type: operation.type,
    ...(operation.durationFrames === undefined ? {} : { durationFrames: operation.durationFrames }),
  }
  const candidate = { ...timeline, transitions: [...transitions, transition] }
  const feedback = resolveTimelineTransitionFeedback(candidate.tracks, candidate.transitions)
  const issue = feedback.find((entry) => entry.transition.fromClipId === transition.fromClipId && entry.transition.toClipId === transition.toClipId && entry.reason)
  if (issue?.reason) return operationError(`transition_${issue.reason}`, 'operation', `Transition cannot be applied: ${issue.reason}`)
  return { timeline: candidate, diagnostics: [] }
}

function findTextIndex(timeline: TimelineState, clipId: string): number {
  return timeline.textClips.findIndex((clip) => clip.id === clipId)
}

function applyText(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'text' }>): OperationResult {
  if (operation.action === 'add') {
    if (!isNonNegativeInteger(operation.startFrame) || !isInteger(operation.endFrame) || operation.endFrame <= operation.startFrame) {
      return operationError('text_time_invalid', 'operation', 'Text range must be a non-empty frame range')
    }
    if ([...timeline.tracks.flatMap((track) => track.clips), ...timeline.textClips].some((clip) => clip.id === operation.id)) {
      return operationError('text_id_conflict', 'operation.id', `Text clip id already exists: ${operation.id}`)
    }
    const clip: TimelineTextClip = { id: operation.id, text: operation.text, style: operation.style, startFrame: operation.startFrame, endFrame: operation.endFrame, ...(operation.sourceNodeId ? { sourceNodeId: operation.sourceNodeId } : {}) }
    return { timeline: { ...timeline, textClips: [...timeline.textClips, clip] }, diagnostics: [] }
  }
  const index = findTextIndex(timeline, operation.clipId)
  if (index < 0) return operationError('text_clip_not_found', 'operation.clipId', `Text clip not found: ${operation.clipId}`)
  const current = timeline.textClips[index]
  let updated: TimelineTextClip
  if (operation.action === 'edit') updated = { ...current, text: operation.text }
  else if (operation.action === 'style') updated = { ...current, style: operation.style }
  else {
    if (!isNonNegativeInteger(operation.startFrame) || !isInteger(operation.endFrame) || operation.endFrame <= operation.startFrame) return operationError('text_time_invalid', 'operation', 'Text range must be a non-empty frame range')
    updated = { ...current, startFrame: operation.startFrame, endFrame: operation.endFrame }
  }
  const textClips = timeline.textClips.map((clip, clipIndex) => clipIndex === index ? updated : clip)
  return { timeline: { ...timeline, textClips }, diagnostics: [] }
}

function applyAudio(timeline: TimelineState, operation: Extract<TimelineOperation, { kind: 'audio' }>): OperationResult {
  const source = findClip(timeline, operation.clipId)
  if (!source) return operationError('clip_not_found', 'operation.clipId', `Clip not found: ${operation.clipId}`)
  if (source.clip.type === 'image') return operationError('clip_audio_unsupported', 'operation.clipId', 'Image clips cannot carry audio settings')
  const durationFrames = source.clip.endFrame - source.clip.startFrame
  if (operation.gainDb !== undefined && (operation.gainDb < MIN_CLIP_GAIN_DB || operation.gainDb > MAX_CLIP_GAIN_DB)) {
    return operationError('clip_audio_gain_invalid', 'operation.gainDb', `gainDb must be between ${MIN_CLIP_GAIN_DB} and ${MAX_CLIP_GAIN_DB}`)
  }
  if (operation.fadeInFrames !== undefined && (!isNonNegativeInteger(operation.fadeInFrames) || operation.fadeInFrames > durationFrames)) {
    return operationError('clip_audio_fade_invalid', 'operation.fadeInFrames', 'fadeInFrames must fit the visible clip duration')
  }
  if (operation.fadeOutFrames !== undefined && (!isNonNegativeInteger(operation.fadeOutFrames) || operation.fadeOutFrames > durationFrames)) {
    return operationError('clip_audio_fade_invalid', 'operation.fadeOutFrames', 'fadeOutFrames must fit the visible clip duration')
  }
  const fadeInFrames = operation.fadeInFrames ?? source.clip.audio?.fadeInFrames ?? 0
  const fadeOutFrames = operation.fadeOutFrames ?? source.clip.audio?.fadeOutFrames ?? 0
  if (fadeInFrames + fadeOutFrames > durationFrames) {
    return operationError('clip_audio_fade_overlap', 'operation', 'Audio fades cannot exceed the visible clip duration')
  }
  const audio: TimelineClipAudio = {
    ...(source.clip.audio ?? {}),
    ...(operation.gainDb === undefined ? {} : { gainDb: operation.gainDb }),
    ...(operation.muted === undefined ? {} : { muted: operation.muted }),
    ...(operation.fadeInFrames === undefined ? {} : { fadeInFrames: operation.fadeInFrames }),
    ...(operation.fadeOutFrames === undefined ? {} : { fadeOutFrames: operation.fadeOutFrames }),
  }
  const resolvedAudio = resolveClipAudio(audio, durationFrames)
  const updated: TimelineClip = { ...source.clip, audio: resolvedAudio }
  const tracks = timeline.tracks.map((track, trackIndex) => trackIndex === source.trackIndex
    ? { ...track, clips: track.clips.map((clip) => clip.id === source.clip.id ? updated : clip) }
    : track)
  const candidate = makeTracks(timeline, tracks)
  const validation = validateTimeline(candidate)
  if (!validation.ok) return { timeline, diagnostics: validation.diagnostics }
  return { timeline: candidate, diagnostics: [] }
}

function applyOperation(timeline: TimelineState, operation: TimelineOperation): OperationResult {
  switch (operation.kind) {
    case 'move': return applyMove(timeline, operation)
    case 'remove': return applyRemove(timeline, operation)
    case 'split': return applySplit(timeline, operation)
    case 'trim': return applyTrim(timeline, operation)
    case 'source-window': return applySourceWindow(timeline, operation)
    case 'ripple': return applyRipple(timeline, operation)
    case 'transition': return applyTransition(timeline, operation)
    case 'text': return applyText(timeline, operation)
    case 'audio': return applyAudio(timeline, operation)
  }
}

function sortedObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedObject)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortedObject(entry)]))
  }
  return value
}

function diffWalk(before: unknown, after: unknown, path: string, entries: TimelineDiffEntry[]): void {
  if (Object.is(before, after)) return
  if (Array.isArray(before) && Array.isArray(after)) {
    const count = Math.max(before.length, after.length)
    for (let index = 0; index < count; index += 1) diffWalk(before[index], after[index], `${path}[${index}]`, entries)
    return
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const keys = [...new Set([...Object.keys(before as object), ...Object.keys(after as object)])].sort((left, right) => left.localeCompare(right))
    for (const key of keys) diffWalk((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], `${path}.${key}`, entries)
    return
  }
  entries.push({ path, before, after })
}

export function diffTimelines(before: TimelineState, after: TimelineState): TimelineDiff {
  const entries: TimelineDiffEntry[] = []
  diffWalk(sortedObject(before), sortedObject(after), '$', entries)
  return { changed: entries.length > 0, entries }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortedObject(value))
}

/** Stable, local revision suitable for a compare-and-swap edit session. */
export function timelineRevision(timeline: TimelineState): string {
  const input = stableJson(normalizeKernelTimeline(timeline))
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function withOperationIndex(diagnostics: TimelineDiagnostic[], operationIndex: number): TimelineDiagnostic[] {
  return diagnostics.map((entry) => ({ ...entry, operationIndex }))
}

/** Apply a batch atomically. Any error rolls the complete batch back. */
export function applyTimelineOperations(
  timeline: TimelineState,
  operations: readonly TimelineOperation[],
  options: TimelineApplyOptions = {},
): TimelineApplyResult {
  const inputValidation = validateTimeline(timeline)
  if (!inputValidation.ok) {
    return {
      ok: false,
      timeline,
      previewTimeline: timeline,
      diff: { changed: false, entries: [] },
      diagnostics: inputValidation.diagnostics,
      appliedOperationCount: 0,
      revision: 'invalid',
    }
  }
  const baseline = normalizeKernelTimeline(timeline)
  const currentRevision = timelineRevision(baseline)
  if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
    return {
      ok: false,
      timeline,
      previewTimeline: timeline,
      diff: { changed: false, entries: [] },
      diagnostics: [diagnostic('stale_revision', 'options.expectedRevision', 'Timeline revision no longer matches the edit plan')],
      appliedOperationCount: 0,
      revision: currentRevision,
    }
  }

  let candidate = baseline
  const diagnostics: TimelineDiagnostic[] = []
  let appliedOperationCount = 0
  for (const [operationIndex, operation] of operations.entries()) {
    const result = applyOperation(candidate, operation)
    const operationDiagnostics = withOperationIndex(result.diagnostics, operationIndex)
    diagnostics.push(...operationDiagnostics)
    if (operationDiagnostics.some((entry) => entry.severity === 'error')) {
      return {
        ok: false,
        timeline,
        previewTimeline: candidate,
        diff: diffTimelines(baseline, candidate),
        diagnostics,
        appliedOperationCount,
        revision: currentRevision,
      }
    }
    candidate = normalizeKernelTimeline(result.timeline)
    const candidateValidation = validateTimeline(candidate)
    if (!candidateValidation.ok) {
      diagnostics.push(...withOperationIndex(candidateValidation.diagnostics, operationIndex))
      return {
        ok: false,
        timeline,
        previewTimeline: candidate,
        diff: diffTimelines(baseline, candidate),
        diagnostics,
        appliedOperationCount,
        revision: currentRevision,
      }
    }
    appliedOperationCount += 1
  }

  const diff = diffTimelines(baseline, candidate)
  const committed = options.validateOnly ? timeline : candidate
  return {
    ok: true,
    timeline: committed,
    previewTimeline: candidate,
    diff,
    diagnostics,
    appliedOperationCount,
    revision: timelineRevision(candidate),
  }
}

export function applyTimelineOperation(timeline: TimelineState, operation: TimelineOperation, options: TimelineApplyOptions = {}): TimelineApplyResult {
  return applyTimelineOperations(timeline, [operation], options)
}
