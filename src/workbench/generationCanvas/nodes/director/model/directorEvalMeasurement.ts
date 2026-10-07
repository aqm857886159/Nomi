/**
 * [INPUT]: DirectorProject and existing pure trajectory/program-camera evaluators.
 * [OUTPUT]: deterministic frame samples, pinhole projections, shot-size and camera-motion recognition,
 *           and continuity checks for offline director evaluation. Zero React; object size / origin come from ./directorSpace (geometry-only three, no rendering).
 * [POS]: single owner of preview measurement; evals/director and future agent self-checks consume it.
 */
import type { DirectorCamera, DirectorObject, DirectorProject, DirectorScene, Vec3 } from './directorTypes'
import { evaluateCameraPose } from './cameraPoseEval'
import { evaluateSceneObjectPose } from './evaluatedSceneObject'
import { programCameraIdAt } from './programCamera'
import { scaledBounds } from './directorSpace'
import { sceneFrame, transformPoint, type SceneFrame } from './sceneObjectGraph'
import { forwardFromAngles, normalize, signedDeg, sub } from './vec3'
import { CAMERA_MOVES, EVAL_SHOT_SIZES, type CameraMove, type EvalShotSize } from '../../../../../../electron/shared/director/vocab'
import type { StagingShot } from '../agent/stagingVocab'

export type { EvalShotSize }

/**
 * Shot size is read from `heightRatio` = projected subject height / frame height (unclamped; >1 means the subject
 * runs past the frame edges, which is what medium and close shots are).
 *
 * Figure ladder (a whole character): the conventional "where does the frame cut the body" scale. With the head near
 * the top of frame the visible fraction of the body is ≈ 1/ratio, so: whole body (全景) ≈ 0.33–1.15, cut at the
 * waist/hips (中景) 1.15–2.3, chest (中近景) 2.3–3.6, shoulders (近景) 3.6–6, face (特写) 6–12, detail (大特写) ≥12;
 * a figure under a third of the frame height is 远景.
 * Object ladder (props, products, vehicles, and any anchored part such as `woman.hand` or `bottle.cap`): there is no
 * body to cut, so size follows how much of the frame the thing fills.
 */
export const FIGURE_SHOT_LADDER: readonly [number, EvalShotSize][] = [
  [0.33, '远景'],
  [1.15, '全景'],
  [2.3, '中景'],
  [3.6, '中近景'],
  [6, '近景'],
  [12, '特写'],
  [Infinity, '大特写'],
]
export const OBJECT_SHOT_LADDER: readonly [number, EvalShotSize][] = [
  [0.12, '远景'],
  [0.35, '全景'],
  [0.6, '中景'],
  [0.8, '中近景'],
  [1.1, '近景'],
  [2.5, '特写'],
  [Infinity, '大特写'],
]
export type ShotLadder = 'figure' | 'object'
const LADDERS: Record<ShotLadder, readonly [number, EvalShotSize][]> = {
  figure: FIGURE_SHOT_LADDER,
  object: OBJECT_SHOT_LADDER,
}
/** Distance below the top of a character's bounds that counts as "the head" for visibility. */
const HEAD_BELOW_TOP = 0.12
export const STAGING_SHOT_TO_EVAL: Record<StagingShot, EvalShotSize> = { wide: '全景', medium: '中景', close: '特写' }

export type AnchorSpec = { offset: Vec3; size: Vec3 }
/** `inFrame` = the subject's key point (head for a character, anchor or centre otherwise) is in front of the camera and inside the frame;
 * `contained` = the whole bounds fit inside the frame (only wide shots satisfy this, by definition). */
export type ProjectionBox = {
  x: number
  y: number
  width: number
  height: number
  heightRatio: number
  inFrame: boolean
  contained: boolean
  depth: number
}
export type AnchorSample = { projection: ProjectionBox; shotSize: EvalShotSize }
export type ObjectSample = {
  position: Vec3
  yaw: number
  projection?: ProjectionBox
  shotSize?: EvalShotSize
  anchors?: Record<string, AnchorSample>
  belowGround: boolean
}
export type CameraSample = { id: string; position: Vec3; yaw: number; pitch: number; roll: number; fov: number }
export type FrameSample = {
  frame: number
  time: number
  cameraId: string | null
  camera: CameraSample | null
  objects: Record<string, ObjectSample>
}
export type MeasurementOptions = {
  fps?: number
  duration?: number
  aspectRatio?: number
  anchors?: Record<string, AnchorSpec>
}
export type DirectorMeasurements = { fps: number; duration: number; frames: FrameSample[]; cuts: number[] }

