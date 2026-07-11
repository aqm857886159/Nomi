// 姿势确定性度量核 —— 把「人眼一看就不对」翻成可计算的数字（纯 three 数学，零渲染，node/浏览器皆可跑）。
// 判据来源：research/2026-07-11-pose-correction-scaffolding.md
//   重心 = Winter/Dempster 肢段质量系数加权；平衡 = COM 垂直投影 vs 接触点凸包（带符号边距）；
//   悬空/踮脚 = 分部位接触集合；反关节 = 关节角窗口；自穿插 = 肢段胶囊最近距离。
// 铁律：静态平衡判据无速度项，只对**静止姿势**有效；动态姿势（运镜/走跑中帧）需 XcoM（COM + v·√(l/g)），
//       别拿这套去判动图 —— walk/run 预设因此声明 comInsideSupport:false。
// 所有长度均为「身高分数」（normalizeMannequinModel 后模型高=1），天然尺度无关。
import * as THREE from 'three'
import { normalizeMannequinBoneName } from './scene3dMath'

export type PoseFindingSeverity = 'P0' | 'P1'

export interface PoseFinding {
  code: string
  severity: PoseFindingSeverity
  measured: number
  expected: [number, number]
  human: string
}

export type PoseAngleName =
  | 'torsoLeanFwd'
  | 'neckPitchFwd'
  | 'kneeFlexL'
  | 'kneeFlexR'
  | 'hipFlexL'
  | 'hipFlexR'
  | 'hipAbdL'
  | 'hipAbdR'
  | 'elbowFlexL'
  | 'elbowFlexR'
  | 'ankleDeltaL'
  | 'ankleDeltaR'

export interface PoseMetricsReport {
  facing: [number, number]
  comXZ: [number, number]
  /** COM 垂直投影到支撑凸包的带符号边距（身高分数，正=在内）。无接触点时为 null。 */
  comMarginH: number | null
  /** COM 相对支撑面中心的前后偏移（身高分数，正=朝面向前方）。 */
  comForwardOffsetH: number | null
  contacts: string[]
  angles: Record<PoseAngleName, number>
  /** 每部位最低点离地高度（身高分数）。 */
  clearanceByPart: Record<string, number>
  selfIntersections: Array<{ parts: [string, string]; depthRatio: number }>
}

export interface PoseIntentSpec {
  /** 每个列出的部位都必须触地。 */
  requiredContacts: string[]
  /** 任何列出的部位都不许触地。 */
  forbiddenContacts?: string[]
  /** 角度窗口（度）。缺省项不检查。 */
  angles?: Partial<Record<PoseAngleName, [number, number]>>
  /** 静态平衡：COM 投影必须落在支撑凸包内（walk/run/sit 这类合法「不平衡」姿势设 false）。 */
  comInsideSupport: boolean
  /** 在内时要求的最小边距（身高分数），默认 0.015。 */
  comMarginMinH?: number
  /**
   * 触地判定容差覆盖（身高分数）。跪姿类用：靴头/小腿肌肉网格有厚度，
   * 「贴地」的物理下限 ≈2-4% 身高（求解器实测），按 1.2% 判必然假阳。
   */
  contactEpsH?: number
  /** 豁免的穿插部位对（解剖常态的贴近，如跑步摆臂贴胸）。 */
  allowedIntersections?: Array<[string, string]>
}

