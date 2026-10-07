/**
 * [INPUT]: 依赖 three 的几何类与 Box3（只量包围盒，不渲染）、./directorTypes 的 DirectorObjectType / DirectorPrimitiveType / Vec3
 * [OUTPUT]: 对外提供 CHARACTER_HEIGHT / CHARACTER_FOOTPRINT、PRIMITIVE_GEOMETRY（图元几何表，渲染与量尺共用）、scaledBounds（物体相对原点的包围盒）、
 *          boundsSource（包围盒从哪来：渲染真值 / 模型实量 / 兜底）、measureObjectBounds（模型加载后用 Box3 实量局部包围盒）、
 *          originYForBottom / originYForCenter（唯一的「底 / 中心 ↔ 原点」换算）、
 *          segmentBlocked（视线线段是否在到达终点前穿过一个包围盒：three 的 Ray.intersectBox）
 * [POS]: director/model 的空间事实唯一 owner：这个东西多大、原点在哪、底在哪。渲染组件 PrimitiveEntity 按 PRIMITIVE_GEOMETRY 画，
 *        编译器 / 测量 / 相机避让 / AI 搭场景都从这里量，不各抄一份。除 model 里的 THREE 禁令外，这是唯一 import three 的文件（只用几何类与 Box3，无 WebGL）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import type { DirectorMeasuredBounds, DirectorObjectType, DirectorPrimitiveType, Vec3 } from './directorTypes'

// 假人真实身高（米）：渲染按骨骼量高度缩放到它，脚底落在对象原点
export const CHARACTER_HEIGHT = 1.75
// unverified：渲染只量身高，宽 / 深没有真值，沿用测量模块一直以来的假设
export const CHARACTER_FOOTPRINT = { x: 0.6, z: 0.4 } as const

export type PrimitiveGeometrySpec = {
  geometry: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'tetrahedron' | 'icosahedron'
  args: number[]
  /** 渲染里网格相对对象原点的抬高（米，未乘 scale）。 */
  meshY: number
}

// 渲染真值：PrimitiveEntity 按这张表画，包围盒也由这张表量，所以「渲染」和「量尺」不会再分叉
export const PRIMITIVE_GEOMETRY: Record<DirectorPrimitiveType, PrimitiveGeometrySpec> = {
  cube: { geometry: 'box', args: [1, 1, 1], meshY: 0.5 },
  sphere: { geometry: 'sphere', args: [0.5, 32, 24], meshY: 0.5 },
  plane: { geometry: 'box', args: [1, 0.02, 1], meshY: 0 },
  cylinder: { geometry: 'cylinder', args: [0.5, 0.5, 1, 32], meshY: 0.5 },
  cone: { geometry: 'cone', args: [0.5, 1, 32], meshY: 0.5 },
  torus: { geometry: 'torus', args: [0.4, 0.15, 16, 48], meshY: 0.5 },
  tetrahedron: { geometry: 'tetrahedron', args: [0.6], meshY: 0.5 },
  icosahedron: { geometry: 'icosahedron', args: [0.55], meshY: 0.5 },
}

export function buildPrimitiveGeometry(spec: PrimitiveGeometrySpec): THREE.BufferGeometry {
  const a = spec.args
  switch (spec.geometry) {
    case 'sphere':
      return new THREE.SphereGeometry(a[0], a[1], a[2])
    case 'cylinder':
      return new THREE.CylinderGeometry(a[0], a[1], a[2], a[3])
    case 'cone':
      return new THREE.ConeGeometry(a[0], a[1], a[2])
    case 'torus':
      return new THREE.TorusGeometry(a[0], a[1], a[2], a[3])
    case 'tetrahedron':
      return new THREE.TetrahedronGeometry(a[0])
    case 'icosahedron':
      return new THREE.IcosahedronGeometry(a[0])
    case 'box':
    default:
      return new THREE.BoxGeometry(a[0], a[1], a[2])
  }
}

const cache = new Map<string, THREE.Box3>()
function measure(type: DirectorObjectType): THREE.Box3 {
  if (type === 'character')
    return new THREE.Box3(
      new THREE.Vector3(-CHARACTER_FOOTPRINT.x / 2, 0, -CHARACTER_FOOTPRINT.z / 2),
      new THREE.Vector3(CHARACTER_FOOTPRINT.x / 2, CHARACTER_HEIGHT, CHARACTER_FOOTPRINT.z / 2),
    )
  const spec = PRIMITIVE_GEOMETRY[type as DirectorPrimitiveType]
  if (spec) {
    const geometry = buildPrimitiveGeometry(spec)
    geometry.translate(0, spec.meshY, 0)
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!.clone()
    geometry.dispose()
    return box
  }
  // 没有渲染真值（GLB 还没加载过、没量到；高斯无包围盒、分组无几何）：按 1 米方盒兜底，boundsSource 标 nominal。
  // model 沿用「底贴原点」的旧约定；group / splat 以原点为中心。
  const grounded = type === 'model'
  return new THREE.Box3(new THREE.Vector3(-0.5, grounded ? 0 : -0.5, -0.5), new THREE.Vector3(0.5, grounded ? 1 : 0.5, 0.5))
}

