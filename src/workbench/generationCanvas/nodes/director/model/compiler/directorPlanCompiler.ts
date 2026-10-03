import { normalizeAiScene } from '../aiScene'
import { createDefaultProject } from '../directorProject'
import { distanceForShotSize, measureContinuity, sampleDirectorProject, type AnchorSpec, type EvalShotSize, type ShotLadder } from '../directorEvalMeasurement'
import type { DirectorCamera, DirectorObject, DirectorProject, Vec3, Waypoint } from '../directorTypes'
import { findActionEntry } from '../actionLibrary'
import { lookAtAngles } from '../vec3'
import { directorPlanSchema, type DirectorPlan, type DirectorPlanActor, type DirectorPlanShot } from '../plan/directorPlanSchema'
import { buildS1TemplateObjects } from './s1SceneTemplates'

const FPS = 30
const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
const add = (a: Vec3, b: Vec3): Vec3 => v(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a: Vec3, b: Vec3): Vec3 => v(a.x - b.x, a.y - b.y, a.z - b.z)
const hash = (input: string): string => { let h = 2166136261; for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }
const clip = (id: string, start: number, end: number) => ({ id, startTime: start, endTime: end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS) })
const wp = (id: string, position: Vec3, target: Vec3, time: number, fov = 45): Waypoint => ({ id, ...position, ...lookAtAngles(position, target), time, frameIndex: Math.round(time * FPS), fov })
const entityWp = (id: string, position: Vec3, time: number, yaw = 0): Waypoint => ({ id, ...position, yaw, pitch: 0, roll: 0, time, frameIndex: Math.round(time * FPS) })
function positionAt(object: DirectorObject, time: number): Vec3 {
  const points = [...(object.motionTrajectory ?? [])].sort((a, b) => a.time - b.time)
  if (!points.length || time <= points[0].time) return points[0] ? v(points[0].x, points[0].y, points[0].z) : object.position
  const last = points.at(-1)!; if (time >= last.time) return v(last.x, last.y, last.z)
  const next = points.find(point => point.time >= time)!, previous = points[points.indexOf(next) - 1], ratio = (time - previous.time) / Math.max(1e-6, next.time - previous.time)
  return v(previous.x + (next.x - previous.x) * ratio, previous.y + (next.y - previous.y) * ratio, previous.z + (next.z - previous.z) * ratio)
}

export type DirectorCompileIssue = { kind: 'unknown-ref' | 'overlap' | 'measurement' | 'missing_asset'; message: string; time?: number; objectId?: string; actorId?: string; assetId?: string }
export type DirectorCompileResult = { ok: true; project: DirectorProject; actorMap: Record<string, string>; anchors: Record<string, AnchorSpec>; issues: DirectorCompileIssue[]; duration: number } | { ok: false; errors: string[] }

function actorObject(actor: DirectorPlanActor, position: Vec3, id: string): DirectorObject {
  const isPerson = actor.kind === 'person'
  const isVehicle = actor.kind === 'vehicle'
  return { id, name: isVehicle ? `${actor.desc}_car` : actor.desc, type: isPerson ? 'character' : isVehicle ? 'cube' : actor.kind === 'product' ? 'cylinder' : 'cube', position, rotation: v(), scale: isPerson ? v(1, 1, 1) : isVehicle ? v(1.8, 1, 4) : actor.kind === 'product' ? v(1.3, 1.3, 1.3) : v(1, 1, 1), visible: true, locked: false, posePreset: isPerson ? 'standing' : undefined }
}

