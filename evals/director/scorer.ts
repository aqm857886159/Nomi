import { auditDirectorSpace, SPATIAL_CRITERIA, type SpatialAuditContext } from '../../src/workbench/generationCanvas/nodes/director/model/directorSpatialAudit'
import type {
  DirectorObject,
  DirectorProject,
  DirectorScene,
} from '../../src/workbench/generationCanvas/nodes/director/model/directorTypes'
import {
  measureContinuity,
  recognizeCameraMotion,
  sampleDirectorProject,
  type DirectorMeasurements,
  type MotionRecognition,
} from '../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'
import type { Direction, DirectorCard } from './cardSchema'
import { bindCardEntities } from './binding'
import type { AnchorSpec } from '../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'
import { ACTION_LIBRARY, resolveActionAlias } from '../../src/workbench/generationCanvas/nodes/director/model/actionLibrary'

/** `null` = the card does not constrain this layer, so it is left out of the total (spec: unconstrained fields are not scored). */
export type LayerScores = {
  L0: number
  L1: number | null
  L2: number | null
  L3: number | null
  L4: number | null
  /** 物理层：directorSpatialAudit 六条判据里通过几条（0 违例才算过）；没有计划上下文的方案不量，null。 */
  P: number | null
  L5: 'unverified'
}
export type CardScore = {
  cardId: string
  tier?: string
  scores: LayerScores
  total: number
  reasons: string[]
  measurements: DirectorMeasurements
  status?: 'ok' | 'adapter_error'
  correspondenceRate: number
}

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol
const MOTION_RULES = new Set([
  'push',
  'pull',
  'pan',
  'tilt',
  'orbit',
  'follow',
  'truck',
  'crane',
  'zoom',
  'arc',
  'static',
  'dolly',
  'whip',
  'rack_focus',
  'over_shoulder',
  'pov',
])
const ACTION_RULES = new Set([
  'walk_to',
  'run_to',
  'stop',
  'sidestep_block',
  'drive_along',
  'chase',
  'hide_object_behind_back',
  'hold_pose',
])
const shotAliases: Record<string, string> = { wide: '全景', medium: '中景', close: '特写' }
const motionAliases: Record<string, string> = {
  push: 'push_in',
  pull: 'pull_out',
  truck: 'track',
  crane: 'crane',
  zoom: 'zoom',
  arc: 'orbit',
  dolly: 'push_in',
  whip: 'pan',
  rack_focus: 'static',
  over_shoulder: 'static',
  pov: 'static',
}
const shotSizeMatches = (expected: string, actual: string) =>
  actual === expected ||
  (expected === '全景' && actual === '中景') ||
  (expected === '远景' && actual === '全景') ||
  (expected === '中近景' && actual === '近景') ||
  (expected === '特写' && actual === '大特写')

function actorSamples(measurements: DirectorMeasurements, id: string, window: [number, number]) {
  return measurements.frames
    .filter((frame) => frame.time >= window[0] - 1e-4 && frame.time <= window[1] + 1e-4)
    .map((frame) => frame.objects[id])
    .filter(Boolean)
}

function distance2(a: { position: { x: number; z: number } }, b: { position: { x: number; z: number } }) {
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)
}

function findObject(scene: DirectorScene, key: string): DirectorObject | undefined {
  const needle = key.toLowerCase()
  return scene.objects.find(
    (object) =>
      object.id.toLowerCase() === needle ||
      object.name.toLowerCase() === needle ||
      object.name.toLowerCase().includes(needle),
  )
}