const DEFAULT_FPS = 30
const DEFAULT_ASPECT = 16 / 9
const EPS = 1e-5
const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const mul = (a: Vec3, n: number): Vec3 => ({ x: a.x * n, y: a.y * n, z: a.z * n })
const distance = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
const sceneDuration = (scene: DirectorScene): number => {
  const ends: number[] = []
  for (const entity of [...scene.objects, ...scene.cameras]) {
    for (const c of entity.trajectoryClips ?? []) ends.push(c.endTime)
    for (const c of 'closeupClips' in entity ? (entity.closeupClips ?? []) : []) ends.push(c.endTime)
    for (const c of 'actionClips' in entity ? (entity.actionClips ?? []) : []) ends.push(c.endTime)
  }
  return ends.length ? Math.max(...ends) : 0
}

// 尺寸 / 原点 / 包围盒一律读 ./directorSpace（渲染真值，three Box3 量出来），这里不再抄表
function objectSize(object: DirectorObject): Vec3 {
  const size = scaledBounds(object).size
  return { x: Math.max(EPS, size.x), y: Math.max(EPS, size.y), z: Math.max(EPS, size.z) }
}
function objectCenter(scene: DirectorScene, object: DirectorObject, frame: SceneFrame): Vec3 {
  // frame 的基底已含 scale，所以这里只取单位 scale 下的包围盒中心
  const center = scaledBounds({ ...object, scale: { x: 1, y: 1, z: 1 } }).center
  return transformPoint(sceneFrame(scene.sceneConfig), transformPoint(frame, center))
}

function cameraBasis(camera: CameraSample): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = forwardFromAngles(camera.yaw, camera.pitch)
  const right = normalize(cross(forward, vec(0, 1, 0)))
  const up = normalize(cross(right, forward))
  return { forward, right, up }
}

export function projectPoint(
  camera: CameraSample,
  point: Vec3,
  aspectRatio = DEFAULT_ASPECT,
): { x: number; y: number; depth: number } {
  const { forward, right, up } = cameraBasis(camera)
  const d = sub(point, camera.position),
    depth = dot(d, forward),
    vertical = Math.max(1e-3, (camera.fov * Math.PI) / 360)
  return {
    x: 0.5 + dot(d, right) / Math.max(EPS, depth) / (2 * Math.tan(vertical) * aspectRatio),
    y: 0.5 - dot(d, up) / Math.max(EPS, depth) / (2 * Math.tan(vertical)),
    depth,
  }
}

export function projectBounds(
  camera: CameraSample,
  center: Vec3,
  size: Vec3,
  aspectRatio = DEFAULT_ASPECT,
  keyPoint: Vec3 = center,
): ProjectionBox {
  const { forward, right, up } = cameraBasis(camera)
  const half = mul(size, 0.5)
  const points: Vec3[] = []
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) points.push(add(center, vec(sx * half.x, sy * half.y, sz * half.z)))
  const vertical = Math.max(1e-3, (camera.fov * Math.PI) / 360)
  const tanV = Math.tan(vertical),
    tanH = tanV * aspectRatio
  const projected = points.map((point) => {
    const d = sub(point, camera.position)
    const depth = dot(d, forward)
    return {
      x: 0.5 + dot(d, right) / Math.max(EPS, depth) / (2 * tanH),
      y: 0.5 - dot(d, up) / Math.max(EPS, depth) / (2 * tanV),
      depth,
    }
  })
  const x0 = Math.min(...projected.map((p) => p.x)),
    x1 = Math.max(...projected.map((p) => p.x))
  const y0 = Math.min(...projected.map((p) => p.y)),
    y1 = Math.max(...projected.map((p) => p.y))
  const depth = Math.min(...projected.map((p) => p.depth))
  const key = sub(keyPoint, camera.position)
  const keyDepth = dot(key, forward)
  const keyX = 0.5 + dot(key, right) / Math.max(EPS, keyDepth) / (2 * tanH)
  const keyY = 0.5 - dot(key, up) / Math.max(EPS, keyDepth) / (2 * tanV)
  const inFrame = keyDepth > 0 && keyX >= -EPS && keyX <= 1 + EPS && keyY >= -EPS && keyY <= 1 + EPS
  const contained = depth > 0 && x0 >= -EPS && x1 <= 1 + EPS && y0 >= -EPS && y1 <= 1 + EPS
  // Size reads at the subject's own depth plane (how framing is judged on set), so the near face of a deep bounding box
  // cannot inflate a close shot; this also makes distanceForShotSize an exact inverse.
  const centerDepth = dot(sub(center, camera.position), forward)
  const heightRatio = centerDepth > EPS ? size.y / (centerDepth * 2 * tanV) : 0
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, heightRatio, inFrame, contained, depth }
}

