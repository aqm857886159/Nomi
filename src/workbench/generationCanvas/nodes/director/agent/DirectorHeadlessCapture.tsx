/**
 * [INPUT]: 依赖 react、@react-three/fiber 的 useThree、../../fencedCanvas 的 FencedCanvas、../DirectorEditorContext（DirectorStoreContext / useDirectorStoreApi）、
 *          ../model/directorStore 的 createDirectorStore、../model/exportSize 的 exportDimensions、../scene/{sceneRefs, SceneRegistryContext, ViewportApiContext, webglContextRecovery, useTimelinePlayback}、
 *          ../scene/environment/{SkyGround, PanoramaSphere}、../scene/entities/DirectorEntities、../scene/capture/CaptureBinder、../timeline/timelineCommands 的 seekTo
 * [OUTPUT]: 对外提供 DirectorHeadlessCapture（隐藏画布 + 独立 store：等角色 GLB → 按给定时刻序列逐帧 seek → 等两帧 → 按时刻取机位出片 → 一次回调 frames[] + 相机/主体回读）、HeadlessCaptureResult、referenceVideoShortSide
 * [POS]: director/agent 的离屏出片器：AI 来导的站位图（times=[0]）与运镜小片（frameTimes 序列）共用；不开全屏壳，只装 three 世界里出片必需的子系统
 *        （环境 / 实体 / 播放求值 / 出片渲染登记），无 gizmo / 拾取 / 视图立方。等角色 GLB 落地（按对象表里 characterMount 出现判定）再采，不靠墙钟；
 *        像素与全屏壳同一条 CaptureBinder 管线，出图 == 编辑器所见。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { FencedCanvas } from '../../fencedCanvas'
import { DirectorStoreContext, useDirectorStoreApi } from '../DirectorEditorContext'
import { createDirectorStore } from '../model/directorStore'
import type { DirectorProject, DirectorScene, Vec3 } from '../model/directorTypes'
import { exportDimensions } from '../model/exportSize'
import { CaptureBinder } from '../scene/capture/CaptureBinder'
import { DirectorEntities } from '../scene/entities/DirectorEntities'
import { PanoramaSphere } from '../scene/environment/PanoramaSphere'
import { SkyGround } from '../scene/environment/SkyGround'
import { createSceneRefRegistry, type SceneRefRegistry } from '../scene/sceneRefs'
import { SceneRegistryContext, useSceneRegistry } from '../scene/SceneRegistryContext'
import { useTimelinePlayback } from '../scene/useTimelinePlayback'
import { ViewportApiContext, type ViewportApiRef } from '../scene/ViewportApiContext'
import { attachWebGLContextRecovery } from '../scene/webglContextRecovery'
import { seekTo } from '../timeline/timelineCommands'
import type { CaptureCameraReadback, CaptureCharacterPoseReadback } from '../scene/ViewportApiContext'
import { poseClipStatus } from '../scene/character/poseClipLibrary'
import { actionClipsLoading, isTPose, resolveHeadlessCameraId } from './DirectorHeadlessCaptureUtils'

export type HeadlessCaptureFrameReadback = {
  cameraId: string | null
  camera: CaptureCameraReadback | null
  subjectPositions: Record<string, Vec3>
  characterPoses: Record<string, CaptureCharacterPoseReadback>
}

export type HeadlessCaptureResult = {
  frames: string[]
  width: number
  height: number
  cameraIds: Array<string | null>
  frameReadbacks: HeadlessCaptureFrameReadback[]
  invalidReasons?: string[]
}

export type DirectorHeadlessCaptureProps = {
  project: DirectorProject
  /** 采样时刻（秒，按播放顺序）；单张静帧传 [0] */
  times: number[]
  /** 短边上限（参考视频 720p 封顶）；省略 = 工程导出档位 */
  maxShortSide?: number
  /** Exact output size for adapters that already own their render viewport. */
  captureSize?: { width: number; height: number }
  /** Wait for referenced action assets before capture; omitted preserves existing callers. */
  waitForActionClips?: boolean
  /** Optional per-time camera selector. Returning null produces a black frame. */
  cameraIdAt?: (time: number) => string | null
  /** Burn character labels into frames; omitted keeps the existing product default. */
  burnLabels?: boolean
  /** Judge-only guard: reject frames where an active ready action renders as a T pose. */
  rejectTPose?: boolean
  onResult: (result: HeadlessCaptureResult | null) => void
}

/** Seedance 参考视频封顶 720p */
export const referenceVideoShortSide = 720

// 等 GLB 落地的帧数上限（≈10s @60fps）；到点仍未落地就按胶囊兜底出图，不无限等
const CHARACTER_LOAD_MAX_FRAMES = 600
const SETTLE_FRAMES = 8
const SEEK_SETTLE_FRAMES = 2

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)))
    step(count)
  })
}

function charactersLoaded(registry: SceneRefRegistry, scene: DirectorScene): boolean {
  return scene.objects.every((object) => {
    if (object.type !== 'character' || !object.visible) return true
    const root = registry.get(object.id)
    return Boolean(root?.getObjectByName('characterMount'))
  })
}