function positionActors(plan: DirectorPlan, pieces: Map<string, Vec3>): { positions: Map<string, Vec3>; issues: DirectorCompileIssue[] } {
  const positions = new Map<string, Vec3>(), issues: DirectorCompileIssue[] = []
  const occupied = new Set<string>()
  for (const [index, actor] of plan.actors.entries()) {
    const ref = pieces.get(actor.placement.ref) ?? positions.get(actor.placement.ref)
    if (!ref) { issues.push({ kind: 'unknown-ref', objectId: actor.id, message: `unknown placement ref ${actor.placement.ref}` }); continue }
    const relation = actor.placement.relation
    const ring = index + 1
    const offset = relation === 'left_of' ? v(-1.8, 0, 0) : relation === 'right_of' ? v(1.8, 0, 0) : relation === 'in_front_of' ? v(0, 0, 1.8) : relation === 'behind' ? v(0, 0, -1.8) : relation === 'near' ? v((ring % 2 ? 1 : -1) * 1.2, 0, 1.2) : relation === 'on' ? v(0, 0.75, 0) : relation === 'between' ? v(0, 0, 0) : relation === 'along' ? v(ring * 1.5, 0, 0) : v(0, 0, 0)
    const p = add(ref, offset)
    p.y = actor.kind === 'person' || actor.kind === 'vehicle' || actor.kind === 'prop' ? 0 : 0.65
    const key = `${Math.round(p.x * 10)}:${Math.round(p.z * 10)}`
    if (occupied.has(key)) { p.x += 0.8; p.z += 0.8; issues.push({ kind: 'overlap', objectId: actor.id, message: `resolved placement overlap for ${actor.id}` }) }
    occupied.add(key); positions.set(actor.id, p)
  }
  return { positions, issues }
}

function materializeDressing(plan: DirectorPlan, seed: string): DirectorObject[] {
  if (!plan.scene.dressing) return []
  const normalized = normalizeAiScene(plan.scene.dressing, `${plan.scene.tags.join('-') || 's1'} dressing`)
  return normalized.groups.flatMap((group, gi) => group.elements.map((element, ei) => ({ id: `dress-${seed}-${gi}-${ei}`, name: element.name, type: element.type, position: element.position, rotation: element.rotation, scale: element.scale, color: element.color, roughness: element.roughness, metalness: element.metalness, opacity: element.opacity, wireframe: element.wireframe, flatShading: element.flatShading, visible: true, locked: true, isAuxiliary: true })))
}

function applyBlocking(plan: DirectorPlan, objects: DirectorObject[], actorMap: Record<string, string>, positions: Map<string, Vec3>, duration: number, issues: DirectorCompileIssue[]): void {
  const byPlanId = (id?: string) => id ? objects.find(o => o.id === actorMap[id]) : undefined
  for (const action of plan.blocking) {
    const actor = byPlanId(action.actor); if (!actor) continue
    const start = action.window[0], end = Math.min(duration, action.window[1]), target = byPlanId(action.target)
    const from = positions.get(action.actor) ?? actor.position
    const to = target?.position ?? from
    const points: Waypoint[] = [entityWp(`${actor.id}-${action.verb}-start`, from, start)]
    if (action.verb === 'walk_to' || action.verb === 'run_to' || action.verb === 'drive_along' || action.verb === 'chase') points.push(entityWp(`${actor.id}-${action.verb}-end`, to, end))
    else if (action.verb === 'sidestep') points.push(entityWp(`${actor.id}-sidestep-end`, add(from, v(target ? (to.x >= from.x ? 1 : -1) : 1, 0, 0)), end))
    else points.push(entityWp(`${actor.id}-${action.verb}-end`, from, end, action.verb === 'turn_to' && target ? Math.atan2(to.x - from.x, to.z - from.z) * 180 / Math.PI : 0))
    actor.motionTrajectory = [...(actor.motionTrajectory ?? []), ...points].sort((a, b) => a.time - b.time)
    actor.trajectoryClips = [...(actor.trajectoryClips ?? []), clip(`${actor.id}-${action.verb}-${start}`, start, end)]
    if (actor.type === 'character') {
      const chosen = action.action ?? (action.verb === 'run_to' || action.verb === 'chase' ? 'running' : action.verb === 'walk_to' || action.verb === 'drive_along' || action.verb === 'sidestep' ? 'standard_walk' : 'standing_idle')
      const entry = findActionEntry(chosen)
      if (entry) {
        actor.actionClips = [...(actor.actionClips ?? []), { id: `${actor.id}-action-${start}`, name: entry.id, clipType: 'action', actionPose: entry.id, startTime: start, endTime: end, startFrame: Math.round(start * FPS), endFrame: Math.round(end * FPS) }]
      } else {
        issues.push({ kind: 'missing_asset', actorId: action.actor, objectId: actor.id, assetId: chosen, message: `no action-library asset for ${chosen}; left the semantic action unmaterialized` })
      }
    }
  }
}