// ── 生物力学常数（公有数据，Winter, Biomechanics and Motor Control of Human Movement）──
// [骨段起, 骨段止, 质量分数, 段内 COM 位置（自近端的比例）]
const SEGMENT_TABLE: Array<[string, string, number, number]> = [
  ['mixamorigHips', 'mixamorigNeck', 0.497, 0.5],
  ['mixamorigHead', '@headTop', 0.081, 0.5],
  ['mixamorigLeftArm', 'mixamorigLeftForeArm', 0.028, 0.436],
  ['mixamorigRightArm', 'mixamorigRightForeArm', 0.028, 0.436],
  ['mixamorigLeftForeArm', 'mixamorigLeftHand', 0.016, 0.43],
  ['mixamorigRightForeArm', 'mixamorigRightHand', 0.016, 0.43],
  ['mixamorigLeftHand', '@extendLeftHand', 0.006, 0.5],
  ['mixamorigRightHand', '@extendRightHand', 0.006, 0.5],
  ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 0.1, 0.433],
  ['mixamorigRightUpLeg', 'mixamorigRightLeg', 0.1, 0.433],
  ['mixamorigLeftLeg', 'mixamorigLeftFoot', 0.0465, 0.433],
  ['mixamorigRightLeg', 'mixamorigRightFoot', 0.0465, 0.433],
  ['mixamorigLeftFoot', 'mixamorigLeftToeBase', 0.0145, 0.5],
  ['mixamorigRightFoot', 'mixamorigRightToeBase', 0.0145, 0.5],
]

// 关节角硬闸（度）——解剖学上不该越过的范围（AAOS 口径放宽后的保守窗），越界 = P0 反关节/畸形。
const HARD_ANGLE_LIMITS: Partial<Record<PoseAngleName, [number, number]>> = {
  kneeFlexL: [-10, 150],
  kneeFlexR: [-10, 150],
  elbowFlexL: [-10, 155],
  elbowFlexR: [-10, 155],
  hipFlexL: [-30, 135],
  hipFlexR: [-30, 135],
  torsoLeanFwd: [-35, 80],
  neckPitchFwd: [-30, 50],
  hipAbdL: [-12, 50],
  hipAbdR: [-12, 50],
  // 下界 −55：跪姿脚背贴地即 ~50° 跖屈，解剖极限内；上界 60 背屈富余。
  ankleDeltaL: [-55, 60],
  ankleDeltaR: [-55, 60],
}

const ANGLE_HUMAN: Record<PoseAngleName, string> = {
  torsoLeanFwd: '躯干前倾角（+前倾/−后仰）',
  neckPitchFwd: '头部前俯角（+低头/−仰头）',
  kneeFlexL: '左膝屈曲',
  kneeFlexR: '右膝屈曲',
  hipFlexL: '左髋屈曲',
  hipFlexR: '右髋屈曲',
  hipAbdL: '左腿外展（劈胯）',
  hipAbdR: '右腿外展（劈胯）',
  elbowFlexL: '左肘屈曲',
  elbowFlexR: '右肘屈曲',
  ankleDeltaL: '左踝勾绷（相对站立中立位，+背屈/−跖屈）',
  ankleDeltaR: '右踝勾绷（相对站立中立位，+背屈/−跖屈）',
}

// 触地判定阈值（身高分数）：1.5% ≈ 真人 2.7cm 鞋底容差（靴底网格实测在 1.2-1.4% 悬摆）。
const CONTACT_EPS_H = 0.015
// 支撑面收点容差放宽一档：视觉上「压着地」的部位（跪姿小腿等）在 2.5% 内都承重，
// 只用 1.2% 收支撑点会把跪姿支撑面算窄、重心边距失真。
const SUPPORT_EPS_H = 0.025
// 自穿插：两胶囊中轴距离 < (rA+rB)·比例 记穿插；比例越小越保守（表面轻触不报）。
const CAPSULE_PENETRATION_RATIO = 0.62
// 只检这些确实不该互相穿透的部位对（相邻肢段天然贴近，不进清单）。
const CAPSULE_PAIRS: Array<[string, string]> = [
  ['left-hand', 'torso'],
  ['right-hand', 'torso'],
  ['left-forearm', 'torso'],
  ['right-forearm', 'torso'],
  ['left-hand', 'pelvis'],
  ['right-hand', 'pelvis'],
  ['left-shank', 'right-shank'],
  ['left-thigh', 'right-thigh'],
  ['left-forearm', 'left-thigh'],
  ['right-forearm', 'right-thigh'],
]

