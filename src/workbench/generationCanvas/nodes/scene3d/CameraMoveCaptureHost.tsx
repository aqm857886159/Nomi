// 运镜小片的全局出图 Host：常驻挂载（不随画布节点剔除），扫描带 meta.cameraMoveAutoCapture 的
// scene3d 节点 → 离屏沿相机轨迹采 N 帧 → ffmpeg 拼成 mp4 → 落项目素材 → 写回 scene3d 节点
// meta.cameraMoveVideo（{ url, assetId, fps, targetNodeId }）+ 清标志。
//
// 与 StagingCaptureHost 同根因（自研画布剔除离屏节点 → 挂节点里的捕获永不触发，故抽成常驻 Host）。
// S2 范围 = 「scene3dState + 标志 → mp4 素材 url」，到此为止；把 mp4 喂进目标镜头
// referenceVideoUrls / 切 Seedance omni 是 S3，故这里只把结果写进 meta.cameraMoveVideo 留干净接缝。
import React from 'react'
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import { normalizeScene3DState } from './scene3dSerializer'
import { persistCameraMoveVideo } from './cameraMoveVideo'
import { Scene3DTrajectoryCapture, type CameraMoveCaptureResult } from './Scene3DTrajectoryCapture'
import {
  decideCameraMoveRetry,
  DEFAULT_CAMERA_MOVE_RETRY,
  type CameraMoveCaptureOutcome,
} from './cameraMoveCaptureRetry'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import type { CameraMove } from './cameraMoveVocab'
import { computeAttachCameraMove } from './attachCameraMoveToTarget'
import { toast } from '../../../../ui/toast'

type CameraMoveAutoCapture = {
  targetNodeId?: string
  frameCount?: number
  fps?: number
  move?: CameraMove
}

// S2 产物（写回 scene3d 节点 meta，供 S3 喂入消费）。
export type CameraMoveVideoResult = {
  url: string
  assetId?: string
  fps: number
  targetNodeId?: string
  createdAt: number
}

const DEFAULT_FPS = 24 // Seedance 参考视频要求 23.8–60 FPS（12fps 会被 InvalidParameter.FpsTooLow 拒）

/**
 * E2E 专用：强制前 N 次尝试失败（模拟离屏上下文丢失导致的空结果），验证重试兜底真会重来出片。
 * 仅当 renderer localStorage['__nomiForceCameraMoveFail']=N（正整数）时生效；生产从不置该标志 → 永不触发。
 * 返回被强制失败后的 outcome（'null'）；否则原样返回真实 outcome。
 */
function coerceOutcomeForE2E(attempt: number, outcome: CameraMoveCaptureOutcome): CameraMoveCaptureOutcome {
  try {
    if (typeof window === 'undefined') return outcome
    const raw = window.localStorage?.getItem('__nomiForceCameraMoveFail')
    const n = raw ? Number(raw) : 0
    if (Number.isFinite(n) && n > 0 && attempt <= n) return 'null'
  } catch {
    // localStorage 不可用 → 不干预
  }
  return outcome
}
const DEFAULT_FRAME_COUNT = 120 // 缺时长时的兜底：5s @ 24fps
const MIN_FRAME_COUNT = 2
const MAX_FRAME_COUNT = 240

function readCameraMove(node: GenerationCanvasNode): CameraMoveAutoCapture | null {
  const raw = node.meta?.cameraMoveAutoCapture
  return raw && typeof raw === 'object' ? (raw as CameraMoveAutoCapture) : null
}

function clampFrameCount(value: number | undefined, fallback: number): number {
  const n = Math.floor(value ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_FRAME_COUNT, Math.max(MIN_FRAME_COUNT, n))
}

/**
 * P3-C 没有显式 frameCount 时,从场景轨迹绑定时长 derive(frameCount = round(duration*fps)),
 * 而非用固定 48（48/12=4s 对不上 3/5/8s 的运镜）。无可读时长 → 回落 DEFAULT_FRAME_COUNT。
 */
