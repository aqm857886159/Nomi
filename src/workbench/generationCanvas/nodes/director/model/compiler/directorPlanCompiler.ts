import { createDefaultProject } from '../directorProject'
import { scaledBounds } from '../directorSpace'
import type { SpatialAuditContext } from '../directorSpatialAudit'
import { syncInTimeline } from '../timeGrid'
import {
  distanceForShotSize,
  measureContinuity,
  sampleDirectorProject,
  type AnchorSpec,
  type ShotLadder,
} from '../directorEvalMeasurement'
import type { DirectorCamera, DirectorObject, DirectorProject, Vec3, Waypoint } from '../directorTypes'
import type { EvalShotSize } from '../../../../../../../electron/shared/director/vocab'
import { evaluateEntityTransform } from '../trajectoryEval'
import { evaluateSceneObjectPose } from '../evaluatedSceneObject'
import { findActionEntry } from '../actionLibrary'
import { lookAtAngles } from '../vec3'
import {
  directorPlanSchema,
  type DirectorPlan,
  type DirectorPlanActor,
  type DirectorPlanShot,
} from '../../../../../../../electron/shared/director/directorPlanSchema'
import { actorBody, buildStage, resolveRef, type Stage } from './directorStage'
import { chooseClearView, sightBlockers, type SightContext } from './stageSightline'
import { carryGroups, clearOfSolids, destinationFor, resolvePlacement, yawToward, yawVector, type Placed } from './stageRelations'

const FPS = 30
const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z)
const clip = (id: string, start: number, end: number, easing: DirectorPlanShot['move']['easing'] = 'linear') => ({
  id,
  startTime: start,
  endTime: end,
  startFrame: Math.round(start * FPS),
  endFrame: Math.round(end * FPS),
  easing,
})
const wp = (id: string, position: Vec3, target: Vec3, time: number, fov = 45, lookAtObjectId?: string): Waypoint => ({
  id,
  ...position,
  ...lookAtAngles(position, target),
  time,
  frameIndex: Math.round(time * FPS),
  fov,
  ...(lookAtObjectId ? { lookAtObjectId } : {}),
})
const entityWp = (id: string, position: Vec3, time: number, yaw = 0): Waypoint => ({
  id,
  ...position,
  yaw,
  pitch: 0,
  roll: 0,
  time,
  frameIndex: Math.round(time * FPS),
})
function reflectAcrossAxis(point: Vec3, a: Vec3, b: Vec3): Vec3 {
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length2 = dx * dx + dz * dz
  if (length2 < 1e-6) return point
  const t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / length2
  const projection = { x: a.x + t * dx, y: point.y, z: a.z + t * dz }
  return v(2 * projection.x - point.x, point.y, 2 * projection.z - point.z)
}
/** 世界姿态（含父链：被拿着的东西、拿着东西的人都挂在携带分组下）。 */
function poseAt(objects: readonly DirectorObject[], object: DirectorObject, time: number): { position: Vec3; yaw: number } {
  const pose = evaluateSceneObjectPose(objects, object.id, time)
  if (pose) return { position: pose.position, yaw: pose.yaw }
  const local = evaluateEntityTransform(object, time)
  return { position: local.position, yaw: local.rotation.y }
}
function positionAt(objects: readonly DirectorObject[], object: DirectorObject, time: number): Vec3 {
  return poseAt(objects, object, time).position
}
/** 主体身上的瞄准点：锚点是主体的局部偏移（计划契约：相对演员），随主体朝向转——和测量按对象姿态求锚点同一个约定。 */
function aimAt(objects: readonly DirectorObject[], subject: DirectorObject, time: number, offset: Vec3): Vec3 {
  const pose = poseAt(objects, subject, time)
  const yaw = (pose.yaw * Math.PI) / 180
  return v(pose.position.x + offset.x * Math.cos(yaw) + offset.z * Math.sin(yaw), pose.position.y + offset.y, pose.position.z - offset.x * Math.sin(yaw) + offset.z * Math.cos(yaw))
}
/** 带着这个东西走的那一层（携带分组，或它自己）：运动轨迹住在这里。 */
function motionCarrier(objects: readonly DirectorObject[], object: DirectorObject): DirectorObject {
  let current = object
  for (let depth = 0; current.parentId && depth < 8; depth += 1) current = objects.find((item) => item.id === current.parentId) ?? current
  return current
}