// 尺子按「动作词」查动作库（经别名表），不手抄具体动作 id；动作库换了（2026-10-07 Mixamo → UAL）尺子自动跟着走
const actionIdFor = (word: string): string => resolveActionAlias(word)?.id ?? word
const MOVEMENT_ACTION_BY_VERB = {
  walk_to: actionIdFor('walk'),
  run_to: actionIdFor('run'),
  sidestep_block: actionIdFor('walk'),
  drive_along: actionIdFor('walk'),
  chase: actionIdFor('chase'),
} as const
const IDLE_ACTION_ID = actionIdFor('idle')
/** 「停住」可接受的动作 = 原地不走的：非位移类、且不是播完就结束的单次动作（循环待机 / 坐 / 蹲、单姿势、T-Pose） */
const STATIC_ACTION_IDS = new Set(ACTION_LIBRARY.filter((entry) => !entry.tags.includes('locomotion') && entry.kind !== 'once').map((entry) => entry.id))

function actionClipCovers(scene: DirectorScene, objectId: string, window: [number, number], actionId: string): boolean {
  if (!resolveActionAlias(actionId)) return false
  const object = scene.objects.find((candidate) => candidate.id === objectId)
  if (!object || object.type !== 'character') return true
  return (object.actionClips ?? []).some(
    (clip) =>
      clip.startTime <= window[0] + 1e-4 &&
      clip.endTime >= window[1] - 1e-4 &&
      (clip.actionPose === actionId || clip.name === actionId),
  )
}

function actionEvidence(
  scene: DirectorScene,
  objectId: string,
  action: DirectorCard['blocking'][number],
  window: [number, number],
): { ok: boolean; missingAsset?: string } {
  const object = scene.objects.find((candidate) => candidate.id === objectId)
  if (!object || object.type !== 'character') return { ok: true }
  if (action.verb === 'hide_object_behind_back') return { ok: false, missingAsset: 'hide_object_behind_back' }
  if (action.verb === 'hold_pose') {
    const actionId = action.action
    // 规划器 schema 归一会把动作词小写化（electron/shared/director/directorPlanSchema），动作 id / 别名一律经动作库解析，与编译器同口径
    const resolved = actionId ? resolveActionAlias(actionId)?.id : undefined
    if (!resolved) return { ok: false, missingAsset: actionId ?? 'hold_pose' }
    return { ok: actionClipCovers(scene, objectId, window, resolved), missingAsset: resolved }
  }
  if (action.verb === 'stop') {
    const actionId = (action.action ? resolveActionAlias(action.action)?.id : undefined) ?? IDLE_ACTION_ID
    const ok = STATIC_ACTION_IDS.has(actionId) && actionClipCovers(scene, objectId, window, actionId)
    return { ok, missingAsset: actionId }
  }
  const actionId = MOVEMENT_ACTION_BY_VERB[action.verb as keyof typeof MOVEMENT_ACTION_BY_VERB]
  if (actionId) return { ok: actionClipCovers(scene, objectId, window, actionId), missingAsset: actionId }
  return { ok: true }
}
function sampleForSubject(
  frame: DirectorMeasurements['frames'][number],
  subject: string | undefined,
  actorMap: Record<string, string | undefined>,
) {
  if (!subject) return undefined
  const [root, part] = subject.split('.')
  const sample = frame.objects[actorMap[root] ?? root]
  return part ? sample?.anchors?.[part] : sample
}