function partForBoneName(rawName: string): string | null {
  const name = normalizeMannequinBoneName(rawName)
  const side = name.includes('Left') ? 'left' : name.includes('Right') ? 'right' : ''
  if (/ToeBase|Toe_End/.test(name)) return `${side}-toe`
  if (/Foot/.test(name)) return `${side}-foot`
  if (/UpLeg/.test(name)) return `${side}-thigh`
  if (/Leg/.test(name)) return `${side}-shank`
  if (/Hips/.test(name)) return 'pelvis'
  if (/Spine/.test(name)) return 'torso'
  if (/Neck|Head/.test(name)) return 'head'
  if (/Shoulder/.test(name)) return `${side}-shoulder`
  if (/ForeArm/.test(name)) return `${side}-forearm`
  if (/Hand/.test(name)) return `${side}-hand`
  if (/Arm/.test(name)) return `${side}-upperarm`
  return null
}

interface RigMesh {
  mesh: THREE.SkinnedMesh
  vertexPart: Array<string | null>
}

export interface PoseMetricsRig {
  root: THREE.Group
  groundY: number
  meshes: RigMesh[]
  bones: Map<string, THREE.Bone>
  capsuleRadius: Map<string, number>
  neutralAnkleL: number
  neutralAnkleR: number
}

function collectBones(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>()
  root.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(normalizeMannequinBoneName(object.name), object)
  })
  return bones
}

const _v = new THREE.Vector3()
const _v2 = new THREE.Vector3()

function boneLocalPosition(rig: PoseMetricsRig, key: string): THREE.Vector3 | null {
  if (key === '@headTop') {
    const top = rig.bones.get('mixamorigHeadTop_End')
    if (top) return boneLocalPosition(rig, 'mixamorigHeadTop_End')
    const head = boneLocalPosition(rig, 'mixamorigHead')
    return head ? head.clone().add(new THREE.Vector3(0, 0.09, 0)) : null
  }
  if (key === '@extendLeftHand' || key === '@extendRightHand') {
    const side = key === '@extendLeftHand' ? 'Left' : 'Right'
    const mid = rig.bones.get(`mixamorig${side}HandMiddle1`)
    if (mid) return boneLocalPosition(rig, `mixamorig${side}HandMiddle1`)
    return boneLocalPosition(rig, `mixamorig${side}Hand`)
  }
  const bone = rig.bones.get(key)
  if (!bone) return null
  bone.getWorldPosition(_v)
  return rig.root.worldToLocal(_v).clone()
}

/** 蒙皮顶点 → root-local 坐标（含当前骨骼姿势）。 */
function skinnedVertexLocal(rig: PoseMetricsRig, entry: RigMesh, index: number, out: THREE.Vector3): THREE.Vector3 {
  const position = entry.mesh.geometry.getAttribute('position')
  out.fromBufferAttribute(position, index)
  entry.mesh.applyBoneTransform(index, out)
  entry.mesh.localToWorld(out)
  return rig.root.worldToLocal(out)
}

function dominantPartPerVertex(mesh: THREE.SkinnedMesh): Array<string | null> {
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  const bones = mesh.skeleton.bones
  const parts: Array<string | null> = new Array(skinIndex.count).fill(null)
  for (let i = 0; i < skinIndex.count; i += 1) {
    let best = 0
    let bestWeight = -1
    for (let k = 0; k < 4; k += 1) {
      const w = skinWeight.getComponent(i, k)
      if (w > bestWeight) {
        bestWeight = w
        best = skinIndex.getComponent(i, k)
      }
    }
    const bone = bones[best]
    parts[i] = bone ? partForBoneName(bone.name) : null
  }
  return parts
}

