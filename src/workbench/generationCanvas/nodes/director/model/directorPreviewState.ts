/**
 * [INPUT]: 依赖 ./directorNodeMeta 的 DIRECTOR_NODE_KIND / DIRECTOR_PREVIEW_META_KEY / DIRECTOR_PLAN_META_KEY、../../../model/generationCanvasTypes
 * [OUTPUT]: 对外提供 DirectorPreviewMeta、DirectorPlanMeta、readDirectorPreview、readDirectorPlanMeta、directorPreviewSpendBlock、
 *           DIRECTOR_PREVIEW_MAX_SECONDS、DIRECTOR_PREVIEW_FPS、declaredShotDurationSeconds、DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS
 * [POS]: 3D-BOX 预演状态的**唯一判据**（方案 §8 花钱闸）：「这一镜挂着的参考预演还没好（渲染中 / 失败）就不许花钱」。
 *        判据只住这里；消费者是全部付费提交的唯一咽喉 `canRunGenerationNode`（生成钮 / runGenerationNode / 生成索引）
 *        与 `generate` 的出卡前检查（拿原因给 Agent）。纯函数、零 React / three，runner 可直接 import。
 *        状态写在**导演节点**上（targetNodeId 指向它要挂的视频节点），不写到视频节点：撤销导演节点，闸自然解除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorPreviewStatus } from '../../../../../../electron/shared/director/directorPreviewStatus'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { productionMetaOf } from '../../../model/productionMeta'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY, DIRECTOR_PREVIEW_META_KEY } from './directorNodeMeta'

/** 预演帧率：Seedance 参考视频要求 ≥ 23.8fps（与运镜小片同一个值）。 */
export const DIRECTOR_PREVIEW_FPS = 24
/** 预演时长上限 = 离屏录制 240 帧 / 24fps。超过直接判失败并说明，不分段（分段与提上限待真机测内存）。 */
export const DIRECTOR_PREVIEW_MAX_SECONDS = 10

/** 预演时长与镜头声明时长允许差多少（秒）：小于 24fps 的一帧多一点，吸收计划窗口的小数尾巴。 */
export const DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS = 0.05

/**
 * 这个视频镜头声明要多长（秒）：读节点上的时长参数——与主进程 `shotDurationSeconds` 认同两个键（`duration` / `durationSeconds`），
 * 草稿候选落地时参数原样铺到节点 meta（buildPlannedNodeMeta）。没声明 = undefined（不拦）。不读 `videoDuration`：那是文件实测时长。
 */
export function declaredShotDurationSeconds(node: Pick<GenerationCanvasNode, 'meta'> | undefined): number | undefined {
  for (const key of ['duration', 'durationSeconds']) {
    const raw = node?.meta?.[key]
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
    if (Number.isFinite(value) && value > 0) return value
  }
  return undefined
}

export type DirectorPreviewFailure = 'too_long' | 'capture_failed'

export type DirectorPreviewMeta = Readonly<{
  status: Exclude<DirectorPreviewStatus, 'none'>
  /** 要挂的视频节点；独立预演没有。 */
  targetNodeId?: string
  /** 这次预演对应的计划修订号：迟到的旧渲染结果按它丢弃。 */
  revision: string
  /** 写下这次预演的那笔提议：Host 的后续写入沿用它的事务身份，撤销不把它当成「别人的后续改动」。 */
  proposalId?: string
  reason?: DirectorPreviewFailure
  /** ready：挂成参考视频，还是模型没有参考视频槽只写进提示词。 */
  attach?: 'video_ref' | 'prompt_only'
  videoUrl?: string
  /** ready 时预演 mp4 在项目素材库里的 id：Agent 改候选时把它放进 `draft_shots` 的 references。 */
  assetId?: string
  /** ready 时渲染出来的预演有多长（离屏帧数 / 帧率）：花钱闸拿它和这一镜候选的时长比。 */
  durationSeconds?: number
  /** 动作库没有的细节动作（编译器报 missing_asset 的那些）：挂接时写进视频节点提示词，交给视频模型演。 */
  notes?: readonly string[]
  updatedAt: number
}>

export type DirectorPlanMeta = Readonly<{ plan: unknown; revision: string }>

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function readDirectorPreview(node: Pick<GenerationCanvasNode, 'meta'> | undefined): DirectorPreviewMeta | null {
  const raw = record(node?.meta?.[DIRECTOR_PREVIEW_META_KEY])
  if (!raw) return null
  if (raw.status !== 'rendering' && raw.status !== 'ready' && raw.status !== 'failed') return null
  if (typeof raw.revision !== 'string' || !raw.revision) return null
  return raw as unknown as DirectorPreviewMeta
}

export function readDirectorPlanMeta(node: Pick<GenerationCanvasNode, 'meta'> | undefined): DirectorPlanMeta | null {
  const raw = record(node?.meta?.[DIRECTOR_PLAN_META_KEY])
  if (!raw || typeof raw.revision !== 'string' || !raw.revision || !record(raw.plan)) return null
  return { plan: raw.plan, revision: raw.revision }
}

export type DirectorPreviewSpendBlock = Readonly<{ reason: 'rendering' | 'failed'; directorNodeId: string; failure?: DirectorPreviewFailure }>

/**
 * 这个视频节点此刻能不能花钱：以**最近一次**指向它的 3D-BOX 预演为准（新预演顶替旧的）。
 * 渲染中 / 失败 → 挡；已挂好 / 没有预演 → 放行。
 */