function deriveFrameCountFromScene(scene3dState: unknown, fps: number): number {
  const state = scene3dState && typeof scene3dState === 'object' ? (scene3dState as Record<string, unknown>) : null
  const bindings = state && Array.isArray(state.trajectoryBindings) ? state.trajectoryBindings : []
  let maxDuration = 0
  for (const raw of bindings) {
    const b = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const end = b && typeof b.endTime === 'number' ? b.endTime : 0
    const start = b && typeof b.startTime === 'number' ? b.startTime : 0
    maxDuration = Math.max(maxDuration, end - start)
  }
  if (!(maxDuration > 0)) return DEFAULT_FRAME_COUNT
  return Math.round(maxDuration * fps)
}

function clampFps(value: number | undefined): number {
  const n = value ?? DEFAULT_FPS
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_FPS
  return Math.min(60, Math.max(24, n)) // 下限 24：Seedance 参考视频帧率必须 ≥23.8 FPS
}

/**
 * S3 喂入（薄壳）：读目标节点 → 交给纯核 computeAttachCameraMove 算 patch/跳过 → 写回 store + 弹提示。
 * 替换语义、幂等、种类校验、模式切换全在纯核里（attachCameraMoveToTarget.ts，可单测）。这里只负责
 * store I/O，不再内联任何附着逻辑（P1：AI 路与手动路共用同一核，无并行拷贝）。
 */
function attachCameraMoveToTarget(targetNodeId: string, mp4Url: string, move: CameraMove | undefined): void {
  const store = useGenerationCanvasStore.getState()
  const target = store.nodes.find((node) => node.id === targetNodeId)
  const outcome = computeAttachCameraMove(target, mp4Url, move)
  if (outcome.toast) toast(outcome.toast.message, outcome.toast.level)
  if (outcome.kind === 'patch') store.updateNode(targetNodeId, outcome.patch)
}

/** 把成功产物写回 scene3d 节点 meta + 喂入目标镜头。清标志留给调用方（重试期间不清）。 */
async function persistAndAttach(
  nodeId: string,
  fps: number,
  capture: CameraMoveCaptureResult,
): Promise<boolean> {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return false
  const config = readCameraMove(node)
  const persisted = await persistCameraMoveVideo(capture.frames, nodeId, capture.title, fps)
  if (!persisted.url) return false
  const videoResult: CameraMoveVideoResult = {
    url: persisted.url,
    assetId: persisted.assetId,
    fps,
    targetNodeId: config?.targetNodeId,
    createdAt: Date.now(),
  }
  // S2 接缝：把运镜小片结果写回 scene3d 节点 meta（产物留痕，便于复用/调试）。
  const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  useGenerationCanvasStore.getState().updateNode(nodeId, {
    meta: {
      ...(current?.meta || node.meta || {}),
      cameraMoveVideo: videoResult,
    },
  })
  // S3 喂入：把 mp4 喂给目标镜头视频节点（有 video_ref 槽则切模式+填参考视频，否则降级 prompt 地板）。
  if (config?.targetNodeId) {
    attachCameraMoveToTarget(config.targetNodeId, persisted.url, config.move)
  }
  return true
}