export function scoreBlocking(
  card: DirectorCard,
  measurements: DirectorMeasurements,
  scene: DirectorScene,
  actorMap: Record<string, string | undefined>,
  reasons: string[],
): number | null {
  if (!card.blocking.length) return null
  let good = 0
  for (const action of card.blocking) {
    if (!ACTION_RULES.has(action.verb))
      throw new Error(`card ${card.id}: no scoring predicate for blocking verb ${action.verb}`)
    const id = actorMap[action.actor]
    const window = action.window ?? ([0, measurements.duration] as [number, number])
    if (!id) {
      reasons.push(`缺少演员 ${action.actor}`)
      continue
    }
    const samples = actorSamples(measurements, id, window)
    const first = samples[0]
    const last = samples.at(-1)
    let ok = false
    const evidence = actionEvidence(scene, id, action, window)
    if (first && last && ['walk_to', 'run_to'].includes(action.verb)) {
      const target = action.target ? findObject(scene, action.target) : undefined
      const moved = distance2(first, last) >= 0.5
      const arrived =
        !!target && Math.hypot(last.position.x - target.position.x, last.position.z - target.position.z) <= 2.5
      ok = moved && arrived && evidence.ok
    } else if (first && last && action.verb === 'stop') {
      const speeds = samples
        .slice(1)
        .map((sample, index) => distance2(sample, samples[index]) / Math.max(0.001, window[1] - window[0]))
      ok = speeds.length > 0 && speeds.every((speed) => speed < 0.1) && evidence.ok
    } else if (first && last && action.verb === 'sidestep_block') {
      const moved = Math.abs(last.position.x - first.position.x) >= 0.5
      const target = action.between?.[1] ? findObject(scene, action.between[1]) : undefined
      const nearTarget =
        !!target && Math.hypot(last.position.x - target.position.x, last.position.z - target.position.z) <= 2.5
      ok = moved && nearTarget && evidence.ok
    } else if (first && last && action.verb === 'drive_along') {
      ok = distance2(first, last) >= 0.5 && evidence.ok
    } else if (first && last && action.verb === 'chase') {
      const targetId = action.target ? actorMap[action.target] : undefined
      const targetSamples = targetId ? actorSamples(measurements, targetId, window) : []
      const startDistance = targetSamples[0] ? distance2(first, targetSamples[0]) : Infinity
      const endDistance = targetSamples.at(-1) ? distance2(last, targetSamples.at(-1)!) : Infinity
      ok = distance2(first, last) >= 0.5 && targetSamples.length > 1 && endDistance <= startDistance + 1 && evidence.ok
    } else if (action.verb === 'hide_object_behind_back' || action.verb === 'hold_pose') {
      ok = evidence.ok
    }
    if (ok) good++
    else if (
      action.capability === 'missing_asset' ||
      (evidence.missingAsset && !resolveActionAlias(evidence.missingAsset))
    ) {
      // A card-declared unavailable capability is recorded as a partial oracle result, not a silent zero.
      good += 0.6
      reasons.push(
        `${action.actor} 的动作 ${action.verb} 能力缺口：missing_asset (${evidence.missingAsset ?? action.verb})`,
      )
    } else reasons.push(`${action.actor} 的动作 ${action.verb} 未在时间窗达成`)
  }
  return good / card.blocking.length
}

function actualShotWindows(measurements: DirectorMeasurements): [number, number][] {
  const out: [number, number][] = []
  let start = 0
  let current = measurements.frames[0]?.cameraId ?? null
  for (const frame of measurements.frames.slice(1)) {
    if (frame.cameraId !== current) {
      if (current !== null) out.push([start, frame.time])
      start = frame.time
      current = frame.cameraId
    }
  }
  if (current !== null && measurements.frames.length) out.push([start, measurements.duration])
  return out.filter(([from, to]) => to > from + 1e-4)
}

function alignedShotWindows(
  card: DirectorCard,
  measurements: DirectorMeasurements,
  reasons: string[],
): [number, number][] {
  const explicit = card.shots.map((shot) => shot.t).filter((window): window is [number, number] => !!window)
  if (explicit.length === card.shots.length) return explicit
  const actual = actualShotWindows(measurements)
  if (actual.length >= card.shots.length) {
    reasons.push('镜头时间窗按节目机位顺序对齐')
    return actual.slice(0, card.shots.length)
  }
  const duration = measurements.duration / Math.max(1, card.shots.length)
  reasons.push('镜头时间窗按总时长等分对齐')
  return card.shots.map((_, index) => [index * duration, (index + 1) * duration])
}

function intervalIoU(a: [number, number], b: [number, number]) {
  const intersection = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]))
  const union = Math.max(a[1], b[1]) - Math.min(a[0], b[0])
  return union > 0 ? intersection / union : 0
}