export function shotSizeForHeight(heightRatio: number, ladder: ShotLadder = 'object'): EvalShotSize {
  for (const [threshold, size] of LADDERS[ladder]) if (heightRatio < threshold) return size
  return EVAL_SHOT_SIZES[EVAL_SHOT_SIZES.length - 1]
}

/** Inverse of the ladder: the band centre's height ratio for a size (geometric mean of its edges; open ends use the inner edge). */
export function heightRatioForShotSize(size: EvalShotSize, ladder: ShotLadder): number {
  const rows = LADDERS[ladder]
  const index = rows.findIndex(([, name]) => name === size)
  const upper = rows[index][0]
  const lower = index > 0 ? rows[index - 1][0] : upper / 2
  return Number.isFinite(upper) ? Math.sqrt(lower * upper) : lower * 1.5
}

/** Camera distance (along the view axis) that frames a subject of `subjectHeight` metres at `size` with a vertical `fovDeg`. */
export function distanceForShotSize(
  size: EvalShotSize,
  subjectHeight: number,
  fovDeg: number,
  ladder: ShotLadder,
): number {
  const ratio = heightRatioForShotSize(size, ladder)
  return subjectHeight / (ratio * 2 * Math.tan((fovDeg * Math.PI) / 360))
}

function cameraSample(scene: DirectorScene, camera: DirectorCamera, time: number): CameraSample {
  const evaluated = evaluateCameraPose(camera, scene, time)
  return {
    id: camera.id,
    position: evaluated.position,
    yaw: evaluated.rotation.y,
    pitch: evaluated.rotation.x,
    roll: evaluated.rotation.z,
    fov: evaluated.fov ?? camera.fov,
  }
}

function objectSample(
  scene: DirectorScene,
  object: DirectorObject,
  time: number,
  camera: CameraSample | null,
  aspectRatio: number,
  anchors?: Record<string, AnchorSpec>,
): ObjectSample {
  const evaluated = evaluateSceneObjectPose(scene.objects, object.id, time)
  const frame = evaluated?.frame
  const sceneWorld = frame ? transformPoint(sceneFrame(scene.sceneConfig), frame.position) : object.position
  const position = sceneWorld
  const originCenter = frame ? objectCenter(scene, object, frame) : position
  const anchor = anchors?.[object.id]
  const center =
    anchor && frame ? transformPoint(sceneFrame(scene.sceneConfig), transformPoint(frame, anchor.offset)) : originCenter
  const size = anchor?.size ?? objectSize(object)
  const figure = object.type === 'character' && !anchor
  const keyPoint = figure ? add(center, vec(0, size.y / 2 - HEAD_BELOW_TOP * Math.abs(object.scale.y), 0)) : center
  const projection = camera ? projectBounds(camera, center, size, aspectRatio, keyPoint) : undefined
  const shotSize = projection ? shotSizeForHeight(projection.heightRatio, figure ? 'figure' : 'object') : undefined
  const anchorSamples: Record<string, AnchorSample> = {}
  if (frame)
    for (const [key, spec] of Object.entries(anchors ?? {}))
      if (key.startsWith(`${object.id}.`)) {
        const anchorCenter = transformPoint(sceneFrame(scene.sceneConfig), transformPoint(frame, spec.offset))
        const anchorProjection = camera
          ? projectBounds(camera, anchorCenter, spec.size, aspectRatio, anchorCenter)
          : undefined
        if (anchorProjection)
          anchorSamples[key.slice(object.id.length + 1)] = {
            projection: anchorProjection,
            shotSize: shotSizeForHeight(anchorProjection.heightRatio, 'object'),
          }
      }
  return {
    position,
    yaw: evaluated?.yaw ?? object.rotation.y,
    projection,
    shotSize,
    anchors: Object.keys(anchorSamples).length ? anchorSamples : undefined,
    // 分组没有几何，量不出「在地面以下」（它的 1 米占位盒只是兜底，不是渲染真值）
    belowGround: object.type !== 'group' && center.y - size.y / 2 < -0.05,
  }
}

