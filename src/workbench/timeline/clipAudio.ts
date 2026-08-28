import type { TimelineClip, TimelineClipAudio } from './timelineTypes'

export const MIN_CLIP_GAIN_DB = -60
export const MAX_CLIP_GAIN_DB = 0

export type ResolvedClipAudio = Required<TimelineClipAudio>

const DEFAULT_CLIP_AUDIO: ResolvedClipAudio = {
  gainDb: 0,
  muted: false,
  fadeInFrames: 0,
  fadeOutFrames: 0,
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? Math.max(0, value) : 0
}

/** Normalize persisted/foreign audio settings without changing old projects. */
export function resolveClipAudio(
  audio: TimelineClipAudio | null | undefined,
  durationFrames: number,
): ResolvedClipAudio {
  const duration = Math.max(0, Math.floor(finiteNumber(durationFrames, 0)))
  const fadeInFrames = Math.min(duration, nonNegativeInteger(audio?.fadeInFrames))
  const fadeOutFrames = Math.min(duration - fadeInFrames, nonNegativeInteger(audio?.fadeOutFrames))
  return {
    gainDb: Math.max(MIN_CLIP_GAIN_DB, Math.min(MAX_CLIP_GAIN_DB, finiteNumber(audio?.gainDb, 0))),
    muted: audio?.muted === true,
    fadeInFrames,
    fadeOutFrames,
  }
}

export function isDefaultClipAudio(audio: ResolvedClipAudio): boolean {
  return audio.gainDb === DEFAULT_CLIP_AUDIO.gainDb &&
    audio.muted === DEFAULT_CLIP_AUDIO.muted &&
    audio.fadeInFrames === DEFAULT_CLIP_AUDIO.fadeInFrames &&
    audio.fadeOutFrames === DEFAULT_CLIP_AUDIO.fadeOutFrames
}

export function gainFromDecibels(gainDb: number): number {
  return 10 ** (gainDb / 20)
}

/** Linear clip gain at a timeline frame, shared by audio and video preview elements. */
export function clipAudioGainAtFrame(clip: TimelineClip, playheadFrame: number): number {
  const durationFrames = Math.max(0, clip.endFrame - clip.startFrame)
  const audio = resolveClipAudio(clip.audio, durationFrames)
  if (audio.muted || playheadFrame < clip.startFrame || playheadFrame >= clip.endFrame) return 0

  const relativeFrame = playheadFrame - clip.startFrame
  const remainingFrames = clip.endFrame - playheadFrame
  const fadeInGain = audio.fadeInFrames > 0 ? Math.min(1, relativeFrame / audio.fadeInFrames) : 1
  const fadeOutGain = audio.fadeOutFrames > 0 ? Math.min(1, remainingFrames / audio.fadeOutFrames) : 1
  return gainFromDecibels(audio.gainDb) * Math.min(fadeInGain, fadeOutGain)
}

/** Browser media-element volume for the current frame, including global preview controls. */
export function resolvePreviewMediaVolume(
  clip: TimelineClip | null | undefined,
  playheadFrame: number,
  volume: number,
  muted: boolean,
): number {
  if (!clip || muted) return 0
  const masterVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0
  return masterVolume * clipAudioGainAtFrame(clip, playheadFrame)
}
