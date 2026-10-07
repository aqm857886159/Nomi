/**
 * [INPUT]: directorSpace（包围盒真值、segmentBlocked = three Ray.intersectBox）、evaluatedSceneObject（含父链的世界姿态）、trajectoryEval、vec3
 * [OUTPUT]: 对外提供 SightContext、sightBlockers（一个镜头窗口内挡住主体的东西）、chooseClearView（整条机位路径找一个看得见主体的候选）
 * [POS]: 舞台模型的机位视线：机位要看得见主体。墙外的机位自然被墙挡住、布景件挡在主体前也一样——一条规则，不写「谁让开谁」。
 *        候选只对整条路径做同一个变换（绕主体转、抬高、拉近），运镜形状不变；换遍候选仍挡就照原样出，由调用方报 occluded。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorCamera, DirectorObject, Vec3, Waypoint } from '../directorTypes'
import { scaledBounds, segmentBlocked } from '../directorSpace'
import { evaluateSceneObjectPose } from '../evaluatedSceneObject'
import { evaluateEntityTransform } from '../trajectoryEval'
import { forwardFromAngles, lookAtAngles, rotateY } from '../vec3'

export type SightContext = {
  objects: readonly DirectorObject[]
  subjectId: string
  /** 镜头瞄准的那一点（世界坐标），随时间。 */
  aim: (time: number) => Vec3
  window: readonly [number, number]
  /** 不算遮挡的东西：拿在手里的东西。 */
  ignore: ReadonlySet<string>
  /** 越轴：返回 false 的机位点在轴线另一侧，候选作废。 */
  sameSide?: (point: Vec3, time: number) => boolean
  /** 接续上一镜（continuous）：起点不能挪，变换从起点 0 渐到终点满量。 */
  keepStart?: boolean
  /** 跟拍：机位随主体走，变换绕「那一刻的主体」做；其余镜头绕镜头开始时的主体做（静止机位仍静止）。 */
  follows?: boolean
}

type Box = { min: Vec3; max: Vec3 }
const SAMPLES = 9
const WALKABLE = 0.3 // 薄于此的实心面（地面 / 路面）不挡视线
const CAMERA_CLEARANCE = 0.08
const solid = (object: DirectorObject) => object.visible && !object.isAuxiliary && object.type !== 'plane' && object.type !== 'group'

/** t 时刻的世界包围盒（含父链、朝向、scale；旋转后取外接轴对齐盒）。 */
function worldBox(objects: readonly DirectorObject[], object: DirectorObject, time: number): Box | undefined {
  const pose = evaluateSceneObjectPose(objects, object.id, time)
  if (!pose) return undefined
  const local = scaledBounds({ ...object, scale: { x: 1, y: 1, z: 1 } })
  const b = pose.frame.basis
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const x of [local.min.x, local.max.x])
    for (const y of [local.min.y, local.max.y])
      for (const z of [local.min.z, local.max.z]) {
        const p = { x: b[0] * x + b[1] * y + b[2] * z + pose.frame.position.x, y: b[3] * x + b[4] * y + b[5] * z + pose.frame.position.y, z: b[6] * x + b[7] * y + b[8] * z + pose.frame.position.z }
        min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z)
        max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z)
      }
  return { min, max }
}
const inside = (box: Box, p: Vec3, pad: number) =>
  p.x > box.min.x - pad && p.x < box.max.x + pad && p.y > box.min.y - pad && p.y < box.max.y + pad && p.z > box.min.z - pad && p.z < box.max.z + pad

const sampleTimes = (window: readonly [number, number]) =>
  Array.from({ length: SAMPLES }, (_, k) => window[0] + ((window[1] - window[0]) * k) / (SAMPLES - 1) - (k === SAMPLES - 1 ? 1e-3 : 0))

/** 窗口内 9 个时刻：机位到主体中心、机位到瞄准点两条视线被谁挡住（机位在实心件里也算）。 */
export function sightBlockers(context: SightContext, camera: Pick<DirectorCamera, 'motionTrajectory' | 'trajectoryClips' | 'position' | 'yaw' | 'pitch' | 'roll' | 'fov'>): string[] {
  const blockers = new Set<string>()
  const subject = context.objects.find((object) => object.id === context.subjectId)
  if (!subject) return []
  for (const time of sampleTimes(context.window)) {
    const from = evaluateEntityTransform(camera as DirectorCamera, time).position
    const subjectBox = worldBox(context.objects, subject, time)
    if (!subjectBox) continue
    if (inside(subjectBox, from, CAMERA_CLEARANCE)) blockers.add(subject.id)
    const center = { x: (subjectBox.min.x + subjectBox.max.x) / 2, y: (subjectBox.min.y + subjectBox.max.y) / 2, z: (subjectBox.min.z + subjectBox.max.z) / 2 }
    const aim = context.aim(time)
    for (const object of context.objects) {
      if (!solid(object) || object.id === subject.id || context.ignore.has(object.id)) continue
      const box = worldBox(context.objects, object, time)
      if (!box || box.max.y - box.min.y <= WALKABLE) continue
      if (inside(box, from, CAMERA_CLEARANCE) || segmentBlocked(from, center, box) || segmentBlocked(from, aim, box)) blockers.add(object.id)
    }
  }
  return [...blockers]
}

