/**
 * [INPUT]: directorTypes / directorProject / cameraLens / vec3
 * [OUTPUT]: typed natural-language DirectorPlan, deterministic ids, whitebox project builder,
 *           semantic camera-track compiler, and preview application with last-playable preservation
 * [POS]: the P0 plan boundary. It is deliberately pure so prompt normalization and validation can
 *        run before a DirectorStore transaction; the existing scene, timeline, preview and MP4 paths
 *        consume the project it produces.
 */
import { syncFocalLength } from './cameraLens'
import { cloneDirectorProject, createDefaultProject } from './directorProject'
import type { DirectorCamera, DirectorObject, DirectorProject, Vec3, Waypoint, TrajectoryClip } from './directorTypes'
import { lookAtAngles } from './vec3'

export const DIRECTOR_PLAN_VERSION = 1 as const
export const DIRECTOR_PLAN_MAX_SHOTS = 3
export const DIRECTOR_PLAN_MIN_DURATION = 1 / 30
export const DIRECTOR_PLAN_MAX_DURATION = 60

export type DirectorMotionKind = 'push' | 'pull' | 'pan' | 'tilt' | 'orbit' | 'follow' | 'target_switch'
export type DirectorEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
export type DirectorPlanIssueCode =
  | 'empty_prompt'
  | 'too_many_shots'
  | 'invalid_duration'
  | 'unknown_target'
  | 'invalid_motion'

export type DirectorPlanIssue = {
  code: DirectorPlanIssueCode
  message: string
  action: string
  shotId?: string
  motionId?: string
}

export type DirectorPlanEntity = {
  id: string
  name: string
  type: 'character' | 'cube' | 'sphere' | 'cylinder' | 'plane'
  position: Vec3
  scale: Vec3
}

export type DirectorLookAt = { type: 'entity'; entityId: string } | { type: 'point'; point: Vec3 }

export type DirectorCameraMotion = {
  id: string
  kind: DirectorMotionKind
  startTime: number
  duration: number
  easing: DirectorEasing
  amount: number
  lookAt?: DirectorLookAt
  fromTargetId?: string
  toTargetId?: string
}

export type DirectorShot = {
  id: string
  order: number
  name: string
  startTime: number
  duration: number
  subjectIds: string[]
  cameraName: string
  motions: DirectorCameraMotion[]
}

export type DirectorPlan = {
  version: typeof DIRECTOR_PLAN_VERSION
  prompt: string
  scene: { id: string; name: string; entities: DirectorPlanEntity[]; skyColor: string }
  shots: DirectorShot[]
  timeline: { duration: number; shotIds: string[] }
  issues: DirectorPlanIssue[]
}

export type CameraTrackCompilation = {
  cameraId: string
  clips: TrajectoryClip[]
  waypoints: Waypoint[]
  issues: DirectorPlanIssue[]
}

export type DirectorPlanBuild = {
  accepted: boolean
  plan: DirectorPlan
  project: DirectorProject
  cameraId: string
  track: CameraTrackCompilation
  status: DirectorPreviewStatus
}

export type DirectorPreviewStatus =
  | { phase: 'playable'; message: string; action: 'preview' | 'edit' }
  | {
      phase: 'error'
      message: string
      action: 'edit_prompt' | 'choose_target' | 'shorten_motion'
      code: DirectorPlanIssueCode
    }

/** Stable, process-independent id. Never use Date.now/random for plan-owned entities. */
export function stableDirectorId(kind: string, seed: string): string {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `dplan-${kind}-${(hash >>> 0).toString(36)}`
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cleanPrompt(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function durationFrom(text: string): number {
  const values = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:s|sec(?:onds?)?|秒)/gi)].map((match) => Number(match[1]))
  return values.length > 0
    ? clamp(
        values.reduce((sum, value) => sum + value, 0),
        DIRECTOR_PLAN_MIN_DURATION,
        DIRECTOR_PLAN_MAX_DURATION,
      )
    : 4
}

