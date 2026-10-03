import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDefaultProject } from '../../src/workbench/generationCanvas/nodes/director/model/directorProject'
import {
  distanceForShotSize,
  type AnchorSpec,
  type EvalShotSize,
  type ShotLadder,
} from '../../src/workbench/generationCanvas/nodes/director/model/directorEvalMeasurement'
import type {
  DirectorCamera,
  DirectorObject,
  DirectorProject,
  Vec3,
  Waypoint,
} from '../../src/workbench/generationCanvas/nodes/director/model/directorTypes'
import { lookAtAngles } from '../../src/workbench/generationCanvas/nodes/director/model/vec3'
import type { DirectorCard } from './cardSchema'
import { adaptS1Plan, adaptS1Prompt } from './s1Adapter'
import { S1_ORACLE_PLANS } from './s1OraclePlans'

export type AdaptedProject = {
  project: DirectorProject
  actorMap?: Record<string, string>
  anchors?: Record<string, AnchorSpec>
  metadata?: {
    plannerAttempts?: number
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number; estimatedUsd?: number }
    rawPlan?: string
    issues?: Array<{ kind: string; message: string; actorId?: string; assetId?: string }>
  }
}
export const PR960_ROOT_ENV = 'NOMI_EVAL_PR960_ROOT'
type Pr960PlanModule = {
  normalizeDirectorPrompt(prompt: string): unknown
  buildDirectorProjectFromPlan(plan: unknown): { project: DirectorProject }
}
async function importPr960Plan(): Promise<Pr960PlanModule> {
  const root = process.env[PR960_ROOT_ENV]
  if (!root)
    throw new Error(
      `${PR960_ROOT_ENV} is not set; point it at a checkout of feat/director-p0 (PR #960) to run the s0 schemes`,
    )
  return (await import(
    pathToFileURL(path.join(root, 'src/workbench/generationCanvas/nodes/director/model/directorPlan.ts')).href
  )) as Pr960PlanModule
}
export type Scheme = 'oracle' | 's0-pr960-raw' | 's0-pr960-ideal' | 's1' | 's1-oracle-plan'
type PointOptions = { target: Vec3; fov: number }
type ShotWindow = [number, number]
type SubjectRef = { root: string; part?: string }
const FPS = 30
const DEFAULT_FOV = 45
const point = (position: Vec3, time: number, options: PointOptions): Waypoint => {
  const angles = lookAtAngles(position, options.target)
  return {
    id: `wp-${time}-${position.x.toFixed(3)}-${position.y.toFixed(3)}-${position.z.toFixed(3)}`,
    ...position,
    time,
    frameIndex: Math.round(time * FPS),
    yaw: angles.yaw,
    pitch: angles.pitch,
    roll: angles.roll,
    fov: options.fov,
  }
}
const entityPoint = (position: Vec3, time: number): Waypoint => ({
  id: `entity-${time}-${position.x.toFixed(3)}-${position.z.toFixed(3)}`,
  ...position,
  time,
  frameIndex: Math.round(time * FPS),
  yaw: 0,
  pitch: 0,
  roll: 0,
})
const clip = (id: string, start: number, end: number) => ({
  id,
  startTime: start,
  endTime: end,
  startFrame: Math.round(start * FPS),
  endFrame: Math.round(end * FPS),
})

