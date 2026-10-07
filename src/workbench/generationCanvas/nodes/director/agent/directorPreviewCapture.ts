/**
 * [INPUT]: 依赖 ../model/directorPreviewState、../model/programCamera 的 programCameraIdAt、../model/timeGrid 的 sceneContentEndSeconds、
 *          ../model/directorShotSummaries、../model/directorProject、./cameraMoveSchedule 的 frameTimes、./attachCameraMoveToTarget 的 computeAttachCameraMove、
 *          画布 store、../../../events/canvasGestureContext
 * [OUTPUT]: 对外提供 previewCapturePlan（整段预演的采帧计划）、applyPreviewCaptured（挂到视频节点 + 写回 ready）、markPreviewFailed、
 *           previewAttemptTimeoutMs
 * [POS]: 3D-BOX 预演出片的纯逻辑那一半（常驻 CameraMoveCaptureHost 的预演请求调它；React / 计时器 / 落盘留在 Host）。
 *        按时刻取节目机位（programCameraIdAt）、等动作片段就绪；挂接只走唯一核心 computeAttachCameraMove。
 *        Host 事后的写入沿用写下这次预演的那笔提议的事务身份（txn_<proposalId>）：撤销 stage_shot 时它们算同一笔改动，
 *        不算「别人的后续改动」。修订号对不上（预演渲染期间计划又被改了）= 迟到结果，整份丢弃。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { withCanvasGestureContext } from '../../../events/canvasGestureContext'
import { useGenerationCanvasStore } from '../../../store/generationCanvasStore'
import { DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from '../model/directorNodeMeta'
import { DIRECTOR_PREVIEW_FPS, DIRECTOR_PREVIEW_MAX_SECONDS, readDirectorPreview, type DirectorPreviewMeta } from '../model/directorPreviewState'
import { normalizeDirectorProject } from '../model/directorProject'
import { summarizeDirectorShots } from '../model/directorShotSummaries'
import type { DirectorProject } from '../model/directorTypes'
import { programCameraIdAt } from '../model/programCamera'
import { sceneContentEndSeconds } from '../model/timeGrid'
import { computeAttachCameraMove } from './attachCameraMoveToTarget'
import { frameTimes } from './cameraMoveSchedule'

const MAX_PREVIEW_FRAMES = DIRECTOR_PREVIEW_FPS * DIRECTOR_PREVIEW_MAX_SECONDS

export type PreviewCapturePlan = Readonly<{
  project: DirectorProject
  fps: number
  times: number[]
  cameraIdAt: (time: number) => string | null
  revision: string
}>

/** 整段预演：0 → 内容末，24fps，最后一帧落在末尾前一帧（镜头片段在末尾是开区间，取到末尾会是黑帧）。 */
export function previewCapturePlan(node: Pick<GenerationCanvasNode, 'meta'>): PreviewCapturePlan | null {
  const preview = readDirectorPreview(node)
  if (!preview || preview.status !== 'rendering') return null
  const project = normalizeDirectorProject(node.meta?.[DIRECTOR_PROJECT_META_KEY])
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  if (!scene) return null
  const fps = DIRECTOR_PREVIEW_FPS
  const duration = Math.max(1 / fps, sceneContentEndSeconds(scene))
  const frameCount = Math.min(MAX_PREVIEW_FRAMES, Math.max(2, Math.round(duration * fps)))
  const times = frameTimes(0, Math.max(0, duration - 1 / fps), frameCount)
  return {
    project, fps, times, revision: preview.revision,
    cameraIdAt: (time) => programCameraIdAt(time, scene.cameras, scene.timelineTrackOrder),
  }
}

/** 单次尝试的看门狗：随帧数放宽（每帧 seek + 两帧沉降 + 角色 GLB 首次落地），短片沿用 30 秒。 */
export function previewAttemptTimeoutMs(frameCount: number): number {
  return Math.max(30_000, 20_000 + frameCount * 200)
}

function sameRevision(nodeId: string, revision: string): GenerationCanvasNode | null {
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
  const preview = readDirectorPreview(node)
  return node && preview?.status === 'rendering' && preview.revision === revision ? node : null
}

function inProposal<T>(preview: DirectorPreviewMeta, fn: () => T): T {
  return preview.proposalId
    ? withCanvasGestureContext({ source: 'runtime', txnId: `txn_${preview.proposalId}`, proposalId: preview.proposalId, suppressUndoBarriers: true }, fn)
    : fn()
}

/**
 * 预演 mp4 已落盘 → 挂到它的视频节点（唯一挂接核心）→ 导演节点预演写回 ready（含挂法：参考视频 / 只写进提示词）。
 * 返回挂接给出的提示（模型不接参考视频时那句「精度会低」由调用方 toast）。修订已变 = 丢弃，返回 null。
 */
export function applyPreviewCaptured(nodeId: string, revision: string, videoUrl: string, assetId: string | undefined, output: Readonly<{ id: string; name: string; width: number; height: number; duration: number; createdAt: number }>):
  { toast?: { message: string; level: 'warning' } } | null {
  const node = sameRevision(nodeId, revision)
  if (!node) return null
  const preview = readDirectorPreview(node)!
  const store = useGenerationCanvasStore.getState()
  const target = preview.targetNodeId ? store.nodes.find((candidate) => candidate.id === preview.targetNodeId) : undefined
  const project = normalizeDirectorProject(node.meta?.[DIRECTOR_PROJECT_META_KEY])
  const cuts = summarizeDirectorShots(project).map((cut) => ({ start: cut.start, end: cut.end, shotSize: cut.shotSize, move: cut.move }))
  const outcome = computeAttachCameraMove(target, videoUrl, { kind: 'preview', cuts, notes: preview.notes ?? [] })
  return inProposal(preview, () => {
    if (outcome.kind === 'patch' && preview.targetNodeId) useGenerationCanvasStore.getState().updateNode(preview.targetNodeId, outcome.patch)
    const fresh = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === nodeId)
    const freshProject = normalizeDirectorProject(fresh?.meta?.[DIRECTOR_PROJECT_META_KEY] ?? project)
    const next: DirectorPreviewMeta = {
      ...preview,
      status: 'ready',
      videoUrl,
      ...(assetId ? { assetId } : {}),
      durationSeconds: output.duration,
      ...(outcome.kind === 'patch' ? { attach: outcome.mode } : {}),
      updatedAt: Date.now(),
    }
    useGenerationCanvasStore.getState().updateNode(nodeId, {
      meta: {
        ...(fresh?.meta ?? node.meta ?? {}),
        [DIRECTOR_PREVIEW_META_KEY]: next,
        [DIRECTOR_PROJECT_META_KEY]: { ...freshProject, outputs: { ...freshProject.outputs, videos: [{ ...output, assetUrl: videoUrl }, ...freshProject.outputs.videos] } },
      },
    })
    return outcome.toast ? { toast: outcome.toast } : {}
  })
}

/** 重试用尽：预演判失败（节点卡上「预演失败 · 重试」），这一镜的生成继续被挡着，不放行无参考的生成。 */
export function markPreviewFailed(nodeId: string, revision: string): void {
  const node = sameRevision(nodeId, revision)
  if (!node) return
  const preview = readDirectorPreview(node)!
  inProposal(preview, () => useGenerationCanvasStore.getState().updateNode(nodeId, {
    meta: { ...(node.meta ?? {}), [DIRECTOR_PREVIEW_META_KEY]: { ...preview, status: 'failed', reason: 'capture_failed', updatedAt: Date.now() } },
  }))
}
