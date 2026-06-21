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
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { archetypeForNode, findVideoRefMode } from '../../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch, readArchetypeArray } from '../controls/archetypeMeta'
import { CAMERA_MOVE_LABEL, CAMERA_MOVE_DESC, type CameraMove } from './cameraMoveVocab'
import { isVideoLikeGenerationNodeKind } from '../../model/generationNodeKinds'
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

const DEFAULT_FPS = 12
const DEFAULT_FRAME_COUNT = 48
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
  return Math.min(60, Math.max(1, n))
}

/** 运镜 prompt 地板（通用，全供应商可用）：人话点出该镜的运镜，作为不吃视频参考时的降级。 */
function cameraMoveDirective(move: CameraMove | undefined): string {
  if (!move) return ''
  return `\n镜头运动：${CAMERA_MOVE_LABEL[move]}（${CAMERA_MOVE_DESC[move]}）`
}

/**
 * S3 喂入：把运镜小片 mp4 喂给目标镜头视频节点。
 * - 目标模型有 video_ref 槽（如 Seedance 2.0 全能参考）→ 切到该模式 + meta.referenceVideoUrls 追加 mp4 +
 *   prompt 追加「参考视频运镜」指令（模型无关，引用视频，只迁运镜不迁内容）。
 * - 无 video_ref 槽 → 降级：只追加结构化运镜 prompt 地板（CAMERA_MOVE_LABEL/DESC），并标注跳过视频参考。
 *   （吃首尾帧的供应商的完整首尾帧降级是后续切片，这里先做 prompt 地板。）
 */
function attachCameraMoveToTarget(targetNodeId: string, mp4Url: string, move: CameraMove | undefined): void {
  const store = useGenerationCanvasStore.getState()
  const target = store.nodes.find((node) => node.id === targetNodeId)
  if (!target) return
  // P2-A 校验目标节点种类:运镜参考只能喂视频生成节点。指到图片节点 → 没有 video_ref 槽,
  // 旧逻辑会静默把无用的运镜 prompt 追加到图片上(图片模型不懂"镜头运动")。诚实跳过并提示。
  if (!isVideoLikeGenerationNodeKind(target.kind)) {
    toast('运镜参考只能喂给视频镜头节点，已跳过（目标不是视频节点）', 'warning')
    return
  }
  const meta = { ...(target.meta || {}) } as Record<string, unknown>
  // P3-A 用 meta 标志判重附（不再靠 prompt 子串嗅探,基础 prompt 含 @Video1/「镜头运动：」会误判）。
  if (meta.cameraMoveAttached === true) return
  const archetype = archetypeForNode(target)
  const videoRef = findVideoRefMode(archetype)
  if (archetype && videoRef) {
    // P2-B 切模式前先看旧模式是否设了首/尾帧、而目标(video_ref)模式没有该槽 → 会在投影时被静默丢弃。
    // 留痕告诉用户「模式变了，首帧不再注入」，不静默改。
    const hadFirstOrLast =
      (typeof meta.firstFrameUrl === 'string' && meta.firstFrameUrl.trim().length > 0) ||
      (typeof meta.lastFrameUrl === 'string' && meta.lastFrameUrl.trim().length > 0)
    // 切到含 video_ref 的模式（已在该模式则 applyArchetypeModeSwitch 幂等）。
    let nextMeta = applyArchetypeModeSwitch(meta, archetype, videoRef.modeId)
    const existing = readArchetypeArray(nextMeta, videoRef.metaKey)
    const referenceVideoUrls = existing.includes(mp4Url) ? existing : [...existing, mp4Url]
    nextMeta = { ...nextMeta, [videoRef.metaKey]: referenceVideoUrls, cameraMoveAttached: true }
    const targetMode = archetype.modes.find((m) => m.id === videoRef.modeId)
    const targetHasFrameSlot = targetMode?.slots.some((s) => s.kind === 'first_frame' || s.kind === 'last_frame') ?? false
    if (hadFirstOrLast && !targetHasFrameSlot) {
      toast('已切换到全能参考模式以注入运镜参考视频（该模式无首/尾帧，原首帧不再生效）', 'warning')
    }
    const directive = `\n@Video1 跟随这段参考视频的运镜（只参考镜头运动，画面内容由角色参考与文字决定）。`
    const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
    const prompt = basePrompt.includes('@Video1') ? basePrompt : `${basePrompt}${directive}`
    store.updateNode(targetNodeId, { meta: nextMeta, prompt })
    return
  }
  // 降级：视频节点但模型无视频参考槽 → 只补结构化运镜 prompt 地板（保留模型不变）。
  const directive = cameraMoveDirective(move)
  if (!directive) return
  const basePrompt = typeof target.prompt === 'string' ? target.prompt : ''
  const prompt = basePrompt.includes('镜头运动：') ? basePrompt : `${basePrompt}${directive}`
  store.updateNode(targetNodeId, { meta: { ...meta, cameraMoveAttached: true }, prompt })
}

export function CameraMoveCaptureHost(): JSX.Element | null {
  const pendingNode = useGenerationCanvasStore((state) =>
    state.nodes.find((node) => node.kind === 'scene3d' && readCameraMove(node) !== null) ?? null,
  )
  const processingRef = React.useRef<string | null>(null)

  const handleResult = React.useCallback(
    async (nodeId: string, fps: number, capture: CameraMoveCaptureResult | null) => {
      const store = useGenerationCanvasStore.getState()
      const node = store.nodes.find((candidate) => candidate.id === nodeId)
      const config = node ? readCameraMove(node) : null
      const clearFlag = () => {
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        if (!current) return
        const meta = { ...(current.meta || {}) }
        delete (meta as Record<string, unknown>).cameraMoveAutoCapture
        useGenerationCanvasStore.getState().updateNode(nodeId, { meta })
      }
      try {
        if (!node || !capture) return
        const persisted = await persistCameraMoveVideo(capture.frames, nodeId, capture.title, fps)
        if (!persisted.url) return
        const videoResult: CameraMoveVideoResult = {
          url: persisted.url,
          assetId: persisted.assetId,
          fps,
          targetNodeId: config?.targetNodeId,
          createdAt: Date.now(),
        }
        // S2 接缝：把运镜小片结果写回 scene3d 节点 meta（产物留痕，便于复用/调试）。
        const current = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
        store.updateNode(nodeId, {
          meta: {
            ...(current?.meta || node.meta || {}),
            cameraMoveVideo: videoResult,
          },
        })
        // S3 喂入：把 mp4 喂给目标镜头视频节点（有 video_ref 槽则切模式+填参考视频，否则降级 prompt 地板）。
        if (config?.targetNodeId) {
          attachCameraMoveToTarget(config.targetNodeId, persisted.url, config.move)
        }
      } finally {
        clearFlag()
        processingRef.current = null
      }
    },
    [],
  )

  if (!pendingNode) return null
  if (processingRef.current && processingRef.current !== pendingNode.id) return null
  processingRef.current = pendingNode.id
  const config = readCameraMove(pendingNode)
  const state = normalizeScene3DState(pendingNode.meta?.scene3dState)
  const nodeId = pendingNode.id
  const fps = clampFps(config?.fps)
  // P3-C 缺 frameCount 时按轨迹时长 derive(round(duration*fps)),别用固定 48。
  const frameCount = clampFrameCount(config?.frameCount, deriveFrameCountFromScene(state, fps))
  return (
    <Scene3DTrajectoryCapture
      state={state}
      frameCount={frameCount}
      fps={fps}
      title="运镜参考"
      onResult={(result) => { void handleResult(nodeId, fps, result) }}
    />
  )
}