// 候选：绕主体转（度）、抬高（米）、拉近（半径倍数）；代价越小越像原镜头。转 20° 先于抬 0.6m 先于拉近。
const TURNS = [0, 20, -20, 40, -40, 60, -60, 90, -90, 120, -120, 150, -150, 180]
const LIFTS = [0, 0.6, 1.5, 3]
const RADII = [1, 0.75, 0.5]
const CANDIDATES = TURNS.flatMap((turn) => LIFTS.flatMap((lift) => RADII.map((radius) => ({ turn, lift, radius, cost: Math.abs(turn) / 30 + lift * 1.5 + (1 - radius) * 6 }))))
  .filter((candidate) => candidate.turn || candidate.lift || candidate.radius !== 1)
  .sort((a, b) => a.cost - b.cost)

/** 整条路径做同一个变换：每个路标相对它那一刻的瞄准点绕竖轴转、水平拉近、整体抬高；看向的点跟着转（摇镜 / 横移的形状不变）。 */
function transformPath(points: Waypoint[], context: SightContext, fullTurn: number, fullLift: number, fullRadius: number): Waypoint[] {
  const [start, end] = context.window
  return points.map((point) => {
    const weight = context.keepStart ? Math.min(1, Math.max(0, (point.time - start) / Math.max(1e-6, end - start))) : 1
    const turn = fullTurn * weight, lift = fullLift * weight, radius = 1 + (fullRadius - 1) * weight
    const pivot = context.aim(context.follows ? point.time : start)
    const position = { x: point.x, y: point.y, z: point.z }
    const reach = Math.max(0.5, Math.hypot(position.x - pivot.x, position.y - pivot.y, position.z - pivot.z))
    const forward = forwardFromAngles(point.yaw, point.pitch)
    const look = { x: position.x + forward.x * reach, y: position.y + forward.y * reach, z: position.z + forward.z * reach }
    const offset = rotateY({ x: position.x - pivot.x, y: 0, z: position.z - pivot.z }, turn)
    const moved = { x: pivot.x + offset.x * radius, y: position.y + lift, z: pivot.z + offset.z * radius }
    const lookOffset = rotateY({ x: look.x - pivot.x, y: 0, z: look.z - pivot.z }, turn)
    const lookAt = { x: pivot.x + lookOffset.x, y: look.y, z: pivot.z + lookOffset.z }
    return { ...point, ...moved, ...lookAtAngles(moved, lookAt) }
  })
}

/**
 * 机位看得见主体：原路径被挡，就按代价从小到大试候选，取第一条全程看得见、不越轴的，直接改写机位路径。
 * 返回仍挡住主体的东西（空 = 看得见）。
 */
export function chooseClearView(camera: DirectorCamera, context: SightContext): string[] {
  const original = sightBlockers(context, camera)
  // 原路径若在轴线另一侧，越轴保护会把它镜像过去（可能镜像到墙外）——那也算不可用，一起找候选
  const offAxis = (trial: DirectorCamera) => !!context.sameSide && sampleTimes(context.window).some((time) => !context.sameSide!(evaluateEntityTransform(trial, time).position, time))
  if ((!original.length && !offAxis(camera)) || !camera.motionTrajectory?.length) return original
  for (const candidate of CANDIDATES) {
    const motionTrajectory = transformPath(camera.motionTrajectory, context, candidate.turn, candidate.lift, candidate.radius)
    if (motionTrajectory.some((point) => point.y < 0.2)) continue
    const trial = { ...camera, motionTrajectory, position: { x: motionTrajectory[0].x, y: motionTrajectory[0].y, z: motionTrajectory[0].z } }
    if (offAxis(trial) || sightBlockers(context, trial).length) continue
    camera.motionTrajectory = motionTrajectory
    camera.position = trial.position
    return []
  }
  return original
}
