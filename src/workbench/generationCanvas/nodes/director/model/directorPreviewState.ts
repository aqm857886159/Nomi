/**
 * [INPUT]: 依赖 ./directorNodeMeta 的 DIRECTOR_NODE_KIND / DIRECTOR_PREVIEW_META_KEY / DIRECTOR_PLAN_META_KEY、../../../model/generationCanvasTypes
 * [OUTPUT]: 对外提供 DirectorPreviewMeta、DirectorPlanMeta、readDirectorPreview、readDirectorPlanMeta、directorPreviewSpendBlock、
 *           directorPreviewSourceFingerprint / directorPreviewIsStale（过期判据，花钱闸与「出成片」共用）/ directorProduceState、
 *           directorPreviewSpendBlockMessageKey（挡住原因 → 文案的唯一映射，节点生成钮与 runner 共用）、
 *           DIRECTOR_PREVIEW_MAX_SECONDS / exceedsDirectorPreviewSeconds / directorProjectSeconds / directorProjectTooLong（超长判据，按当前工程，Agent 写计划、重渲写口、出成片、花钱闸共用）、
 *           DIRECTOR_PREVIEW_FPS、declaredShotDurationSeconds、DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS
 * [POS]: 3D-BOX 预演状态的**唯一判据**（方案 §8 花钱闸）：「这一镜挂着的参考预演还没好（渲染中 / 失败）或已过期（挂上之后导演工程又被改过）就不许花钱」。
 *        挡住原因的词表住 electron/shared/director/directorPreviewStatus.ts（跨进程合同，主进程准入同一份）。
 *        判据只住这里；消费者是全部付费提交的唯一咽喉 `canRunGenerationNode`（生成钮 / runGenerationNode / 生成索引）
 *        与 `generate` 的出卡前检查（拿原因给 Agent）。纯函数、零 React / three，runner 可直接 import。
 *        状态写在**导演节点**上（targetNodeId 指向它要挂的视频节点），不写到视频节点：撤销导演节点，闸自然解除。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorPreviewSpendBlockReason, DirectorPreviewStatus } from '../../../../../../electron/shared/director/directorPreviewStatus'
import { stableProjectAgentJson } from '../../../../../../electron/shared/legacyAgentJson'
import { synchronousSha256 } from '../../../../../../electron/shared/synchronousSha256'
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
import { productionMetaOf } from '../../../model/productionMeta'
import { previewAttachIsCurrent } from '../agent/attachCameraMoveToTarget'
import { paramSeconds } from '../../../../../../electron/shared/videoCapabilities/paramValue'
import { isDirectorPreviewDismissed } from '../agent/directorPreviewReferenceLifecycle'
import { DIRECTOR_NODE_KIND, DIRECTOR_PLAN_META_KEY, DIRECTOR_PREVIEW_META_KEY, DIRECTOR_PROJECT_META_KEY } from './directorNodeMeta'
import { normalizeDirectorProject } from './directorProject'
import { sceneContentEndSeconds } from './timeGrid'
import type { DirectorProject } from './directorTypes'

/** 预演帧率：Seedance 参考视频要求 ≥ 23.8fps（与运镜小片同一个值）。 */
export const DIRECTOR_PREVIEW_FPS = 24
/** 预演时长上限 = 离屏录制 240 帧 / 24fps。超过直接判失败并说明，不分段（分段与提上限待真机测内存）。 */
export const DIRECTOR_PREVIEW_MAX_SECONDS = 10

/** 这么长的内容能不能做成一段预演：超了不渲染、不出片、不花钱。Agent 写计划、重渲写口、「出成片」、花钱闸都问这一句。 */
export function exceedsDirectorPreviewSeconds(seconds: number): boolean {
  return seconds > DIRECTOR_PREVIEW_MAX_SECONDS + 1e-6
}

/**
 * 导演工程此刻有多长（当前场景内容末尾）。按**当前工程**算，不看预演上记过的结论：精修里手动拉长 / 缩短都立刻算数。
 * 工程对象不可变（每次写都换新引用）：同一个对象只算一次。
 */