export function CameraMoveCaptureHost(): JSX.Element | null {
  // E2E 专用桥：仅当 renderer localStorage['__nomiE2E']==='1' 时把画布 store 挂到 window，
  // 供隔离走查在页面上下文里读写画布（如把相机轨迹改成假人走位再触发离屏渲染）。生产从不置该标志 → 永不暴露。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiCanvasStore?: unknown }).__nomiCanvasStore = useGenerationCanvasStore
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])
  const pendingNode = useGenerationCanvasStore((state) =>
    state.nodes.find((node) => node.kind === 'scene3d' && readCameraMove(node) !== null) ?? null,
  )
  // 正在处理的节点 id + 该节点当前的尝试轮次（1=首次；每次重试 +1）。
  // attempt 也当挂载 key：变一次就整棵 Scene3DTrajectoryCapture 卸载重挂（离屏 Canvas 全新、上下文腾出）。
  const [processing, setProcessing] = React.useState<{ nodeId: string; attempt: number } | null>(null)
  // 单次尝试的看门狗：捕获循环若被上下文丢失停死（onResult 永不回调），到点判 'timeout' 走重试。
  const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const settledRef = React.useRef(false)
  // 当前轮的 fps，供 watchdog 回调（timeout 无 onResult 参数）读取。
  const currentFpsRef = React.useRef(DEFAULT_FPS)

  const clearTimers = React.useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null }
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
  }, [])

  const clearFlag = React.useCallback((nodeId: string) => {
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    if (!current) return
    const meta = { ...(current.meta || {}) }
    delete (meta as Record<string, unknown>).cameraMoveAutoCapture
    useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
  }, [])

  // 某次尝试的结局（ok / null / timeout）→ 纯逻辑决定 done / retry / giveUp。
  // 关键：只有 done 或 giveUp 才清 cameraMoveAutoCapture 标志；retry 期间**保留标志**，
  // 靠换 attempt(=挂载 key) 让离屏捕获器整棵重挂重来（一次瞬态上下文丢失不判死）。
  const settleAttempt = React.useCallback(
    (nodeId: string, attempt: number, fps: number, outcome: CameraMoveCaptureOutcome, capture: CameraMoveCaptureResult | null) => {
      if (settledRef.current) return // 同一轮 watchdog 与 onResult 竞态：先到者定结局，后到者忽略。
      settledRef.current = true
      clearTimers()
      // E2E 故障注入：强制前 N 次失败，验证重试兜底真会重来出片（生产 no-op）。
      const effectiveOutcome = coerceOutcomeForE2E(attempt, outcome)
      void (async () => {
        let done = effectiveOutcome === 'ok'
        if (effectiveOutcome === 'ok' && capture) {
          try {
            done = await persistAndAttach(nodeId, fps, capture)
          } catch {
            done = false // 落盘/喂入抛错也当失败，走重试兜底。
          }
        }
        const decision = decideCameraMoveRetry(done ? 'ok' : (effectiveOutcome === 'ok' ? 'null' : effectiveOutcome), attempt, DEFAULT_CAMERA_MOVE_RETRY)
        if (decision.kind === 'retry') {
          // 保留标志：延迟后 +attempt 触发整棵重挂（上下文腾出配额后重采）。
          retryTimerRef.current = setTimeout(() => {
            setProcessing((prev) => (prev && prev.nodeId === nodeId ? { nodeId, attempt: decision.nextAttempt } : prev))
          }, decision.delayMs)
          return
        }
        // done 或 giveUp：清标志（giveUp 也清，否则永远卡着重挂），放开处理位。
        clearFlag(nodeId)
        setProcessing(null)
      })()
    },
    [clearTimers, clearFlag],
  )

  // 认领待处理节点：无人处理时锁定它并从第 1 轮起。已在处理别的节点则不抢。
  React.useEffect(() => {
    if (!pendingNode) {
      if (processing) { clearTimers(); setProcessing(null) }
      return
    }
    if (!processing) setProcessing({ nodeId: pendingNode.id, attempt: 1 })
  }, [pendingNode, processing, clearTimers])

  // 每轮尝试开始时装看门狗：到 attemptTimeoutMs 仍无 onResult → 判 timeout 走重试（治「循环停死不回调」）。
  React.useEffect(() => {
    if (!processing) return
    settledRef.current = false
    watchdogRef.current = setTimeout(() => {
      settleAttempt(processing.nodeId, processing.attempt, currentFpsRef.current, 'timeout', null)
    }, DEFAULT_CAMERA_MOVE_RETRY.attemptTimeoutMs)
    return () => { if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null } }
  }, [processing, settleAttempt])

  React.useEffect(() => () => clearTimers(), [clearTimers])

  if (!pendingNode || !processing || processing.nodeId !== pendingNode.id) return null
  const config = readCameraMove(pendingNode)
  const state = normalizeScene3DState(pendingNode.meta?.scene3dState)
  const nodeId = pendingNode.id
  const fps = clampFps(config?.fps)
  currentFpsRef.current = fps
  // P3-C 缺 frameCount 时按轨迹时长 derive(round(duration*fps)),别用固定 48。
  const frameCount = clampFrameCount(config?.frameCount, deriveFrameCountFromScene(state, fps))
  return (
    <Scene3DTrajectoryCapture
      // attempt 作 key：重试即整棵卸载重挂（离屏 Canvas 全新、WebGL 上下文腾出后重采）。
      key={`${nodeId}:${processing.attempt}`}
      state={state}
      frameCount={frameCount}
      fps={fps}
      title="运镜参考"
      onResult={(result) => settleAttempt(nodeId, processing.attempt, fps, result ? 'ok' : 'null', result)}
    />
  )
}