export type DirectorCompileIssue = {
  kind: 'unknown-ref' | 'overlap' | 'measurement' | 'missing_asset' | 'nominal-size' | 'occluded'
  message: string
  time?: number
  objectId?: string
  actorId?: string
  assetId?: string
}
export type DirectorCompileResult =
  | {
      ok: true
      project: DirectorProject
      actorMap: Record<string, string>
      anchors: Record<string, AnchorSpec>
      issues: DirectorCompileIssue[]
      duration: number
      /** 物理判据需要的计划信息（谁拍谁、谁拿着什么），评测打分用。 */
      spatial: SpatialAuditContext
    }
  | { ok: false; errors: string[] }

function actorObject(actor: DirectorPlanActor, plan: DirectorPlan, position: Vec3, id: string): DirectorObject {
  const body = actorBody(actor, plan)
  return {
    id,
    name: actor.kind === 'vehicle' ? `${actor.desc}_car` : actor.desc,
    type: body.type,
    position,
    rotation: v(),
    scale: body.scale,
    visible: true,
    locked: false,
    posePreset: actor.kind === 'person' ? 'standing' : undefined,
  }
}

/** 演员按关系词落到舞台站位（关系解析住 stageRelations）；落好就登记进舞台，后面的演员和走位都能以他为参照。 */
function placeActors(plan: DirectorPlan, stage: Stage): { objects: DirectorObject[]; issues: DirectorCompileIssue[]; holds: Map<string, string> } {
  const issues: DirectorCompileIssue[] = [],
    objects: DirectorObject[] = [],
    placed: Placed[] = [],
    holds = new Map<string, string>()
  const slots = new Map<string, number>()
  for (const actor of plan.actors) {
    const body = actorBody(actor, plan)
    const object = actorObject(actor, plan, v(), `actor:${actor.id}`)
    const ref = resolveRef(stage, actor.placement.ref)
    let facing = 0
    if (!ref) issues.push({ kind: 'unknown-ref', objectId: actor.id, message: `unknown placement ref ${actor.placement.ref}` })
    else {
      const slot = slots.get(ref.objectId) ?? 0
      slots.set(ref.objectId, slot + 1)
      const placement = resolvePlacement(stage, object, body.role, actor.placement.relation, ref, slot, placed)
      object.position = placement.position
      facing = placement.facing
      if (placement.heldBy) holds.set(object.id, placement.heldBy)
      if (placement.adjusted) issues.push({ kind: 'overlap', objectId: actor.id, message: `moved ${actor.id} out of a solid` })
    }
    object.rotation = v(0, facing, 0)
    placed.push({ object, position: object.position })
    const thing = { objectId: object.id, planId: actor.id, kind: body.kind, role: body.role, object, sizeSource: body.sizeSource, facing }
    stage.things.push(thing)
    stage.refs.set(actor.id, thing)
    objects.push(object)
  }
  return { objects, issues, holds }
}