export function directorProjectSeconds(project: unknown): number {
  const cached = project && typeof project === 'object' ? PROJECT_SECONDS.get(project) : undefined
  if (cached !== undefined) return cached
  const normalized = normalizeDirectorProject(JSON.parse(JSON.stringify(project ?? null)))
  const scene = normalized.scenes.find((item) => item.id === normalized.activeSceneId) ?? normalized.scenes[0]
  const seconds = scene ? sceneContentEndSeconds(scene) : 0
  if (project && typeof project === 'object') PROJECT_SECONDS.set(project, seconds)
  return seconds
}
const PROJECT_SECONDS = new WeakMap<object, number>()

export function directorProjectTooLong(project: unknown): boolean {
  return exceedsDirectorPreviewSeconds(directorProjectSeconds(project))
}

/** 预演时长与镜头声明时长允许差多少（秒）：小于 24fps 的一帧多一点，吸收计划窗口的小数尾巴。 */
export const DIRECTOR_PREVIEW_DURATION_TOLERANCE_SECONDS = 0.05

/**
 * 这个视频镜头声明要多长（秒）：读节点上的时长参数——与主进程 `shotDurationSeconds` 同一个取值函数（`paramSeconds`，`duration` / `durationSeconds`），
 * 草稿候选落地时参数原样铺到节点 meta（buildPlannedNodeMeta）。没声明 = undefined（不拦）。不读 `videoDuration`：那是文件实测时长。
 */
export function declaredShotDurationSeconds(node: Pick<GenerationCanvasNode, 'meta'> | undefined): number | undefined {
  const seconds = paramSeconds(node?.meta)
  return seconds !== undefined && seconds > 0 ? seconds : undefined
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
  /** 这份预演是对哪份工程渲染的（`directorPreviewSourceFingerprint`）：之后工程被手改过 = 预演过期（`directorPreviewIsStale`）。旧预演没有这一项：新鲜度未知，按过期处理（付费前重渲一次，本机免费）。 */
  sourceFingerprint?: string
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

export type DirectorPreviewSpendBlock = Readonly<{ reason: DirectorPreviewSpendBlockReason; directorNodeId: string; failure?: DirectorPreviewFailure }>

/**
 * 这个视频节点此刻能不能花钱：以**最近一次**指向它的 3D-BOX 预演为准（新预演顶替旧的）。
 * 渲染中 / 失败 / 过期 → 挡；已挂好且最新 / 没有预演 → 放行。
 */
function latestDirectorPreviewFor(
  nodeId: string,
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[],
): { node: Pick<GenerationCanvasNode, 'id' | 'meta'>; preview: DirectorPreviewMeta } | null {
  let latest: { node: Pick<GenerationCanvasNode, 'id' | 'meta'>; preview: DirectorPreviewMeta } | null = null
  for (const node of nodes) {
    if (node.kind !== DIRECTOR_NODE_KIND) continue
    const preview = readDirectorPreview(node)
    if (!preview || preview.targetNodeId !== nodeId) continue
    if (!latest || preview.updatedAt >= latest.preview.updatedAt) latest = { node, preview }
  }
  return latest
}

/** 预演记录坏了（状态非法 / 缺修订号）但写明指向这个镜头：新鲜度未知，按过期处理（与无指纹的旧预演同一口径）。 */
function corruptedPreviewBlock(nodeId: string, nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[]): DirectorPreviewSpendBlock | null {
  for (const node of nodes) {
    if (node.kind !== DIRECTOR_NODE_KIND) continue
    const raw = record(node.meta?.[DIRECTOR_PREVIEW_META_KEY])
    if (raw && !readDirectorPreview(node) && raw.targetNodeId === nodeId) return { reason: 'stale', directorNodeId: node.id }
  }
  return null
}

export function directorPreviewSpendBlock(
  nodeId: string,
  nodes: readonly Pick<GenerationCanvasNode, 'id' | 'kind' | 'meta'>[],
): DirectorPreviewSpendBlock | null {
  const latest = latestDirectorPreviewFor(nodeId, nodes)
  if (!latest) return corruptedPreviewBlock(nodeId, nodes)
  if (latest.preview.status === 'ready') {
    const project = latest.node.meta?.[DIRECTOR_PROJECT_META_KEY]
    // 工程超长：这份预演是被压进 10 秒里的（旧版本会这样出），花钱就是按一段走样的预演出片
    if (project && typeof project === 'object' && directorProjectTooLong(project)) return { reason: 'failed', directorNodeId: latest.node.id, failure: 'too_long' }
    // 挂着的是最新预演才放行：挂上之后导演工程又被改过（精修里手调）= 过期，花钱就是按旧预演出片
    if (directorPreviewIsStale(latest.preview, project)) return { reason: 'stale', directorNodeId: latest.node.id }
    // 挂接是当前的才放行：换了模型 / 方式之后预演没跟着重挂（窗口关着、或没点出成片）= 付费请求会少带这份预演，挡到再点一次「出成片」
    const target = nodes.find((node) => node.id === nodeId)
    if (target && latest.preview.videoUrl) {
      if (isDirectorPreviewDismissed(target, latest.preview.videoUrl)) return null
      if (!previewAttachIsCurrent(target as GenerationCanvasNode, latest.preview.videoUrl, { kind: 'preview', cuts: [], notes: latest.preview.notes ?? [] })) {
        return { reason: 'not_attached', directorNodeId: latest.node.id }
      }
    }
    return null
  }
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
  reason: DirectorPreviewSpendBlockReason | 'not_referenced' | 'duration_mismatch'
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
    const target = nodes.find((candidate) => candidate.id === node.id)
    if (referenced && target && ready?.status === 'ready' && !isDirectorPreviewDismissed(target, ready.videoUrl)
      && ready.attach === 'video_ref' && ready.assetId && !referenced.includes(ready.assetId)) {
      blocks.push({ nodeId: node.id, ...(shotId ? { shotId } : {}), reason: 'not_referenced', previewAssetId: ready.assetId })
    }
  }
  return blocks
}

