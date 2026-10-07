/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../ui/toast、../../../store/generationCanvasStore、../../../model/generationCanvasTypes、../bridge/persistOutputs 的 persistDirectorFramesVideo、
 *          ../model/directorProject 的 normalizeDirectorProject、../model/directorIds 的 createOutputId、../model/directorNodeMeta 的 meta 键、../model/timeGrid 的 sceneContentEndSeconds、
 *          ./createCameraMoveReferenceNode（readCameraMoveAutoCapture / CAMERA_MOVE_CAPTURE_FPS）、./cameraMoveSchedule 的 frameTimes、./cameraMoveCaptureRetry、./attachCameraMoveToTarget 的 computeAttachCameraMove、./DirectorHeadlessCapture
 * [OUTPUT]: 对外提供 CameraMoveCaptureHost（常驻：扫到带 cameraMoveAutoCapture 的 director 节点 → 离屏沿机位 1 的路径片段采 N 帧 → 帧转视频桥拼 mp4 →
 *          写回节点 meta.cameraMoveVideo + 工程 outputs.videos → 喂目标镜头 video_ref → 清标志）、CameraMoveVideoResult
 * [POS]: director/agent 的 create_camera_move 执行下半场（手动运镜控件同一条路）。看门狗 + 重试：一次上下文丢失不判死，attempt 当挂载 key 整棵重挂；
 *        只有 done / giveUp 才清标志。E2E 桥（__nomiCanvasStore / __nomiForceCameraMoveFail）只在 localStorage 打标时生效，生产永不暴露。
 *        3D-BOX 整段预演（导演节点 directorPreview.status=rendering）是同一个 Host 的第二种请求：同一套重试 / 看门狗 / 落盘，
 *        采帧计划与挂接写回在 ./directorPreviewCapture（按时刻取节目机位、等动作片段）；用尽重试判 failed 不清标志（挡生成）。
 *        请求身份带修订号：渲染期间计划被改，旧那轮直接作废、按新修订重来。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '../../../../../ui/toast'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { persistDirectorFramesVideo } from '../bridge/persistOutputs'
