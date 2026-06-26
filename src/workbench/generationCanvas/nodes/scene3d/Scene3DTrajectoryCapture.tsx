// 离屏「沿相机轨迹采 N 帧」捕获器：不开全屏编辑器，用隐藏 Canvas 渲染完整场景
// （物体 + 群众 + 灯光 + 环境，同 Scene3DAutoCapture），等 GLB 落地后**逐 useFrame tick 走一帧**
// （确定性步进，不靠 wall-clock 动画 / useTrajectoryAnimation），每步：
//   t = frameTimes[i] → cameraWithPlaybackPosition(state, cameras[0], t) 算相机位姿
//   + 每个物体 objectWithPlaybackPose(state, obj, t) 摆到该时刻 → render → captureScene 收一帧。
// 全部采完回调一次 frames[]。供 CameraMoveCaptureHost → ffmpeg 拼运镜小片（S2）。
import React, { Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Mannequin, MannequinCrowd, MannequinAssetBoundary, ProceduralMannequin } from './scene3dObjects'
import { captureScene, applySceneCameraPose, aspectDimensions, capCameraMoveDimensions } from './scene3dMath'
import { cameraWithPlaybackPosition, objectWithPlaybackPose } from './scene3dPlayback'
import { frameTimes } from './cameraMoveSchedule'
import type { Scene3DState, Scene3DObject } from './scene3dTypes'
import { Scene3DEnvironmentLayer } from './scene3dEnvironment'

export type CameraMoveCaptureResult = {
  frames: string[]
  width: number
  height: number
  fps: number
  title: string
}

// 在某个播放头时刻 t 把每个物体摆到轨迹位姿后渲染（同 Scene3DAutoCapture 的 StagingObjects，
// 只是物体先经 objectWithPlaybackPose 投影到时刻 t）。
// 关键：每个 state.objects[i] **恒映射一个 group child**（即使内容为空），让 stepper 用
// group.children[i] 直接对齐 state.objects[i]，不被「跳过的物体类型」打乱索引。
function TrajectoryObjects({ objects }: { objects: Scene3DObject[] }): JSX.Element {
  let roleStart = 0
  return (
    <>
      {objects.map((object) => {
        const content = object.type === 'mannequin'
          ? <Mannequin color={object.color || '#808080'} pose={object.pose} />
          : object.type === 'mannequinCrowd'
            ? <MannequinCrowd object={object} roleStartIndex={roleStart} />
            : null
        if (object.type === 'mannequin') roleStart += 1
        return (
          <group key={object.id} position={object.position} rotation={object.rotation} scale={object.scale}>
            {content}
          </group>
        )
      })}
    </>
  )
}

function cameraBindingTimes(state: Scene3DState, frameCount: number): number[] {
  const camera = state.cameras[0]
  const binding = camera
    ? state.trajectoryBindings.find((candidate) => candidate.objects.some((bound) => bound.objectId === camera.id))
    : undefined
  const start = binding?.startTime ?? 0
  const end = binding?.endTime ?? Math.max(start + 1, state.sceneTimeline?.totalDuration ?? start + 1)
  return frameTimes(start, end, frameCount)
}

// 确定性步进 + 逐帧采样的内层。每个 useFrame tick 处理一个时刻：
// 先用 indexRef 控制「先等 GLB 落地」再「逐帧采」，避免连续动画导致的不确定性。
function TrajectoryFrameStepper({
  state,
  frameCount,
  fps,
  title,
  onResult,
}: {
  state: Scene3DState
  frameCount: number
  fps: number
  title: string
  onResult: (result: CameraMoveCaptureResult | null) => void
}): JSX.Element {
  const { gl, scene } = useThree()
  const firedRef = React.useRef(false)
  const settleRef = React.useRef(0)
  const indexRef = React.useRef(0)
  const framesRef = React.useRef<string[]>([])
  const times = React.useMemo(() => cameraBindingTimes(state, frameCount), [state, frameCount])
  const objectGroupRef = React.useRef<THREE.Group>(null)

  useFrame(() => {
    if (firedRef.current) return
    // 1) 等 GLB 落地 + 几帧渲染稳定（同 Scene3DAutoCapture 的 8 帧门）。
    if (settleRef.current < 8) {
      settleRef.current += 1
      return
    }
    const camera = state.cameras[0]
    if (!camera || times.length === 0) {
      firedRef.current = true
      onResult(null)
      return
    }

    // 2) 取当前时刻 → 摆物体到该时刻 → 摆相机 → 渲染 → 收一帧。
    const i = indexRef.current
    const t = times[i]

    // 物体沿轨迹到时刻 t（位置 + 朝向 + 可见性）。直接写已挂载的 group transform。
    const group = objectGroupRef.current
    if (group) {
      state.objects.forEach((object, objectIndex) => {
        const child = group.children[objectIndex]
        if (!child) return
        const posed = objectWithPlaybackPose(state, object, t)
        child.position.set(posed.position[0], posed.position[1], posed.position[2])
        child.rotation.set(posed.rotation[0], posed.rotation[1], posed.rotation[2])
        child.visible = posed.visible
      })
      group.updateMatrixWorld(true)
    }

    const playbackCamera = cameraWithPlaybackPosition(state, camera, t)
    // Seedance video_urls 要求参考视频 480P–720P → 运镜捕获封顶 720p(不动 aspectDimensions 全局)。
    const dims = capCameraMoveDimensions(aspectDimensions(playbackCamera.aspectRatio))
    const captureCamera = new THREE.PerspectiveCamera(
      playbackCamera.fov,
      dims.width / dims.height,
      playbackCamera.near,
      playbackCamera.far,
    )
    applySceneCameraPose(captureCamera, playbackCamera)
    const frame = captureScene(gl, scene, captureCamera, dims.width, dims.height, title, 'scene3d-camera', true)
    if (frame) framesRef.current.push(frame.dataUrl)

    // 3) 步进 / 收尾。
    indexRef.current += 1
    if (indexRef.current >= times.length) {
      firedRef.current = true
      if (framesRef.current.length < 2) {
        onResult(null)
        return
      }
      const dims2 = capCameraMoveDimensions(aspectDimensions(camera.aspectRatio))
      onResult({ frames: framesRef.current, width: dims2.width, height: dims2.height, fps, title })
    }
  })

  return (
    <group ref={objectGroupRef}>
      <TrajectoryObjects objects={state.objects} />
    </group>
  )
}

export function Scene3DTrajectoryCapture({
  state,
  frameCount,
  fps,
  title,
  onResult,
}: {
  state: Scene3DState
  frameCount: number
  fps: number
  title: string
  onResult: (result: CameraMoveCaptureResult | null) => void
}): JSX.Element {
  return (
    <div aria-hidden style={{ position: 'absolute', left: -10000, top: 0, width: 480, height: 270, opacity: 0, pointerEvents: 'none' }}>
      <Canvas gl={{ preserveDrawingBuffer: true, antialias: true }} camera={{ position: [4, 2.4, 5], fov: 45 }}>
        <Scene3DEnvironmentLayer environment={state.environment} ambientIntensity={0.7} />
        <directionalLight position={[4, 6, 5]} intensity={1.1} />
        <directionalLight position={[-4, 3, -3]} intensity={0.4} />
        <MannequinAssetBoundary fallback={<ProceduralMannequin color="#808080" />}>
          <Suspense fallback={null}>
            <TrajectoryFrameStepper
              state={state}
              frameCount={frameCount}
              fps={fps}
              title={title}
              onResult={onResult}
            />
          </Suspense>
        </MannequinAssetBoundary>
      </Canvas>
    </div>
  )
}