function scoreCoverage(
  card: DirectorCard,
  measurements: DirectorMeasurements,
  actorMap: Record<string, string | undefined>,
  reasons: string[],
): number | null {
  if (!card.coverageRequired.length) return null
  const required = new Set(card.coverageRequired.map((size) => shotAliases[size] ?? size))
  const observed = new Set<string>()
  const subjectIds = Object.values(actorMap).filter((id): id is string => !!id)
  for (const frame of measurements.frames)
    for (const id of subjectIds) {
      const size = frame.objects[id]?.shotSize
      if (size) observed.add(size)
    }
  const hit = [...required].filter((size) => observed.has(size)).length / required.size
  if (hit < 1) reasons.push(`景别覆盖缺少 ${[...required].filter((size) => !observed.has(size)).join(', ')}`)
  return hit
}

function scoreStructure(
  card: DirectorCard,
  measurements: DirectorMeasurements,
  actorMap: Record<string, string | undefined>,
  reasons: string[],
): number | null {
  if (!card.shots.length) return scoreCoverage(card, measurements, actorMap, reasons)
  const expected = alignedShotWindows(card, measurements, reasons)
  const actual = actualShotWindows(measurements)
  const count = Math.min(1, actual.length / Math.max(1, card.minCount ?? card.shots.length))
  const iou =
    expected.reduce(
      (sum, window) => sum + Math.max(...actual.map((candidate) => intervalIoU(window, candidate)), 0),
      0,
    ) / Math.max(1, expected.length)
  if (card.duration?.total !== undefined && !near(measurements.duration, card.duration.total, card.duration.tol))
    reasons.push(`总时长 ${measurements.duration.toFixed(1)}s 与 ${card.duration.total}s 偏差超过容差`)
  return (count + iou) / 2
}

function moveMatches(expected: string, actual: string): boolean {
  const normalized = motionAliases[expected] ?? expected
  if (normalized === 'orbit') return actual === 'orbit_left' || actual === 'orbit_right'
  if (normalized === 'track') return actual === 'track_left' || actual === 'track_right'
  if (normalized === 'crane') return actual === 'crane_up' || actual === 'crane_down'
  if (normalized === 'zoom') return actual === 'zoom_in' || actual === 'zoom_out' || actual === 'dolly_zoom'
  return actual === normalized
}

function directionMatches(direction: Direction | undefined, motion: MotionRecognition): boolean {
  if (!direction) return true
  if (direction === 'left') return motion.signedOrbitDeg < -1 || motion.yawDelta < -1 || motion.cameraDelta.x < -0.05
  if (direction === 'right') return motion.signedOrbitDeg > 1 || motion.yawDelta > 1 || motion.cameraDelta.x > 0.05
  if (direction === 'up') return motion.pitchDelta < -1 || motion.cameraDelta.y > 0.05
  if (direction === 'down') return motion.pitchDelta > 1 || motion.cameraDelta.y < -0.05
  if (direction === 'in') return motion.distanceDelta < -0.05 || motion.fovDelta < -0.5
  return motion.distanceDelta > 0.05 || motion.fovDelta > 0.5
}

