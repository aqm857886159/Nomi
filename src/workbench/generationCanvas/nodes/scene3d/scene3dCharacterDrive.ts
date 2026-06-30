import * as THREE from 'three'
import type { Scene3DMovementCode } from './scene3dConstants'
import type { Scene3DVector3 } from './scene3dTypes'

// 角色操控（possess）纯运动学层。和相机 fly（scene3dViewControllers）是两条独立路径：
// 相机 fly 把按键映射到「相机本地空间」并允许 y 飞行；角色操控只在「地面平面 x/z」走位、贴地、自动面向。
// 这里只放可单测的纯函数；R3F 控制器与节流提交在 scene3dCharacterDrive.tsx。

const _forward = new THREE.Vector3()
const _right = new THREE.Vector3()

// 由按键集合 + 相机水平朝向(yaw) 推出地面移动方向（单位向量，y=0）。
// 方向相对相机：W=朝相机看向的水平方向前进，S=后退，A/D=左右扫。无按键或抵消 → 零向量。
// 注意 yaw 约定与相机一致（applyEditorCameraPose 用 'YXZ'，-Z 为前）：
// 前进方向 = (-sin(yaw), 0, -cos(yaw))；右方向 = (cos(yaw), 0, -sin(yaw))。
export function groundMoveDirection(
  keys: Partial<Record<Scene3DMovementCode, boolean>>,
  cameraYaw: number,
): THREE.Vector3 {
  let forwardAxis = 0
  let rightAxis = 0
  if (keys.KeyW || keys.ArrowUp) forwardAxis += 1
  if (keys.KeyS || keys.ArrowDown) forwardAxis -= 1
  if (keys.KeyD || keys.ArrowRight) rightAxis += 1
  if (keys.KeyA || keys.ArrowLeft) rightAxis -= 1
  if (forwardAxis === 0 && rightAxis === 0) return new THREE.Vector3(0, 0, 0)
  _forward.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw))
  _right.set(Math.cos(cameraYaw), 0, -Math.sin(cameraYaw))
  const direction = new THREE.Vector3()
  direction.addScaledVector(_forward, forwardAxis)
  direction.addScaledVector(_right, rightAxis)
  if (direction.lengthSq() < 1e-9) return new THREE.Vector3(0, 0, 0)
  return direction.normalize()
}

// 由地面移动方向推出「角色应面向的 yaw」。约定与 groundMoveDirection 的前向一致：
// 绕 Y 旋转 yaw 后物体本地 -Z 轴 = (-sin(yaw), 0, -cos(yaw))。令其等于移动方向 d
// → yaw = atan2(-d.x, -d.z)，角色正面（-Z）即指向移动方向。
// 零向量（无移动）→ 返回 null（保持当前朝向，不要突然转回正前方）。
export function facingYawFromDirection(direction: THREE.Vector3): number | null {
  if (direction.lengthSq() < 1e-9) return null
  return Math.atan2(-direction.x, -direction.z)
}

// 把任意角度归一化到 (-π, π]。
export function normalizeAngle(angle: number): number {
  let value = angle % (Math.PI * 2)
  if (value > Math.PI) value -= Math.PI * 2
  if (value <= -Math.PI) value += Math.PI * 2
  return value
}

// 两 yaw 之间的最短有符号角差（target - current，落在 (-π, π]）。
export function shortestAngleDelta(current: number, target: number): number {
  return normalizeAngle(target - current)
}

// 沿最短弧把 current yaw 平滑插值向 target。lambda 越大转身越快；delta 为帧时长(秒)。
// 用指数阻尼（与相机 fly 的 1-exp(-k*dt) 同套），帧率无关、不过冲。
export function dampYaw(current: number, target: number, lambda: number, delta: number): number {
  const diff = shortestAngleDelta(current, target)
  if (Math.abs(diff) < 1e-5) return normalizeAngle(target)
  const blend = 1 - Math.exp(-lambda * delta)
  return normalizeAngle(current + diff * blend)
}

// 角色在地面行走，y 永远贴地（不飞行）。给定当前 position 与水平位移(dx,dz)，
// 返回新的地面 position：x/z 平移，y 保持传入的 groundY（脚踩地由 groundMannequinModel 在渲染层处理，
// 这里只保证根对象不偏离它落地时的 y 基准）。
export function applyGroundTranslation(
  position: Scene3DVector3,
  deltaX: number,
  deltaZ: number,
  groundY: number,
): Scene3DVector3 {
  return [
    Number((position[0] + deltaX).toFixed(4)),
    Number(groundY.toFixed(4)),
    Number((position[2] + deltaZ).toFixed(4)),
  ]
}
