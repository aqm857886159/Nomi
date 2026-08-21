/**
 * Evidence-backed acceptance contracts for a real provider film.
 *
 * This module intentionally does not use an LLM. It checks whether the artifacts
 * contain the information an LLM/video model would otherwise silently lose. A
 * human or VLM still supplies frame-analysis verdicts; this contract only
 * refuses to call an unreviewed/under-specified artifact “passed”.
 */

const REQUIRED_SHOT_FIELDS = [
  'narrativeGoal',
  'actionChain',
  'dramaticBeat',
  'continuityLocks',
  'ffDesc',
  'motionDesc',
  'lfDesc',
]

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}
function nonEmpty(value) {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== undefined && value !== null
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function result(errors) {
  return errors.length ? { ok: false, errors } : { ok: true, errors: [] }
}

export function validateProductionPlan(plan) {
  const errors = []
  if (!isObject(plan)) return result(['storyboard plan is missing'])
  const shots = Array.isArray(plan.shots) ? plan.shots : []
  if (shots.length < 6) errors.push(`storyboard plan needs at least 6 shots; got ${shots.length}`)
  if (!Array.isArray(plan.anchors) || plan.anchors.length === 0) errors.push('storyboard plan needs persistent anchors')
  const seenIds = new Set()
  shots.forEach((shot, index) => {
    const label = `shot ${index + 1}`
    if (!isObject(shot)) {
      errors.push(`${label} is not an object`)
      return
    }
    const shotId = text(shot.shotId)
    if (!shotId) errors.push(`${label} missing shotId`)
    if (shotId && seenIds.has(shotId)) errors.push(`${label} duplicates shotId ${shotId}`)
    if (shotId) seenIds.add(shotId)
    if (!Number.isFinite(Number(shot.durationSec)) || Number(shot.durationSec) <= 0) errors.push(`${label} needs positive durationSec`)
    if (!Array.isArray(shot.anchorIds) || shot.anchorIds.length === 0) errors.push(`${label} needs anchorIds`)
    REQUIRED_SHOT_FIELDS.forEach((field) => {
      if (!nonEmpty(shot[field])) errors.push(`${label} missing ${field}`)
    })
    if (index > 0 && !text(shot.previousShotId)) errors.push(`${label} missing previousShotId causal handoff`)
    if (index > 0 && !text(shot.firstFrameRef)) errors.push(`${label} missing firstFrameRef from prior state`)
    if (index > 0 && text(shot.previousShotId) === shotId) errors.push(`${label} previousShotId points to itself`)
    if (text(shot.prompt).length < 24) errors.push(`${label} prompt is too short to carry visible action`) // slogan-only prompts fail here
  })
  for (let index = 1; index < shots.length; index += 1) {
    const previous = shots[index - 1]
    const current = shots[index]
    if (text(current.previousShotId) && text(previous.shotId) && current.previousShotId !== previous.shotId) {
      errors.push(`shot ${index + 1} previousShotId must reference ${previous.shotId}`)
    }
  }
  return result(errors)
}

export function validateGenerationRecord(record) {
  const errors = []
  if (!isObject(record)) return result(['generation record is missing'])
  const planResult = validateProductionPlan(record.plan)
  errors.push(...planResult.errors)
  const videoShots = Array.isArray(record.video?.shots) ? record.video.shots : []
  if (videoShots.length < 6) errors.push(`generation record needs at least 6 shot requests; got ${videoShots.length}`)
  const planShots = Array.isArray(record.plan?.shots) ? record.plan.shots : []
  if (videoShots.length && planShots.length && videoShots.length !== planShots.length) errors.push('plan/request shot count mismatch')
  videoShots.forEach((shot, index) => {
    const label = `video request ${index + 1}`
    if (!text(shot?.shotId)) errors.push(`${label} missing shotId`)
    if (index > 0 && !text(shot?.previousShotId)) errors.push(`${label} missing previousShotId`)
    if (index > 0 && !text(shot?.firstFrameRef)) errors.push(`${label} missing firstFrameRef`)
    if (!nonEmpty(shot?.references)) errors.push(`${label} missing references`)
    if (!text(shot?.firstFrameDesc)) errors.push(`${label} missing firstFrameDesc`)
    if (!text(shot?.lastFrameDesc)) errors.push(`${label} missing lastFrameDesc`)
    if (text(shot?.prompt).length < 24) errors.push(`${label} prompt is too short`)
  })
  return result(errors)
}

export function validateFrameAnalysis(analysis) {
  const errors = []
  if (!isObject(analysis)) return result(['frame analysis is missing'])
  const duration = Number(analysis.film?.durationSeconds)
  if (!Number.isFinite(duration) || Math.abs(duration - 30) > 0.75) errors.push(`film duration is not about 30 seconds: ${duration}`)
  if (text(analysis.film?.videoCodec).toLowerCase() !== 'h264') errors.push('film must have h264 video')
  if (text(analysis.film?.audioCodec).toLowerCase() !== 'aac') errors.push('film must have aac audio')
  const meanVolume = Number(analysis.film?.audioMeanVolumeDb)
  const maxVolume = Number(analysis.film?.audioMaxVolumeDb)
  const silenceRatio = Number(analysis.film?.silenceRatio)
  if (!Number.isFinite(meanVolume) || meanVolume <= -45) errors.push(`audio is not audibly mixed: mean volume ${meanVolume} dB`)
  if (!Number.isFinite(maxVolume) || maxVolume <= -12) errors.push(`audio peak is effectively silent: ${maxVolume} dB`)
  if (!Number.isFinite(silenceRatio) || silenceRatio > 0.65) errors.push(`audio silence ratio is too high: ${silenceRatio}`)
  if (Number(analysis.audio?.narrationCueCount) < 6) errors.push('audio needs six timed narration cues')
  if (!text(analysis.audio?.waveform)) errors.push('audio waveform evidence is missing')
  if (text(analysis.audio?.verdict).toLowerCase() !== 'pass') errors.push('audio verdict is not pass')
  if (!Number.isFinite(Number(analysis.film?.subtitleDurationSeconds)) || Number(analysis.film.subtitleDurationSeconds) > duration + 0.1) errors.push('subtitle stream exceeds film duration')
  const shots = Array.isArray(analysis.shots) ? analysis.shots : []
  if (shots.length < 6) errors.push(`frame analysis needs at least 6 shot entries; got ${shots.length}`)
  shots.forEach((shot, index) => {
    if (!text(shot?.shotId)) errors.push(`shot frame entry ${index + 1} missing shotId`)
    for (const frame of ['early', 'middle', 'late']) if (!text(shot?.frames?.[frame])) errors.push(`${shot?.shotId || `shot ${index + 1}`} missing ${frame} frame evidence`)
  })
  const boundaries = Array.isArray(analysis.boundaries) ? analysis.boundaries : []
  if (boundaries.length !== Math.max(0, shots.length - 1)) errors.push(`expected ${Math.max(0, shots.length - 1)} reviewed boundaries; got ${boundaries.length}`)
  boundaries.forEach((boundary, index) => {
    const label = `boundary ${index + 1}`
    for (const field of ['fromShotId', 'toShotId', 'spatialContinuity', 'causalHandoff', 'characterState', 'verdict']) {
      if (!text(boundary?.[field])) errors.push(`${label} missing ${field} verdict`)
    }
    if (!Array.isArray(boundary?.evidence) || boundary.evidence.length === 0) errors.push(`${label} missing contact-sheet evidence`)
    for (const field of ['spatialContinuity', 'causalHandoff', 'characterState', 'verdict']) {
      if (text(boundary?.[field]).toLowerCase() !== 'pass') errors.push(`${label} ${field} is not pass`)
    }
  })
  const narrative = analysis.narrative
  for (const field of ['openingGoal', 'development', 'turn', 'result']) if (narrative?.[field] !== true) errors.push(`narrative missing ${field} evidence`)
  if (text(narrative?.verdict).toLowerCase() !== 'pass') errors.push('narrative verdict is not pass')
  return result(errors)
}