/**
 * 预演是对哪份工程渲染的：只看场景内容，不看产出列表（预演写回会把自己加进产出）。两边都先过 normalizeDirectorProject，
 * 编辑器 store 里的工程与节点 meta 往返不产生假差异。
 */
export function directorPreviewSourceFingerprint(project: unknown): string {
  // 工程对象是不可变的（每次写都换新引用）：同一个对象只算一次，花钱闸被订阅时不会每次画布变化都重哈希整份工程
  const cached = project && typeof project === 'object' ? FINGERPRINTS.get(project) : undefined
  if (cached) return cached
  const normalized = normalizeDirectorProject(JSON.parse(JSON.stringify(project ?? null)))
  const fingerprint = synchronousSha256(stableProjectAgentJson(JSON.parse(JSON.stringify({ activeSceneId: normalized.activeSceneId, scenes: normalized.scenes })))).slice(0, 32)
  if (project && typeof project === 'object') FINGERPRINTS.set(project, fingerprint)
  return fingerprint
}
const FINGERPRINTS = new WeakMap<object, string>()

/**
 * 预演过期：预演记了渲染源指纹，且和导演工程此刻的指纹不一样（挂上之后又被改过）。花钱闸与「出成片」共用这一个判据。
 * **没有指纹的旧预演 = 新鲜度未知 = 过期**（2026-10-21 协调定：拿可能过期的参考去花钱，比多做一次本机免费重渲更伤用户）：
 * 付费前要先重渲一次，重渲出的新预演必带指纹（applyPreviewCaptured 的指纹是必填参数）。
 * 只有节点上没有工程对象时不判（没有可比对的工程，导演节点必有工程，这是坏数据的兜底而不是放行口）。
 */
