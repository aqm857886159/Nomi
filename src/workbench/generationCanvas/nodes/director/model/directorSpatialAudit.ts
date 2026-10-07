/**
 * [INPUT]: ./directorTypes、./directorSpace 的 scaledBounds（渲染真值包围盒）、./evaluatedSceneObject 的 evaluateSceneObjectPose（含父链的世界姿态）、./trajectoryEval 的 evaluateEntityTransform
 * [OUTPUT]: 对外提供 SpatialAuditContext、SpatialViolation、SPATIAL_CRITERIA、auditDirectorSpace：编出来的工程在物理上是否成立的六条判据
 * [POS]: 评测打分的「物理层」：不悬空、不互穿、只有一个地面高度、机位不在物体里、看得见主体、携带物跟人走。
 *        不读任何手抄尺寸表，所有包围盒来自 directorSpace；判据只许照物理写，不许为分数回调。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorObject, DirectorProject, DirectorScene, Vec3 } from './directorTypes'
import { scaledBounds } from './directorSpace'
import { evaluateSceneObjectPose } from './evaluatedSceneObject'
import { evaluateEntityTransform } from './trajectoryEval'

export const SPATIAL_CRITERIA = ['floating', 'interpenetrating', 'offFloor', 'cameraInside', 'occluded', 'carriedDrift'] as const
export type SpatialCriterion = (typeof SPATIAL_CRITERIA)[number]
/** 违例码 + 结构化字段（实体 id、数值）；人话由评测报告那一层拼，这里不放可见文字。 */
export type SpatialViolation = { criterion: SpatialCriterion; subject: string; other?: string; value?: number }

/** 计划层面的信息（哪个镜头拍谁、谁拿着什么）；没有计划的工程只量不依赖它的几条。 */
export type SpatialAuditContext = {
  /** 每个镜头：机位 id、主体对象 id、时间窗。 */
  shots: { cameraId: string; subjectId: string; window: [number, number] }[]
  /** [携带物对象 id, 持有者对象 id]。 */
  carried: [string, string][]
}

type Box = { min: Vec3; max: Vec3 }
const EPS = 0.02 // 2cm：低于这个算贴合
const WALKABLE_MAX_THICKNESS = 0.3 // 薄于此的实心面（地面 / 路面）算可行走面

const solid = (object: DirectorObject) => object.visible && !object.isAuxiliary && object.type !== 'plane' && object.type !== 'group'
const walkable = (box: Box) => box.max.y - box.min.y <= WALKABLE_MAX_THICKNESS
const xzOverlap = (a: Box, b: Box) => a.min.x < b.max.x - EPS && b.min.x < a.max.x - EPS && a.min.z < b.max.z - EPS && b.min.z < a.max.z - EPS
const overlapDepth = (a: Box, b: Box) =>
  Math.min(a.max.x - b.min.x, b.max.x - a.min.x, a.max.y - b.min.y, b.max.y - a.min.y, a.max.z - b.min.z, b.max.z - a.min.z)
const contains = (box: Box, p: Vec3) => p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y && p.z >= box.min.z && p.z <= box.max.z

/** 每个有渲染真值的对象在 t 时刻的世界包围盒（含父链、旋转、scale；旋转后取外接轴对齐盒）。 */
function worldBoxes(scene: DirectorScene, time: number): Map<string, Box> {
  const boxes = new Map<string, Box>()
  for (const object of scene.objects) {
    if (object.type === 'group') continue
    const pose = evaluateSceneObjectPose(scene.objects, object.id, time)
    if (!pose) continue
    const local = scaledBounds({ ...object, scale: { x: 1, y: 1, z: 1 } })
    const b = pose.frame.basis
    const min = { x: Infinity, y: Infinity, z: Infinity }
    const max = { x: -Infinity, y: -Infinity, z: -Infinity }
    for (const x of [local.min.x, local.max.x])
      for (const y of [local.min.y, local.max.y])
        for (const z of [local.min.z, local.max.z]) {
          const p = {
            x: b[0] * x + b[1] * y + b[2] * z + pose.frame.position.x,
            y: b[3] * x + b[4] * y + b[5] * z + pose.frame.position.y,
            z: b[6] * x + b[7] * y + b[8] * z + pose.frame.position.z,
          }
          min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z)
          max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z)
        }
    boxes.set(object.id, { min, max })
  }
  return boxes
}