function makeObject(id: string, category: string, position: Vec3): DirectorObject {
  const type: DirectorObject['type'] =
    category === 'person' ? 'character' : category === 'product' ? 'cylinder' : category === 'vehicle' ? 'cube' : 'cube'
  const scale =
    category === 'person'
      ? { x: 1, y: 1, z: 1 }
      : category === 'vehicle'
        ? { x: 1.8, y: 1, z: 4 }
        : { x: 1, y: 1, z: 1 }
  return {
    id,
    name: id,
    type,
    position: { ...position, y: type === 'character' ? 0 : Math.max(0, position.y) },
    rotation: { x: 0, y: 0, z: 0 },
    scale,
    visible: true,
    locked: false,
  }
}
function makeSceneObject(id: string): DirectorObject {
  const primitive = id === 'ground' || id.endsWith('_street') || id === 'road' ? 'plane' : 'cube'
  const isGate = id === 'gate'
  return {
    id,
    name: id === 'gate' ? 'gate' : id === 'road' ? 'road' : 'ground',
    type: primitive,
    position: { x: 0, y: primitive === 'plane' || isGate ? 0 : 50, z: primitive === 'plane' || isGate ? 0 : 50 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: primitive === 'plane' ? { x: 20, y: 1, z: 20 } : { x: 1, y: 1, z: 1 },
    visible: true,
    locked: false,
  }
}
function base(objects: DirectorObject[], cameras: DirectorCamera[], duration: number): DirectorProject {
  const project = createDefaultProject('oracle')
  const scene = project.scenes[0]
  scene.objects = objects
  scene.cameras = cameras
  scene.timelineTrackOrder = cameras.map((camera) => camera.id)
  return project
}
function parseSubject(value: string | undefined): SubjectRef | undefined {
  if (!value) return undefined
  const [root, part] = value.split('.')
  return { root, part }
}
function shotWindows(card: DirectorCard, duration: number): ShotWindow[] {
  const count = card.shots.length || card.coverageRequired.length || 1
  return Array.from(
    { length: count },
    (_, index) => card.shots[index]?.t ?? [(index * duration) / count, ((index + 1) * duration) / count],
  )
}
function oracleShots(card: DirectorCard): DirectorCard['shots'] {
  if (card.shots.length) return card.shots
  return card.coverageRequired.map((size, index) => ({
    size,
    move: card.moveAnyOf?.[index % Math.max(1, card.moveAnyOf.length)] ?? 'static',
  }))
}
function actorPositions(card: DirectorCard): Record<string, Vec3> {
  const positions: Record<string, Vec3> = {}
  card.actors.forEach((actor, index) => {
    positions[actor.id] = {
      x: (index - (card.actors.length - 1) / 2) * 2,
      y: actor.category === 'person' ? 0 : 0.5,
      z: 0,
    }
  })
  return positions
}
function applyBlocking(
  card: DirectorCard,
  objects: DirectorObject[],
  actorMap: Record<string, string>,
  duration: number,
): void {
  const byId = (id: string | undefined) => objects.find((object) => object.id === (id ? (actorMap[id] ?? id) : ''))
  for (const action of card.blocking) {
    const actor = byId(action.actor)
    if (!actor) continue
    const start = action.window?.[0] ?? 0
    const end = action.window?.[1] ?? duration
    const target = byId(action.target)
    const addTrajectory = (points: Waypoint[], trajectoryId: string) => {
      actor.motionTrajectory = [...(actor.motionTrajectory ?? []), ...points].sort((a, b) => a.time - b.time)
      actor.trajectoryClips = [...(actor.trajectoryClips ?? []), clip(trajectoryId, start, end)]
    }
    if (['walk_to', 'run_to'].includes(action.verb) && target) {
      addTrajectory(
        [entityPoint(actor.position, start), entityPoint(target.position, end)],
        `${actor.id}-${action.verb}`,
      )
    } else if (action.verb === 'sidestep_block') {
      const targetPosition = target?.position ?? actor.position
      addTrajectory(
        [
          entityPoint(actor.position, start),
          entityPoint({ x: targetPosition.x - 0.8, y: actor.position.y, z: targetPosition.z }, end),
        ],
        `${actor.id}-sidestep`,
      )
    } else if (['drive_along', 'chase'].includes(action.verb)) {
      const targetPosition = target?.position ?? actor.position
      addTrajectory(
        [
          entityPoint(actor.position, start),
          entityPoint({ x: targetPosition.x, y: actor.position.y, z: targetPosition.z + 0.8 }, end),
        ],
        `${actor.id}-${action.verb}`,
      )
    } else if (action.verb === 'stop') {
      const last = actor.motionTrajectory?.at(-1)
      addTrajectory(
        [
          entityPoint(last ? { x: last.x, y: last.y, z: last.z } : actor.position, start),
          entityPoint(last ? { x: last.x, y: last.y, z: last.z } : actor.position, end),
        ],
        `${actor.id}-stop`,
      )
    } else if (action.verb === 'hide_object_behind_back' || action.verb === 'hold_pose') {
      actor.actionClips = [
        {
          id: `${actor.id}-${action.verb}`,
          name: action.verb,
          clipType: 'action',
          startTime: start,
          endTime: end,
          startFrame: Math.round(start * FPS),
          endFrame: Math.round(end * FPS),
          actionPose: action.verb,
        },
      ]
    }
  }
}
function anchorFor(subject: SubjectRef | undefined, actor: DirectorObject): AnchorSpec | undefined {
  if (!subject?.part) return undefined
  if (subject.part === 'hand') return { offset: { x: 0.28, y: 1.05, z: 0.12 }, size: { x: 0.18, y: 0.22, z: 0.18 } }
  if (subject.part === 'cap')
    return { offset: { x: 0, y: actor.type === 'character' ? 1.7 : 0.95, z: 0 }, size: { x: 0.24, y: 0.2, z: 0.24 } }
  return { offset: { x: 0, y: 0.5, z: 0 }, size: { x: 0.25, y: 0.25, z: 0.25 } }
}
function subjectHeight(actor: DirectorObject, anchor: AnchorSpec | undefined): number {
  if (anchor) return anchor.size.y
  return actor.type === 'character' ? 1.75 : actor.type === 'cube' && actor.scale.z > 2 ? 1 : actor.scale.y
}
function targetPosition(actor: DirectorObject, anchor: AnchorSpec | undefined): Vec3 {
  if (anchor)
    return {
      x: actor.position.x + anchor.offset.x,
      y: actor.position.y + anchor.offset.y,
      z: actor.position.z + anchor.offset.z,
    }
  if (actor.type === 'character') return { x: actor.position.x, y: actor.position.y + 1.2, z: actor.position.z }
  return { x: actor.position.x, y: actor.position.y + 0.5, z: actor.position.z }
}
function positionAt(actor: DirectorObject, time: number): Vec3 {
  const points = actor.motionTrajectory
  if (!points?.length) return actor.position
  if (time <= points[0].time) return { x: points[0].x, y: points[0].y, z: points[0].z }
  const last = points[points.length - 1]
  if (time >= last.time) return { x: last.x, y: last.y, z: last.z }
  const next = points.find((point) => point.time >= time) ?? last
  const previous = points[Math.max(0, points.indexOf(next) - 1)]
  const ratio = (time - previous.time) / Math.max(0.001, next.time - previous.time)
  return {
    x: previous.x + (next.x - previous.x) * ratio,
    y: previous.y + (next.y - previous.y) * ratio,
    z: previous.z + (next.z - previous.z) * ratio,
  }
}
function angleOffset(
  angle: string | undefined,
  subject: Vec3,
  distance: number,
  actors: Record<string, DirectorObject>,
): Vec3 {
  const lower = angle?.toLowerCase() ?? 'front'
  if (lower === 'side' || lower === 'side_rear') return { x: subject.x - distance, y: subject.y, z: subject.z }
  if (lower === 'rear' || lower === 'back') return { x: subject.x, y: subject.y, z: subject.z - distance }
  const match = angle?.match(/(?:over_shoulder|pov)\(([^)]+)\)/)
  if (match) {
    const other = actors[match[1]]
    if (other) {
      const dx = subject.x - other.position.x
      const dz = subject.z - other.position.z
      const length = Math.max(0.001, Math.hypot(dx, dz))
      return { x: subject.x + (dx / length) * distance, y: subject.y, z: subject.z + (dz / length) * distance }
    }
  }
  return { x: subject.x, y: subject.y, z: subject.z - distance }
}
function cameraForShot(
  id: string,
  shot: DirectorCard['shots'][number],
  window: ShotWindow,
  actor: DirectorObject,
  actors: Record<string, DirectorObject>,
  anchor: AnchorSpec | undefined,
): DirectorCamera {
  const [start, end] = window
  const size = (shot.size ?? shot.endSize ?? '中景') as EvalShotSize
  const ladder: ShotLadder = actor.type === 'character' && !anchor ? 'figure' : 'object'
  const fov = DEFAULT_FOV
  const distance = Math.max(anchor ? 0.15 : 0.12, distanceForShotSize(size, subjectHeight(actor, anchor), fov, ladder))
  const startActor = { ...actor, position: positionAt(actor, start) }
  const endActor = { ...actor, position: positionAt(actor, end) }
  const target = targetPosition(startActor, anchor)
  const endTarget = targetPosition(endActor, anchor)
  if (
    actor.type === 'character' &&
    !anchor &&
    (size === '中近景' || size === '近景' || size === '特写' || size === '大特写')
  ) {
    const lift = size === '特写' || size === '大特写' ? 0.5 : 0.2
    target.y += lift
    endTarget.y += lift
  }
  const direction = shot.direction
  const sign = direction === 'left' ? -1 : 1
  const firstPosition = angleOffset(shot.angle, target, distance, actors)
  let positions = [firstPosition, firstPosition]
  let targets = [target, target]
  let fovs = [fov, fov]
  const move = shot.move ?? 'static'
  if (move === 'push' || move === 'dolly') {
    const far = shot.angle?.startsWith('over_shoulder')
      ? { x: firstPosition.x, y: firstPosition.y, z: firstPosition.z - 0.8 }
      : angleOffset(shot.angle, target, distance + 0.8, actors)
    positions = [far, firstPosition]
    fovs = [size === '特写' || size === '大特写' ? 10 : Math.max(15, fov - 20), fov]
  } else if (move === 'pull') {
    const far = shot.angle?.startsWith('over_shoulder')
      ? { x: firstPosition.x, y: firstPosition.y, z: firstPosition.z - 0.8 }
      : angleOffset(shot.angle, target, distance + 0.8, actors)
    positions = [firstPosition, far]
    fovs = [fov, size === '特写' || size === '大特写' ? 10 : Math.max(15, fov - 20)]
  } else if (move === 'orbit' || move === 'arc') {
    const sweep = shot.sweepDeg ?? (move === 'arc' ? 90 : 360)
    positions = Array.from({ length: 9 }, (_, index) => {
      const radians = (sign * (index / 8 - 0.5) * sweep * Math.PI) / 180
      return { x: target.x + Math.sin(radians) * distance, y: target.y, z: target.z + Math.cos(radians) * distance }
    })
  } else if (move === 'follow') {
    const offset = { x: -distance * 0.25, y: 0.5, z: -distance }
    positions = [
      { x: target.x + offset.x, y: target.y + offset.y, z: target.z + offset.z },
      { x: endTarget.x + offset.x, y: endTarget.y + offset.y, z: endTarget.z + offset.z },
    ]
    targets = [target, endTarget]
  } else if (move === 'truck') {
    positions = [
      { x: firstPosition.x - sign * 0.15, y: firstPosition.y, z: firstPosition.z },
      { x: firstPosition.x + sign * 0.15, y: firstPosition.y, z: firstPosition.z },
    ]
    targets = [
      { x: target.x - sign * 0.15, y: target.y, z: target.z },
      { x: target.x + sign * 0.15, y: target.y, z: target.z },
    ]
  } else if (move === 'crane')
    positions = [
      { x: firstPosition.x, y: firstPosition.y - 2 * (direction === 'down' ? -1 : 1), z: firstPosition.z },
      { x: firstPosition.x, y: firstPosition.y + 2 * (direction === 'down' ? -1 : 1), z: firstPosition.z },
    ]
  else if (move === 'pan' || move === 'whip') targets = [target, { x: target.x + sign * 2, y: target.y, z: target.z }]
  else if (move === 'tilt') {
    const amount = 0.5
    targets =
      direction === 'down'
        ? [
            { x: target.x, y: target.y + amount, z: target.z },
            { x: target.x, y: target.y - amount, z: target.z },
          ]
        : [
            { x: target.x, y: target.y - amount, z: target.z },
            { x: target.x, y: target.y + amount, z: target.z },
          ]
  } else if (move === 'zoom') fovs = direction === 'out' ? [35, 55] : [55, 35]
  if (move !== 'follow' && actor.motionTrajectory && positions.length > 1) {
    const delta = { x: endTarget.x - target.x, y: endTarget.y - target.y, z: endTarget.z - target.z }
    const last = positions.length - 1
    positions[last] = { x: positions[last].x + delta.x, y: positions[last].y + delta.y, z: positions[last].z + delta.z }
    if (targets.length > 1) {
      const targetIndex = targets.length - 1
      targets[targetIndex] = {
        x: targets[targetIndex].x + delta.x,
        y: targets[targetIndex].y + delta.y,
        z: targets[targetIndex].z + delta.z,
      }
    }
  }
  const waypoints = positions.map((position, index) =>
    point(position, start + ((end - start) * index) / Math.max(1, positions.length - 1), {
      target: targets[Math.min(index, targets.length - 1)],
      fov: fovs[Math.min(index, fovs.length - 1)],
    }),
  )
  const first = waypoints[0]
  return {
    id,
    name: id,
    position: { x: first.x, y: first.y, z: first.z },
    yaw: first.yaw,
    pitch: first.pitch,
    roll: 0,
    fov: first.fov ?? fov,
    focalLengthMm: 0,
    motionTrajectory: waypoints,
    trajectoryClips: [clip(`${id}-clip`, start, end)],
  }
}
function buildCardOracle(card: DirectorCard): AdaptedProject {
  const duration = card.duration?.total ?? 12
  const actorMap: Record<string, string> = {}
  const positions = actorPositions(card)
  const actors: Record<string, DirectorObject> = {}
  const objects = card.actors.map((actor) => {
    const object = makeObject(actor.id, actor.category, positions[actor.id])
    actors[actor.id] = object
    actorMap[actor.id] = object.id
    return object
  })
  for (const required of card.scene.required)
    if (!objects.some((object) => object.id === required)) objects.push(makeSceneObject(required))
  applyBlocking(card, objects, actorMap, duration)
  const shots = oracleShots(card)
  const windows = shotWindows(card, duration)
  const anchors: Record<string, AnchorSpec> = {}
  const cameras = shots.map((shot, index) => {
    const subject = parseSubject(shot.subject ?? shot.subjects?.[0] ?? shot.endSubject ?? card.actors[0]?.id)
    const actor = subject ? actors[subject.root] : objects[0]
    if (!actor) throw new Error(`card ${card.id}: shot ${index} has no subject`)
    if (shot.move === 'follow' && !actor.motionTrajectory) {
      const window = windows[index]
      const direction = shot.direction === 'left' ? -1 : 1
      actor.motionTrajectory = [
        entityPoint(actor.position, window[0]),
        entityPoint({ x: actor.position.x + direction * 2, y: actor.position.y, z: actor.position.z }, window[1]),
      ]
      actor.trajectoryClips = [clip(`${actor.id}-follow`, window[0], window[1])]
    }
    const anchor = anchorFor(subject, actor)
    if (anchor && subject?.part) anchors[`${actor.id}.${subject.part}`] = anchor
    return cameraForShot(`shot-${index}`, shot, windows[index], actor, actors, anchor)
  })
  const project = base(objects, cameras, duration)
  Object.defineProperty(project, '__evalAnchors', { value: anchors, enumerable: false })
  return { project, actorMap, anchors }
}
export function oracleForCard(card: DirectorCard): AdaptedProject {
  return buildCardOracle(card)
}

