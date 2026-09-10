/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useThree、../../DirectorEditorContext、../SceneRegistryContext、../ViewportApiContext 的请求 / 结果类型、
 *          ../entities/CharacterEntity 的 CHARACTER_HEIGHT、../character/characterLabel 的完整世界标签锚点、cameraCoordinateSpace 的机位变换、./directorCapture（buildCaptureCamera / FrameRenderer / drawLabels / encodeCanvas）
 * [OUTPUT]: 对外提供 CaptureBinder：把出片渲染器登记进场景对象表（ViewportApi.captureFrame 转发到这里）
 * [POS]: director/scene/capture 的 R3F 侧接线：拿 gl / scene / 默认相机，按请求构造机位相机（'free' = 视口相机复制、'black' = 黑场）、
 *        隐藏辅助物体、离屏渲染到画布、投影角色标签画上去、一次异步编码。渲染结果只返回像素，落盘与产物登记在 DOM 侧 useDirectorOutputs。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useDirectorStoreApi } from '../../DirectorEditorContext'
import { CHARACTER_HEIGHT } from '../entities/CharacterEntity'
import { useSceneRegistry } from '../SceneRegistryContext'
import type { CaptureFrameRequest, CaptureFrameResult } from '../ViewportApiContext'
import { buildCaptureCamera, drawLabels, encodeCanvas, FrameRenderer, type CaptureLabel } from './directorCapture'
import { transformCameraPose } from '../../model/cameraCoordinateSpace'
import { sceneFrame } from '../../model/sceneObjectGraph'
import { characterLabelAnchor } from '../character/characterLabel'

const BLACK = new THREE.Color(0x000000)

export function CaptureBinder(): null {
  const { gl, scene, camera } = useThree()
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()

  React.useEffect(() => {
    const captureCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 2000)
    const anchor = new THREE.Vector3()
    const renderer = new FrameRenderer()

    const resolveCamera = (request: CaptureFrameRequest): THREE.Camera | null => {
      const aspect = request.width / request.height
      if (request.cameraId === 'free' || request.cameraId === 'black') {
        const viewCamera = camera as THREE.PerspectiveCamera
        captureCamera.position.copy(viewCamera.position)
        captureCamera.quaternion.copy(viewCamera.quaternion)
        captureCamera.fov = viewCamera.fov
        captureCamera.aspect = aspect
        captureCamera.updateProjectionMatrix()
        captureCamera.updateMatrixWorld(true)
        return captureCamera
      }
      const state = store.getState()
      const data = state.activeScene().cameras.find((item) => item.id === request.cameraId)
      if (!data) return null
      const pose = state.evaluatedPoses[data.id]
      const rotation = pose?.rotation ?? { x: data.pitch, y: data.yaw, z: data.roll }
      const world = transformCameraPose({ position: pose?.position ?? data.position, pitch: rotation.x, yaw: rotation.y, roll: rotation.z, fov: pose?.fov ?? data.fov }, sceneFrame(state.activeScene().sceneConfig))
      return buildCaptureCamera(world.position, { x: world.pitch, y: world.yaw, z: world.roll }, world.fov, aspect, captureCamera)
    }

    const projectLabels = (target: THREE.Camera, width: number, height: number): CaptureLabel[] => {
      const state = store.getState()
      const sceneData = state.activeScene()
      if (!sceneData.visible || !sceneData.sceneConfig.showCharacterLabels) return []
      const labels: CaptureLabel[] = []
      for (const object of sceneData.objects) {
        if (object.type !== 'character' || !object.visible || object.isAuxiliary) continue
        const root = registry.get(object.id)
        if (!root || !characterLabelAnchor(root, CHARACTER_HEIGHT, anchor)) continue
        anchor.project(target)
        if (anchor.z > 1 || anchor.z < -1) continue
        labels.push({ text: object.name, x: (anchor.x * 0.5 + 0.5) * width, y: (-anchor.y * 0.5 + 0.5) * height })
      }
      return labels
    }

    const capture = async (request: CaptureFrameRequest): Promise<CaptureFrameResult | null> => {
      const target = resolveCamera(request)
      if (!target) return null
      // 黑场帧：什么都不画（相机不看任何图层）+ 纯黑背景
      const black = request.cameraId === 'black'
      const previousBackground = scene.background
      const previousLayers = target.layers.mask
      if (black) {
        scene.background = BLACK
        target.layers.disableAll()
      }
      // 辅助物体（isAuxiliary）不进成片；editor-only 由 V1 captureScene 按旗标隐藏
      const hidden: THREE.Object3D[] = []
      for (const object of store.getState().activeScene().objects) {
        if (!object.isAuxiliary) continue
        const root = registry.get(object.id)
        if (root?.visible) {
          root.visible = false
          hidden.push(root)
        }
      }
      let canvas: HTMLCanvasElement | null
      let labels: CaptureLabel[] = []
      try {
        canvas = renderer.renderToCanvas(gl, scene, target, request.width, request.height)
        // 在恢复辅助组前取标签，保证标签与本帧实际渲染的实体完全一致。
        if (canvas && request.burnLabels && !black) labels = projectLabels(target, request.width, request.height)
      } finally {
        hidden.forEach((root) => {
          root.visible = true
        })
        if (black) {
          scene.background = previousBackground
          target.layers.mask = previousLayers
        }
      }
      if (!canvas) return null
      const context = canvas.getContext('2d')
      if (context) drawLabels(context, labels, request.width, request.height)
      const encoded = await encodeCanvas(canvas)
      return { dataUrl: encoded.dataUrl, blob: encoded.blob, width: request.width, height: request.height }
    }

    registry.registerFrameCapturer(capture)
    return () => {
      registry.registerFrameCapturer(null)
      renderer.dispose()
    }
  }, [camera, gl, registry, scene, store])

  return null
}