import { isProjectExecutionContextCurrent, withProjectAction, type ProjectExecutionContext } from '../../../../project/projectCanvasReadSurface'
import { createOutputId } from '../model/directorIds'
import { CAMERA_MOVE_AUTO_CAPTURE_META_KEY, DIRECTOR_NODE_KIND, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { normalizeDirectorProject } from '../model/directorProject'
import type { DirectorProject } from '../model/directorTypes'
import { sceneContentEndSeconds } from '../model/timeGrid'
import { computeAttachCameraMove } from './attachCameraMoveToTarget'
import { decideCameraMoveRetry, DEFAULT_CAMERA_MOVE_RETRY, type CameraMoveCaptureOutcome } from './cameraMoveCaptureRetry'
import { frameTimes } from './cameraMoveSchedule'
import type { CameraMove } from '../../../../../../electron/shared/director/vocab'
import { CAMERA_MOVE_CAPTURE_FPS, readCameraMoveAutoCapture } from './createCameraMoveReferenceNode'
import { DirectorHeadlessCapture, referenceVideoShortSide, type HeadlessCaptureResult } from './DirectorHeadlessCapture'
import { readDirectorPreview } from '../model/directorPreviewState'
import { applyPreviewCaptured, markPreviewFailed, previewAttemptTimeoutMs, previewCapturePlan } from './directorPreviewCapture'

export const CAMERA_MOVE_VIDEO_META_KEY = 'cameraMoveVideo'

/** 写回节点 meta 的产物（目标镜头 / 产物卡靠它判「出片完成」） */
export type CameraMoveVideoResult = { url: string; assetId?: string; fps: number; targetNodeId?: string; createdAt: number }

const DEFAULT_FRAME_COUNT = 120 // 缺时长时的兜底：5s @ 24fps
const MIN_FRAME_COUNT = 2
const MAX_FRAME_COUNT = 240

/**
 * E2E 专用：强制前 N 次尝试失败（模拟离屏上下文丢失导致的空结果），验证重试兜底真会重来出片。
 * 仅当 renderer localStorage['__nomiForceCameraMoveFail']=N 时生效；生产从不置该标志。
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

function isPendingCameraMove(node: GenerationCanvasNode): boolean {
  return node.kind === DIRECTOR_NODE_KIND && readCameraMoveAutoCapture(node) !== null
}

/** 待处理请求的身份：运镜小片 = 节点；3D-BOX 预演 = 节点 + 修订 + 标记时刻（重试 / 新修订都是新请求）。 */
function pendingRequestKey(node: GenerationCanvasNode): string | null {
  if (node.kind !== DIRECTOR_NODE_KIND) return null
  if (isPendingCameraMove(node)) return `camera-move:${node.id}`
  const preview = readDirectorPreview(node)
  return preview?.status === 'rendering' ? `preview:${node.id}:${preview.revision}:${preview.updatedAt}` : null
}

function clampFrameCount(value: number | undefined, fallback: number): number {
  const n = Math.floor(value ?? fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_FRAME_COUNT, Math.max(MIN_FRAME_COUNT, n))
}

function clampFps(value: number | undefined): number {
  const n = value ?? CAMERA_MOVE_CAPTURE_FPS
  if (!Number.isFinite(n) || n <= 0) return CAMERA_MOVE_CAPTURE_FPS
  return Math.min(60, Math.max(24, n)) // 下限 24：Seedance 参考视频帧率必须 ≥23.8 FPS
}

/** 机位 1 的路径片段区间（没有片段 = 内容末，至少 1s）；帧数缺省按区间时长 derive，不用固定值 */
function captureWindow(project: DirectorProject): { start: number; end: number } {
  const scene = project.scenes[0]
  const clip = scene?.cameras[0]?.trajectoryClips?.[0]
  if (clip) return { start: clip.startTime, end: Math.max(clip.startTime + 1 / CAMERA_MOVE_CAPTURE_FPS, clip.endTime) }
  return { start: 0, end: Math.max(1, scene ? sceneContentEndSeconds(scene) : 1) }
}

function attachToTarget(targetNodeId: string, mp4Url: string, move: CameraMove | undefined): void {
  const store = useGenerationCanvasStore.getState()
  const outcome = computeAttachCameraMove(store.nodes.find((node) => node.id === targetNodeId), mp4Url, move)
  if (outcome.toast) toast(outcome.toast.message, outcome.toast.level)
  if (outcome.kind === 'patch') store.updateNode(targetNodeId, outcome.patch)
}

/** 成功产物写回节点 meta + 工程产物清单 + 喂入目标镜头。清标志留给调用方（重试期间不清）。 */
async function persistAndAttach(nodeId: string, fps: number, title: string, capture: HeadlessCaptureResult, originProject: ProjectExecutionContext | null): Promise<boolean> {
  const store = useGenerationCanvasStore.getState()
  const node = store.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return false
  const config = readCameraMoveAutoCapture(node)
  const persisted = await persistDirectorFramesVideo(capture.frames, nodeId, title, fps, originProject)
  if (!persisted.url || (originProject && !isProjectExecutionContextCurrent(originProject))) return false
  const videoResult: CameraMoveVideoResult = { url: persisted.url, assetId: persisted.assetId, fps, targetNodeId: config?.targetNodeId, createdAt: Date.now() }
  const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const project = normalizeDirectorProject(current?.meta?.[DIRECTOR_PROJECT_META_KEY] ?? node.meta?.[DIRECTOR_PROJECT_META_KEY])
  const output = { id: createOutputId(), name: title, assetUrl: persisted.url, width: capture.width, height: capture.height, duration: capture.frames.length / fps, createdAt: videoResult.createdAt }
  useGenerationCanvasStore.getState().updateNode(nodeId, {
    meta: {
      ...(current?.meta || node.meta || {}),
      [CAMERA_MOVE_VIDEO_META_KEY]: videoResult,
      [DIRECTOR_PROJECT_META_KEY]: { ...project, outputs: { ...project.outputs, videos: [output, ...project.outputs.videos] } },
    },
  })
  if (config?.targetNodeId) attachToTarget(config.targetNodeId, persisted.url, config.move)
  return true
}

/** 3D-BOX 预演：拼片落盘（只认原项目）→ 挂接 + 写回 ready；修订已变 = 迟到结果，当成完成丢弃（新修订会另起一轮）。 */
async function persistPreview(nodeId: string, revision: string, fps: number, title: string, capture: HeadlessCaptureResult, originProject: ProjectExecutionContext | null): Promise<boolean> {
  const persisted = await persistDirectorFramesVideo(capture.frames, nodeId, title, fps, originProject)
  if (!persisted.url || (originProject && !isProjectExecutionContextCurrent(originProject))) return false
  const createdAt = Date.now()
  const outcome = applyPreviewCaptured(nodeId, revision, persisted.url, persisted.assetId, { id: createOutputId(), name: title, width: capture.width, height: capture.height, duration: capture.frames.length / fps, createdAt })
  if (outcome?.toast) toast(outcome.toast.message, outcome.toast.level)
  return true
}

export function CameraMoveCaptureHost(): JSX.Element | null {
  const { t } = useTranslation()
  // E2E 桥：仅当 localStorage['__nomiE2E']==='1' 时把画布 store 挂到 window，供走查在页面上下文里读写画布
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        ;(window as unknown as { __nomiCanvasStore?: unknown }).__nomiCanvasStore = useGenerationCanvasStore
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])
  const pendingKey = useGenerationCanvasStore((state) => {
    for (const node of state.nodes) {
      const key = pendingRequestKey(node)
      if (key) return key
    }
    return null
  })
  const pendingNode = pendingKey ? useGenerationCanvasStore.getState().nodes.find((node) => pendingRequestKey(node) === pendingKey) ?? null : null
  // 正在处理的请求 + 尝试轮次（1=首次）；attempt 也当挂载 key：变一次就整棵离屏画布卸载重挂
  const [processing, setProcessing] = React.useState<{ nodeId: string; key: string; attempt: number } | null>(null)
  const watchdogRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const settledRef = React.useRef(false)
  const currentFpsRef = React.useRef(CAMERA_MOVE_CAPTURE_FPS)
  const currentRevisionRef = React.useRef<string | null>(null)
  const currentTimeoutRef = React.useRef(DEFAULT_CAMERA_MOVE_RETRY.attemptTimeoutMs)

  const clearTimers = React.useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current)
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    watchdogRef.current = null
    retryTimerRef.current = null
  }, [])

  const clearFlag = React.useCallback((nodeId: string) => {
    const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    if (!current) return
    const meta = { ...(current.meta || {}) }
    delete meta[CAMERA_MOVE_AUTO_CAPTURE_META_KEY]
    useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
  }, [])

  // 某次尝试的结局（ok / null / timeout）→ 纯逻辑决定 done / retry / giveUp；只有 done / giveUp 才清标志
  const settleAttempt = React.useCallback(
    (nodeId: string, key: string, attempt: number, fps: number, outcome: CameraMoveCaptureOutcome, capture: HeadlessCaptureResult | null, revision: string | null) => {
      if (settledRef.current) return // watchdog 与 onResult 竞态：先到者定结局
      settledRef.current = true
      clearTimers()
      const effectiveOutcome = coerceOutcomeForE2E(attempt, outcome)
      // 这一轮结局到达即动作起点：签发原项目，拼片落盘与写回只认它；换了项目就放弃，不在新项目写 meta。
      const originProject = withProjectAction((issued) => issued) ?? null
      void (async () => {
        let done = effectiveOutcome === 'ok'
        if (effectiveOutcome === 'ok' && capture) {
          try {
            done = revision === null
              ? await persistAndAttach(nodeId, fps, t('director.agent.cameraMoveReference'), capture, originProject)
              : await persistPreview(nodeId, revision, fps, t('director.agent.boxPreview'), capture, originProject)
          } catch {
            done = false // 落盘 / 喂入抛错也当失败，走重试兜底
          }
        }
        if (originProject && !isProjectExecutionContextCurrent(originProject)) return
        const decision = decideCameraMoveRetry(done ? 'ok' : effectiveOutcome === 'ok' ? 'null' : effectiveOutcome, attempt, DEFAULT_CAMERA_MOVE_RETRY)
        if (decision.kind === 'retry') {
          retryTimerRef.current = setTimeout(() => {
            setProcessing((prev) => (prev && prev.key === key ? { ...prev, attempt: decision.nextAttempt } : prev))
          }, decision.delayMs)
          return
        }
        // 运镜小片：结局一到就清标志。预演：成功已写回 ready；用尽重试判 failed（标志不清，挡着这一镜的生成）。
        if (revision === null) clearFlag(nodeId)
        else if (decision.kind === 'giveUp') markPreviewFailed(nodeId, revision)
        setProcessing(null)
      })()
    },
    [clearFlag, clearTimers, t],
  )

  // 认领待处理节点：无人处理时锁定它并从第 1 轮起；已在处理别的节点则不抢
  React.useEffect(() => {
    if (!pendingNode) {
      if (processing) {
        clearTimers()
        setProcessing(null)
      }
      return
    }
    if (!processing || processing.key !== pendingKey) {
      clearTimers()
      setProcessing({ nodeId: pendingNode.id, key: pendingKey!, attempt: 1 })
    }
  }, [pendingNode, pendingKey, processing, clearTimers])

  // 每轮尝试装看门狗：到点仍无 onResult → 判 timeout 走重试
  React.useEffect(() => {
    if (!processing) return
    settledRef.current = false
    watchdogRef.current = setTimeout(() => {
      settleAttempt(processing.nodeId, processing.key, processing.attempt, currentFpsRef.current, 'timeout', null, currentRevisionRef.current)
    }, currentTimeoutRef.current)
    return () => {
      if (watchdogRef.current) clearTimeout(watchdogRef.current)
      watchdogRef.current = null
    }
  }, [processing, settleAttempt])

  React.useEffect(() => () => clearTimers(), [clearTimers])

  const nodeId = pendingNode?.id ?? null
  const attempt = processing?.attempt ?? 0
  const plan = React.useMemo(() => {
    if (!pendingNode) return null
    if (!isPendingCameraMove(pendingNode)) {
      const preview = previewCapturePlan(pendingNode)
      return preview ? { ...preview, waitForActionClips: true } : null
    }
    const config = readCameraMoveAutoCapture(pendingNode)
    const project = normalizeDirectorProject(pendingNode.meta?.[DIRECTOR_PROJECT_META_KEY])
    const fps = clampFps(config?.fps)
    const window = captureWindow(project)
    const frameCount = clampFrameCount(config?.frameCount, Math.round((window.end - window.start) * fps) || DEFAULT_FRAME_COUNT)
    return { project, fps, times: frameTimes(window.start, window.end, frameCount), revision: null, cameraIdAt: undefined, waitForActionClips: false }
    // 只在换请求 / 换轮次时重建：出片期间节点 meta 的其它写入不该重挂离屏画布
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey, attempt])
  const onResult = React.useCallback(
    (result: HeadlessCaptureResult | null) => {
      if (!nodeId || !plan || !processing) return
      settleAttempt(nodeId, processing.key, attempt, plan.fps, result && result.frames.length >= MIN_FRAME_COUNT ? 'ok' : 'null', result, plan.revision)
    },
    [attempt, nodeId, plan, processing, settleAttempt],
  )

  if (!pendingNode || !processing || processing.key !== pendingKey || !plan) return null
  currentFpsRef.current = plan.fps
  currentRevisionRef.current = plan.revision
  currentTimeoutRef.current = plan.revision === null ? DEFAULT_CAMERA_MOVE_RETRY.attemptTimeoutMs : previewAttemptTimeoutMs(plan.times.length)
  return (
    <DirectorHeadlessCapture
      key={`${processing.key}:${processing.attempt}`}
      project={plan.project}
      times={plan.times}
      maxShortSide={referenceVideoShortSide}
      {...(plan.cameraIdAt ? { cameraIdAt: plan.cameraIdAt } : {})}
      {...(plan.waitForActionClips ? { waitForActionClips: true } : {})}
      onResult={onResult}
    />
  )
}