export async function adapt(prompt: string, card: DirectorCard, scheme: Scheme): Promise<AdaptedProject> {
  if (scheme === 'oracle') return oracleForCard(card)
  if (scheme === 's1') {
    const result = await adaptS1Prompt(prompt)
    if (!result.ok) {
      const error = new Error(`s1 planner/compiler failed for ${card.id}: ${result.errors.join('; ')}`) as Error & { planner?: unknown }
      error.planner = result.planner
      throw error
    }
    return {
      ...result.adapted,
      metadata: { plannerAttempts: result.planner.attempts, usage: result.planner.usage, rawPlan: result.planner.raw, issues: result.adapted.issues },
    }
  }
  if (scheme === 's1-oracle-plan') {
    const plan = S1_ORACLE_PLANS[card.id]
    if (!plan) throw new Error(`s1-oracle-plan only supports the three benchmark cards; received ${card.id}`)
    const result = adaptS1Plan(plan)
    if ('errors' in result) throw new Error(`s1 oracle compiler failed for ${card.id}: ${result.errors.join('; ')}`)
    return { ...result, metadata: { issues: result.issues } }
  }
  if (scheme === 's0-pr960-ideal') {
    if (!new Set(['police-chase', 'perfume-orbit', 'courtyard-standoff']).has(card.id))
      throw new Error(`s0-pr960-ideal only supports benchmark cards; received ${card.id}`)
    prompt =
      card.id === 'police-chase'
        ? 'Shot 1: wide establishing of the police car chasing the getaway car down the street, follow the getaway car 4s. Shot 2: medium shot beside the police car, pan right with it 3s. Shot 3: close-up on the driver, push in 2s.'
        : card.id === 'perfume-orbit'
          ? 'Shot 1: orbit 360 deg around the perfume bottle on the round pedestal, linear, 8s. Shot 2: push in 1.2m to the bottle cap, ease out, 3s.'
          : 'Shot 1: wide shot, the woman walks across the courtyard toward the gate, follow the woman from behind-left 4s. Shot 2: two-shot of the guard and the woman at the gate, static 4s. Shot 3: close-up of the woman hand behind her back, then switch to the guard over-the-shoulder, slow push in 0.5m 4s.'
  }
  try {
    const mod = await importPr960Plan()
    const plan = mod.normalizeDirectorPrompt(prompt)
    return { project: mod.buildDirectorProjectFromPlan(plan).project }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${scheme} adapter failed for ${card.id}: ${message}`, { cause: error })
  }
}

export function mutateOracle(
  baseProject: DirectorProject,
  mutation:
    | 'half-orbit'
    | 'out-of-frame'
    | 'missing-shot'
    | 'axis-cross'
    | 'no-sidestep'
    | 'no-action'
    | 'unmatched-actor'
    | 'reverse-direction',
): DirectorProject {
  const project = JSON.parse(JSON.stringify(baseProject)) as DirectorProject
  const scene = project.scenes[0]
  if (mutation === 'half-orbit') {
    const camera = scene.cameras.find((item) => item.motionTrajectory && item.motionTrajectory.length >= 3)
    if (camera?.motionTrajectory)
      camera.motionTrajectory = camera.motionTrajectory.slice(
        0,
        Math.max(2, Math.floor(camera.motionTrajectory.length / 3)),
      )
  }
  if (mutation === 'out-of-frame') {
    const object = scene.objects.find(
      (item) => item.type === 'character' || item.type === 'cylinder' || item.type === 'cube',
    )
    if (object) {
      object.position.x = 30
      if (object.motionTrajectory)
        object.motionTrajectory = object.motionTrajectory.map((waypoint) => ({ ...waypoint, x: 30 }))
    }
  }
  if (mutation === 'missing-shot') {
    scene.cameras = scene.cameras.slice(0, Math.max(1, scene.cameras.length - 1))
    scene.timelineTrackOrder = scene.cameras.map((camera) => camera.id)
  }
  if (mutation === 'axis-cross') {
    const camera = scene.cameras[0]
    if (camera?.motionTrajectory)
      for (const waypoint of camera.motionTrajectory) {
        waypoint.x = -waypoint.x
        waypoint.z = -waypoint.z
      }
  }
  if (mutation === 'no-sidestep') {
    const object = scene.objects.find((item) => item.id === 'guard')
    if (object) {
      object.position.x = 6
      if (object.motionTrajectory)
        object.motionTrajectory = object.motionTrajectory.map((waypoint) => ({ ...waypoint, x: 6 }))
    }
  }
  if (mutation === 'no-action')
    for (const object of scene.objects) {
      object.motionTrajectory = undefined
      object.trajectoryClips = undefined
      object.actionClips = undefined
    }
  if (mutation === 'unmatched-actor')
    for (const object of scene.objects)
      if (object.type === 'character' || object.type === 'cylinder') {
        object.id = `unknown-${object.id}`
        object.name = 'unnamed'
      }
  if (mutation === 'reverse-direction') {
    const camera = scene.cameras[0]
    const points = camera?.motionTrajectory
    if (points && points.length > 1) {
      const reversed = [...points].reverse()
      camera.motionTrajectory = points.map((waypoint, index) => ({
        ...waypoint,
        x: reversed[index].x,
        y: reversed[index].y,
        z: reversed[index].z,
        yaw: reversed[index].yaw,
        pitch: reversed[index].pitch,
        roll: reversed[index].roll,
      }))
    }
  }
  return project
}
