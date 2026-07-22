// 安全画幅求解器（F1 · 纯几何，零渲染、零 React）：按「拍摄主体的 world-space 包围盒」求相机 target 与
// 最小距离，让主体 8 个角点始终落在安全矩形内，头脚左右都不裁切。默认创建 / 套模板 / 切画幅共用此一求解器，
// 不再各自维护固定机位常量。区别于 scene3dFitView（编辑器「看全场」把相机 gizmo/灯/网格都算进去）——
// 本模块只看真实拍摄主体（mannequin），且保留作者选的方位角、不改 FOV。配单测 scene3dSafeFrame.test.ts。
import * as THREE from 'three'
import { objectVisualHalfHeight } from './scene3dCrowd'
import { cameraLookAtRotation, vectorAlmostEqual } from './scene3dMath'
import { SCENE3D_ASPECT_RATIOS, type Scene3DAspectRatio, type Scene3DCamera, type Scene3DObject, type Scene3DVector3 } from './scene3dTypes'

export type Scene3DAabb = { center: Scene3DVector3; half: Scene3DVector3 }

// 人形主体的水平/纵深半轴按身高比例估（肩展 ~0.42 半高、身厚 ~0.3 半高）；
// 纵向留 30% 头顶余量兜住举手/发型/下蹲重心偏移等姿势外扩——宁略大不裁切（截头是硬 FAIL）。
const MANNEQUIN_HALF_WIDTH_RATIO = 0.42
const MANNEQUIN_HALF_DEPTH_RATIO = 0.3
const POSE_HEADROOM = 1.3

const WORLD_UP = new THREE.Vector3(0, 1, 0)

/**
 * 单个拍摄主体的 world-space AABB。只框真人（mannequin/crowd），灯/道具/几何不参与成片构图。不可见 → null。
 * 关键：`object.position` 是**脚底基准**（脚站在这），视觉中心在其上方 `objectVisualHalfHeight`——
 * 与 scene3dPlayback（sceneObjectCameraTargetPosition / objectWithPlaybackPose 都 +halfHeight 求中心/瞄准点）
 * 同一口径。此前把 center 直接取 position（脚底）→ 相机瞄脚底、头出框（复测真实构图 PNG 截头的真根因）。
 */
export function objectSubjectAabb(object: Scene3DObject): Scene3DAabb | null {
  if (!object.visible) return null
  if (object.type !== 'mannequin' && object.type !== 'mannequinCrowd') return null
  const visualHalfHeight = objectVisualHalfHeight(object) // 脚底→视觉中心 = 视觉半高
  const halfHeight = visualHalfHeight * POSE_HEADROOM
  const halfWidth = Math.max(halfHeight * MANNEQUIN_HALF_WIDTH_RATIO, 0.5 * Math.abs(object.scale[0] || 1) * MANNEQUIN_HALF_WIDTH_RATIO)
  const halfDepth = Math.max(halfHeight * MANNEQUIN_HALF_DEPTH_RATIO, 0.5 * Math.abs(object.scale[2] || 1) * MANNEQUIN_HALF_DEPTH_RATIO)
  return {
    center: [object.position[0], object.position[1] + visualHalfHeight, object.position[2]],
    half: [halfWidth, halfHeight, halfDepth],
  }
}

/** 主体集合的 union AABB（双人取两人并集）。无主体 → null。 */
export function subjectsUnionAabb(objects: readonly Scene3DObject[]): Scene3DAabb | null {
  const boxes = objects.map(objectSubjectAabb).filter((box): box is Scene3DAabb => box !== null)
  if (boxes.length === 0) return null
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min.setComponent(axis, Math.min(min.getComponent(axis), box.center[axis] - box.half[axis]))
      max.setComponent(axis, Math.max(max.getComponent(axis), box.center[axis] + box.half[axis]))
    }
  }
  return {
    center: [(min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2],
    half: [(max.x - min.x) / 2, (max.y - min.y) / 2, (max.z - min.z) / 2],
  }
}

