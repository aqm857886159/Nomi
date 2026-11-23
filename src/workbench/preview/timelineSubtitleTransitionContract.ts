import type { TimelineState } from '../timeline/timelineTypes'

/**
 * The timeline is the last hand-off before export. This small contract keeps
 * the two things that are easy to lose in an agentic run—subtitles and
 * transitions—in a durable, testable shape. It is intentionally independent
 * of any model/vendor so the same check can be used by MCP, canvas Agent and
 * the final export path.
 */

export type DraftFilmClip = {
  shotId: string
  startFrame: number
  endFrame: number
}

export type DraftFilmSubtitle = {
  startFrame: number
  endFrame: number
  text: string
  style?: string
}

export type DraftFilmTransition = {
  fromShotId: string
  toShotId: string
  type: 'cut' | 'dissolve' | 'fade' | 'match_cut' | 'whip_pan'
  durationFrames?: number
}

export type DraftFilmTimeline = {
  fps: number
  durationFrames: number
  clips: DraftFilmClip[]
  subtitles: DraftFilmSubtitle[]
  transitions: DraftFilmTransition[]
}

type DraftFilmValidation = {
  durationSeconds: number
  clipCount: number
  subtitleCount: number
  transitionCount: number
}

/** Project the existing Nomi timeline into the production artifact contract.
 * Visual clips remain the source of truth; subtitles come from `textClips`.
 * Gaps are still rejected by the clip-contiguity check, but clip boundaries are
 * not silently promoted to transitions. Only authored timeline transition
 * metadata can satisfy the final-film bar; an authored `cut` is valid and
 * renders as the normal hard cut already supported by the exporter.
 */
export function draftFilmTimelineFromState(timeline: TimelineState): DraftFilmTimeline {
  const clips = timeline.tracks
    .flatMap((track) => track.clips
      .filter((clip) => clip.type === 'image' || clip.type === 'video')
      .map((clip) => ({ shotId: clip.sourceNodeId, startFrame: clip.startFrame, endFrame: clip.endFrame })))
    .sort((left, right) => left.startFrame - right.startFrame || left.shotId.localeCompare(right.shotId))
  const clipById = new Map(timeline.tracks.flatMap((track) => track.clips).map((clip) => [clip.id, clip]))
  const transitions = (timeline.transitions ?? []).flatMap((transition) => {
    const fromClip = clipById.get(transition.fromClipId)
    const toClip = clipById.get(transition.toClipId)
    if (!fromClip || !toClip) return []
    return [{
      fromShotId: fromClip.sourceNodeId,
      toShotId: toClip.sourceNodeId,
      type: transition.type,
      ...(transition.durationFrames ? { durationFrames: transition.durationFrames } : {}),
    }]
  })
  const durationFrames = Math.max(0, ...timeline.tracks.flatMap((track) => track.clips.map((clip) => clip.endFrame)))
  return {
    fps: timeline.fps,
    durationFrames,
    clips,
    subtitles: (timeline.textClips ?? []).map((clip) => ({
      startFrame: clip.startFrame,
      endFrame: clip.endFrame,
      text: clip.text,
      style: clip.style,
    })),
    transitions,
  }
}

function fail(message: string): never {
  throw new Error(message)
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) fail(`${label} must be a positive integer`)
  return Number(value)
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) fail(`${label} must be a non-negative integer`)
  return Number(value)
}