const sampleTimes = (scene: DirectorScene): number[] => {
  const end = Math.max(0, ...[...scene.objects, ...scene.cameras].flatMap((entity) => (entity.trajectoryClips ?? []).map((clip) => clip.endTime)))
  return Array.from({ length: 9 }, (_, index) => (end * index) / 8)
}

/** 不悬空：静止时每个实心物件的底要么贴地（或在地面以下，陷地另量），要么贴在另一个实心物件的顶上；被拿着的（有父级）由父级承托。 */
function floating(scene: DirectorScene): SpatialViolation[] {
  const boxes = worldBoxes(scene, 0)
  const out: SpatialViolation[] = []
  for (const object of scene.objects.filter(solid)) {
    const box = boxes.get(object.id)
    if (!box || object.parentId || box.min.y <= EPS) continue
    const resting = [...boxes].some(([otherId, other]) => otherId !== object.id && Math.abs(other.max.y - box.min.y) <= EPS && xzOverlap(box, other))
    if (!resting) out.push({ criterion: 'floating', subject: object.id, value: box.min.y })
  }
  return out
}

/** 不互穿：角色与计划放进来的件（actor:* / setPiece:*）在任何采样时刻不与其他实心物件互穿超过 2cm；携带物除外。 */
function interpenetrating(scene: DirectorScene, carried: Set<string>): SpatialViolation[] {
  const placed = (id: string) => id.startsWith('actor:') || id.startsWith('setPiece:')
  const seen = new Set<string>()
  const out: SpatialViolation[] = []
  for (const time of sampleTimes(scene)) {
    const boxes = worldBoxes(scene, time)
    const ids = scene.objects.filter(solid).map((item) => item.id).filter((id) => boxes.has(id))
    for (const [i, a] of ids.entries())
      for (const b of ids.slice(i + 1)) {
        if (!placed(a) && !placed(b)) continue // 模板 / 布景之间的拼接（墙角、门嵌墙）是作者意图
        if (carried.has(a) || carried.has(b)) continue
        if (walkable(boxes.get(a)!) || walkable(boxes.get(b)!)) continue // 地面另由 offFloor 量
        const key = [a, b].sort().join(' x ')
        if (!seen.has(key) && overlapDepth(boxes.get(a)!, boxes.get(b)!) > EPS) {
          seen.add(key)
          out.push({ criterion: 'interpenetrating', subject: a, other: b })
        }
      }
  }
  return out
}

/** 只有一个地面高度：站在可行走面上的东西，脚底应等于那块面的顶，不能陷进去。 */
function offFloor(scene: DirectorScene): SpatialViolation[] {
  const boxes = worldBoxes(scene, 0)
  const floors = [...boxes].filter(([, box]) => walkable(box))
  const out: SpatialViolation[] = []
  for (const object of scene.objects.filter(solid)) {
    const box = boxes.get(object.id)
    if (!box || walkable(box) || object.parentId) continue
    // 陷进可行走面的深度：面顶高出脚底多少（只看 30cm 以内，更深的是别的问题）
    const sink = Math.max(0, ...floors.filter(([id, floor]) => id !== object.id && xzOverlap(box, floor)).map(([, floor]) => floor.max.y - box.min.y).filter((depth) => depth <= WALKABLE_MAX_THICKNESS))
    if (sink > EPS) out.push({ criterion: 'offFloor', subject: object.id, value: sink })
  }
  return out
}

/** 机位不在物体里：每个采样时刻，机位点不落在任何实心物件的包围盒内。 */
function cameraInside(scene: DirectorScene): SpatialViolation[] {
  const seen = new Set<string>()
  const out: SpatialViolation[] = []
  for (const time of sampleTimes(scene)) {
    const boxes = worldBoxes(scene, time)
    for (const camera of scene.cameras) {
      if (!camera.trajectoryClips?.some((clip) => time >= clip.startTime - 1e-6 && time <= clip.endTime + 1e-6)) continue
      const p = evaluateEntityTransform(camera, time).position
      for (const object of scene.objects.filter(solid)) {
        const box = boxes.get(object.id)
        const key = `${camera.id}>${object.id}`
        if (box && !seen.has(key) && contains(box, p)) {
          seen.add(key)
          out.push({ criterion: 'cameraInside', subject: camera.id, other: object.id })
        }
      }
    }
  }
  return out
}