/** 相机基（forward=从机位看向 target；right/up 正交）。solver 与 projector 共用同一构造，保证投影一致。 */
function cameraBasis(position: THREE.Vector3, target: THREE.Vector3): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const forward = target.clone().sub(position)
  if (forward.lengthSq() < 1e-10) forward.set(0, 0, -1)
  forward.normalize()
  let right = forward.clone().cross(WORLD_UP)
  if (right.lengthSq() < 1e-8) right = forward.clone().cross(new THREE.Vector3(1, 0, 0))
  right.normalize()
  const up = right.clone().cross(forward).normalize()
  return { forward, right, up }
}

function aabbCorners(box: Scene3DAabb): THREE.Vector3[] {
  const corners: THREE.Vector3[] = []
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push(new THREE.Vector3(
          box.center[0] + sx * box.half[0],
          box.center[1] + sy * box.half[1],
          box.center[2] + sz * box.half[2],
        ))
      }
    }
  }
  return corners
}

/**
 * 把世界点投影到相机屏幕 NDC [0,1]（x 右、y 下；主体正中 → 0.5,0.5）。点在相机后方（深度≤0）→ null。
 * 与 solveSafeFrameCamera 同一相机基 + 同一透视口径，供求解验证/回归断言复用。
 */
export function projectPointToScreen(
  point: Scene3DVector3,
  cameraPosition: Scene3DVector3,
  cameraTarget: Scene3DVector3,
  fovVerticalDeg: number,
  aspect: number,
): { x: number; y: number } | null {
  const position = new THREE.Vector3(...cameraPosition)
  const target = new THREE.Vector3(...cameraTarget)
  const { forward, right, up } = cameraBasis(position, target)
  const relative = new THREE.Vector3(...point).sub(position)
  const depth = relative.dot(forward)
  if (depth <= 1e-6) return null
  const tanV = Math.tan((fovVerticalDeg * Math.PI) / 360)
  const tanH = tanV * aspect
  const ndcX = relative.dot(right) / (depth * tanH)
  const ndcY = relative.dot(up) / (depth * tanV)
  return { x: (ndcX + 1) / 2, y: (1 - ndcY) / 2 }
}

/** 主体 AABB 投影到屏幕的最小外接矩形（[0,1]）。任一角点在相机后方 → null（构图无意义）。 */
export function projectAabbScreenRect(
  box: Scene3DAabb,
  cameraPosition: Scene3DVector3,
  cameraTarget: Scene3DVector3,
  fovVerticalDeg: number,
  aspect: number,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const corner of aabbCorners(box)) {
    const screen = projectPointToScreen(
      [corner.x, corner.y, corner.z], cameraPosition, cameraTarget, fovVerticalDeg, aspect,
    )
    if (!screen) return null
    minX = Math.min(minX, screen.x)
    minY = Math.min(minY, screen.y)
    maxX = Math.max(maxX, screen.x)
    maxY = Math.max(maxY, screen.y)
  }
  return { minX, minY, maxX, maxY }
}

export type SafeFrameSolution = { target: Scene3DVector3; position: Scene3DVector3; distance: number }

/**
 * 求安全画幅相机：target=主体 AABB 中心；沿给定视线方向反向解**最小距离**，使 AABB 8 角投影全落进
 * 安全矩形 [margin, 1-margin]（头脚左右都不裁）。保留作者方位角（direction）、不改 FOV。
 * 口径：把 AABB 半轴投到相机 right/up/forward，按近面（center 距 - forward 半轴）满足安全占比反解距离。
 */
export function solveSafeFrameCamera(input: {
  subject: Scene3DAabb
  direction: Scene3DVector3
  fovVerticalDeg: number
  aspect: number
  margin: number
  minDistance?: number
}): SafeFrameSolution {
  const { subject, fovVerticalDeg, aspect, margin } = input
  const center = new THREE.Vector3(...subject.center)
  const dir = new THREE.Vector3(...input.direction)
  if (dir.lengthSq() < 1e-10) dir.set(0.6, 0.35, 0.8)
  dir.normalize()
  // 相机在 target 后方 → forward（看向 target）= -dir。用一个试位建基。
  const probePosition = center.clone().addScaledVector(dir, -1)
  const { forward, right, up } = cameraBasis(probePosition, center)
  const half = new THREE.Vector3(...subject.half)
  const projHalfRight = Math.abs(half.x * right.x) + Math.abs(half.y * right.y) + Math.abs(half.z * right.z)
  const projHalfUp = Math.abs(half.x * up.x) + Math.abs(half.y * up.y) + Math.abs(half.z * up.z)
  const projHalfFwd = Math.abs(half.x * forward.x) + Math.abs(half.y * forward.y) + Math.abs(half.z * forward.z)
  const tanV = Math.tan((fovVerticalDeg * Math.PI) / 360)
  const tanH = tanV * aspect
  const safeFrac = Math.max(0.05, 1 - 2 * margin)
  const distV = projHalfUp / (tanV * safeFrac) + projHalfFwd
  const distH = projHalfRight / (tanH * safeFrac) + projHalfFwd
  const distance = Math.max(distV, distH, input.minDistance ?? 0)
  const position = center.clone().addScaledVector(dir, -distance)
  return {
    target: [center.x, center.y, center.z],
    position: [position.x, position.y, position.z],
    distance,
  }
}