function scoreMotionAndFraming(
  card: DirectorCard,
  measurements: DirectorMeasurements,
  actorMap: Record<string, string | undefined>,
  reasons: string[],
): number | null {
  if (!card.shots.length) {
    if (!card.moveAnyOf?.length) return null
    const subjectId = Object.values(actorMap).find((id): id is string => !!id)
    if (!subjectId) {
      reasons.push('覆盖型运动约束缺少演员')
      return 0
    }
    const matched = actualShotWindows(measurements).some((window) =>
      card.moveAnyOf!.some((move) =>
        moveMatches(move, recognizeCameraMotion(measurements, subjectId, { start: window[0], end: window[1] }).move),
      ),
    )
    if (!matched) reasons.push(`运动覆盖未命中 ${card.moveAnyOf.join('/')}`)
    return matched ? 1 : 0
  }
  const windows = alignedShotWindows(card, measurements, reasons)
  let total = 0
  let count = 0
  for (const [index, shot] of card.shots.entries()) {
    const [start, end] = windows[index] ?? [0, measurements.duration]
    const subjectRef = shot.subject ?? shot.subjects?.[0] ?? shot.endSubject
    const subject = subjectRef?.split('.')[0]
    const objectId = subject ? actorMap[subject] : Object.values(actorMap).find((id): id is string => !!id)
    const motion = objectId ? recognizeCameraMotion(measurements, objectId, { start, end }) : null
    if (shot.move && motion) {
      const expectedZoom =
        (motionAliases[shot.move] ?? shot.move) === 'zoom_in' ||
        (motionAliases[shot.move] ?? shot.move) === 'zoom_out' ||
        shot.move === 'zoom'
      const ok =
        moveMatches(shot.move, motion.move) &&
        directionMatches(shot.direction, motion) &&
        (expectedZoom || motion.issues.length === 0)
      total += ok ? 1 : 0
      count++
      if (motion.issues.length) reasons.push(...motion.issues.map((issue) => `${start}-${end}s ${issue}`))
      if (!ok)
        reasons.push(
          `${start}-${end}s 运镜 ${motion.move} / 方向 ${motion.signedOrbitDeg.toFixed(1)}° 不满足 ${shot.move}${shot.direction ? ` ${shot.direction}` : ''}`,
        )
      if (shot.sweepDeg !== undefined) {
        const amplitude = Math.abs(motion.signedOrbitDeg)
        const amplitudeOk = near(amplitude, shot.sweepDeg, shot.tolDeg ?? 20)
        total += amplitudeOk ? 1 : 0
        count++
        if (!amplitudeOk) reasons.push(`环绕幅度 ${amplitude.toFixed(0)}°，目标 ${shot.sweepDeg}°`)
      }
    } else if (shot.move && !motion) {
      count++
      reasons.push(`缺少镜头主体 ${subject ?? 'unknown'}`)
    }
    if (objectId) {
      const frames = measurements.frames.filter(
        (frame) => frame.time >= start - 1e-4 && (frame.time < end - 1e-4 || end >= measurements.duration - 1e-4),
      )
      const visible =
        frames.filter((frame) => sampleForSubject(frame, subjectRef, actorMap)?.projection?.inFrame).length /
        Math.max(1, frames.length)
      total += visible
      count++
      if (visible < 0.95) reasons.push(`${start}-${end}s 主体出画 ${Math.round((1 - visible) * 100)}% 帧`)
      if (shot.size) {
        const framingFrames =
          shot.move === 'pull'
            ? frames.filter((frame) => frame.time <= start + (end - start) * 0.35)
            : ['push', 'dolly', 'zoom'].includes(shot.move ?? '')
              ? frames.filter((frame) => frame.time >= start + (end - start) * 0.65)
              : frames
        const sizes = framingFrames
          .map((frame) => sampleForSubject(frame, subjectRef, actorMap)?.shotSize)
          .filter((size) => size !== undefined) as string[]
        const expected = shotAliases[shot.size] ?? shot.size ?? ''
        const anchorSubject = subjectRef?.includes('.')
        const hit =
          sizes.filter((size) =>
            anchorSubject && expected === '特写'
              ? ['中近景', '近景', '特写', '大特写'].includes(size)
              : shotSizeMatches(expected, size),
          ).length / Math.max(1, sizes.length)
        total += hit
        count++
        if (hit < 0.85) reasons.push(`${start}-${end}s 景别命中率 ${Math.round(hit * 100)}%`)
      }
    } else if (shot.subject || shot.subjects?.length) {
      count++
      reasons.push(`缺少镜头主体 ${subject ?? 'unknown'}`)
    }
  }
  return count ? total / count : null
}