/** Validate ordering and return a compact summary suitable for artifact metadata. */
export function validateDraftFilmTimeline(input: DraftFilmTimeline): DraftFilmValidation {
  const fps = positiveInteger(input.fps, 'fps')
  const durationFrames = positiveInteger(input.durationFrames, 'durationFrames')
  if (!Array.isArray(input.clips) || input.clips.length === 0) fail('成片至少需要一个镜头 / film needs at least one clip')

  const clips = [...input.clips].sort((left, right) => left.startFrame - right.startFrame)
  const shotIds = new Set<string>()
  for (let index = 0; index < clips.length; index += 1) {
    const clip = clips[index]
    if (typeof clip.shotId !== 'string' || !clip.shotId.trim()) fail(`镜头 ${index + 1} 缺少 shotId / clip ${index + 1} has no shotId`)
    if (shotIds.has(clip.shotId)) fail(`重复镜头 shotId: ${clip.shotId} / duplicate shotId: ${clip.shotId}`)
    shotIds.add(clip.shotId)
    const startFrame = nonNegativeInteger(clip.startFrame, `clips[${index}].startFrame`)
    const endFrame = positiveInteger(clip.endFrame, `clips[${index}].endFrame`)
    if (endFrame <= startFrame) fail(`镜头 ${clip.shotId} 的时间区间无效 / clip ${clip.shotId} has an invalid range`)
    if (endFrame > durationFrames) fail(`镜头 ${clip.shotId} 超出成片时长 / clip ${clip.shotId} exceeds film duration`)
    if (index > 0 && startFrame !== clips[index - 1].endFrame) {
      fail(`镜头时间轴必须连续，${clips[index - 1].shotId} 与 ${clip.shotId} 之间有空隙或重叠 / clips must be contiguous: gap or overlap between ${clips[index - 1].shotId} and ${clip.shotId}`)
    }
  }
  if (clips[0].startFrame !== 0 || clips[clips.length - 1].endFrame !== durationFrames) {
    fail('镜头必须覆盖完整成片时长 / clips must cover the full film duration')
  }

  if (!Array.isArray(input.subtitles)) fail('字幕轨不存在 / subtitle track is missing')
  for (const [index, subtitle] of input.subtitles.entries()) {
    const startFrame = nonNegativeInteger(subtitle.startFrame, `subtitles[${index}].startFrame`)
    const endFrame = positiveInteger(subtitle.endFrame, `subtitles[${index}].endFrame`)
    if (endFrame <= startFrame || endFrame > durationFrames) fail(`字幕 ${index + 1} 的区间无效 / subtitle ${index + 1} has an invalid range`)
    if (typeof subtitle.text !== 'string' || !subtitle.text.trim()) fail(`字幕 ${index + 1} 为空 / subtitle ${index + 1} is empty`)
  }

  if (!Array.isArray(input.transitions)) fail('转场数据不存在 / transition data is missing')
  const clipIndexById = new Map(clips.map((clip, index) => [clip.shotId, index]))
  const transitionPairs = new Set<string>()
  for (const [index, transition] of input.transitions.entries()) {
    const fromIndex = clipIndexById.get(transition.fromShotId)
    const toIndex = clipIndexById.get(transition.toShotId)
    if (fromIndex === undefined || toIndex === undefined || toIndex !== fromIndex + 1) {
      fail(`转场 ${index + 1} 必须连接相邻镜头 / transition ${index + 1} must connect adjacent clips`)
    }
    const pair = `${transition.fromShotId}->${transition.toShotId}`
    if (transitionPairs.has(pair)) fail(`重复转场: ${pair} / duplicate transition: ${pair}`)
    transitionPairs.add(pair)
    if (transition.durationFrames !== undefined && (!Number.isInteger(transition.durationFrames) || transition.durationFrames <= 0)) {
      fail(`转场 ${index + 1} 的时长无效 / transition ${index + 1} has an invalid duration`)
    }
    if (!['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan'].includes(transition.type)) {
      fail(`转场 ${index + 1} 类型无效 / transition ${index + 1} has an invalid type`)
    }
  }

  return {
    durationSeconds: Number((durationFrames / fps).toFixed(3)),
    clipCount: clips.length,
    subtitleCount: input.subtitles.length,
    transitionCount: input.transitions.length,
  }
}

/** Final 30-second draft-film bar used by the production run before export. */
export function assertDraftFilmReady(input: DraftFilmTimeline): DraftFilmValidation {
  const summary = validateDraftFilmTimeline(input)
  if (summary.durationSeconds < 25 || summary.durationSeconds > 35) {
    fail(`成片时长应约 30 秒，当前 ${summary.durationSeconds} 秒 / film should be about 30 seconds, got ${summary.durationSeconds}s`)
  }
  if (summary.clipCount < 6) fail(`成片至少需要 6 个镜头，当前 ${summary.clipCount} 个 / film needs at least 6 clips, got ${summary.clipCount}`)
  if (summary.subtitleCount === 0) fail('最终成片必须有字幕 / final film must contain subtitles')
  if (summary.transitionCount < 2) fail(`最终成片至少需要 2 个明确转场（硬切也必须显式声明），当前 ${summary.transitionCount} 个 / final film needs at least 2 explicit transitions (cuts must be authored), got ${summary.transitionCount}`)
  return summary
}
