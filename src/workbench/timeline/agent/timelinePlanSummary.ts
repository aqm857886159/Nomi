import type { TimelineOperation } from '../kernel/timelineKernel'
import type { TimelineState } from '../timelineTypes'
import { timelineSeconds, timelineTimecodePrecise } from '../timelineTimecode'

/**
 * Turns one edit-plan operation into a line a person can check before approving.
 *
 * Two rules from the design contract drive this file. §2.8: users read seconds
 * and clip names; frames and ids are engineering units that belong in the
 * tooltip and the Agent contract. §2.6: the intervention slot shows the plan
 * "summary line by line" — an approval card that prints raw operation JSON asks
 * the user to approve something they cannot read, which is the same as no
 * review at all.
 */
export type TimelinePlanLine = {
  /** Localized, human-readable sentence. */
  text: string
  /** Engineering detail for the tooltip: exact frames and ids. */
  technical: string
}

export type PlanTranslate = (key: string, values?: Record<string, unknown>) => string

const seconds = timelineSeconds
const timecode = timelineTimecodePrecise

/** Prefer the label the user sees on the track; fall back to the id when unlabelled. */
export function timelineClipLabel(timeline: TimelineState, clipId: string): string {
  for (const track of timeline.tracks) {
    for (const clip of track.clips) if (clip.id === clipId) return clip.label || clip.id
  }
  for (const clip of timeline.textClips) if (clip.id === clipId) return clip.text || clip.id
  return clipId
}

function audioFragments(operation: Extract<TimelineOperation, { kind: 'clip-audio' }>, fps: number, t: PlanTranslate): string[] {
  const { gainDb, muted, fadeInFrames, fadeOutFrames } = operation.audio
  const parts: string[] = []
  if (gainDb !== undefined) parts.push(t('timelineEditor.agentPlan.audioGain', { gain: gainDb }))
  if (muted !== undefined) parts.push(t(muted ? 'timelineEditor.agentPlan.audioMuted' : 'timelineEditor.agentPlan.audioUnmuted'))
  if (fadeInFrames !== undefined) parts.push(t('timelineEditor.agentPlan.audioFadeIn', { seconds: seconds(fadeInFrames, fps) }))
  if (fadeOutFrames !== undefined) parts.push(t('timelineEditor.agentPlan.audioFadeOut', { seconds: seconds(fadeOutFrames, fps) }))
  return parts
}

function sentence(operation: TimelineOperation, timeline: TimelineState, t: PlanTranslate): string {
  const fps = timeline.fps
  const clip = (clipId: string): string => timelineClipLabel(timeline, clipId)
  const key = (suffix: string): string => `timelineEditor.agentPlan.${suffix}`
  switch (operation.kind) {
    case 'move':
      return t(key('move'), { clip: clip(operation.clipId), time: timecode(operation.startFrame, fps) })
    case 'remove':
      return t(key('remove'), { clips: (operation.clipIds ?? (operation.clipId ? [operation.clipId] : [])).map(clip).join('、') })
    case 'split':
      return t(key('split'), { clip: clip(operation.clipId), time: timecode(operation.atFrame, fps) })
    case 'trim':
      return t(key(`${operation.deltaFrame < 0 ? 'trimShorten' : 'trimExtend'}${operation.edge === 'left' ? 'Start' : 'End'}`), {
        clip: clip(operation.clipId),
        seconds: seconds(operation.deltaFrame, fps),
      })
    case 'source-window':
      return t(key('sourceWindow'), { clip: clip(operation.clipId), start: timecode(operation.sourceStartFrame, fps), end: timecode(operation.sourceEndFrame, fps) })
    case 'ripple':
      return t(key('ripple'), { time: timecode(operation.fromFrame, fps), seconds: seconds(operation.deltaFrame, fps) })
    case 'transition':
      return operation.action === 'remove'
        ? t(key('transitionRemove'), { from: clip(operation.fromClipId), to: clip(operation.toClipId) })
        : t(key('transitionSet'), {
            from: clip(operation.fromClipId),
            to: clip(operation.toClipId),
            type: t(`timelineEditor.transition.types.${operation.type ?? 'cut'}`),
            seconds: seconds(operation.durationFrames ?? 0, fps),
          })
    case 'text':
      if (operation.action === 'add') return t(key('textAdd'), { text: operation.text, time: timecode(operation.startFrame, fps) })
      if (operation.action === 'edit') return t(key('textEdit'), { clip: clip(operation.clipId), text: operation.text })
      if (operation.action === 'style') {
        const styleKey = operation.style === 'caption' ? 'timelineEditor.agentPlan.textStyle_caption' : 'timelineEditor.agentPlan.textStyle_title'
        return t(key('textStyle'), { clip: clip(operation.clipId), style: t(styleKey) })
      }
      return t(key('textTime'), { clip: clip(operation.clipId), start: timecode(operation.startFrame, fps), end: timecode(operation.endFrame, fps) })
    case 'clip-audio':
      return t(key('audio'), { clip: clip(operation.clipId), changes: audioFragments(operation, fps, t).join(' · ') })
  }
}

export function timelinePlanLines(
  operations: readonly TimelineOperation[],
  timeline: TimelineState,
  t: PlanTranslate,
): TimelinePlanLine[] {
  return operations.map((operation) => ({ text: sentence(operation, timeline, t), technical: JSON.stringify(operation) }))
}