function angleOffset(angle: DirectorPlanShot['angle']): number {
  if (typeof angle === 'string') return ({ front: 0, three_quarter: 45, side: 90, side_rear: 135, back: 180 } as Record<string, number>)[angle]
  return 'over_shoulder' in angle ? 25 : 0
}

function solveCamera(shot: DirectorPlanShot, subject: DirectorObject, previous: Vec3 | undefined, id: string): DirectorCamera {
  const start = shot.window[0], end = shot.window[1], ladder: ShotLadder = subject.type === 'character' ? 'figure' : 'object', fov = 45
  const subjectHeight = subject.type === 'character' ? 1.75 : Math.max(0.4, subject.scale.y)
  const distance = distanceForShotSize(shot.size as EvalShotSize, subjectHeight, fov, ladder)
  const azimuth = angleOffset(shot.angle), height = shot.height === 'low' ? 0.65 : shot.height === 'high' ? 2.3 : shot.height === 'overhead' ? 4.2 : subject.position.y + (subject.type === 'character' ? 1.1 : 0.8)
  const subjectStart = positionAt(subject, start), subjectEndPosition = positionAt(subject, end)
  const target = add(subjectStart, v(0, subject.type === 'character' ? 0.9 : subject.scale.y / 2, 0))
  const endAngle = shot.move.kind === 'orbit_left' || shot.move.kind === 'arc_left' ? azimuth - (shot.move.amount ?? (shot.move.kind.startsWith('arc') ? 45 : 90)) : shot.move.kind === 'orbit_right' || shot.move.kind === 'arc_right' ? azimuth + (shot.move.amount ?? (shot.move.kind.startsWith('arc') ? 45 : 90)) : azimuth
  const amount = shot.move.amount ?? (shot.move.kind === 'push_in' || shot.move.kind === 'pull_out' ? distance * 0.35 : 2)
  const endRadius = shot.move.kind === 'push_in' ? Math.max(0.4, distance - amount) : shot.move.kind === 'pull_out' ? distance + amount : distance
  const startPosition = previous ?? v(target.x + Math.sin(azimuth * Math.PI / 180) * distance, height, target.z + Math.cos(azimuth * Math.PI / 180) * distance)
  let endPosition = v(target.x + Math.sin(endAngle * Math.PI / 180) * endRadius, height, target.z + Math.cos(endAngle * Math.PI / 180) * endRadius)
  if (shot.move.kind === 'crane_up' || shot.move.kind === 'crane_down') endPosition.y = height + (shot.move.kind === 'crane_up' ? amount : -amount)
  if (shot.move.kind === 'track_left' || shot.move.kind === 'track_right') endPosition = add(endPosition, v(shot.move.kind === 'track_left' ? -amount : amount, 0, 0))
  let targetEnd = target
  if (shot.move.kind === 'follow' && subject.motionTrajectory?.length) { const delta = sub(subjectEndPosition, subjectStart); endPosition = add(endPosition, delta); targetEnd = add(target, delta) }
  const endFov = shot.move.kind === 'zoom_in' ? Math.max(18, fov - (shot.move.amount ?? 10)) : shot.move.kind === 'zoom_out' ? Math.min(80, fov + (shot.move.amount ?? 10)) : fov
  const isOrbit = shot.move.kind === 'orbit_left' || shot.move.kind === 'orbit_right' || shot.move.kind === 'arc_left' || shot.move.kind === 'arc_right'
  const motionTrajectory = isOrbit
    ? Array.from({ length: 9 }, (_, index) => {
        const ratio = index / 8
        const angle = (azimuth + (endAngle - azimuth) * ratio) * Math.PI / 180
        const radius = distance + (endRadius - distance) * ratio
        const point = v(target.x + Math.sin(angle) * radius, height, target.z + Math.cos(angle) * radius)
        return wp(`${id}-orbit-${index}`, point, target, start + (end - start) * ratio, fov + (endFov - fov) * ratio)
      })
    : [wp(`${id}-start`, startPosition, target, start, fov), wp(`${id}-end`, endPosition, targetEnd, end, endFov)]
  return { id, name: shot.id, position: startPosition, yaw: 0, pitch: 0, roll: 0, fov, focalLengthMm: 35, motionTrajectory, trajectoryClips: [clip(`${id}-clip`, start, end)] }
}