function splitShots(prompt: string): string[] {
  const marked = prompt
    .split(/(?=(?:shot|scene|镜头|镜)\s*\d+\s*[:：.)]?)/i)
    .map((part) => part.replace(/^(?:shot|scene|镜头|镜)\s*\d+\s*[:：.)]?\s*/i, '').trim())
    .filter(Boolean)
  if (marked.length > 1) return marked
  return prompt
    .split(/\s*(?:;|；|\.|。|!|！|\?|？)\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function primitiveFor(name: string): DirectorPlanEntity['type'] {
  if (/\b(?:person|character|actor|hero|woman|man)\b|人物|角色|主角|演员/i.test(name)) return 'character'
  if (/\b(?:ball|sphere)\b|球/i.test(name)) return 'sphere'
  if (/\b(?:cylinder|pillar|column)\b|柱/i.test(name)) return 'cylinder'
  if (/\b(?:plane|ground|floor)\b|地面/i.test(name)) return 'plane'
  return 'cube'
}

function entityNames(prompt: string): string[] {
  const candidates: string[] = []
  const add = (value: string) => {
    const name = value.trim().replace(/^(?:a|an|the)\s+/i, '')
    if (!name || candidates.some((item) => item.toLowerCase() === name.toLowerCase())) return
    candidates.push(name)
  }
  for (const match of prompt.matchAll(/(?:a|an|the)\s+([a-z][a-z0-9_-]{2,24})/gi)) add(match[1])
  for (const match of prompt.matchAll(/([\u4e00-\u9fff]{2,8})(?:角色|人物|主角)/g)) add(match[1])
  if (candidates.length === 0) {
    if (/\b(?:two|2)\s+(?:people|characters|actors)\b|两(?:个)?(?:人|角色)/i.test(prompt)) {
      add('Character A')
      add('Character B')
    } else add(/\b(?:character|person|hero|woman|man)\b|人物|角色/i.test(prompt) ? 'Character' : 'Subject')
  }
  return candidates.slice(0, 8)
}

function targetFor(text: string, entities: DirectorPlanEntity[], fallback: string): string {
  const lower = text.toLowerCase()
  return entities.find((entity) => lower.includes(entity.name.toLowerCase()))?.id ?? fallback
}

function motionFrom(
  text: string,
  index: number,
  shotId: string,
  entities: DirectorPlanEntity[],
  shotStart: number,
  cursor: number,
): DirectorCameraMotion[] {
  const parts = text
    .split(/\s*(?:\bthen\b|\band\b|,|;|，|、|并且|然后)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean)
  const segments = parts.length > 0 ? parts : [text]
  const patterns: Array<[DirectorMotionKind, RegExp, number]> = [
    ['target_switch', /(?:target\s*switch|switch\s+to|cut\s+to|切换|转向|切到)/i, 0],
    ['orbit', /(?:orbit|arc|circle|环绕|绕)/i, 90],
    ['follow', /(?:follow|tracking|跟随|追踪)/i, 0],
    ['push', /(?:push(?:\s+in)?|dolly\s+in|推进|推近)/i, 1.5],
    ['pull', /(?:pull(?:\s+out)?|dolly\s+out|拉远|后拉)/i, 1.5],
    ['pan', /(?:pan|truck|横移|摇摄)/i, 1],
    ['tilt', /(?:tilt|crane|俯仰|升降)/i, 12],
  ]
  let elapsed = cursor
  const motions: DirectorCameraMotion[] = []
  for (const [segmentIndex, segment] of segments.entries()) {
    const found = patterns.find(([, pattern]) => pattern.test(segment))
    if (!found) continue
    const [kind, , defaultAmount] = found
    const target = targetFor(segment, entities, entities[0].id)
    const amountMatch = segment.match(/(-?\d+(?:\.\d+)?)\s*(?:m|米|deg|°|度)(?!\w)/i)
    const amount = amountMatch ? Number(amountMatch[1]) : defaultAmount
    const direction = /(?:left|down|back|逆时针|左|下|后)/i.test(segment) ? -1 : 1
    const explicitDuration = /\d+(?:\.\d+)?\s*(?:s|sec(?:onds?)?|秒)/i.test(segment)
    const duration = explicitDuration ? durationFrom(segment) : segments.length === 1 ? durationFrom(text) : 1
    const targetSwitch =
      kind === 'target_switch' ? (entities.find((entity) => entity.id !== target)?.id ?? target) : undefined
    motions.push({
      id: stableDirectorId('motion', `${shotId}:${index}:${segmentIndex}:${kind}:${segment}`),
      kind,
      startTime: shotStart + elapsed,
      duration,
      easing: /linear|匀速/i.test(segment)
        ? 'linear'
        : /ease\s*in(?!\s*out)|加速/i.test(segment)
          ? 'ease_in'
          : /ease\s*out|减速/i.test(segment)
            ? 'ease_out'
            : 'ease_in_out',
      amount: finite(Math.abs(amount) * direction, defaultAmount * direction),
      lookAt: { type: 'entity', entityId: kind === 'target_switch' ? targetSwitch! : target },
      fromTargetId: kind === 'target_switch' ? target : undefined,
      toTargetId: targetSwitch,
    })
    elapsed += duration
  }
  return motions
}

/** Normalize a short prompt into a bounded one-to-three-shot typed plan. */
export function normalizeDirectorPrompt(input: string): DirectorPlan {
  const prompt = cleanPrompt(input)
  const issues: DirectorPlanIssue[] = []
  const seed = prompt || 'empty'
  const sceneId = stableDirectorId('scene', seed)
  const names = entityNames(prompt)
  const entities: DirectorPlanEntity[] = names.map((name, index) => ({
    id: stableDirectorId('entity', `${seed}:${name}:${index}`),
    name,
    type: primitiveFor(name),
    position: { x: (index - (names.length - 1) / 2) * 1.5, y: primitiveFor(name) === 'character' ? 0 : 0.5, z: 0 },
    scale: primitiveFor(name) === 'character' ? { x: 1, y: 1, z: 1 } : { x: 1, y: 1, z: 1 },
  }))
  if (!prompt)
    issues.push({
      code: 'empty_prompt',
      message: 'Describe a scene or camera move first.',
      action: 'Add a subject, setting, or camera action.',
    })
  const rawShots = splitShots(prompt)
  if (rawShots.length > DIRECTOR_PLAN_MAX_SHOTS)
    issues.push({
      code: 'too_many_shots',
      message: `Use at most ${DIRECTOR_PLAN_MAX_SHOTS} shots.`,
      action: 'Combine the extra shot descriptions.',
    })
  const shots: DirectorShot[] = []
  let time = 0
  for (const [index, text] of rawShots.slice(0, DIRECTOR_PLAN_MAX_SHOTS).entries()) {
    const shotId = stableDirectorId('shot', `${seed}:${index}:${text}`)
    const motions = motionFrom(text, 0, shotId, entities, time, 0)
    const duration = clamp(
      Math.max(
        durationFrom(text),
        motions.reduce((sum, motion) => sum + motion.duration, 0),
      ),
      DIRECTOR_PLAN_MIN_DURATION,
      DIRECTOR_PLAN_MAX_DURATION,
    )
    shots.push({
      id: shotId,
      order: index,
      name: `Shot ${index + 1}`,
      startTime: time,
      duration,
      subjectIds: [entities[0].id],
      cameraName: `Plan Camera ${index + 1}`,
      motions,
    })
    time += duration
  }
  if (shots.length === 0 && prompt) {
    const shotId = stableDirectorId('shot', `${seed}:0`)
    shots.push({
      id: shotId,
      order: 0,
      name: 'Shot 1',
      startTime: 0,
      duration: 4,
      subjectIds: [entities[0].id],
      cameraName: 'Plan Camera 1',
      motions: [],
    })
    time = 4
  }
  return {
    version: DIRECTOR_PLAN_VERSION,
    prompt,
    scene: {
      id: sceneId,
      name: prompt ? prompt.slice(0, 48) : 'Untitled Director Plan',
      entities,
      skyColor: '#1a1a1a',
    },
    shots,
    timeline: { duration: clamp(time, 0, DIRECTOR_PLAN_MAX_DURATION), shotIds: shots.map((shot) => shot.id) },
    issues,
  }
}

function pointFor(entity: DirectorPlanEntity | undefined): Vec3 {
  return entity
    ? { x: entity.position.x, y: entity.position.y + (entity.type === 'character' ? 1.5 : 0.5), z: entity.position.z }
    : { x: 0, y: 1, z: 0 }
}

function cameraPose(position: Vec3, target: Vec3): { position: Vec3; yaw: number; pitch: number; roll: number } {
  const angles = lookAtAngles(position, target)
  return { position, yaw: angles.yaw, pitch: angles.pitch, roll: angles.roll }
}

function cameraMotionEndpoint(start: Waypoint, motion: DirectorCameraMotion, target: Vec3): Waypoint {
  const progress = motion.kind === 'push' ? 1 : motion.kind === 'pull' ? -1 : 0
  let position = { x: start.x, y: start.y, z: start.z }
  if (motion.kind === 'push' || motion.kind === 'pull') {
    const direction = { x: target.x - start.x, y: target.y - start.y, z: target.z - start.z }
    const length = Math.hypot(direction.x, direction.y, direction.z) || 1
    const distance = motion.amount * progress
    position = {
      x: start.x + (direction.x / length) * distance,
      y: start.y + (direction.y / length) * distance,
      z: start.z + (direction.z / length) * distance,
    }
  } else if (motion.kind === 'pan') {
    position.x += motion.amount
  } else if (motion.kind === 'tilt') {
    position.y += motion.amount * 0.02
  } else if (motion.kind === 'orbit') {
    const dx = start.x - target.x
    const dz = start.z - target.z
    const angle = (motion.amount * Math.PI) / 180
    position = {
      x: target.x + dx * Math.cos(angle) - dz * Math.sin(angle),
      y: start.y,
      z: target.z + dx * Math.sin(angle) + dz * Math.cos(angle),
    }
  }
  const rotation = cameraPose(position, target)
  return {
    ...start,
    ...position,
    ...rotation,
    time: start.time + motion.duration,
    frameIndex: Math.round((start.time + motion.duration) * 30),
    lookAtObjectId: motion.lookAt?.type === 'entity' ? motion.lookAt.entityId : undefined,
    progress: 1,
    easing: motion.easing,
  }
}

/** Compile semantic camera motions into the existing editable trajectory contract. */
export function compileDirectorCameraTrack(
  plan: DirectorPlan,
  cameraId = stableDirectorId('camera', plan.scene.id),
): CameraTrackCompilation {
  const entityById = new Map(plan.scene.entities.map((entity) => [entity.id, entity]))
  const issues = [...plan.issues]
  const clips: TrajectoryClip[] = []
  const waypoints: Waypoint[] = []
  let position: Vec3 = { x: 0, y: 1.6, z: 4.5 }
  for (const shot of plan.shots) {
    const clipStart = shot.startTime
    const clipEnd = shot.startTime + shot.duration
    const clipId = stableDirectorId('clip', `${plan.scene.id}:${shot.id}`)
    clips.push({
      id: clipId,
      startTime: clipStart,
      endTime: clipEnd,
      startFrame: Math.round(clipStart * 30),
      endFrame: Math.round(clipEnd * 30),
    })
    let targetId = shot.subjectIds[0] ?? plan.scene.entities[0]?.id
    if (targetId && !entityById.has(targetId)) {
      issues.push({
        code: 'unknown_target',
        message: 'Shot subject is not in the scene.',
        action: 'Choose an existing scene entity as the shot subject.',
        shotId: shot.id,
      })
      targetId = plan.scene.entities[0]?.id
    }
    let target = pointFor(entityById.get(targetId))
    let start: Waypoint = {
      id: stableDirectorId('waypoint', `${clipId}:0`),
      ...position,
      ...cameraPose(position, target),
      time: clipStart,
      frameIndex: Math.round(clipStart * 30),
      clipId,
      progress: 0,
      lookAtObjectId: targetId,
    }
    waypoints.push(start)
    for (const [motionIndex, motion] of shot.motions.entries()) {
      if (!Number.isFinite(motion.duration) || motion.duration < DIRECTOR_PLAN_MIN_DURATION) {
        issues.push({
          code: 'invalid_duration',
          message: 'Camera motion duration must be at least one frame.',
          action: 'Set a duration of 0.03 seconds or longer.',
          shotId: shot.id,
          motionId: motion.id,
        })
        continue
      }
      if (start.time + motion.duration > clipEnd + 1 / 300) {
        issues.push({
          code: 'invalid_duration',
          message: 'Camera motion extends past the shot duration.',
          action: 'Shorten the motion or lengthen the shot.',
          shotId: shot.id,
          motionId: motion.id,
        })
        continue
      }
      const nextTargetId = motion.toTargetId ?? (motion.lookAt?.type === 'entity' ? motion.lookAt.entityId : targetId)
      if (!entityById.has(nextTargetId)) {
        issues.push({
          code: 'unknown_target',
          message: 'Camera target is not in the scene.',
          action: 'Choose an existing scene entity as the target.',
          shotId: shot.id,
          motionId: motion.id,
        })
        continue
      }
      targetId = nextTargetId
      target = pointFor(entityById.get(targetId))
      const next = cameraMotionEndpoint(start, motion, target)
      next.id = stableDirectorId('waypoint', `${clipId}:${motionIndex + 1}:${motion.id}`)
      next.clipId = clipId
      next.progress = clamp((next.time - clipStart) / Math.max(shot.duration, DIRECTOR_PLAN_MIN_DURATION), 0, 1)
      next.lookAtObjectId = targetId
      waypoints.push(next)
      start = next
    }
    if (start.time < clipEnd) {
      const final = {
        ...start,
        id: stableDirectorId('waypoint', `${clipId}:end`),
        time: clipEnd,
        frameIndex: Math.round(clipEnd * 30),
        progress: 1,
        clipId,
        lookAtObjectId: targetId,
      }
      waypoints.push(final)
      start = final
    }
    position = { x: start.x, y: start.y, z: start.z }
  }
  return { cameraId, clips, waypoints: waypoints.sort((a, b) => a.time - b.time), issues }
}

function objectsForPlan(plan: DirectorPlan): DirectorObject[] {
  return plan.scene.entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    type: entity.type,
    position: { ...entity.position },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { ...entity.scale },
    visible: true,
    locked: false,
  }))
}

