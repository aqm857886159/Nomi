import React from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { findSceneObjectByRuntimeId } from './scene3dMath'
import type { Scene3DVector3 } from './scene3dTypes'

// 录 take 的 Canvas 内采样器（S2）。录制期间每帧读：
//  - 被操控角色 group 的世界位置（CharacterDriveController 直驱的就是这个 group）；
//  - 编辑器相机的世界位置（用户录制时绕看 = 机位路径）。
// 推进 useScene3DTakeRecorder 的 buffer（内部按 50ms 节流）。空帧/未录时零开销。
// 直驱 group 位置不走 React state（节流提交），所以这里直接读 three 世界矩阵才拿得到「正在走」的实时位置。
export function Scene3DTakeSampler({
  isRecording,
  possessedObjectId,
  onSampleCharacter,
  onSampleCamera,
}: {
  isRecording: boolean
  possessedObjectId: string | null
  onSampleCharacter: (position: Scene3DVector3) => void
  onSampleCamera: (position: Scene3DVector3) => void
}): null {
  const { camera, scene, invalidate } = useThree()
  const worldRef = React.useRef(new THREE.Vector3())

  // 录制时强制每帧渲染（demand 模式下静止不重绘 → 采样会停；invalidate 让循环转起来）。
  React.useEffect(() => {
    if (isRecording) invalidate()
  }, [isRecording, invalidate])

  useFrame(() => {
    if (!isRecording || !possessedObjectId) return
    const group = findSceneObjectByRuntimeId(scene, possessedObjectId)
    if (group) {
      group.getWorldPosition(worldRef.current)
      onSampleCharacter([worldRef.current.x, worldRef.current.y, worldRef.current.z])
    }
    onSampleCamera([camera.position.x, camera.position.y, camera.position.z])
    invalidate() // 维持录制期间的连续帧
  })

  return null
}