export function sampleDirectorProject(
  project: DirectorProject,
  options: MeasurementOptions = {},
): DirectorMeasurements {
  const scene = project.scenes.find((s) => s.id === project.activeSceneId) ?? project.scenes[0]
  if (!scene) return { fps: options.fps ?? DEFAULT_FPS, duration: options.duration ?? 0, frames: [], cuts: [] }
  const fps = Math.max(1, Math.round(options.fps ?? DEFAULT_FPS))
  const duration = Math.max(0, options.duration ?? sceneDuration(scene))
  const frames: FrameSample[] = []
  const count = Math.round(duration * fps)
  let previousCamera: string | null = null
  const cuts: number[] = []
  for (let frame = 0; frame <= count; frame++) {
    const time = frame / fps
    const cameraId = programCameraIdAt(time, scene.cameras, scene.timelineTrackOrder)
    if (previousCamera !== null && cameraId !== previousCamera) cuts.push(time)
    previousCamera = cameraId
    const camera = cameraId ? scene.cameras.find((item) => item.id === cameraId) : undefined
    const cameraState = camera ? cameraSample(scene, camera, time) : null
    const objects: Record<string, ObjectSample> = {}
    for (const object of scene.objects)
      objects[object.id] = objectSample(
        scene,
        object,
        time,
        cameraState,
        options.aspectRatio ?? DEFAULT_ASPECT,
        options.anchors,
      )
    frames.push({ frame, time, cameraId, camera: cameraState, objects })
  }
  return { fps, duration, frames, cuts }
}

export type MotionWindow = { start: number; end: number }
export type MotionRecognition = {
  move: CameraMove | 'follow' | 'pan' | 'tilt' | 'static'
  signedOrbitDeg: number
  distanceDelta: number
  linearSpeed: number
  angularSpeed: number
  jerkRms: number
  jump: boolean
  cameraDelta: Vec3
  yawDelta: number
  pitchDelta: number
  fovDelta: number
  heightRatioStart: number
  heightRatioEnd: number
  heightRatioRatio: number
  cameraTravel: number
  issues: string[]
}