// ── 小几何工具（导出供单测）──
export function convexHullXZ(points: Array<[number, number]>): Array<[number, number]> {
  const unique = [...new Map(points.map((p) => [`${p[0].toFixed(5)},${p[1].toFixed(5)}`, p])).values()]
  if (unique.length <= 2) return unique
  const sorted = unique.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Array<[number, number]> = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Array<[number, number]> = []
  for (const p of sorted.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return [...lower, ...upper]
}

function distanceToSegment2D(p: [number, number], a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0]
  const abz = b[1] - a[1]
  const lenSq = abx * abx + abz * abz
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / lenSq))
  const dx = p[0] - (a[0] + abx * t)
  const dz = p[1] - (a[1] + abz * t)
  return Math.hypot(dx, dz)
}

/** 点到凸包的带符号距离：正=在内（到最近边的距离），负=在外。退化（<3 点）按「线段支撑带」处理。 */
export function signedDistanceToHullXZ(p: [number, number], hull: Array<[number, number]>): number {
  if (hull.length === 0) return Number.NEGATIVE_INFINITY
  if (hull.length === 1) return 0.02 - Math.hypot(p[0] - hull[0][0], p[1] - hull[0][1])
  if (hull.length === 2) return 0.02 - distanceToSegment2D(p, hull[0], hull[1])
  let inside = true
  let minEdge = Number.POSITIVE_INFINITY
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    const crossZ = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
    if (crossZ < 0) inside = false
    minEdge = Math.min(minEdge, distanceToSegment2D(p, a, b))
  }
  return inside ? minEdge : -minEdge
}

export function segmentDistance3D(
  a0: THREE.Vector3,
  a1: THREE.Vector3,
  b0: THREE.Vector3,
  b1: THREE.Vector3,
): number {
  const d1 = _segD1.subVectors(a1, a0)
  const d2 = _segD2.subVectors(b1, b0)
  const r = _segR.subVectors(a0, b0)
  const aa = d1.dot(d1)
  const ee = d2.dot(d2)
  const f = d2.dot(r)
  let s = 0
  let t = 0
  if (aa <= 1e-9 && ee <= 1e-9) return r.length()
  if (aa <= 1e-9) {
    t = Math.max(0, Math.min(1, f / ee))
  } else {
    const c = d1.dot(r)
    if (ee <= 1e-9) {
      s = Math.max(0, Math.min(1, -c / aa))
    } else {
      const b = d1.dot(d2)
      const denom = aa * ee - b * b
      s = denom !== 0 ? Math.max(0, Math.min(1, (b * f - c * ee) / denom)) : 0
      t = (b * s + f) / ee
      if (t < 0) {
        t = 0
        s = Math.max(0, Math.min(1, -c / aa))
      } else if (t > 1) {
        t = 1
        s = Math.max(0, Math.min(1, (b - c) / aa))
      }
    }
  }
  const p1 = _segP1.copy(a0).addScaledVector(d1, s)
  const p2 = _segP2.copy(b0).addScaledVector(d2, t)
  return p1.distanceTo(p2)
}
const _segD1 = new THREE.Vector3()
const _segD2 = new THREE.Vector3()
const _segR = new THREE.Vector3()
const _segP1 = new THREE.Vector3()
const _segP2 = new THREE.Vector3()

// 胶囊中轴的骨段定义（与 SEGMENT_TABLE 一致的部位子集）。
const CAPSULE_SEGMENTS: Record<string, [string, string]> = {
  'left-thigh': ['mixamorigLeftUpLeg', 'mixamorigLeftLeg'],
  'right-thigh': ['mixamorigRightUpLeg', 'mixamorigRightLeg'],
  'left-shank': ['mixamorigLeftLeg', 'mixamorigLeftFoot'],
  'right-shank': ['mixamorigRightLeg', 'mixamorigRightFoot'],
  'left-forearm': ['mixamorigLeftForeArm', 'mixamorigLeftHand'],
  'right-forearm': ['mixamorigRightForeArm', 'mixamorigRightHand'],
  'left-hand': ['mixamorigLeftHand', '@extendLeftHand'],
  'right-hand': ['mixamorigRightHand', '@extendRightHand'],
  torso: ['mixamorigSpine', 'mixamorigNeck'],
  pelvis: ['mixamorigHips', 'mixamorigSpine'],
}