function latestDirectorPreviewFor(
  nodeId: string,
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[],
): { node: Pick<GenerationCanvasNode, 'id'>; preview: DirectorPreviewMeta } | null {
  let latest: { node: Pick<GenerationCanvasNode, 'id'>; preview: DirectorPreviewMeta } | null = null
  for (const node of nodes) {
    if (node.kind !== DIRECTOR_NODE_KIND) continue
    const preview = readDirectorPreview(node)
    if (!preview || preview.targetNodeId !== nodeId) continue
    if (!latest || preview.updatedAt >= latest.preview.updatedAt) latest = { node, preview }
  }
  return latest
}

export function directorPreviewSpendBlock(
  nodeId: string,
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[],
): DirectorPreviewSpendBlock | null {
  const latest = latestDirectorPreviewFor(nodeId, nodes)
  if (!latest || latest.preview.status === 'ready') return null
  return {
    reason: latest.preview.status,
    directorNodeId: latest.node.id,
    ...(latest.preview.reason ? { failure: latest.preview.reason } : {}),
  }
}

export type DirectorPreviewOperationBlock = Readonly<{
  nodeId: string
  shotId?: string
  /**
   * rendering / failed：预演没好；not_referenced：预演好了，但这一镜真正要付费提交的候选没带它；
   * duration_mismatch：挂上去的预演和候选要生成的时长不一样长（预演挂好之后镜头时长又被改了）。
   */
  reason: 'rendering' | 'failed' | 'not_referenced' | 'duration_mismatch'
  failure?: DirectorPreviewFailure
  /** not_referenced 时：要放进候选 references 的那个素材 id。 */
  previewAssetId?: string
  previewSeconds?: number
  shotSeconds?: number
}>

function metaString(node: Pick<GenerationCanvasNode, 'meta'>, key: string): string | undefined {
  const value = node.meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * Agent 的 `generate` 出卡**之前**问的那一句：这次要生成的镜头里，哪些被 3D-BOX 预演挡着。
 * 镜头 ↔ 画布节点按落地章认（Agent 分镜 = 制作流程章 `productionMetaOf`：runId 就是 operationId × shotId；
 * 文稿分镜 `storyboardDesignId × shotId`）；没好的判据仍是同一个 `directorPreviewSpendBlock`。
 *
 * 多一条只读核对（2026-10-04 拍板 A）：`generate` 付费提交的是草稿**候选**，不是画布节点——预演挂在节点上，
 * 候选里不一定有。`candidateReferences`（主进程只读出的「每一镜候选带了哪些素材」）给了这一镜、它的预演已就绪
 * 且是以参考视频挂上的，而候选没带这份预演素材 → 挡（not_referenced），由 Agent 用 `draft_shots` 改候选。
 * 候选仍只有 `draft_shots` 一个写者；这里不写任何东西。以文字兜底挂上的（模型没有参考视频槽）不要求。
 */
export function directorPreviewBlocksForOperation(
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[],
  operationId: string,
  shotIds?: readonly string[],
  candidateReferences?: Readonly<Record<string, readonly string[]>>,
  candidateDurations?: Readonly<Record<string, number>>,
): DirectorPreviewOperationBlock[] {
  const scope = shotIds && shotIds.length ? new Set(shotIds) : null
  const blocks: DirectorPreviewOperationBlock[] = []
  for (const node of nodes) {
    // Agent 分镜的落地章是制作流程那一份（唯一 owner productionMetaOf）。不要读 materializationOperationId：
    // 那是落地事务的幂等章，值是 `canvas-landing:<operationId>`（2026-10-04 真机第 7 跑：按它认，一镜都认不出，
    // 花钱闸在 Agent 路上整条失效、带空参考的报价卡照样出了）。
    const production = productionMetaOf(node)
    const fromOperation = production?.runId === operationId
    if (!fromOperation && metaString(node, 'storyboardDesignId') !== operationId) continue
    const shotId = fromOperation ? production?.shotId : metaString(node, 'shotId')
    if (scope && shotId && !scope.has(shotId)) continue
    const block = directorPreviewSpendBlock(node.id, nodes)
    if (block) {
      blocks.push({ nodeId: node.id, ...(shotId ? { shotId } : {}), reason: block.reason, ...(block.failure ? { failure: block.failure } : {}) })
      continue
    }
    // 键 '' = 单镜草稿（没有镜头 id 的那一镜）；与主进程 readShotCandidateFacts 同一约定。
    const referenced = candidateReferences?.[shotId ?? '']
    const ready = latestDirectorPreviewFor(node.id, nodes)?.preview
    // 以镜头为准：参考视频随付费载荷走（video_ref）时，它必须和候选要生成的那一镜一样长；只写进提示词的不比
    const shotSeconds = candidateDurations?.[shotId ?? '']
    if (ready?.status === 'ready' && ready.attach === 'video_ref' && typeof ready.durationSeconds === 'number' && typeof shotSeconds === 'number'
      && Math.abs(ready.durationSeconds - shotSeconds) > DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS) {
      blocks.push({ nodeId: node.id, ...(shotId ? { shotId } : {}), reason: 'duration_mismatch', previewSeconds: ready.durationSeconds, shotSeconds })
      continue
    }
    if (referenced && ready?.status === 'ready' && ready.attach === 'video_ref' && ready.assetId && !referenced.includes(ready.assetId)) {
      blocks.push({ nodeId: node.id, ...(shotId ? { shotId } : {}), reason: 'not_referenced', previewAssetId: ready.assetId })
    }
  }
  return blocks
}