function scoreScene(
  card: DirectorCard,
  sceneMap: Record<string, string | undefined>,
  reasons: string[],
): number | null {
  if (!card.scene.required.length) return null
  let hit = 0
  for (const required of card.scene.required) {
    if (sceneMap[required]) hit++
    else reasons.push(`场景缺少 ${required}`)
  }
  return hit / card.scene.required.length
}

export function scoreCard(
  card: DirectorCard,
  project: DirectorProject,
  actorMap?: Record<string, string>,
  anchors?: Record<string, AnchorSpec>,
  spatial?: SpatialAuditContext,
): CardScore {
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  const embeddedAnchors = (project as DirectorProject & { __evalAnchors?: Record<string, AnchorSpec> }).__evalAnchors
  const measurements = sampleDirectorProject(project, {
    duration: card.duration?.total ?? undefined,
    anchors: anchors ?? embeddedAnchors,
  })
  const reasons: string[] = []
  const continuity = scene ? measureContinuity(measurements, scene) : []
  const l0 = continuity.length ? 0 : 1
  if (continuity.length) reasons.push(...continuity.slice(0, 5).map((issue) => issue.message))
  const binding = scene
    ? bindCardEntities(card, scene)
    : { actorMap: {}, sceneMap: {}, correspondenceRate: 0, missing: [] as string[] }
  reasons.push(...binding.missing)
  const actors = binding.actorMap
  const l1 = scene ? scoreStructure(card, measurements, actors, reasons) : 0
  const l2 = scoreMotionAndFraming(card, measurements, actors, reasons)
  const l3 = scene ? scoreBlocking(card, measurements, scene, actors, reasons) : 0
  const l4 = scene ? scoreScene(card, binding.sceneMap, reasons) : 0
  const violations = spatial ? auditDirectorSpace(project, spatial) : []
  const p = spatial ? SPATIAL_CRITERIA.filter((criterion) => !violations.some((item) => item.criterion === criterion)).length / SPATIAL_CRITERIA.length : null
  for (const criterion of SPATIAL_CRITERIA) {
    const hits = violations.filter((item) => item.criterion === criterion)
    if (hits.length) reasons.push(`物理 ${criterion} ×${hits.length}：${hits.slice(0, 2).map((item) => [item.subject, item.other, item.value === undefined ? undefined : item.value.toFixed(2)].filter(Boolean).join(' / ')).join('；')}`)
  }
  const total = l0 === 0 ? 0 : weightedTotal({ L1: l1, L2: l2, L3: l3, L4: l4, P: p }, reasons)
  return {
    cardId: card.id,
    tier: card.tier,
    status: 'ok',
    scores: { L0: l0, L1: l1, L2: l2, L3: l3, L4: l4, P: p, L5: 'unverified' },
    total,
    reasons,
    measurements,
    correspondenceRate: binding.correspondenceRate,
  }
}

/** Spec weights (L5 visual judge is scored separately): camera+framing 40%, blocking 25%, structure 15%, scene 10%; P physical layer 20% (s1 schemes only, step 3 of the stage-truth work). */
export const LAYER_WEIGHTS = { L1: 0.15, L2: 0.4, L3: 0.25, L4: 0.1, P: 0.2 } as const

/** Weighted mean over the layers this card actually constrains; an unconstrained layer neither adds free points nor dilutes. */
function weightedTotal(layers: Record<keyof typeof LAYER_WEIGHTS, number | null>, reasons: string[]): number {
  let sum = 0
  let weight = 0
  for (const key of Object.keys(LAYER_WEIGHTS) as (keyof typeof LAYER_WEIGHTS)[]) {
    const value = layers[key]
    if (value === null) continue
    sum += value * LAYER_WEIGHTS[key]
    weight += LAYER_WEIGHTS[key]
  }
  if (weight === 0) {
    reasons.push('卡没有约束任何可计分的层')
    return 0
  }
  return sum / weight
}

export const scorerConfig = { motionRules: [...MOTION_RULES], actionRules: [...ACTION_RULES] }