function estimateCapsuleRadii(rig: PoseMetricsRig): Map<string, number> {
  const radii = new Map<string, number>()
  const samples = new Map<string, number[]>()
  const axis: Record<string, [THREE.Vector3, THREE.Vector3]> = {}
  for (const [part, [a, b]] of Object.entries(CAPSULE_SEGMENTS)) {
    const pa = boneLocalPosition(rig, a)
    const pb = boneLocalPosition(rig, b)
    if (pa && pb) axis[part] = [pa, pb]
  }
  for (const entry of rig.meshes) {
    const position = entry.mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i += 4) {
      const part = entry.vertexPart[i]
      if (!part || !axis[part]) continue
      skinnedVertexLocal(rig, entry, i, _v)
      const [a, b] = axis[part]
      const d = segmentDistance3D(_v, _v, a, b)
      const list = samples.get(part) ?? []
      list.push(d)
      samples.set(part, list)
    }
  }
  for (const [part, list] of samples) {
    list.sort((x, y) => x - y)
    radii.set(part, list[Math.floor(list.length * 0.5)] ?? 0.03)
  }
  return radii
}

export function createPoseMetricsRig(root: THREE.Group, groundY: number): PoseMetricsRig {
  const meshes: RigMesh[] = []
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push({ mesh: object, vertexPart: dominantPartPerVertex(object) })
  })
  const rig: PoseMetricsRig = {
    root,
    groundY,
    meshes,
    bones: collectBones(root),
    capsuleRadius: new Map(),
    neutralAnkleL: 0,
    neutralAnkleR: 0,
  }
  root.updateMatrixWorld(true)
  rig.capsuleRadius = estimateCapsuleRadii(rig)
  rig.neutralAnkleL = ankleAngle(rig, 'Left')
  rig.neutralAnkleR = ankleAngle(rig, 'Right')
  return rig
}

/** 以当前姿势的蒙皮最低点为地面基准（在 groundMannequinModel 落地后的默认姿势上调用一次）。 */
export function calibrateRigGround(rig: PoseMetricsRig): void {
  rig.root.updateMatrixWorld(true)
  let min = Number.POSITIVE_INFINITY
  for (const entry of rig.meshes) {
    const position = entry.mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i += 1) {
      skinnedVertexLocal(rig, entry, i, _v)
      if (_v.y < min) min = _v.y
    }
  }
  if (Number.isFinite(min)) rig.groundY = min
}

function angleBetweenDeg(a: THREE.Vector3, b: THREE.Vector3): number {
  const denom = a.length() * b.length()
  if (denom < 1e-9) return 0
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b) / denom, -1, 1)))
}

function segmentVec(rig: PoseMetricsRig, from: string, to: string): THREE.Vector3 | null {
  const a = boneLocalPosition(rig, from)
  const b = boneLocalPosition(rig, to)
  if (!a || !b) return null
  return b.sub(a)
}

function ankleAngle(rig: PoseMetricsRig, side: 'Left' | 'Right'): number {
  const shank = segmentVec(rig, `mixamorig${side}Leg`, `mixamorig${side}Foot`)
  const foot = segmentVec(rig, `mixamorig${side}Foot`, `mixamorig${side}ToeBase`)
  if (!shank || !foot) return 0
  return angleBetweenDeg(shank, foot)
}

/**
 * 面向：由双肩连线派生（up × 左肩→右肩）。肩线在一切人形姿势里都不退化；
 * 曾用「脚尖朝向均值」，被单膝跪的后脚（脚背贴地、脚尖朝后）搅乱过——别改回去。
 */
function computeFacing(rig: PoseMetricsRig): THREE.Vector3 {
  const left = boneLocalPosition(rig, 'mixamorigLeftShoulder') ?? boneLocalPosition(rig, 'mixamorigLeftArm')
  const right = boneLocalPosition(rig, 'mixamorigRightShoulder') ?? boneLocalPosition(rig, 'mixamorigRightArm')
  if (left && right) {
    const leftToRight = right.sub(left)
    const facing = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), leftToRight)
    facing.y = 0
    if (facing.lengthSq() > 1e-8) return facing.normalize()
  }
  return new THREE.Vector3(0, 0, 1)
}

