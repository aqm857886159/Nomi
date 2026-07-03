// 离屏「沿相机轨迹采 N 帧」捕获器：不开全屏编辑器，用隐藏 Canvas 渲染完整场景
// （物体 + 群众 + 灯光 + 环境，同 Scene3DAutoCapture），等 GLB 落地后**逐 useFrame tick 走一帧**
// （确定性步进，不靠 wall-clock 动画 / useTrajectoryAnimation），每步：
//   t = frameTimes[i] → cameraWithPlaybackPosition(state, cameras[0], t) 算相机位姿
//   + 每个物体 objectWithPlaybackPose(state, obj, t) 摆到该时刻 → render → captureScene 收一帧。
// 全部采完回调一次 frames[]。供 CameraMoveCaptureHost → ffmpeg 拼运镜小片（S2）。
import React, { Suspense } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Mannequin, MannequinCrowd, MannequinAssetBoundary, ProceduralMannequin, StaticObjectVisual } from './scene3dObjects'
import type { MannequinLocomotionDriver } from './scene3dMannequinLocomotion'
import { captureScene, applySceneCameraPose, aspectDimensions, capCameraMoveDimensions, applyMannequinSkeletonPose, applyMannequinArmDownPose, resetMannequinSkeletonToRest, groundMannequinModel } from './scene3dMath'
import { cameraWithPlaybackPosition, objectWithPlaybackPose } from './scene3dPlayback'
import { samplePoseKeyframe, poseKeyframeKey, frameMotionSource } from './scene3dPoseTrack'
import { locomotionAnimationClip } from './scene3dCharacterDrive'
import { frameTimes } from './cameraMoveSchedule'
import type { Scene3DState, Scene3DObject } from './scene3dTypes'
import { Scene3DEnvironmentLayer } from './scene3dEnvironment'
import { attachWebGLContextRecovery } from './scene3dContextRecovery'

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
// driverRefs：每个带 locomotionClip 的被操控假人对应一个 locomotion 驱动句柄 ref，由 stepper 在
// capture 前 imperatively 定相位（确定性迈腿）。无 locomotionClip 的假人不传 activeClip → 走原静态路径（零回归）。
function TrajectoryObjects({
  objects,
  driverRefs,
}: {
  objects: Scene3DObject[]
  driverRefs: Map<string, React.MutableRefObject<MannequinLocomotionDriver | null>>
}): JSX.Element {
  let roleStart = 0
  return (
    <>
      {objects.map((object) => {
        const content = object.type === 'mannequin'
          ? (
            <Mannequin
              color={object.color || '#808080'}
              pose={object.pose}
              activeClip={object.locomotionClip}
              driverRef={locomotionAnimationClip(object.locomotionClip) ? driverRefs.get(object.id) : undefined}
            />
          )
          : object.type === 'mannequinCrowd'
            ? <MannequinCrowd object={object} roleStartIndex={roleStart} />
            // 灯/道具/几何体也要进运镜小片（此前 null → 用户摆的场在 mp4 里凭空消失）。
            : <StaticObjectVisual object={object} />
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

// 在时刻 t 把假人骨架摆到「当前生效静态姿势」+ 落地（仅姿势 key 变化时重摆，imperatively，不靠 React 重渲染）。
// child = 包裹该对象的 group；child.children[0] = Mannequin 挂载的骨架 root（normalizeMannequinModel 产物，
// 即 Mannequin 组件里 applyMannequinSkeletonPose 的同一 root）。
// #7：无论有无 poseTrack，静态姿势都**复用实时同一套 groundMannequinModel 落地**——
//   有 poseTrack → 取该时刻关键帧 pose；无 poseTrack → 用 object.pose（如蹲）。
//   此前「无 poseTrack 直接 return」使纯静态蹲姿在离屏从不落地 → 导出悬空（用户实测 #7）。
function applyPoseOverTime(
  object: Scene3DObject,
  t: number,
  child: THREE.Object3D,
  appliedPoseKey: Map<string, string>,
): void {
  if (object.type !== 'mannequin') return
  const hasTrack = Boolean(object.poseTrack && object.poseTrack.length > 0)
  const keyframe = hasTrack ? samplePoseKeyframe(object.poseTrack!, t) : undefined
  // 生效 pose：有 track 取关键帧 pose（t 早于首帧 → 落回 object.pose）；无 track → object.pose。
  const effectivePose = keyframe ? keyframe.pose : object.pose
  // 缓存键：有 track 用关键帧 key（边界塌合）；无 track 用静态 pose 形状 key（pose 不变只摆一次）。
  const key = hasTrack ? poseKeyframeKey(keyframe) : poseKeyframeKey({ time: 0, pose: effectivePose })
  if (appliedPoseKey.get(object.id) === key) return
  const mannequinRoot = child.children[0]
  if (!(mannequinRoot instanceof THREE.Group)) return
  applyMannequinSkeletonPose(mannequinRoot, effectivePose)
  groundMannequinModel(mannequinRoot)
  appliedPoseKey.set(object.id, key)
}

// 在时刻 t 决定被操控假人该帧的「动作来源」并落到骨架（locomotion 迈腿 vs 静态 pose 共存，单一判定 frameMotionSource）：
// - locomotion：调 driver.setTime(t) 定相位 + 落地（确定性腿迈）。清掉该对象的 appliedPoseKey，
//   使下次切回静态时强制重摆（mixer 期间骨架已被动画覆盖，缓存键失效）。
// - 否则（static-pose / static-base）：走原 applyPoseOverTime（静态优先，含 base 落回 object.pose）。
// 无 locomotionClip 的假人 → frameMotionSource 恒非 locomotion → 完全走原静态路径（零回归）。
function applyMotionOverTime(
  object: Scene3DObject,
  t: number,
  child: THREE.Object3D,
  appliedPoseKey: Map<string, string>,
  lastSource: Map<string, string>,
  driverRefs: Map<string, React.MutableRefObject<MannequinLocomotionDriver | null>>,
): void {
  if (object.type !== 'mannequin') return
  // #9 idle 不靠 clip：把 locomotionClip 经 locomotionAnimationClip 折叠（idle/空 → undefined → 走静态站姿，
  // 不调 driver），与 Mannequin 内部口径一致；仅 walk/run 才走 locomotion 驱动。
  const source = frameMotionSource(object.poseTrack, locomotionAnimationClip(object.locomotionClip), t)
  const prevSource = lastSource.get(object.id)
  lastSource.set(object.id, source)
  if (source === 'locomotion') {
    const driver = driverRefs.get(object.id)?.current
    if (driver) {
      const mannequinRoot = child.children[0]
      // #4 离屏侧根因：上一帧是静态动作（蹲/挥手）这帧切回走路 → 先把骨架复位 bind rest，清掉
      // walk clip 不驱动的骨上残留的 squat 旋转（脊/头/腿链终端），否则导出停在「蹲到片尾」。
      // 只在 static→locomotion 那一次转换 reset（不每帧 reset，避免抹掉 mixer 已写的迈腿相位）。
      if (prevSource && prevSource !== 'locomotion' && mannequinRoot instanceof THREE.Group) {
        resetMannequinSkeletonToRest(mannequinRoot)
      }
      driver.setTime(t)
      if (mannequinRoot instanceof THREE.Group) {
        // #2 A-hybrid：clip 已滤掉手臂链 → 离屏每帧也补「手臂下垂」静态姿势（与 LIVE 同一套）。
        applyMannequinArmDownPose(mannequinRoot)
        groundMannequinModel(mannequinRoot)
      }
    }
    // locomotion 接管期间静态缓存失效：清键，切回静态时强制重摆。
    appliedPoseKey.delete(object.id)
    return
  }
  applyPoseOverTime(object, t, child, appliedPoseKey)
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
  // pose-over-time：每个假人「上次套用的关键帧 key」。step-hold 下只在动作切换边界重摆骨架，
  // 不每帧重摆（groundMannequinModel 含全顶点遍历，每帧跑会掉帧；其设计本就是「仅姿势变化时跑一次」）。
  const appliedPoseKeyRef = React.useRef<Map<string, string>>(new Map())
  // 每个假人「上一帧的动作来源」（locomotion/static-pose/static-base）。用于侦测 static→locomotion 转换，
  // 在那一刻把骨架复位 rest 清掉静态残留（#4 离屏侧）。
  const lastSourceRef = React.useRef<Map<string, string>>(new Map())
  // 每个带 locomotionClip 的被操控假人对应一个 locomotion 驱动句柄 ref（Mannequin 发布，stepper 在 capture 前调）。
  // 稳定身份：同一 object.id 复用同一 ref（避免每帧/每渲染换 ref 丢句柄）。
  const driverRefsRef = React.useRef<Map<string, React.MutableRefObject<MannequinLocomotionDriver | null>>>(new Map())
  const driverRefs = driverRefsRef.current
  state.objects.forEach((object) => {
    if (object.type === 'mannequin' && locomotionAnimationClip(object.locomotionClip) && !driverRefs.has(object.id)) {
      driverRefs.set(object.id, { current: null })
    }
  })

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
        applyMotionOverTime(object, t, child, appliedPoseKeyRef.current, lastSourceRef.current, driverRefs)
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
      <TrajectoryObjects objects={state.objects} driverRefs={driverRefs} />
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
      <Canvas
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        camera={{ position: [4, 2.4, 5], fov: 45 }}
        // 离屏出片的命门：一次 WebGL 上下文丢失（多 Electron 抢 context 配额）浏览器默认不补发 restore，
        // useFrame 停死 → mp4 永久失败（用户真机 30× Context Lost）。preventDefault 让浏览器补发 restore、
        // restored 后 invalidate 续画（复用编辑器/预览同一套 attachWebGLContextRecovery，不造第二套）。
        // Host 侧还有超时/null 重试兜底，双保险。
        onCreated={({ gl, invalidate }) => attachWebGLContextRecovery(gl.domElement, invalidate)}
      >
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