function unwrapDelta(values: number[]): number[] {
  const out: number[] = []
  let total = 0
  for (let i = 1; i < values.length; i++) {
    const d = signedDeg(values[i] - values[i - 1])
    total += d
    out.push(total)
  }
  return out
}
export function recognizeCameraMotion(
  measurements: DirectorMeasurements,
  subjectId: string,
  window: MotionWindow,
): MotionRecognition {
  let frames = measurements.frames.filter((f) => f.time >= window.start - EPS && f.time <= window.end + EPS && f.camera)
  const cameraCounts = new Map<string, number>()
  for (const frame of frames)
    if (frame.cameraId) cameraCounts.set(frame.cameraId, (cameraCounts.get(frame.cameraId) ?? 0) + 1)
  const dominantCamera = [...cameraCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  if (dominantCamera) frames = frames.filter((f) => f.cameraId === dominantCamera)
  const first = frames[0],
    last = frames[frames.length - 1]
  if (!first?.camera || !last?.camera || frames.length < 2)
    return {
      move: 'static',
      signedOrbitDeg: 0,
      distanceDelta: 0,
      linearSpeed: 0,
      angularSpeed: 0,
      jerkRms: 0,
      jump: false,
      cameraDelta: vec(0, 0, 0),
      yawDelta: 0,
      pitchDelta: 0,
      fovDelta: 0,
      heightRatioStart: 0,
      heightRatioEnd: 0,
      heightRatioRatio: 1,
      cameraTravel: 0,
      issues: [],
    }
  const points = frames.map((f) => f.camera!.position),
    subjects = frames.map((f) => f.objects[subjectId]?.position ?? vec(0, 0, 0))
  const distances = frames.map((_, i) => distance(points[i], subjects[i]))
  const azimuth = frames.map(
    (_, i) => (Math.atan2(points[i].x - subjects[i].x, points[i].z - subjects[i].z) * 180) / Math.PI,
  )
  const orbit = unwrapDelta(azimuth).at(-1) ?? 0
  const distanceDelta = distances.at(-1)! - distances[0]
  const dt = Math.max(EPS, last.time - first.time)
  const cameraDelta = sub(points.at(-1)!, points[0]),
    subjectDelta = sub(subjects.at(-1)!, subjects[0])
  const cameraTravel = distance(points.at(-1)!, points[0])
  const verticalTravel = Math.abs(cameraDelta.y),
    horizontalTravel = Math.hypot(cameraDelta.x, cameraDelta.z)
  const coMotion =
    length(cameraDelta) > EPS &&
    length(subjectDelta) > EPS &&
    (cameraDelta.x * subjectDelta.x + cameraDelta.y * subjectDelta.y + cameraDelta.z * subjectDelta.z) /
      (length(cameraDelta) * length(subjectDelta)) >
      0.8
  const angularTravel = Math.hypot(
    signedDeg(last.camera.yaw - first.camera.yaw),
    last.camera.pitch - first.camera.pitch,
  )
  const heightRatios = frames.map((frame) => frame.objects[subjectId]?.projection?.heightRatio ?? 0)
  const heightRatioStart = heightRatios[0] ?? 0
  const heightRatioEnd = heightRatios.at(-1) ?? 0
  const heightRatioRatio = heightRatioStart > EPS ? heightRatioEnd / heightRatioStart : 1
  const fovDelta = last.camera.fov - first.camera.fov
  const issues: string[] = []
  const dollyTravel = cameraTravel >= 0.25
  const dollyDirection = distanceDelta < -0.05 ? 'in' : distanceDelta > 0.05 ? 'out' : undefined
  const zoomDirection = fovDelta < -0.5 ? 'in' : fovDelta > 0.5 ? 'out' : undefined
  if (dollyDirection && zoomDirection && dollyDirection !== zoomDirection) {
    issues.push('互相抵消：dolly 与反向 zoom 同时出现')
  }
  const accel: number[] = []
  const speeds: number[] = []
  for (let i = 1; i < points.length; i++)
    speeds.push(distance(points[i], points[i - 1]) / Math.max(EPS, frames[i].time - frames[i - 1].time))
  for (let i = 1; i < speeds.length; i++)
    accel.push((speeds[i] - speeds[i - 1]) / Math.max(EPS, frames[i + 1].time - frames[i].time))
  const jerks = accel
    .slice(1)
    .map((value, i) => (value - accel[i]) / Math.max(EPS, frames[i + 2].time - frames[i + 1].time))
  const jerkRms = jerks.length ? Math.sqrt(jerks.reduce((sum, value) => sum + value * value, 0) / jerks.length) : 0
  const jump = speeds.some((speed, i) => i > 0 && Math.abs(speed - speeds[i - 1]) > 8)
  let move: MotionRecognition['move'] = 'static'
  if (
    dollyTravel &&
    zoomDirection &&
    dollyDirection &&
    dollyDirection !== zoomDirection &&
    heightRatioRatio > 0.8 &&
    heightRatioRatio < 1.25
  )
    move = 'dolly_zoom'
  else if (angularTravel >= 5 && Math.abs(distanceDelta) < 0.25 && Math.abs(orbit) < 25)
    move = Math.abs(last.camera.pitch - first.camera.pitch) >= angularTravel ? 'tilt' : 'pan'
  else if (horizontalTravel < 0.25 && verticalTravel >= 0.25) move = cameraDelta.y > 0 ? 'crane_up' : 'crane_down'
  else if (cameraTravel < 0.25 && zoomDirection) move = zoomDirection === 'in' ? 'zoom_in' : 'zoom_out'
  else if (heightRatioRatio >= 1.25) move = 'push_in'
  else if (heightRatioRatio <= 0.8) move = 'pull_out'
  else if (Math.abs(orbit) >= 25) move = orbit > 0 ? 'orbit_right' : 'orbit_left'
  else if (cameraTravel >= 0.25 && coMotion && Math.abs(distanceDelta) < 0.25) move = 'follow'
  else if (cameraTravel >= 0.25) {
    const dx = last.camera.position.x - first.camera.position.x
    move = dx < 0 ? 'track_left' : 'track_right'
  }
  if (move !== 'zoom_in' && move !== 'zoom_out' && Math.abs(fovDelta) > 0.5) issues.push('非变焦运镜出现 fov 变化')
  return {
    move,
    signedOrbitDeg: orbit,
    distanceDelta,
    linearSpeed: cameraTravel / dt,
    angularSpeed: angularTravel / dt,
    jerkRms,
    jump,
    cameraDelta,
    yawDelta: signedDeg(last.camera.yaw - first.camera.yaw),
    pitchDelta: last.camera.pitch - first.camera.pitch,
    fovDelta,
    heightRatioStart,
    heightRatioEnd,
    heightRatioRatio,
    cameraTravel,
    issues,
  }
}

export type ContinuityIssue = {
  kind: 'teleport' | 'axis-cross' | 'camera-inside' | 'below-ground'
  time: number
  objectId?: string
  message: string
}
export function measureContinuity(measurements: DirectorMeasurements, scene: DirectorScene): ContinuityIssue[] {
  const issues: ContinuityIssue[] = []
  for (const frame of measurements.frames) {
    if (frame.camera)
      for (const object of scene.objects) {
        const sample = frame.objects[object.id]
        if (
          frame.camera &&
          !object.isAuxiliary &&
          object.type !== 'plane' &&
          sample &&
          cameraInsideObject(frame.camera.position, sample.position, object)
        )
          issues.push({
            kind: 'camera-inside',
            time: frame.time,
            objectId: object.id,
            message: `camera enters ${object.name}`,
          })
        if (sample?.belowGround)
          issues.push({
            kind: 'below-ground',
            time: frame.time,
            objectId: object.id,
            message: `${object.name} is below ground`,
          })
      }
  }
  for (const cut of measurements.cuts) {
    const before = measurements.frames.find((f) => Math.abs(f.time - (cut - 1 / measurements.fps)) < EPS * 2)
    const after = measurements.frames.find((f) => Math.abs(f.time - cut) < EPS * 2)
    if (before && after)
      for (const object of scene.objects) {
        const a = before.objects[object.id]?.position,
          b = after.objects[object.id]?.position
        if (a && b && distance(a, b) > 2)
          issues.push({
            kind: 'teleport',
            time: cut,
            objectId: object.id,
            message: `${object.name} jumps ${distance(a, b).toFixed(2)}m across cut`,
          })
      }
  }
  const pair = scene.objects.filter((o) => o.type === 'character').slice(0, 2)
  if (pair.length === 2) {
    let previousSign = 0
    for (const frame of measurements.frames) {
      const a = frame.objects[pair[0].id]?.position,
        b = frame.objects[pair[1].id]?.position,
        c = frame.camera?.position
      if (!a || !b || !c) continue
      const sign = Math.sign(cross(sub(b, a), sub(c, a)).y)
      if (sign && previousSign && sign !== previousSign)
        issues.push({
          kind: 'axis-cross',
          time: frame.time,
          message: `camera crosses 180° axis for ${pair[0].name}/${pair[1].name}`,
        })
      if (sign) previousSign = sign
    }
  }
  return issues
}

function cameraInsideObject(camera: Vec3, origin: Vec3, object: DirectorObject): boolean {
  const bounds = scaledBounds(object),
    size = objectSize(object)
  const center = add(origin, bounds.center)
  return (
    Math.abs(camera.x - center.x) <= size.x / 2 &&
    Math.abs(camera.y - center.y) <= size.y / 2 &&
    Math.abs(camera.z - center.z) <= size.z / 2
  )
}

export const isKnownCameraMove = (value: string): value is CameraMove =>
  (CAMERA_MOVES as readonly string[]).includes(value)
export const measurementMath = { add, sub, cross, dot, length }