/** 带符号前倾角：向量相对世界竖直向上、朝 facing 方向倾倒为正（后仰为负）。 */
function forwardTiltDeg(vec: THREE.Vector3, facing: THREE.Vector3): number {
  const tilt = angleBetweenDeg(vec, new THREE.Vector3(0, 1, 0))
  const horiz = _v2.copy(vec)
  horiz.y = 0
  const sign = horiz.lengthSq() < 1e-9 ? 0 : Math.sign(horiz.dot(facing))
  return tilt * (sign === 0 ? 1 : sign)
}

/**
 * 髋外展角（+外劈/−内收），自校准定义：外向 = 该侧髋关节相对双髋中点的真实侧别方向，
 * 与世界朝向、左右命名约定完全解耦；用 asin(大腿方向·外向轴)，深屈（大腿近水平）时不发散。
 */
function hipAbductionDeg(rig: PoseMetricsRig, side: 'Left' | 'Right', facing: THREE.Vector3): number {
  const hip = boneLocalPosition(rig, `mixamorig${side}UpLeg`)
  const hipL = boneLocalPosition(rig, 'mixamorigLeftUpLeg')
  const hipR = boneLocalPosition(rig, 'mixamorigRightUpLeg')
  const thigh = segmentVec(rig, `mixamorig${side}UpLeg`, `mixamorig${side}Leg`)
  if (!hip || !hipL || !hipR || !thigh) return 0
  const right = _v2.crossVectors(facing, new THREE.Vector3(0, 1, 0)).normalize()
  const mid = hipL.clone().add(hipR).multiplyScalar(0.5)
  const outwardSign = Math.sign(hip.clone().sub(mid).dot(right)) || 1
  const lateral = thigh.clone().normalize().dot(right) * outwardSign
  return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(lateral, -1, 1)))
}