export function compileDirectorPlan(input: unknown): DirectorCompileResult {
  const parsed = directorPlanSchema.safeParse(input)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) }
  const plan = parsed.data, seed = hash(JSON.stringify(plan)), project = createDefaultProject(plan.scene.tags.join(' / ') || 'S1 Director')
  const scene = project.scenes[0]; scene.id = `scene-${seed}`; project.activeSceneId = scene.id; scene.name = plan.scene.environment
  const templateObjects = plan.scene.template ? buildS1TemplateObjects(plan.scene.template) : []
  const pieces = new Map<string, Vec3>(templateObjects.map(o => [o.id, o.position]))
  for (const piece of plan.scene.setPieces) { const anchor = piece.relation?.ref ? pieces.get(piece.relation.ref) : undefined; const pos = anchor ? add(anchor, v(0, 0, 2 + pieces.size * 0.2)) : v((pieces.size % 3 - 1) * 2.5, 0, Math.floor(pieces.size / 3) * 2); const id = `piece-${seed}-${piece.id}`; templateObjects.push({ id, name: piece.kind, type: 'cube', position: pos, rotation: v(), scale: v(1.4, 1, 1.4), visible: true, locked: true, isAuxiliary: true }); pieces.set(piece.id, pos) }
  const placed = positionActors(plan, pieces), actorMap: Record<string, string> = {}, anchors: Record<string, AnchorSpec> = {}, actorObjects: DirectorObject[] = []
  for (const actor of plan.actors) { const id = `actor-${seed}-${actor.id}`; actorMap[actor.id] = id; const position = placed.positions.get(actor.id) ?? v(); const obj = actorObject(actor, position, id); actorObjects.push(obj); for (const [name, offset] of Object.entries(actor.anchors ?? {})) anchors[`${id}.${name}`] = { offset: { x: offset?.x ?? 0, y: offset?.y ?? 0.9, z: offset?.z ?? 0 }, size: v(0.18, 0.18, 0.18) } }
  scene.objects = [...templateObjects, ...materializeDressing(plan, seed), ...actorObjects]
  const duration = Math.max(...plan.shots.map(s => s.window[1]), ...plan.blocking.map(b => b.window[1]), 0)
  const issues: DirectorCompileIssue[] = [...placed.issues]
  applyBlocking(plan, actorObjects, actorMap, placed.positions, duration, issues)
  const cameras: DirectorCamera[] = []; let previous: Vec3 | undefined
  for (const shot of plan.shots) { const root = shot.subject.split('.')[0], subject = actorObjects.find(o => o.id === actorMap[root]); if (!subject) continue; const camera = solveCamera(shot, subject, shot.transitionIn === 'continuous' ? previous : undefined, `cam-${seed}-${shot.id}`); cameras.push(camera); scene.timelineTrackOrder.push(camera.id); previous = camera.motionTrajectory?.at(-1) ? v(camera.motionTrajectory.at(-1)!.x, camera.motionTrajectory.at(-1)!.y, camera.motionTrajectory.at(-1)!.z) : camera.position }
  scene.cameras = cameras
  scene.objects.forEach(object => { object.position.y = Math.max(0, object.position.y) })
  const measurement = sampleDirectorProject(project, { fps: FPS, duration, anchors }), continuity = measureContinuity(measurement, scene)
  issues.push(...continuity.map(item => ({ kind: 'measurement' as const, message: item.message, time: item.time, objectId: item.objectId })))
  return { ok: true, project, actorMap, anchors, issues, duration }
}
