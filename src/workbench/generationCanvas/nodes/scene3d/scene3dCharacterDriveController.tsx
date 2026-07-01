import React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  MANNEQUIN_POSE_PRESETS,
  type Scene3DMovementCode,
} from './scene3dConstants'
import {
  clearMovementKeyState,
  clonePoseValue,
  eulerToArray,
  findSceneObjectByRuntimeId,
  isEditableKeyboardTarget,
  isMovementCode,
} from './scene3dMath'
import {
  applyGroundTranslation,
  dampYaw,
  facingYawFromDirection,
  groundMoveDirection,
  groundSpeedForFlySpeed,
  groundSpeedMultiplier,
  jumpArcOffset,
  locomotionForSpeed,
  CHARACTER_DRIVE_JUMP_DURATION,
} from './scene3dCharacterDrive'
import { LOCOMOTION_CLIP_IDLE } from './scene3dConstants'
import type { Scene3DObject } from './scene3dTypes'

// #C 下蹲复用现成的 squat 静态姿势预设（不新造姿势数据，同 ACTION_LIBRARY 的 squat 按钮共享同一份数据源，P1）。
const CROUCH_POSE_PRESET = MANNEQUIN_POSE_PRESETS.find((preset) => preset.id === 'squat')

const TURN_LAMBDA = 11 // 自动面向转身的阻尼系数（越大转身越快）
const COMMIT_INTERVAL = 0.08 // 节流提交 state 的间隔(秒)，复用 CameraViewEditController 的 80ms