export function measurePose(rig: PoseMetricsRig): PoseMetricsReport {
  rig.root.updateMatrixWorld(true)
  const facing = computeFacing(rig)

  // 接触 + 每部位最低点 + 支撑点
  const clearance = new Map<string, number>()
  const supportPoints: Array<[number, number]> = []
  for (const entry of rig.meshes) {
    const position = entry.mesh.geometry.getAttribute('position')
    for (let i = 0; i < position.count; i += 1) {
      const part = entry.vertexPart[i]
      if (!part) continue
      skinnedVertexLocal(rig, entry, i, _v)
      const height = _v.y - rig.groundY
      const prev = clearance.get(part)
      if (prev === undefined || height < prev) clearance.set(part, height)
      if (height < SUPPORT_EPS_H) supportPoints.push([_v.x, _v.z])
    }
  }
  const contacts = [...clearance.entries()].filter(([, h]) => h < CONTACT_EPS_H).map(([part]) => part).sort()

  // COM（Winter 加权）
  const com = new THREE.Vector3()
  let totalMass = 0
  for (const [from, to, mass, ratio] of SEGMENT_TABLE) {
    const a = boneLocalPosition(rig, from)
    const b = boneLocalPosition(rig, to)
    if (!a || !b) continue
    com.addScaledVector(a.lerp(b, ratio), mass)
    totalMass += mass
  }
  if (totalMass > 0) com.divideScalar(totalMass)

  const hull = convexHullXZ(supportPoints)
  const comMarginH = supportPoints.length === 0 ? null : signedDistanceToHullXZ([com.x, com.z], hull)
  let comForwardOffsetH: number | null = null
  if (supportPoints.length > 0) {
    const cx = supportPoints.reduce((s, p) => s + p[0], 0) / supportPoints.length
    const cz = supportPoints.reduce((s, p) => s + p[1], 0) / supportPoints.length
    comForwardOffsetH = (com.x - cx) * facing.x + (com.z - cz) * facing.z
  }

  // 角度族
  const torso = segmentVec(rig, 'mixamorigHips', 'mixamorigNeck') ?? new THREE.Vector3(0, 1, 0)
  const headTopPos = boneLocalPosition(rig, '@headTop')
  const headPos = boneLocalPosition(rig, 'mixamorigHead')
  const headUp = headTopPos && headPos ? headTopPos.sub(headPos) : new THREE.Vector3(0, 1, 0)
  const torsoDown = torso.clone().negate()
  const angleOf = (side: 'Left' | 'Right', a: string, b: string, c: string): number => {
    const seg1 = segmentVec(rig, `mixamorig${side}${a}`, `mixamorig${side}${b}`)
    const seg2 = segmentVec(rig, `mixamorig${side}${b}`, `mixamorig${side}${c}`)
    return seg1 && seg2 ? angleBetweenDeg(seg1, seg2) : 0
  }
  const hipFlex = (side: 'Left' | 'Right'): number => {
    const thigh = segmentVec(rig, `mixamorig${side}UpLeg`, `mixamorig${side}Leg`)
    return thigh ? angleBetweenDeg(thigh, torsoDown) : 0
  }
  const angles: Record<PoseAngleName, number> = {
    torsoLeanFwd: forwardTiltDeg(torso, facing),
    neckPitchFwd: forwardTiltDeg(headUp, facing),
    kneeFlexL: angleOf('Left', 'UpLeg', 'Leg', 'Foot'),
    kneeFlexR: angleOf('Right', 'UpLeg', 'Leg', 'Foot'),
    hipFlexL: hipFlex('Left'),
    hipFlexR: hipFlex('Right'),
    hipAbdL: hipAbductionDeg(rig, 'Left', facing),
    hipAbdR: hipAbductionDeg(rig, 'Right', facing),
    elbowFlexL: angleOf('Left', 'Arm', 'ForeArm', 'Hand'),
    elbowFlexR: angleOf('Right', 'Arm', 'ForeArm', 'Hand'),
    ankleDeltaL: ankleAngle(rig, 'Left') - rig.neutralAnkleL,
    ankleDeltaR: ankleAngle(rig, 'Right') - rig.neutralAnkleR,
  }

  // 自穿插（胶囊便宜档）
  const selfIntersections: Array<{ parts: [string, string]; depthRatio: number }> = []
  for (const [pa, pb] of CAPSULE_PAIRS) {
    const segA = CAPSULE_SEGMENTS[pa]
    const segB = CAPSULE_SEGMENTS[pb]
    const ra = rig.capsuleRadius.get(pa)
    const rb = rig.capsuleRadius.get(pb)
    if (!segA || !segB || !ra || !rb) continue
    const a0 = boneLocalPosition(rig, segA[0])
    const a1 = boneLocalPosition(rig, segA[1])
    const b0 = boneLocalPosition(rig, segB[0])
    const b1 = boneLocalPosition(rig, segB[1])
    if (!a0 || !a1 || !b0 || !b1) continue
    const dist = segmentDistance3D(a0, a1, b0, b1)
    const limit = (ra + rb) * CAPSULE_PENETRATION_RATIO
    if (dist < limit) selfIntersections.push({ parts: [pa, pb], depthRatio: 1 - dist / Math.max(1e-6, ra + rb) })
  }

  return {
    facing: [facing.x, facing.z],
    comXZ: [com.x, com.z],
    comMarginH,
    comForwardOffsetH,
    contacts,
    angles,
    clearanceByPart: Object.fromEntries(clearance),
    selfIntersections,
  }
}

