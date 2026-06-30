import React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  type Scene3DMovementCode,
} from './scene3dConstants'
import {
  clearMovementKeyState,
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
} from './scene3dCharacterDrive'
import type { Scene3DObject } from './scene3dTypes'

const WALK_SPEED = 2.6 // 米/秒（地面走位基速，速度滑块再乘进来）
const SPEED_SCALE = 0.42 // 把 header 速度滑块(1–16，给相机 fly 调的)缩到适合角色走位的尺度
const TURN_LAMBDA = 11 // 自动面向转身的阻尼系数（越大转身越快）
const COMMIT_INTERVAL = 0.08 // 节流提交 state 的间隔(秒)，复用 CameraViewEditController 的 80ms

// 操控（possess）某假人的实时控制器。和相机 fly（Scene3DControls）是两条独立键盘路径：
// 只在 possess 激活时挂键盘、且相机 fly 此时被 Scene3DFullscreen 锁成 edit（viewLocked）让出 WASD。
// 直驱：每帧改被操控假人 group 的 position/rotation（不走 React），节流 80ms + dirty 检测后才提交 state，
// 照 CameraViewEditController 那套，避免每帧 setState 触发全场景 reconcile。
export function CharacterDriveController({
  possessedObject,
  onObjectPatch,
}: {
  possessedObject: Scene3DObject
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
}): null {
  const { camera, scene, invalidate } = useThree()
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

  React.useEffect(() => {
    const keyState = keyStateRef.current
    const clearKeys = () => clearMovementKeyState(keyState)

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target) || !isMovementCode(event.code)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // 只接走位键（WASD/方向键），Space/Shift 不抬升角色（贴地不飞行）。
      if (event.code === 'Space' || event.code === 'ShiftLeft' || event.code === 'ShiftRight') return
      event.preventDefault()
      event.stopPropagation()
      keyState[event.code] = true
      invalidate()
    }

    const handleKeyUp = (event: KeyboardEvent) => {
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
  }, [invalidate])

  useFrame((state, delta) => {
    const group = groupRef.current
      ?? (findSceneObjectByRuntimeId(scene, objectIdRef.current) as THREE.Group | null)
    groupRef.current = group

    const cameraEuler = cameraEulerRef.current.setFromQuaternion(camera.quaternion, 'YXZ')
    const direction = groundMoveDirection(keyStateRef.current, cameraEuler.y)
    const moving = direction.lengthSq() > 0

    // 自动面向移动方向（平滑插值）；不移动则保持当前朝向。
    const targetYaw = facingYawFromDirection(direction)
    if (targetYaw !== null) {
      yawRef.current = dampYaw(yawRef.current, targetYaw, TURN_LAMBDA, delta)
    }

    if (moving) {
      const step = WALK_SPEED * Math.max(0.2, SPEED_SCALE) * delta
      positionRef.current.x += direction.x * step
      positionRef.current.z += direction.z * step
    }

    // TODO(S1 可选项·相机跟随未做)：操控态下让相机平滑跟在角色身后/上方。S1 暂不做——
    // 当前 viewLocked=true 下 OrbitControls 仍可用，用户可手动绕看角色；自动跟随涉及与 OrbitControls
    // target/damping 的协调，留到后续切片，避免与现有相机链路抢控制权（不动项 R5）。

    // 直驱 group（贴地：y 锁在落地时的基准）。
    if (group) {
      group.position.set(positionRef.current.x, groundYRef.current, positionRef.current.z)
      group.rotation.y = yawRef.current
      group.updateMatrixWorld()
    }

    const turning = targetYaw !== null && Math.abs(group ? group.rotation.y - (targetYaw) : 0) > 1e-4
    if (moving || turning) invalidate()

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
