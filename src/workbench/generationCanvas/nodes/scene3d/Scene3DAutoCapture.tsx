// 离屏自动截图：不打开全屏编辑器，用一个隐藏 Canvas 渲染 staging 场景 + 选定机位，
// GLB 加载(Suspense)+几帧落地后用 captureScene 出图，回调一次。供 create_staging_reference 工具用。
// 复用 Mannequin(带自动落地) + captureScene，渲染==3D 编辑器。
import React, { Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Mannequin, MannequinCrowd, MannequinAssetBoundary, ProceduralMannequin } from './scene3dObjects'
import { captureScene, applySceneCameraPose, aspectDimensions } from './scene3dMath'
import type { Scene3DState, Scene3DCaptureResult } from './scene3dTypes'
import { Scene3DEnvironmentLayer } from './scene3dEnvironment'

function StagingObjects({ state }: { state: Scene3DState }): JSX.Element {
  let roleStart = 0
  return (
    <>
      {state.objects.map((object) => {
        if (object.type === 'mannequin') {
          const node = (
            <group key={object.id} position={object.position} rotation={object.rotation} scale={object.scale}>
              <Mannequin color={object.color || '#808080'} pose={object.pose} />
            </group>
          )
          roleStart += 1
          return node
        }
        if (object.type === 'mannequinCrowd') {
          const start = roleStart
          roleStart += 0
          return (
            <group key={object.id} position={object.position} rotation={object.rotation} scale={object.scale}>
              <MannequinCrowd object={object} roleStartIndex={start} />
            </group>
          )
        }
        return null
      })}
    </>
  )
}

function CaptureTrigger({
  state,
  onResult,
}: {
  state: Scene3DState
  onResult: (result: Scene3DCaptureResult | null) => void
}): null {
  const { gl, scene } = useThree()
  const firedRef = React.useRef(false)
  const frameRef = React.useRef(0)
  useFrame(() => {
    if (firedRef.current) return
    frameRef.current += 1
    if (frameRef.current < 8) return // 等 GLB 落地(layout effect)+几帧渲染稳定
    firedRef.current = true
    const camera = state.cameras[0]
    if (!camera) {
      onResult(null)
      return
    }
    const dims = aspectDimensions(camera.aspectRatio)
    const captureCamera = new THREE.PerspectiveCamera(camera.fov, dims.width / dims.height, camera.near, camera.far)
    applySceneCameraPose(captureCamera, camera)
    const result = captureScene(gl, scene, captureCamera, dims.width, dims.height, '站位参考', 'scene3d-camera', true)
    onResult(result)
  })
  return null
}

export function Scene3DAutoCapture({
  state,
  onResult,
}: {
  state: Scene3DState
  onResult: (result: Scene3DCaptureResult | null) => void
}): JSX.Element {
  return (
    <div aria-hidden style={{ position: 'absolute', left: -10000, top: 0, width: 480, height: 270, opacity: 0, pointerEvents: 'none' }}>
      <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [4, 2.4, 5], fov: 45 }}>
        <Scene3DEnvironmentLayer environment={state.environment} ambientIntensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <directionalLight position={[-4, 3, -3]} intensity={0.4} />
        <MannequinAssetBoundary fallback={<ProceduralMannequin color="#808080" />}>
          <Suspense fallback={null}>
            <StagingObjects state={state} />
            <CaptureTrigger state={state} onResult={onResult} />
          </Suspense>
        </MannequinAssetBoundary>
      </Canvas>
    </div>
  )
}