export function evaluatePoseAgainstSpec(report: PoseMetricsReport, spec: PoseIntentSpec): PoseFinding[] {
  const findings: PoseFinding[] = []
  const contactEps = spec.contactEpsH ?? CONTACT_EPS_H
  const contacts = new Set(
    Object.entries(report.clearanceByPart)
      .filter(([, h]) => h < contactEps)
      .map(([part]) => part),
  )

  for (const part of spec.requiredContacts) {
    if (!contacts.has(part)) {
      const clearance = report.clearanceByPart[part]
      findings.push({
        code: `missing-contact:${part}`,
        severity: 'P0',
        measured: clearance ?? Number.NaN,
        expected: [0, contactEps],
        human: `「${part}」应触地但离地 ${((clearance ?? 0) * 100).toFixed(1)}%身高（悬空）`,
      })
    }
  }
  for (const part of spec.forbiddenContacts ?? []) {
    if (contacts.has(part)) {
      findings.push({
        code: `forbidden-contact:${part}`,
        severity: 'P0',
        measured: report.clearanceByPart[part] ?? 0,
        expected: [CONTACT_EPS_H, Number.POSITIVE_INFINITY],
        human: `「${part}」不该触地却贴到了地面（陷地/塌姿）`,
      })
    }
  }

  if (spec.comInsideSupport && report.comMarginH !== null) {
    const minMargin = spec.comMarginMinH ?? 0.015
    if (report.comMarginH < minMargin) {
      const dir = (report.comForwardOffsetH ?? 0) >= 0 ? '前' : '后'
      findings.push({
        code: 'com-outside-support',
        severity: 'P0',
        measured: report.comMarginH,
        expected: [minMargin, Number.POSITIVE_INFINITY],
        human:
          report.comMarginH < 0
            ? `重心投影出支撑面 ${(-report.comMarginH * 100).toFixed(1)}%身高（向${dir}，会摔倒）`
            : `重心离支撑面边缘仅 ${(report.comMarginH * 100).toFixed(1)}%身高（勉强站稳，向${dir}偏）`,
      })
    }
  }

  const checkWindow = (name: PoseAngleName, window: [number, number], severity: PoseFindingSeverity) => {
    const value = report.angles[name]
    if (value < window[0] || value > window[1]) {
      findings.push({
        code: `angle:${name}`,
        severity,
        measured: value,
        expected: window,
        human: `${ANGLE_HUMAN[name]} ${value.toFixed(1)}°，应在 [${window[0]}°, ${window[1]}°]`,
      })
    }
  }
  for (const [name, window] of Object.entries(HARD_ANGLE_LIMITS) as Array<[PoseAngleName, [number, number]]>) {
    checkWindow(name, window, 'P0')
  }
  for (const [name, window] of Object.entries(spec.angles ?? {}) as Array<[PoseAngleName, [number, number]]>) {
    checkWindow(name, window, 'P1')
  }

  const allowedPairs = new Set((spec.allowedIntersections ?? []).map((pair) => [...pair].sort().join('x')))
  for (const hit of report.selfIntersections) {
    if (allowedPairs.has([...hit.parts].sort().join('x'))) continue
    findings.push({
      code: `self-intersect:${hit.parts[0]}x${hit.parts[1]}`,
      severity: 'P0',
      measured: hit.depthRatio,
      expected: [0, 1 - CAPSULE_PENETRATION_RATIO],
      human: `「${hit.parts[0]}」与「${hit.parts[1]}」互相穿插（深度比 ${(hit.depthRatio * 100).toFixed(0)}%）`,
    })
  }

  // 同一角度同时触发硬闸(P0)与意图窗(P1)时只留 P0，避免重复噪音。
  const p0Angles = new Set(findings.filter((f) => f.severity === 'P0' && f.code.startsWith('angle:')).map((f) => f.code))
  return findings.filter((f) => !(f.severity === 'P1' && p0Angles.has(f.code)))
}

/** posecode 式人话报告：给 VLM prompt 与循环日志用。 */
export function describePoseFindings(findings: PoseFinding[]): string {
  if (findings.length === 0) return '未检出确定性缺陷'
  return findings
    .map((f) => `[${f.severity}] ${f.human}`)
    .join('\n')
}