/** Action clips are sampled by the character rig; do not capture while a referenced asset is still loading. */
function activeReadyAction(object: DirectorScene['objects'][number], time: number): boolean {
  return object.type === 'character' && object.actionTrackEnabled !== false && (object.actionClips ?? []).some((clip) => clip.clipType === 'action' && Boolean(clip.actionPose) && time >= clip.startTime && time <= clip.endTime && poseClipStatus(clip.actionPose!) === 'ready')
}

function captureDimensions(project: DirectorProject, maxShortSide: number | undefined, captureSize: { width: number; height: number } | undefined): { width: number; height: number } {
  if (captureSize) return captureSize
  const full = exportDimensions(project.exportRatio, project.exportResolution)
  const short = Math.min(full.width, full.height)
  if (!maxShortSide || short <= maxShortSide) return full
  const scale = maxShortSide / short
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2)
  return { width: even(full.width), height: even(full.height) }
}

function ContextRecovery(): null {
  const { gl, invalidate } = useThree()
  React.useEffect(() => attachWebGLContextRecovery(gl.domElement, invalidate), [gl, invalidate])
  return null
}

function PlaybackBinder(): null {
  useTimelinePlayback()
  return null
}

function CaptureDriver({ times, maxShortSide, captureSize, cameraIdAt, burnLabels = true, waitForActionClips = false, rejectTPose = false, onResult }: Omit<DirectorHeadlessCaptureProps, 'project'>): null {
  const store = useDirectorStoreApi()
  const registry = useSceneRegistry()

  React.useEffect(() => {
    let cancelled = false
    const run = async () => {
      const state = store.getState()
      const scene = state.activeScene()
      if (times.length === 0 || scene.cameras.length === 0) {
        onResult(null)
        return
      }
      for (let frame = 0; frame < CHARACTER_LOAD_MAX_FRAMES && (!charactersLoaded(registry, scene) || (waitForActionClips && actionClipsLoading(scene))); frame += 1) {
        await nextFrames(1)
        if (cancelled) return
      }
      await nextFrames(SETTLE_FRAMES)
      const { width, height } = captureDimensions(state.project, maxShortSide, captureSize)
      const frames: string[] = []
      const cameraIds: Array<string | null> = []
      const frameReadbacks: HeadlessCaptureFrameReadback[] = []
      for (const time of times) {
        if (cancelled) return
        seekTo(store, time)
        await nextFrames(SEEK_SETTLE_FRAMES)
        const cameraId = resolveHeadlessCameraId(scene, time, cameraIdAt)
        const frame = await registry.captureFrame({ cameraId: cameraId ?? 'black', width, height, burnLabels })
        if (!frame) {
          onResult(null)
          return
        }
        frames.push(frame.dataUrl)
        cameraIds.push(cameraId)
        const characterPoses = frame.characterPoses ?? {}
        const tPoseIds = rejectTPose ? scene.objects.filter((object) => activeReadyAction(object, time) && characterPoses[object.id] && isTPose(characterPoses[object.id])).map((object) => object.id) : []
        if (tPoseIds.length) {
          onResult({ frames: [], width, height, cameraIds: [], frameReadbacks: [], invalidReasons: tPoseIds.map((id) => `t-pose:${id}@${time}`) })
          return
        }
        frameReadbacks.push({ cameraId, camera: frame.camera ?? null, subjectPositions: frame.subjectPositions ?? {}, characterPoses })
      }
      if (!cancelled) onResult({ frames, width, height, cameraIds, frameReadbacks })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [burnLabels, cameraIdAt, captureSize, maxShortSide, onResult, rejectTPose, registry, store, times, waitForActionClips])

  return null
}

export function DirectorHeadlessCapture({ project, times, maxShortSide, captureSize, cameraIdAt, burnLabels, waitForActionClips, rejectTPose, onResult }: DirectorHeadlessCaptureProps): JSX.Element {
  const store = React.useMemo(() => createDirectorStore({ rawProject: project, defaultSceneName: project.scenes[0]?.name ?? 'Scene 1' }), [project])
  const registry = React.useMemo(() => createSceneRefRegistry(), [])
  const apiRef = React.useRef(null) as ViewportApiRef

  return (
    <div aria-hidden style={{ position: 'absolute', left: -10000, top: 0, width: 480, height: 270, opacity: 0, pointerEvents: 'none' }}>
      <DirectorStoreContext.Provider value={store}>
        <ViewportApiContext.Provider value={apiRef}>
          <FencedCanvas
            frameloop="always"
            shadows="percentage"
            dpr={1}
            gl={{ antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
            camera={{ fov: 50, near: 0.1, far: 2000, position: [4, 2.4, 5] }}
            style={{ width: '100%', height: '100%' }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace
            }}
          >
            <SceneRegistryContext.Provider value={registry}>
              <ContextRecovery />
              <SkyGround theme="default" />
              <PanoramaSphere />
              <DirectorEntities />
              <PlaybackBinder />
              <CaptureBinder />
              <CaptureDriver times={times} maxShortSide={maxShortSide} captureSize={captureSize} cameraIdAt={cameraIdAt} burnLabels={burnLabels} waitForActionClips={waitForActionClips} rejectTPose={rejectTPose} onResult={onResult} />
            </SceneRegistryContext.Provider>
          </FencedCanvas>
        </ViewportApiContext.Provider>
      </DirectorStoreContext.Provider>
    </div>
  )
}