function applyBlocking(
  plan: DirectorPlan,
  stage: Stage,
  objects: DirectorObject[],
  duration: number,
  issues: DirectorCompileIssue[],
): void {
  for (const action of [...plan.blocking].sort((a, b) => a.window[0] - b.window[0])) {
    const actor = stage.refs.get(action.actor)?.object
    if (!actor || !objects.includes(actor)) continue
    const start = action.window[0],
      end = Math.min(duration, action.window[1]),
      target = resolveRef(stage, action.target)
    const from = positionAt(objects, actor, start)
    const facing = evaluateEntityTransform(actor, start).rotation.y
    const others = objects.filter((item) => item.id !== actor.id).map((item) => ({ object: item, position: positionAt(objects, item, end) }))
    const targetAt = target ? positionAt(objects, target.object, end) : undefined
    // 走位终点由舞台解析：走到目标的站位，站位上有人就停在那人跟前（面对他）；落脚点留在出发点的地面高度
    let to = from,
      startYaw = facing,
      endYaw = facing
    if (target && targetAt && (action.verb === 'walk_to' || action.verb === 'run_to' || action.verb === 'chase')) {
      const destination = destinationFor(stage, actor, from, target, targetAt, others)
      to = destination.position
      startYaw = yawToward(from, to, facing) // 走动时朝行进方向，到了面对目标
      endYaw = destination.facing
    } else if (action.verb === 'drive_along') {
      const ahead = yawVector(facing)
      to = add(from, v(ahead.x * 4, 0, ahead.z * 4))
    } else if (action.verb === 'sidestep') {
      // 横移一步：朝向的左右，往目标那一侧
      const side = yawVector(facing + 90)
      const sign = targetAt && (targetAt.x - from.x) * side.x + (targetAt.z - from.z) * side.z < 0 ? -1 : 1
      const step = add(from, v(side.x * sign, 0, side.z * sign))
      to = clearOfSolids(step, actor, others, () => v(from.x - step.x, 0, from.z - step.z))
    } else if (action.verb === 'turn_to' && targetAt) endYaw = yawToward(from, targetAt, facing)
    const points: Waypoint[] = [entityWp(`${actor.id}-${action.verb}-start`, from, start, startYaw), entityWp(`${actor.id}-${action.verb}-end`, to, end, endYaw)]
    const trajectoryClip = clip(`${actor.id}-${action.verb}-${start}`, start, end)
    // Explicit ownership preserves the shared start waypoint of adjacent clips.
    // Without it, playback assigns that point to the previous clip and jumps
    // straight to the new clip's endpoint on the first frame after the cut.
    actor.motionTrajectory = [...(actor.motionTrajectory ?? []), ...points.map((point) => ({ ...point, clipId: trajectoryClip.id }))].sort((a, b) => a.time - b.time)
    actor.trajectoryClips = [...(actor.trajectoryClips ?? []), trajectoryClip]
    if (actor.type === 'character') {
      const chosen =
        action.action ??
        (action.verb === 'run_to' || action.verb === 'chase'
          ? 'running'
          : action.verb === 'walk_to' || action.verb === 'drive_along' || action.verb === 'sidestep'
            ? 'standard_walk'
            : 'standing_idle')
      const entry = findActionEntry(chosen)
      if (entry) {
        actor.actionClips = [
          ...(actor.actionClips ?? []),
          {
            id: `${actor.id}-action-${start}`,
            name: entry.id,
            clipType: 'action',
            actionPose: entry.id,
            startTime: start,
            endTime: end,
            startFrame: Math.round(start * FPS),
            endFrame: Math.round(end * FPS),
          },
        ]
      } else {
        issues.push({
          kind: 'missing_asset',
          actorId: action.actor,
          objectId: actor.id,
          assetId: chosen,
          message: `no action-library asset for ${chosen}; left the semantic action unmaterialized`,
        })
      }
    }
  }
}

function ensureCharacterActionCoverage(objects: DirectorObject[], duration: number): void {
  const entry = findActionEntry('standing_idle')!
  for (const object of objects.filter((item) => item.type === 'character')) {
    const clips = [...(object.actionClips ?? [])].sort((a, b) => a.startTime - b.startTime)
    let cursor = 0
    const addIdle = (start: number, end: number) => {
      if (end <= start) return
      clips.push({
        ...clip(`${object.id}/idle:${start}`, start, end),
        name: entry.id, clipType: 'action', actionPose: entry.id,
      })
    }
    for (const action of [...clips]) {
      addIdle(cursor, action.startTime)
      cursor = Math.max(cursor, action.endTime)
    }
    addIdle(cursor, duration)
    object.actionClips = clips.sort((a, b) => a.startTime - b.startTime)
  }
}

/** 镜头瞄准主体的哪一点（主体局部偏移）：锚点，或人物的胸口 / 腰（远景、全景），或物体的几何中心。机位求解、轨迹烘焙、视线检查共用这一处。 */
function aimOffsetFor(shot: DirectorPlanShot, subject: DirectorObject, anchor: AnchorSpec | undefined): Vec3 {
  if (anchor) return anchor.offset
  if (subject.type === 'character') return v(0, ['远景', '全景'].includes(shot.size) ? 1.2 : 1.5, 0)
  return v(0, scaledBounds(subject).center.y, 0)
}

function angleOffset(angle: DirectorPlanShot['angle']): number {
  if (typeof angle === 'string')
    return ({ front: 0, three_quarter: 45, side: 90, side_rear: 135, back: 180 } as Record<string, number>)[angle]
  return 'over_shoulder' in angle ? 25 : 0
}

