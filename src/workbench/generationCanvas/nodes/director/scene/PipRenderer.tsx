/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree/useFrame、../DirectorEditorContext 的 useDirectorStoreApi、./SceneRegistryContext、
 *          ./sceneRefs 的 isEditorOnly、./cameraMath（cameraQuaternion / THREE_CAMERA_FLIP）、./pipCamera（PipRect / pipCameraIdOf）
 *          ../model/cameraCoordinateSpace / sceneObjectGraph 的机位世界变换；临时可见性与渲染器状态在 finally 恢复
 * [OUTPUT]: 对外提供 PipRenderer：每帧在主画布的一块剪裁矩形里用目标机位再渲染一遍场景（editor-only 与辅助物体不画）
 * [POS]: director/scene 的画中画渲染（清单 §2.5 V7）：同一个 WebGL 上下文、同一份场景图，scissor + viewport 内嵌渲染，
 *        不另起渲染器；矩形由 DOM 侧 PipViewport 量好写进 ref。播放/录制中跟节目机位，停止时显示预览机位；没有机位 → 不画（DOM 盖黑场）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import { cameraQuaternion, THREE_CAMERA_FLIP } from './cameraMath'
import { pipCameraIdOf, type PipRect } from './pipCamera'
import { isEditorOnly } from './sceneRefs'
import { useSceneRegistry } from './SceneRegistryContext'
import { transformCameraPose } from '../model/cameraCoordinateSpace'
import { sceneFrame } from '../model/sceneObjectGraph'

export function PipRenderer({ rectRef }: { rectRef: React.MutableRefObject<PipRect> }): null {
  const { gl, scene, size } = useThree()
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()
  const pipCamera = React.useMemo(() => new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000), [])
  const previousViewport = React.useMemo(() => new THREE.Vector4(), [])
  const previousScissor = React.useMemo(() => new THREE.Vector4(), [])

  useFrame(() => {
    const rect = rectRef.current
    if (!rect || rect.width < 8 || rect.height < 8) return
    const state = store.getState()
    const sceneData = state.activeScene()
    const cameraId = pipCameraIdOf(state)
    const data = cameraId ? sceneData.cameras.find((camera) => camera.id === cameraId) : undefined
    if (!data) return
    const pose = state.evaluatedPoses[data.id]
    const rotation = pose?.rotation ?? { x: data.pitch, y: data.yaw, z: data.roll }
    const world = transformCameraPose({ position: pose?.position ?? data.position, pitch: rotation.x, yaw: rotation.y, roll: rotation.z, fov: pose?.fov ?? data.fov }, sceneFrame(sceneData.sceneConfig))
    const position = world.position
    pipCamera.position.set(position.x, position.y, position.z)
    pipCamera.quaternion.copy(cameraQuaternion(world.pitch, world.yaw, world.roll)).multiply(THREE_CAMERA_FLIP)
    pipCamera.fov = world.fov
    pipCamera.aspect = rect.width / rect.height
    pipCamera.updateProjectionMatrix()

    // 成片视角：编辑辅助物（网格、机位模型、路标、gizmo）与「辅助物体」都不画
    const hidden: THREE.Object3D[] = []
    scene.traverse((object) => {
      if (object.visible && isEditorOnly(object)) {
        object.visible = false
        hidden.push(object)
      }
    })
    for (const object of sceneData.objects) {
      if (!object.isAuxiliary) continue
      const root = registry.get(object.id)
      if (root?.visible) {
        root.visible = false
        hidden.push(root)
      }
    }

    gl.getViewport(previousViewport)
    gl.getScissor(previousScissor)
    const scissorWasOn = gl.getScissorTest()
    const yFromBottom = size.height - rect.y - rect.height
    try {
      gl.setScissorTest(true)
      gl.setViewport(rect.x, yFromBottom, rect.width, rect.height)
      gl.setScissor(rect.x, yFromBottom, rect.width, rect.height)
      gl.render(scene, pipCamera)
    } finally {
      gl.setScissorTest(scissorWasOn)
      gl.setScissor(previousScissor)
      gl.setViewport(previousViewport)
      for (const object of hidden) object.visible = true
    }
  }, 2)

  return null
}