/** Build a DirectorProject that existing DirectorCanvas/Timeline/MP4 code can play and edit. */
export function buildDirectorProjectFromPlan(plan: DirectorPlan, baseProject?: DirectorProject): DirectorPlanBuild {
  const project = baseProject ? cloneDirectorProject(baseProject) : createDefaultProject(plan.scene.name)
  const scene = project.scenes.find((candidate) => candidate.id === project.activeSceneId) ?? project.scenes[0]
  scene.id = plan.scene.id
  scene.name = plan.scene.name
  scene.objects = objectsForPlan(plan)
  scene.cameras = []
  scene.lights = []
  scene.timelineTrackOrder = []
  scene.timelineTrackPins = []
  scene.timelineTrackFolds = []
  scene.sceneConfig.skyColor = plan.scene.skyColor
  const cameraId = stableDirectorId('camera', plan.scene.id)
  const track = compileDirectorCameraTrack(plan, cameraId)
  const firstTarget = pointFor(plan.scene.entities[0])
  const cameraPoseValue = cameraPose({ x: 0, y: 1.6, z: 4.5 }, firstTarget)
  const lastTargetId = track.waypoints.at(-1)?.lookAtObjectId ?? plan.scene.entities[0]?.id
  const followsTarget = plan.shots.some((shot) => shot.motions.some((motion) => motion.kind === 'follow'))
  const camera: DirectorCamera = syncFocalLength({
    id: cameraId,
    name: plan.shots[0]?.cameraName ?? 'Plan Camera',
    ...cameraPoseValue,
    fov: 50,
    focalLengthMm: 0,
    showRayHelper: true,
    lookAtType: 'object',
    lookAtObjectId: lastTargetId,
    ...(followsTarget ? { rigType: 'follow' as const } : {}),
    motionTrajectory: track.waypoints,
    trajectoryClips: track.clips,
    inTimeline: track.clips.length > 0,
  })
  scene.cameras.push(camera)
  scene.timelineTrackOrder.push(camera.id)
  scene.timelineTrackOrder.push(...scene.objects.map((object) => object.id))
  project.activeSceneId = scene.id
  project.version = 2
  const accepted = track.issues.length === 0
  const issue = track.issues[0]
  const status: DirectorPreviewStatus = accepted
    ? { phase: 'playable', message: 'Director preview is ready.', action: 'preview' }
    : {
        phase: 'error',
        message: issue.message,
        action:
          issue.code === 'unknown_target'
            ? 'choose_target'
            : issue.code === 'invalid_duration'
              ? 'shorten_motion'
              : 'edit_prompt',
        code: issue.code,
      }
  return { accepted, plan, project, cameraId, track, status }
}

/** Atomic preview entry point: invalid updates never replace the last playable project. */
export function applyDirectorPrompt(previous: DirectorProject, prompt: string): DirectorPlanBuild {
  const plan = normalizeDirectorPrompt(prompt)
  const next = buildDirectorProjectFromPlan(plan, previous)
  if (!next.accepted) return { ...next, project: previous }
  return next
}