/** 单位 scale 下，某一类物体相对自己原点的包围盒（返回副本，可随便改）。 */
function localBounds(type: DirectorObjectType): THREE.Box3 {
  let box = cache.get(type)
  if (!box) {
    box = measure(type)
    cache.set(type, box)
  }
  return box.clone()
}

export type ScaledBounds = { min: Vec3; max: Vec3; center: Vec3; size: Vec3 }
/** 量包围盒需要的那几个字段：类型、scale，模型还有加载后实量的局部包围盒。 */
export type BoundsSubject = { type: DirectorObjectType; scale: Vec3; measuredBounds?: DirectorMeasuredBounds }
export type BoundsSource = 'render' | 'measured' | 'nominal'

const finiteBounds = (bounds: DirectorMeasuredBounds | undefined): bounds is DirectorMeasuredBounds =>
  !!bounds && [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z].every(Number.isFinite) &&
  bounds.max.x >= bounds.min.x && bounds.max.y >= bounds.min.y && bounds.max.z >= bounds.min.z

/** 包围盒从哪来：图元 / 角色 = 渲染真值；模型量过 = 实量；模型没量过、高斯、分组 = 1 米方盒兜底（nominal，调用方要标出来）。 */
export function boundsSource(subject: BoundsSubject): BoundsSource {
  if (subject.type === 'model') return finiteBounds(subject.measuredBounds) ? 'measured' : 'nominal'
  return subject.type === 'group' || subject.type === 'splat' ? 'nominal' : 'render'
}

/** 带 scale（不带旋转）的、相对原点的包围盒：编译器避让、测量、视线、AI 搭场景落地都用这个。模型有实量就用实量（唯一真值，不手抄）。 */
export function scaledBounds(subject: BoundsSubject): ScaledBounds {
  const scale = subject.scale
  const box = subject.type === 'model' && finiteBounds(subject.measuredBounds)
    ? new THREE.Box3(new THREE.Vector3(subject.measuredBounds.min.x, subject.measuredBounds.min.y, subject.measuredBounds.min.z), new THREE.Vector3(subject.measuredBounds.max.x, subject.measuredBounds.max.y, subject.measuredBounds.max.z))
    : localBounds(subject.type)
  const sx = Math.abs(scale.x), sy = Math.abs(scale.y), sz = Math.abs(scale.z)
  const min = { x: box.min.x * sx, y: box.min.y * sy, z: box.min.z * sz }
  const max = { x: box.max.x * sx, y: box.max.y * sy, z: box.max.z * sz }
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  }
}

/** 唯一的「底 → 原点」换算：要让物体的底落在 y = bottom，原点 y 该是多少。 */
export function originYForBottom(subject: BoundsSubject, bottom: number): number {
  return bottom - scaledBounds(subject).min.y
}

/** 唯一的「中心 → 原点」换算：模型写的是几何中心 y，换成对象原点 y。 */
export function originYForCenter(subject: BoundsSubject, centerY: number): number {
  return centerY - scaledBounds(subject).center.y
}

/**
 * 模型加载后实量局部包围盒（对象自己的坐标系、未乘对象 scale）：遍历网格几何，按「网格相对模型根」的矩阵并起来。
 * 根已经挂进场景也没关系——先扣掉父级的世界矩阵。量不到（没有网格）返回 undefined，调用方保持兜底。
 */
export function measureObjectBounds(root: THREE.Object3D): DirectorMeasuredBounds | undefined {
  root.updateWorldMatrix(true, true)
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert()
  const box = new THREE.Box3()
  const relative = new THREE.Matrix4()
  root.traverse((node) => {
    const geometry = (node as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
    if (!(node as THREE.Mesh).isMesh || !geometry) return
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (!geometry.boundingBox) return
    box.union(geometry.boundingBox.clone().applyMatrix4(relative.multiplyMatrices(toRoot, node.matrixWorld)))
  })
  if (box.isEmpty()) return undefined
  // 根自己的局部变换（模型文件里根节点的位姿）也属于模型
  box.applyMatrix4(new THREE.Matrix4().compose(root.position, root.quaternion, root.scale))
  return { min: { x: box.min.x, y: box.min.y, z: box.min.z }, max: { x: box.max.x, y: box.max.y, z: box.max.z } }
}

const ray = new THREE.Ray()
const hitPoint = new THREE.Vector3()
const scratchBox = new THREE.Box3()
/**
 * 视线 from → to 在到达 to 之前（留 margin 米）是否穿过盒子；from 在盒子里也算挡住。用 three 的 Ray.intersectBox，不自写求交。
 * 舞台上的东西都是图元 / 角色 / 已量的模型包围盒，盒级就是真值；网格级射线（three-mesh-bvh）等真网格遮挡成为需求再接。
 */
export function segmentBlocked(from: Vec3, to: Vec3, box: { min: Vec3; max: Vec3 }, margin = 0.05): boolean {
  const length = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z)
  if (length < 1e-6) return false
  ray.origin.set(from.x, from.y, from.z)
  ray.direction.set((to.x - from.x) / length, (to.y - from.y) / length, (to.z - from.z) / length)
  scratchBox.min.set(box.min.x, box.min.y, box.min.z)
  scratchBox.max.set(box.max.x, box.max.y, box.max.z)
  const hit = ray.intersectBox(scratchBox, hitPoint)
  return !!hit && hit.distanceTo(ray.origin) < length - margin
}