// 默认 12% 安全边距（比 10% 求解线多一点呼吸，兜住半宽估计误差；仍远严于 8% 量测容差）。
export const SAFE_FRAME_DEFAULT_MARGIN = 0.12

/**
 * 从「当前拍摄主体 + 相机现有方位/FOV/画幅」求安全画幅位姿（默认创建 / 套模板 / 切画幅 / 主体入镜共用）。
 * 保留相机现有视线方向（target-position），只重解 target=主体中心 + 最小距离。无主体 → null（不动相机）。
 */
export function safeFrameCameraForSubjects(
  subjects: readonly Scene3DObject[],
  camera: { position: Scene3DVector3; target: Scene3DVector3; fov: number; aspectRatio: Scene3DAspectRatio },
  margin: number = SAFE_FRAME_DEFAULT_MARGIN,
): { position: Scene3DVector3; target: Scene3DVector3 } | null {
  const subject = subjectsUnionAabb(subjects)
  if (!subject) return null
  const direction: Scene3DVector3 = [
    camera.target[0] - camera.position[0],
    camera.target[1] - camera.position[1],
    camera.target[2] - camera.position[2],
  ]
  const solution = solveSafeFrameCamera({
    subject,
    direction,
    fovVerticalDeg: camera.fov,
    aspect: SCENE3D_ASPECT_RATIOS[camera.aspectRatio] ?? 16 / 9,
    margin,
  })
  return { position: solution.position, target: solution.target }
}

/**
 * 只在相机是 auto-managed 时按当前主体重解安全画幅（default/模板/切画幅/切输出视图共用）；
 * manual 相机或无主体 → null（绝不覆盖用户手动构图）。rotation 由调用方 cameraLookAtRotation 补。
 */
export function reframeAutoCameraPose(
  camera: Scene3DCamera,
  subjects: readonly Scene3DObject[],
  margin: number = SAFE_FRAME_DEFAULT_MARGIN,
): { position: Scene3DVector3; target: Scene3DVector3 } | null {
  if (camera.framing !== 'auto') return null
  return safeFrameCameraForSubjects(subjects, camera, margin)
}

/** patchCamera 构图所有权判定：用户真改机位/target(>epsilon) → 转 manual；显式带 framing 的（自动取景/系统写回）尊重之。 */
export function patchCameraFraming(camera: Scene3DCamera, patch: Partial<Scene3DCamera>): Partial<Scene3DCamera> {
  if (patch.framing !== undefined) return patch
  const userMoved =
    (patch.position !== undefined && !vectorAlmostEqual(patch.position, camera.position)) ||
    (patch.target !== undefined && !vectorAlmostEqual(patch.target, camera.target))
  return userMoved ? { ...patch, framing: 'manual' } : patch
}

/** auto 相机按 overrides（如切画幅）后的主体重解安全画幅，返回完整 patch；manual/无主体 → 只回 overrides（不动构图）。 */
export function autoReframeCameraPatch(
  camera: Scene3DCamera,
  subjects: readonly Scene3DObject[],
  overrides: Partial<Scene3DCamera> = {},
): Partial<Scene3DCamera> {
  const reframed = reframeAutoCameraPose({ ...camera, ...overrides } as Scene3DCamera, subjects)
  if (!reframed) return overrides
  return {
    ...overrides,
    position: reframed.position,
    target: reframed.target,
    rotation: cameraLookAtRotation(reframed.position, reframed.target),
    framing: 'auto',
  }
}