function solveCamera(
  objects: readonly DirectorObject[],
  shot: DirectorPlanShot,
  subject: DirectorObject,
  previous: Vec3 | undefined,
  id: string,
  anchor?: AnchorSpec,
): DirectorCamera {
  const start = shot.window[0],
    end = shot.window[1],
    ladder: ShotLadder = anchor || subject.type !== 'character' ? 'object' : 'figure'
  const closeCharacter = !anchor && subject.type === 'character' && (shot.size === '特写' || shot.size === '大特写')
  const fov = closeCharacter ? 10 : shot.size === '中近景' && subject.type === 'character' ? 30 : 45
  const bounds = scaledBounds(subject)
  const subjectHeight = anchor?.size.y ?? (subject.type === 'character' ? bounds.size.y : Math.max(0.4, bounds.size.y))
  const distance =
    distanceForShotSize(shot.size as EvalShotSize, subjectHeight, fov, ladder) *
    (shot.subjects && shot.subjects.length > 1 ? 3 : 1)
  const safeObjectRadius = ladder === 'object' ? Math.hypot(bounds.size.x, bounds.size.z) / 2 + 0.2 : 0
  const subjectStart = positionAt(objects, subject, start),
    subjectEndPosition = positionAt(objects, subject, end)
  // 机位角度（正面 / 侧面 / 背面……）相对主体自己的朝向，不相对世界 +Z
  const azimuth = poseAt(objects, subject, start).yaw + angleOffset(shot.angle),
    requestedHeight = closeCharacter
      ? subjectStart.y + 2.1
      : shot.height === 'low'
        ? 0.65
        : shot.height === 'high'
          ? 2.3
          : shot.height === 'overhead'
            ? 4.2
            : subjectStart.y + (subject.type === 'character' ? 1.1 : 0.8)
  const height = requestedHeight
  const aimOffset = aimOffsetFor(shot, subject, anchor)
  const target = aimAt(objects, subject, start, aimOffset)
  const subjectEndTarget = aimAt(objects, subject, end, aimOffset)
  const subjectRoot = shot.subject.split('.')[0]
  const targetSwitch = shot.move.kind === 'target_switch'
    ? (shot.subjects ?? []).map((reference) => reference.split('.')[0]).find((reference) => reference !== subjectRoot)
    : undefined
  const targetSwitchObject = targetSwitch ? objects.find((object) => object.id === `actor:${targetSwitch}`) : undefined
  const targetSwitchStartTarget = targetSwitchObject ? aimAt(objects, subject, start, aimOffset) : target
  const targetSwitchEndTarget = targetSwitchObject ? aimAt(objects, targetSwitchObject, end, aimOffsetFor(shot, targetSwitchObject, undefined)) : subjectEndTarget
  // 画面右方（横移 / 摇镜的方向跟着机位转）
  const right = v(Math.cos((azimuth * Math.PI) / 180), 0, -Math.sin((azimuth * Math.PI) / 180))
  const sideways = (amount: number) => v(right.x * amount, 0, right.z * amount)
  const endAngle =
    shot.move.kind === 'orbit_left' || shot.move.kind === 'arc_left'
      ? azimuth - (shot.move.amount ?? (shot.move.kind.startsWith('arc') ? 45 : 90))
      : shot.move.kind === 'orbit_right' || shot.move.kind === 'arc_right'
        ? azimuth + (shot.move.amount ?? (shot.move.kind.startsWith('arc') ? 45 : 90))
        : azimuth
  const amount =
    shot.move.amount ??
    (shot.move.kind === 'push_in' || shot.move.kind === 'pull_out' ? Math.max(0.65, distance * 0.35) : 2)
  const endRadius =
    shot.move.kind === 'push_in'
      ? Math.max(0.68, safeObjectRadius, distance - amount)
      : shot.move.kind === 'pull_out'
        ? distance + amount
        : distance
  const startRadius = shot.move.kind === 'push_in' ? distance + amount : distance
  const startPosition =
    previous ??
    v(
      target.x + Math.sin((azimuth * Math.PI) / 180) * startRadius,
      height,
      target.z + Math.cos((azimuth * Math.PI) / 180) * startRadius,
    )
  let endPosition = v(
    target.x + Math.sin((endAngle * Math.PI) / 180) * endRadius,
    height,
    target.z + Math.cos((endAngle * Math.PI) / 180) * endRadius,
  )
  if (shot.move.kind === 'crane_up' || shot.move.kind === 'crane_down')
    endPosition.y = height + (shot.move.kind === 'crane_up' ? amount : -amount)
  const trackAmount = Math.min(amount, distance * 0.25)
  if (shot.move.kind === 'track_left' || shot.move.kind === 'track_right')
    endPosition = add(endPosition, sideways(shot.move.kind === 'track_left' ? -trackAmount : trackAmount))
  let targetEnd = target
  if (targetSwitchObject) targetEnd = targetSwitchEndTarget
  if (shot.move.kind === 'follow' && motionCarrier(objects, subject).motionTrajectory?.length) {
    const delta = sub(subjectEndPosition, subjectStart)
    endPosition = add(endPosition, delta)
    targetEnd = subjectEndTarget
  }
  if (shot.move.kind === 'pan' || shot.move.kind === 'whip') {
    const direction = shot.move.direction === 'left' ? 1 : -1
    targetEnd = add(target, sideways(direction * (shot.move.amount ?? 2)))
  } else if (shot.move.kind === 'tilt') {
    const direction = shot.move.direction === 'down' ? -1 : 1
    targetEnd = add(target, v(0, direction * (shot.move.amount ?? 0.5), 0))
  }
  if (shot.move.kind === 'track_left' || shot.move.kind === 'track_right') {
    const direction = shot.move.kind === 'track_left' ? -1 : 1
    targetEnd = add(target, sideways(direction * trackAmount))
  }
  const endFov =
    shot.move.kind === 'zoom_in'
      ? Math.max(18, fov - (shot.move.amount ?? 10))
      : shot.move.kind === 'zoom_out'
        ? Math.min(80, fov + (shot.move.amount ?? 10))
        : fov
  const isOrbit =
    shot.move.kind === 'orbit_left' ||
    shot.move.kind === 'orbit_right' ||
    shot.move.kind === 'arc_left' ||
    shot.move.kind === 'arc_right'
  const motionTrajectory = isOrbit
    ? Array.from({ length: 9 }, (_, index) => {
        const ratio = index / 8
        const angle = ((azimuth + (endAngle - azimuth) * ratio) * Math.PI) / 180
        const radius = distance + (endRadius - distance) * ratio
        const point = v(target.x + Math.sin(angle) * radius, height, target.z + Math.cos(angle) * radius)
        return wp(`${id}-orbit-${index}`, point, target, start + (end - start) * ratio, fov + (endFov - fov) * ratio)
      })
    : [
        wp(`${id}-start`, startPosition, targetSwitchStartTarget, start, fov, targetSwitchObject ? subject.id : undefined),
        wp(`${id}-end`, endPosition, targetEnd, end, endFov, targetSwitchObject?.id),
      ]
  return {
    id,
    name: shot.id,
    position: startPosition,
    yaw: 0,
    pitch: 0,
    roll: 0,
    fov,
    focalLengthMm: 35,
    motionTrajectory,
    trajectoryClips: [clip(`${id}-clip`, start, end, shot.move.easing)],
  }
}