/** 线段 [from,to] 是否在到达 to 之前（留 5cm）穿过盒子：slab 法。 */
function segmentHitsBox(from: Vec3, to: Vec3, box: Box): boolean {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }
  const length = Math.hypot(d.x, d.y, d.z)
  if (length < 1e-6) return false
  let enter = 0
  let exit = 1
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (from[axis] < box.min[axis] || from[axis] > box.max[axis]) return false
      continue
    }
    const t1 = (box.min[axis] - from[axis]) / d[axis]
    const t2 = (box.max[axis] - from[axis]) / d[axis]
    enter = Math.max(enter, Math.min(t1, t2))
    exit = Math.min(exit, Math.max(t1, t2))
    if (enter > exit) return false
  }
  return enter * length < length - 0.05
}

/** 看得见主体：镜头窗口内 5 个时刻，机位到主体中心的视线不被别的实心物件（非地面、非携带物）挡住。 */
function occluded(scene: DirectorScene, context: SpatialAuditContext, carried: Set<string>): SpatialViolation[] {
  const seen = new Set<string>()
  const out: SpatialViolation[] = []
  for (const shot of context.shots) {
    const camera = scene.cameras.find((item) => item.id === shot.cameraId)
    if (!camera) continue
    for (let k = 0; k <= 4; k += 1) {
      const time = shot.window[0] + ((shot.window[1] - shot.window[0]) * k) / 4 - (k === 4 ? 1e-3 : 0)
      const boxes = worldBoxes(scene, time)
      const subject = boxes.get(shot.subjectId)
      if (!subject) continue
      const from = evaluateEntityTransform(camera, time).position
      const to = { x: (subject.min.x + subject.max.x) / 2, y: (subject.min.y + subject.max.y) / 2, z: (subject.min.z + subject.max.z) / 2 }
      for (const object of scene.objects.filter(solid)) {
        const box = boxes.get(object.id)
        if (!box || object.id === shot.subjectId || carried.has(object.id) || walkable(box) || contains(box, from)) continue
        const key = `${shot.cameraId}|${object.id}`
        if (!seen.has(key) && segmentHitsBox(from, to, box)) {
          seen.add(key)
          out.push({ criterion: 'occluded', subject: shot.cameraId, other: object.id })
        }
      }
    }
  }
  return out
}

/** 携带物跟人走：持有者会动时，携带物与持有者的水平间距全程不变（±2cm）。用世界姿态量。 */
function carriedDrift(scene: DirectorScene, pairs: [string, string][]): SpatialViolation[] {
  const out: SpatialViolation[] = []
  const times = sampleTimes(scene)
  for (const [itemId, holderId] of pairs) {
    const item = scene.objects.find((o) => o.id === itemId)
    const holder = scene.objects.find((o) => o.id === holderId)
    if (!item || !holder || !holder.trajectoryClips?.length) continue
    const gap = (t: number) => {
      const p = evaluateSceneObjectPose(scene.objects, itemId, t)!.position
      const q = evaluateSceneObjectPose(scene.objects, holderId, t)!.position
      return Math.hypot(p.x - q.x, p.z - q.z)
    }
    const drift = Math.max(...times.map((t) => Math.abs(gap(t) - gap(0))))
    if (drift > EPS) out.push({ criterion: 'carriedDrift', subject: item.id, other: holder.id, value: drift })
  }
  return out
}

export function auditDirectorSpace(project: DirectorProject, context?: SpatialAuditContext): SpatialViolation[] {
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  if (!scene) return []
  const carriedPairs = context?.carried ?? []
  const carried = new Set(carriedPairs.map(([item]) => item))
  return [
    ...floating(scene),
    ...interpenetrating(scene, carried),
    ...offFloor(scene),
    ...cameraInside(scene),
    ...(context ? occluded(scene, context, carried) : []),
    ...carriedDrift(scene, carriedPairs),
  ]
}
