import * as THREE from 'three'
import {
  LOCOMOTION_CLIP_IDLE,
  LOCOMOTION_CLIP_RUN,
  LOCOMOTION_CLIP_WALK,
  LOCOMOTION_RUN_SPEED_THRESHOLD,
  LOCOMOTION_WALK_SPEED_THRESHOLD,
  type Scene3DLocomotionClip,
  type Scene3DMovementCode,
} from './scene3dConstants'
import type { Scene3DVector3 } from './scene3dTypes'

// header「速度」滑块（flySpeed，原给相机 fly 调）的取值范围（与 Scene3DFullscreen 滑块 min/max 一致）。
export const CHARACTER_DRIVE_FLY_SPEED_MIN = 1
export const CHARACTER_DRIVE_FLY_SPEED_MAX = 16
// 角色走位地面基速（米/秒）。滑块在此之上缩放：低档=从容走路(远低于 run 阈值 3.2)，
// 高档=明确奔跑(越过 run 阈值)。基速以下任何缩放都走路，基速 ~2.3 倍才奔跑。
export const CHARACTER_DRIVE_BASE_GROUND_SPEED = 2.6
// 滑块两端相对基速的缩放：低端 ≈ 基速×0.46 (≈1.2 m/s 舒适走)、高端 ≈ 基速×2.31 (≈6.0 m/s 奔跑)。
const GROUND_SPEED_SCALE_AT_MIN_FLY = 0.46
const GROUND_SPEED_SCALE_AT_MAX_FLY = 2.31

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

// #2 A-hybrid：retargetClip 对绕肩手臂链校正差（headless 钉死：walk@0.5s 手-肩 y≈-0.005、横展 0.713
// = 手臂水平张开退回 bind T-pose），但对绕髋腿/脊链校正好。所以播 locomotion 时**滤掉手臂链的 track**，
// 只让腿/髋/脊被动画驱动，手臂另由「手臂下垂」静态姿势兜（applyMannequinArmDownPose）。
// 这个纯字符串谓词判断某条 animation track 是否属于「手臂链」骨（肩/大臂/前臂/手/手指）。
// track 名形如 "mixamorigLeftArm.quaternion"，取 '.' 前的骨名匹配。颈/头不滤（留它们让头自然摆）。
const ARM_LOCOMOTION_BONE_PATTERN = /(Shoulder|Arm|ForeArm|Hand)/
export function isArmLocomotionTrackName(trackName: string): boolean {
  const boneName = trackName.split('.')[0]
  if (!/(Left|Right)/.test(boneName)) return false
  return ARM_LOCOMOTION_BONE_PATTERN.test(boneName)
}

// #9 idle 不靠 clip：locomotion 桶 = idle 时 demand frameloop 不推帧，idle clip 会冻在 bind T-pose。
// 改成 idle（及空 clip）→ 返回 undefined，让 Mannequin 走静态「自然站姿」路径（手臂下垂 + 落地，不依赖推帧）；
// 仅 walk/run 才返回真 clip 名交给 mixer（腿动 + 手臂静态下垂）。纯函数，单测覆盖。
export function locomotionAnimationClip(locomotionClip: string | undefined): string | undefined {
  if (!locomotionClip) return undefined
  if (locomotionClip === LOCOMOTION_CLIP_IDLE) return undefined
  return locomotionClip
}

// #4「走→蹲→走」录制：点静态动作（蹲/挥手）→ locomotionClip 置 ''（CharacterDriveController 冻结位移、
// 显示静态姿势），录制器同刻打了一条 static-pose 关键帧。但「按 WASD 恢复走路」只把 locomotionClip 从 ''
// 接回 walk/run（onLocomotionChange），**没有**往 pose track 打事件 → step-hold 下 squat 关键帧永久 hold
// 到片尾（导出「蹲到底」）。这个纯谓词判断一次 locomotion 变化是否是「从静态动作恢复到走/跑」——是则录制器
// 该补一条 base 关键帧（pose/presetId 皆缺省），让 frameMotionSource 在恢复时刻判回 locomotion（腿重新迈）。
// 仅 '' → 非空 locomotion 才算恢复；walk↔run、→idle、首次进入（prev 非 '')都不补（不污染轨道）。
export function shouldRecordLocomotionResume(
  prevClip: string | undefined,
  nextClip: string | undefined,
): boolean {
  return prevClip === '' && Boolean(nextClip)
}