// 操控（possess）某假人的实时控制器。和相机 fly（Scene3DControls）是两条独立键盘路径：
// 只在 possess 激活时挂键盘、且相机 fly 此时被 Scene3DFullscreen 锁成 edit（viewLocked）让出 WASD。
// 直驱：每帧改被操控假人 group 的 position/rotation（不走 React），节流 80ms + dirty 检测后才提交 state，
// 照 CameraViewEditController 那套，避免每帧 setState 触发全场景 reconcile。
export function CharacterDriveController({
  possessedObject,
  flySpeed,
  locomotionClip,
  onObjectPatch,
  onLocomotionChange,
}: {
  possessedObject: Scene3DObject
  // header「速度」滑块(1–16，与相机 fly 同一个)。高档 → 地面速度越过 run 阈值播奔跑，低档走路。
  flySpeed: number
  // 当前 UI locomotion clip：idle/walk/run = 走位态；'' = 用户点了静态动作（蹲/挥手…）→ 停下做动作（#8）。
  // 由 useScene3DCharacterDrive.applyActionPreset 置空、由本控制器经 onLocomotionChange 重置回 idle/walk/run。
  locomotionClip?: string
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  // 当 locomotion 桶（idle/walk/run）变化时上抛——驱动被操控假人切迈腿动画 clip。仅在桶变化时调用（非每帧）。
  onLocomotionChange?: (clip: string) => void
}): null {
  const { camera, scene, invalidate } = useThree()
  // 滑块值放 ref，useFrame 每帧读最新值；改滑块不重订阅、不重挂键盘。
  const flySpeedRef = React.useRef(flySpeed)
  flySpeedRef.current = flySpeed
  const locomotionRef = React.useRef<string>(LOCOMOTION_CLIP_IDLE)
  // #8 静态动作「停下做动作，再走自动接回」：点蹲/挥手等静态动作（locomotionClip='')→ frozen=true，
  // 该状态下**不推进位移**（治「蹲着滑行」），且清掉按住的走位键，必须一次**新的**走位 keydown 才解冻接回走路。
  const staticActionFrozenRef = React.useRef(false)
  const objectIdRef = React.useRef(possessedObject.id)
  const groundYRef = React.useRef(possessedObject.position[1])
  const yawRef = React.useRef(possessedObject.rotation[1])
  const positionRef = React.useRef<THREE.Vector3>(
    new THREE.Vector3(possessedObject.position[0], possessedObject.position[1], possessedObject.position[2]),
  )
  const groupRef = React.useRef<THREE.Group | null>(null)
  const lastCommitTimeRef = React.useRef(0)
  const cameraEulerRef = React.useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const keyStateRef = React.useRef<Record<Scene3DMovementCode, boolean>>({
    KeyW: false, KeyA: false, KeyS: false, KeyD: false,
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
    Space: false, ShiftLeft: false, ShiftRight: false,
  })
  // #C 下蹲（C / Ctrl，按住）：不走 Scene3DMovementCode 的共享 WASD/Space/Shift 管线（那套被相机 fly
  // 复用、且 Ctrl 修饰键会撞现有"任何带 ctrlKey 的按键一律当系统组合键忽略"防护），单独一对 ref 本地跟踪，
  // 只在这个控制器内生效——蹲下是角色专属语义，相机 fly 没有这个概念（P4：不强推不需要的通用）。
  const crouchHeldRef = React.useRef(false)
  // #C 跳跃（Space，按下沿触发一次）：jumpingRef=true 期间每帧按抛物线纯视觉抬升 group.position.y，
  // 不写回 state（跳跃不是"新的落地基准"，落地即精确回到 groundYRef）。落地前 jumpingRef 挡住重复触发。
  const jumpingRef = React.useRef(false)
  const jumpElapsedRef = React.useRef(0)
  // locomotionClip 最新值放 ref：C 松开时判断"现在是不是处于点击式静态动作(''）"，是则不动 pose——尊重
  // 用户后点的动作库选择，不被蹲键释放顺手抹掉（#B 点击态 和 #C 按住态两套状态机的互斥点，见 keyup 里的用法）。
  const locomotionClipRef = React.useRef(locomotionClip)
  locomotionClipRef.current = locomotionClip

  // 换被操控对象 / 外部改了它的 transform（如属性面板）→ 重新对齐驱动基准。
  React.useLayoutEffect(() => {
    objectIdRef.current = possessedObject.id
    groundYRef.current = possessedObject.position[1]
    yawRef.current = possessedObject.rotation[1]
    positionRef.current.set(
      possessedObject.position[0],
      possessedObject.position[1],
      possessedObject.position[2],
    )
    groupRef.current = findSceneObjectByRuntimeId(scene, possessedObject.id) as THREE.Group | null
  }, [possessedObject.id, possessedObject.position, possessedObject.rotation, scene])

  // #C：切到不同被操控对象 → 清跳跃/下蹲的瞬时态（不跟着上面那个 effect 一起清，那个在每次节流提交
  // position/rotation 时都会重跑，若混在一起会把"正在进行中的跳跃/下蹲"每 80ms 打断一次）。只认 id 变化。
  React.useLayoutEffect(() => {
    crouchHeldRef.current = false
    jumpingRef.current = false
    jumpElapsedRef.current = 0
  }, [possessedObject.id])

  // #8：locomotionClip 切到 '' = 用户点了静态动作 → 冻结位移 + 清键（停下做动作，不滑行）。
  // 切回 idle/walk/run（如本控制器或外部恢复）→ 解冻。
  React.useLayoutEffect(() => {
    if (locomotionClip === '') {
      staticActionFrozenRef.current = true
      clearMovementKeyState(keyStateRef.current)
      // 失忆当前桶：解冻后第一次移动必触发桶变化上抛，把 locomotionClip 从 '' 接回 walk/run（否则停在静态姿势）。
      locomotionRef.current = ''
    } else if (locomotionClip) {
      staticActionFrozenRef.current = false
    }
  }, [locomotionClip])

  React.useEffect(() => {
    const keyState = keyStateRef.current

    // C 松开 → 若此刻不处于「点击式静态动作」冻结态（locomotionClip !== ''），把 pose 收回站姿（松手自愈，
    // 见 #C）；若用户蹲着时又点了动作库（真冻结），那是用户后做的显式选择，不被这里的松键动作覆盖。
    const releaseCrouch = () => {
      if (!crouchHeldRef.current) return
      crouchHeldRef.current = false
      if (locomotionClipRef.current !== '') {
        onObjectPatch(objectIdRef.current, { pose: undefined })
      }
    }

    const clearKeys = () => {
      clearMovementKeyState(keyState)
      releaseCrouch()
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return
      // 下蹲（C 或 Ctrl，按住）：走独立分支，不进 isMovementCode 的共享 WASD/Space/Shift 管线（那套被相机
      // fly 复用；且 Ctrl 修饰键本身会让下面通用的 event.ctrlKey 防护误判成系统组合键，见顶部注释）。
      if (event.code === 'KeyC' || event.code === 'ControlLeft' || event.code === 'ControlRight') {
        if (event.metaKey || event.altKey) return
        event.preventDefault()
        event.stopPropagation()
        // #8/#C 统一规则：任何「动作类」按键的 keydown 都会解冻点击式静态动作（不止 WASD）——按了这些键
        // 说明用户想动/想做别的，不该继续卡在之前点的挥手/坐下等姿势里（这也顺带彻底解掉 #B 那类卡住）。
        staticActionFrozenRef.current = false
        if (!crouchHeldRef.current) {
          crouchHeldRef.current = true
          if (CROUCH_POSE_PRESET) {
            onObjectPatch(objectIdRef.current, { pose: clonePoseValue(CROUCH_POSE_PRESET.pose) })
          }
        }
        invalidate()
        return
      }
      if (!isMovementCode(event.code)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      staticActionFrozenRef.current = false
      // 跳跃（Space，按下沿触发一次）：event.repeat 过滤系统自动重复；jumpingRef 挡住落地前重复触发。
      if (event.code === 'Space' && !event.repeat && !jumpingRef.current) {
        jumpingRef.current = true
        jumpElapsedRef.current = 0
      }
      keyState[event.code] = true
      invalidate()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'KeyC' || event.code === 'ControlLeft' || event.code === 'ControlRight') {
        releaseCrouch()
        return
      }
      if (!isMovementCode(event.code)) return
      keyState[event.code] = false
    }

    // capture: true 抢在相机 Scene3DControls 之前消费走位键，杜绝两条 WASD 路径争用。
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('keyup', handleKeyUp, { capture: true })
    window.addEventListener('blur', clearKeys)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('keyup', handleKeyUp, { capture: true })
      window.removeEventListener('blur', clearKeys)
      clearMovementKeyState(keyState)
    }
  }, [invalidate, onObjectPatch])

  useFrame((state, delta) => {
    const group = groupRef.current
      ?? (findSceneObjectByRuntimeId(scene, objectIdRef.current) as THREE.Group | null)
    groupRef.current = group

    const cameraEuler = cameraEulerRef.current.setFromQuaternion(camera.quaternion, 'YXZ')
    // #8：静态动作冻结中 → 不读走位键、不推位移（停下做动作）。等一次新的走位 keydown 解冻接回。
    const frozen = staticActionFrozenRef.current
    const direction = frozen ? new THREE.Vector3(0, 0, 0) : groundMoveDirection(keyStateRef.current, cameraEuler.y)
    const moving = direction.lengthSq() > 0

    // 自动面向移动方向（平滑插值）；不移动则保持当前朝向。
    const targetYaw = facingYawFromDirection(direction)
    if (targetYaw !== null) {
      yawRef.current = dampYaw(yawRef.current, targetYaw, TURN_LAMBDA, delta)
    }

    // #C 加速/下蹲倍率：共享 groundSpeedMultiplier（角色/相机 fly 同一套语义，见 scene3dCharacterDrive）。
    // 下蹲优先于加速（同时按住时，蹲下更明确表达"慢下来"）。
    const running = Boolean(keyStateRef.current.ShiftLeft || keyStateRef.current.ShiftRight)
    const crouching = crouchHeldRef.current
    const groundSpeed = moving ? groundSpeedForFlySpeed(flySpeedRef.current) * groundSpeedMultiplier(running, crouching) : 0
    if (moving) {
      const step = groundSpeed * delta
      positionRef.current.x += direction.x * step
      positionRef.current.z += direction.z * step
    }

    // locomotion 桶（idle/walk/run）：由实时地面速度分桶，仅在桶变化时上抛切动画 clip（非每帧，无渲染风暴）。
    // #8 冻结中不上抛——否则 groundSpeed=0→idle 会把 locomotionClip 从 '' 顶成 'idle'，立刻解掉静态动作。
    //   保持显示用户点的静态姿势，直到一次新的走位 keydown 解冻、下一帧再正常上抛 walk/run 接回。
    // #C 下蹲中强制走 idle 桶（不管是否在移动）：没有蹲走混合动画素材，locomotionAnimationClip('idle')
    //   走静态 pose 路径才能显示蹲姿（mixer 播 walk/run clip 时会整段接管骨骼、无视 object.pose，两条路径
    //   打架）；蹲着移动因此是"蹲姿滑步"而非真正的蹲走循环——no 素材的诚实折中，非 bug。
    if (!frozen) {
      const nextLocomotion = crouching ? LOCOMOTION_CLIP_IDLE : locomotionForSpeed(groundSpeed)
      if (nextLocomotion !== locomotionRef.current) {
        locomotionRef.current = nextLocomotion
        onLocomotionChange?.(nextLocomotion)
        invalidate()
      }
    }

    // #C 跳跃：一次性抛物线纯视觉位移，只改 group.position.y、不写回 state（见 jumpingRef 注释）。
    let jumpOffset = 0
    if (jumpingRef.current) {
      jumpElapsedRef.current += delta
      jumpOffset = jumpArcOffset(jumpElapsedRef.current)
      if (jumpElapsedRef.current >= CHARACTER_DRIVE_JUMP_DURATION) {
        jumpingRef.current = false
        jumpElapsedRef.current = 0
        jumpOffset = 0
      }
    }

    // 相机跟随由 Scene3DControls 的 followObjectId useFrame 负责（#3）：orbit 轴心+相机每帧随本 group
    // 世界位置同步平移，角色不飞出框，用户照旧可绕看/拉近。本控制器只管直驱 group，不碰相机链路。

    // 直驱 group（贴地基准 groundYRef + 跳跃抛物线偏移；地面基准本身不受跳跃影响，落地即精确回零）。
    if (group) {
      group.position.set(positionRef.current.x, groundYRef.current + jumpOffset, positionRef.current.z)
      group.rotation.y = yawRef.current
      group.updateMatrixWorld()
    }

    const turning = targetYaw !== null && Math.abs(group ? group.rotation.y - (targetYaw) : 0) > 1e-4
    if (moving || turning || jumpingRef.current) invalidate()

    // 节流提交 state（dirty 由 updateEditorCamera/patchObject 上游兜底，这里只控频率）。
    if (!moving && targetYaw === null) return
    if (state.clock.elapsedTime - lastCommitTimeRef.current < COMMIT_INTERVAL) return
    lastCommitTimeRef.current = state.clock.elapsedTime
    const nextPosition = applyGroundTranslation(
      [positionRef.current.x, groundYRef.current, positionRef.current.z],
      0,
      0,
      groundYRef.current,
    )
    const nextRotation = eulerToArray(
      new THREE.Euler(possessedObject.rotation[0], yawRef.current, possessedObject.rotation[2]),
    )
    onObjectPatch(objectIdRef.current, { position: nextPosition, rotation: nextRotation })
  })

  return null
}
