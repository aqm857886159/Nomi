import React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { cameraPoseSampleChanged, type CameraPoseSample, eulerToArray, vectorToArray } from './scene3dMath'
import type { Scene3DControlMode, Scene3DState, Scene3DVector3 } from './scene3dTypes'

// 从 Scene3DFullscreen 拆出（巨壳门岗·只减不增）：把相机位姿记录器单独成文件。
// 核心是每帧脏判断——相机静止时本帧采样 === 上帧 → 直接 return，不分配 cameraState、不回调
// （消除原来每帧无条件 new + 回调的 60fps churn，根因 P2）。
export function CameraStateRecorder({
  mode,
  target,
  onDraftChange,
  onCommit,
}: {
  mode: Scene3DControlMode
  target: Scene3DVector3
  onDraftChange: (cameraState: Scene3DState['editorCamera']) => void
  onCommit: (cameraState: Scene3DState['editorCamera']) => void
}): null {
  const { camera, controls } = useThree()
  const lastCommitRef = React.useRef(0)
  // 上一帧位姿采样（扁平 9 number，就地复用同一对象，零分配比对）。
  const lastSampleRef = React.useRef<CameraPoseSample | null>(null)

  useFrame((state) => {
    const controlsTarget =
      mode === 'edit' && controls && 'target' in controls && (controls as { target?: unknown }).target instanceof THREE.Vector3
        ? (controls as { target: THREE.Vector3 }).target
        : null
    // 就地读 THREE 对象的原始分量（不分配数组）；target 为 fly 模式或无 controls 时退回 prop。
    const sample: CameraPoseSample = {
      px: camera.position.x, py: camera.position.y, pz: camera.position.z,
      rx: camera.rotation.x, ry: camera.rotation.y, rz: camera.rotation.z,
      tx: controlsTarget ? controlsTarget.x : target[0],
      ty: controlsTarget ? controlsTarget.y : target[1],
      tz: controlsTarget ? controlsTarget.z : target[2],
    }
    if (!cameraPoseSampleChanged(lastSampleRef.current, sample)) return
    lastSampleRef.current = sample
    const cameraState = {
      position: vectorToArray(camera.position),
      target: controlsTarget ? vectorToArray(controlsTarget) : target,
      rotation: eulerToArray(camera.rotation),
      mode,
    } satisfies Scene3DState['editorCamera']
    onDraftChange(cameraState)
    if (mode === 'fly') return
    if (state.clock.elapsedTime - lastCommitRef.current < 1) return
    lastCommitRef.current = state.clock.elapsedTime
    onCommit(cameraState)
  })

  return null
}