function constrainCameraPath(
  camera: DirectorCamera,
  shot: DirectorPlanShot,
  subject: DirectorObject,
  objects: DirectorObject[],
  anchor: AnchorSpec | undefined,
  desiredSign: { value: number },
): void {
  const characters = objects.filter((object) => object.type === 'character').slice(0, 2)
  const aimOffset = aimOffsetFor(shot, subject, anchor)
  const frameCount = Math.max(1, Math.ceil((shot.window[1] - shot.window[0]) * FPS))
  const baked = Array.from({ length: frameCount + 1 }, (_, frame) => {
    const time = shot.window[0] + (shot.window[1] - shot.window[0]) * frame / frameCount
    const pose = evaluateEntityTransform(camera, time)
    let point = { ...pose.position }
    const original = { ...point }
    const a = characters[0] && positionAt(objects, characters[0], time)
    const b = characters[1] && positionAt(objects, characters[1], time)
    const axisSide = (candidate: Vec3) => a && b
      ? (b.x - a.x) * (candidate.z - a.z) - (b.z - a.z) * (candidate.x - a.x) : 0
    const sign = Math.sign(axisSide(point))
    if (!desiredSign.value && sign) desiredSign.value = sign
    if (a && b && sign && desiredSign.value !== sign) point = reflectAcrossAxis(point, a, b)
    for (const object of objects) {
      if (!object.visible || object.isAuxiliary || object.type === 'plane') continue
      const origin = positionAt(objects, object, time)
      const box = scaledBounds(object)
      const center = add(origin, box.center)
      const half = v(box.size.x / 2 + 0.08, box.size.y / 2 + 0.08, box.size.z / 2 + 0.08)
      if (Math.abs(point.x - center.x) > half.x || Math.abs(point.y - center.y) > half.y || Math.abs(point.z - center.z) > half.z) continue
      const candidates = (['x', 'y', 'z'] as const).flatMap((axis) => [-1, 1].map((direction) => ({
        ...point, [axis]: center[axis] + direction * (half[axis] + 0.02),
      }))).filter((candidate) => candidate.y >= 0 && (!desiredSign.value || !a || !b || axisSide(candidate) * desiredSign.value >= 0))
      candidates.sort((left, right) => Math.hypot(left.x - point.x, left.y - point.y, left.z - point.z) - Math.hypot(right.x - point.x, right.y - point.y, right.z - point.z))
      if (candidates[0]) point = candidates[0]
    }
    const changed = Math.hypot(point.x - original.x, point.y - original.y, point.z - original.z) > 1e-6
    const switchTarget = shot.move.kind === 'target_switch'
      ? (shot.subjects ?? []).map((reference) => reference.split('.')[0]).find((reference) => reference !== shot.subject.split('.')[0])
      : undefined
    const switchObject = switchTarget ? objects.find((object) => object.id === `actor:${switchTarget}`) : undefined
    const switched = switchObject && time >= (shot.window[0] + shot.window[1]) / 2
    const targetObject = switched ? switchObject : subject
    const targetOffset = targetObject === subject ? aimOffset : aimOffsetFor(shot, targetObject, undefined)
    return {
      ...wp(`${camera.id}/frame:${frame}`, point, aimAt(objects, targetObject, time, targetOffset), time, pose.fov ?? camera.fov, targetObject.id),
      ...(changed ? {} : { yaw: pose.rotation.y, pitch: pose.rotation.x, roll: pose.rotation.z }),
      clipId: camera.trajectoryClips?.[0]?.id,
    }
  })
  camera.motionTrajectory = baked
  camera.position = v(baked[0].x, baked[0].y, baked[0].z)
}