// 把 header「速度」滑块(flySpeed，1–16) 线性映射到角色走位地面速度(米/秒)。
// 滑块越高走得越快，**高档要越过 run 阈值(3.2)** 触发奔跑、低档保持走路；随滑块连续 derive，不钉死。
// clamp 到滑块范围后归一化，再在「基速×低端缩放 ~ 基速×高端缩放」间线性插值。
export function groundSpeedForFlySpeed(flySpeed: number): number {
  const clamped = Math.min(
    CHARACTER_DRIVE_FLY_SPEED_MAX,
    Math.max(CHARACTER_DRIVE_FLY_SPEED_MIN, flySpeed),
  )
  const t = (clamped - CHARACTER_DRIVE_FLY_SPEED_MIN)
    / (CHARACTER_DRIVE_FLY_SPEED_MAX - CHARACTER_DRIVE_FLY_SPEED_MIN)
  const scale = GROUND_SPEED_SCALE_AT_MIN_FLY
    + t * (GROUND_SPEED_SCALE_AT_MAX_FLY - GROUND_SPEED_SCALE_AT_MIN_FLY)
  return CHARACTER_DRIVE_BASE_GROUND_SPEED * scale
}

// 由「角色当前地面速度(米/秒，非负)」分桶到 locomotion 动画 clip：
// 微小速度以下 = idle（站着），walk 阈值~run 阈值之间 = walk，run 阈值以上 = run。
// 纯函数、帧率无关，供 CharacterDriveController 每帧判桶（只在桶变化时才上抛切 clip）。
export function locomotionForSpeed(speedMetersPerSec: number): Scene3DLocomotionClip {
  const speed = Math.abs(speedMetersPerSec)
  if (speed < LOCOMOTION_WALK_SPEED_THRESHOLD) return LOCOMOTION_CLIP_IDLE
  if (speed >= LOCOMOTION_RUN_SPEED_THRESHOLD) return LOCOMOTION_CLIP_RUN
  return LOCOMOTION_CLIP_WALK
}

// #C 游戏式操控键：Shift 加速跑 / C·Ctrl 下蹲，角色操控（CharacterDriveController）与相机 fly
// （Scene3DControls）共享同一套倍率语义（P4 通用第一，不要角色一个逻辑相机另一个）。
// 1.7x：观感自然的"跑起来"提速——角色这边叠加到地面基速后自然越过 LOCOMOTION_RUN_SPEED_THRESHOLD，
// 复用现有 locomotionForSpeed 分桶，不需要额外强制切 run（别做两套判断）。
export const CHARACTER_DRIVE_RUN_SPEED_MULTIPLIER = 1.7
// 蹲下时移动打折：允许蹲着挪动，但明显比走路慢（游戏惯例）。
export const CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER = 0.5
// 轻跳的抛物线参数：无跳跃骨骼动画素材，纯粹靠 group.position.y 相对 groundY 的短抛物线模拟起伏。
export const CHARACTER_DRIVE_JUMP_HEIGHT = 0.55 // 最高点相对 groundY 的抬升（米）
export const CHARACTER_DRIVE_JUMP_DURATION = 0.5 // 起跳到落地的总时长（秒）

// 由「加速/下蹲」两个互斥的按住态求地面速度倍率。下蹲优先于加速（同时按住时，蹲下更明确地表达"慢下来"的
// 意图；现实里蹲着不太会同时想跑）。都不按住 → 1（不缩放）。纯函数，角色 CharacterDriveController 和
// 相机 Scene3DControls（相机只传 crouching=false，无下蹲语义）共享同一份，避免出现两套倍率来源（P1）。
export function groundSpeedMultiplier(running: boolean, crouching: boolean): number {
  if (crouching) return CHARACTER_DRIVE_CROUCH_SPEED_MULTIPLIER
  if (running) return CHARACTER_DRIVE_RUN_SPEED_MULTIPLIER
  return 1
}

// 跳跃抛物线：给定「起跳后经过的时间」，返回相对 groundY 的向上偏移（米，>=0）。
// 用一段抛物线 4h·t·(D-t)/D²：t=0 或 t=D 时偏移为 0（起跳/落地贴地），t=D/2 时取最大高度 h。
// 落在区间外（尚未起跳 / 已经落地）一律 clamp 到 0——调用方靠这个天然可判断"是否已经落地"。纯函数、单测覆盖。
export function jumpArcOffset(
  elapsedSeconds: number,
  height: number = CHARACTER_DRIVE_JUMP_HEIGHT,
  duration: number = CHARACTER_DRIVE_JUMP_DURATION,
): number {
  if (elapsedSeconds <= 0 || elapsedSeconds >= duration || duration <= 0) return 0
  return (4 * height * elapsedSeconds * (duration - elapsedSeconds)) / (duration * duration)
}