export function directorPreviewIsStale(preview: DirectorPreviewMeta, project: unknown): boolean {
  if (preview.status !== 'ready' || !project || typeof project !== 'object') return false
  if (!preview.sourceFingerprint) return true
  return directorPreviewSourceFingerprint(project) !== preview.sourceFingerprint
}

/** 花钱闸挡住原因 → 给用户的一句话（i18n 键）。节点生成钮的悬停说明与 runner 的报错共用，不各写一份三元式。 */
export type DirectorPreviewSpendBlockMessageKey = 'director.agent.spendBlockedRendering' | 'director.agent.spendBlockedFailed' | 'director.agent.spendBlockedStale' | 'director.agent.spendBlockedNotAttached' | 'director.agent.spendBlockedTooLong'

export function directorPreviewSpendBlockMessageKey(block: Pick<DirectorPreviewSpendBlock, 'reason' | 'failure'>): DirectorPreviewSpendBlockMessageKey {
  if (block.reason === 'rendering') return 'director.agent.spendBlockedRendering'
  if (block.reason === 'stale') return 'director.agent.spendBlockedStale'
  if (block.reason === 'not_attached') return 'director.agent.spendBlockedNotAttached'
  return block.failure === 'too_long' ? 'director.agent.spendBlockedTooLong' : 'director.agent.spendBlockedFailed'
}

/**
 * 导演视图「出成片」此刻是什么状态（设计卡 docs/plan/2026-10-16-director-3dbox-produce-design-card.md ★4）。
 * 与花钱闸同一份判据（`readDirectorPreview`），外壳只渲染、不另判：
 *   empty        —— 没有可播放的镜头；
 *   needs_render —— 没出过预演，或预演过期（`directorPreviewIsStale`，与花钱闸同一个判据）：点了先渲染；
 *   rendering / failed —— 预演自己的生命周期（超长的失败不给重试）；
 *   ready        —— 预演是最新的：点了就挂到视频镜头上、回画布选中它。
 */
export type DirectorProduceState =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'needs_render' }>
  | Readonly<{ kind: 'rendering' }>
  | Readonly<{ kind: 'failed'; tooLong: boolean }>
  | Readonly<{ kind: 'ready' }>

export function directorProduceState(preview: DirectorPreviewMeta | null, project: DirectorProject, playableShots: number): DirectorProduceState {
  if (playableShots === 0) return { kind: 'empty' }
  // 超长按**当前工程**判：精修里拉长了，哪怕节点上还挂着一份好的预演，也不出片（预演会被压进 10 秒）
  if (directorProjectTooLong(project)) return { kind: 'failed', tooLong: true }
  if (!preview) return { kind: 'needs_render' }
  if (preview.status === 'rendering') return { kind: 'rendering' }
  // 记过「超长」但已经改短了：重新渲染就行
  if (preview.status === 'failed') return preview.reason === 'too_long' ? { kind: 'needs_render' } : { kind: 'failed', tooLong: false }
  if (!preview.videoUrl || directorPreviewIsStale(preview, project)) return { kind: 'needs_render' }
  return { kind: 'ready' }
}

/**
 * 主按钮显示什么（不算工程指纹：拖动时每一帧都在变，按钮不该每帧哈希整份工程）。超长按当前工程判（与 `directorProduceState` 同一句）。「过期要先重渲」在点下去那一刻由
 * `directorProduceState` 判，按钮上与「可出片」同一个样子。
 */
export type DirectorProduceButtonState = 'empty' | 'rendering' | 'retry' | 'too_long' | 'idle'

export function directorProduceButtonState(preview: DirectorPreviewMeta | null, project: DirectorProject, playableShots: number): DirectorProduceButtonState {
  if (playableShots === 0) return 'empty'
  if (directorProjectTooLong(project)) return 'too_long'
  if (preview?.status === 'rendering') return 'rendering'
  if (preview?.status === 'failed' && preview.reason !== 'too_long') return 'retry'
  return 'idle'
}