export function compileDirectorPlan(input: unknown): DirectorCompileResult {
  const parsed = directorPlanSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  const plan = parsed.data,
    project = createDefaultProject(plan.scene.tags.join(' / ') || 'S1 Director')
  const scene = project.scenes[0]
  scene.id = 'scene:director'
  project.activeSceneId = scene.id
  scene.name = plan.scene.environment
  const stage = buildStage(plan)
  const placed = placeActors(plan, stage),
    actorMap: Record<string, string> = {},
    anchors: Record<string, AnchorSpec> = {},
    actorObjects = placed.objects
  for (const actor of plan.actors) {
    const id = `actor:${actor.id}`
    actorMap[actor.id] = id
    for (const [name, offset] of Object.entries(actor.anchors ?? {}))
      anchors[`${id}.${name}`] = {
        offset: { x: offset?.x ?? 0, y: offset?.y ?? 0.9, z: offset?.z ?? 0 },
        size: v(0.18, 0.18, 0.18),
      }
  }
  scene.objects = [...stage.objects, ...actorObjects]
  const duration = Math.max(...plan.shots.map((s) => s.window[1]), ...plan.blocking.map((b) => b.window[1]), 0)
  const issues: DirectorCompileIssue[] = [...stage.issues, ...placed.issues]
  applyBlocking(plan, stage, scene.objects, duration, issues)
  ensureCharacterActionCoverage(scene.objects, duration)
  // 拿在手里的东西挂到人身上：编辑器现成的父子关系（父级只能是分组），人和东西一起挂在携带分组下，轨迹由分组承载
  scene.objects.push(...carryGroups(scene.objects, placed.holds))
  const cameras: DirectorCamera[] = []
  let previous: Vec3 | undefined
  const axisSign = { value: 0 }
  for (const shot of plan.shots) {
    const root = shot.subject.split('.')[0],
      subject = actorObjects.find((o) => o.id === actorMap[root])
    if (!subject) continue
    const mover = motionCarrier(scene.objects, subject)
    if (shot.move.kind === 'follow' && !mover.motionTrajectory?.length) {
      const start = shot.window[0],
        end = shot.window[1]
      mover.motionTrajectory = [
        entityWp(`${mover.id}-follow-start`, mover.position, start, mover.rotation.y),
        entityWp(`${mover.id}-follow-end`, add(mover.position, v(2, 0, 0)), end, mover.rotation.y),
      ]
      mover.trajectoryClips = [...(mover.trajectoryClips ?? []), clip(`${mover.id}-follow`, start, end)]
    }
    const part = shot.subject.split('.')[1]
    const anchorValue = part ? plan.actors.find((actor) => actor.id === root)?.anchors?.[part] : undefined
    const anchor = anchorValue
      ? { offset: v(anchorValue.x ?? 0, anchorValue.y ?? 0.9, anchorValue.z ?? 0), size: v(0.18, 0.18, 0.18) }
      : undefined
    const camera = solveCamera(
      scene.objects,
      shot,
      subject,
      shot.transitionIn === 'continuous' ? previous : undefined,
      `shot:${shot.id}/camera`,
      anchor,
    )
    // 机位视线：被墙 / 布景 / 别的人挡住主体，就对整条路径找一个看得见的候选（接续上一镜的连续镜头不挪起点）
    const characters = scene.objects.filter((object) => object.type === 'character').slice(0, 2)
    const sight: SightContext = {
      objects: scene.objects,
      subjectId: subject.id,
      aim: (time) => aimAt(scene.objects, subject, time, aimOffsetFor(shot, subject, anchor)),
      window: shot.window,
      ignore: new Set(placed.holds.keys()),
      keepStart: shot.transitionIn === 'continuous' && !!previous,
      follows: shot.move.kind === 'follow',
      sameSide: (point, time) => {
        if (!axisSign.value || characters.length < 2) return true
        const a = positionAt(scene.objects, characters[0], time), b = positionAt(scene.objects, characters[1], time)
        return Math.sign((b.x - a.x) * (point.z - a.z) - (b.z - a.z) * (point.x - a.x)) !== -axisSign.value
      },
    }
    chooseClearView(camera, sight)
    constrainCameraPath(camera, shot, subject, scene.objects, anchor, axisSign)
    const hidden = sightBlockers(sight, camera)
    if (hidden.length) issues.push({ kind: 'occluded', objectId: camera.id, message: `shot ${shot.id}: ${subject.id} is hidden behind ${hidden.join(', ')} from every candidate camera` })
    camera.trajectoryClips = (camera.trajectoryClips ?? []).map((clipItem) => ({
      ...clipItem,
      endTime: Math.max(clipItem.startTime, clipItem.endTime - 1e-4),
      endFrame: Math.max(clipItem.startFrame, clipItem.endFrame - 1),
    }))
    cameras.push(camera)
    scene.timelineTrackOrder.push(camera.id)
    previous = camera.motionTrajectory?.at(-1)
      ? v(camera.motionTrajectory.at(-1)!.x, camera.motionTrajectory.at(-1)!.y, camera.motionTrajectory.at(-1)!.z)
      : camera.position
  }
  scene.cameras = cameras
  // 在不在时间轴由片段推出——和编辑器同一条规则（timeGrid.syncInTimeline），编译器不另写一份
  for (const entity of [...scene.objects, ...scene.cameras]) syncInTimeline(entity)
  const measurement = sampleDirectorProject(project, { fps: FPS, duration, anchors }),
    continuity = measureContinuity(measurement, scene)
  issues.push(
    ...continuity.map((item) => ({
      kind: 'measurement' as const,
      message: item.message,
      time: item.time,
      objectId: item.objectId,
    })),
  )
  const spatial: SpatialAuditContext = {
    shots: plan.shots.flatMap((shot) => {
      const subjectId = actorMap[shot.subject.split('.')[0]]
      return subjectId && cameras.some((camera) => camera.id === `shot:${shot.id}/camera`)
        ? [{ cameraId: `shot:${shot.id}/camera`, subjectId, window: shot.window as [number, number] }]
        : []
    }),
    // 携带物 → 带着它走的那一层（携带分组）：物理判据量「东西和带它的人是否一起走」
    carried: [...placed.holds].map(([item]) => [item, motionCarrier(scene.objects, scene.objects.find((object) => object.id === item)!).id] as [string, string]),
  }
  return { ok: true, project, actorMap, anchors, issues, duration, spatial }
}
