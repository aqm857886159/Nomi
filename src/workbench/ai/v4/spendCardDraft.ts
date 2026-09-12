// 付费确认卡上「用户改了什么」的**纯账本**（无 React、无 store、可裸测）。
//
// ── 它在解决哪个真实摩擦 ──
//
// 在 2026-09-11 之前，卡体直接绑着画布上那个草稿节点：卡上改一个字，画布节点当场就变了。
// 两件坏事跟着来：
//   ① 用户还没答应花钱，画布已经被改了——「我只是看看」变成了「我已经动过了」；
//   ② 落地链在候选每前进一版时都会按候选重画那个节点，于是「节点写候选」和「候选写节点」
//      两个方向同时开着，每改一个参数就是一场拉锯（实测：计划连推三版、最后弹回参数默认值）。
//      那场拉锯正是上一轮「改参数不能实时重算价格」的根因（docs/plan/2026-09-11 已知缺口 1）。
//
// 这个文件把编辑意图从画布上**摘下来**，放进一份自己的账本：
//   · 改动只落在这里，画布节点在按下「生成」之前一个字都不动；
//   · 因为不再回写节点，落地链那一侧永远是单向的（候选 → 节点），拉锯没有了；
//   · 价格随时可以按这份账本**本地**重算（`spendCardEstimate.ts`），不必等一个来回。
//
// ── 两层覆写：全部 / 逐镜 ──
//
// 「全部」模式下改的是**这一批的公共值**，「逐镜」模式下改的是**这一镜自己的值**。
// 逐镜层压在全部层上面（2026-09-11 用户拍板：逐镜覆写优先于全部），两层各自留着，
// 来回切模式谁也不会被抹掉。
//
// 卡体显示的是**正在编辑的那一层**：「全部」模式显示 `镜 ⊕ 全部层`，「逐镜」模式显示
// `镜 ⊕ 全部层 ⊕ 这一镜层`。不这么分会出一个很坏的手感——在「全部」模式下改一个
// 已经有逐镜覆写的字段，按优先级它改了也看不见，用户读到的是「改了又弹回去」。
// 价格与最终落盘一律按**优先级后的有效值**算，显示层的分层只影响「你此刻在编哪一层」。
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'

/** 候选里用户能在卡上改的那几件（就是「供应商会收到的那份载荷」的可编辑面）。 */
export type SpendCandidatePatch = Readonly<{
  prompt?: string
  modelId?: string
  providerId?: string
  modeId?: string
  parameters?: Readonly<Record<string, unknown>>
}>

/** 两层覆写。`all` = 在「全部」模式下改出来的公共层；`perShot` = 在「逐镜」模式下改出来的那一镜层。 */
export type SpendDraft = Readonly<{
  all: SpendCandidatePatch
  perShot: Readonly<Record<string, SpendCandidatePatch>>
}>

export const EMPTY_SPEND_DRAFT: SpendDraft = Object.freeze({ all: Object.freeze({}), perShot: Object.freeze({}) })

export type SpendScope = 'each' | 'all'

/** 这一镜的有效候选（参数逐键浅合并；后者赢）。 */
export function mergeCandidatePatch(
  base: SpendCandidatePatch,
  overlay: SpendCandidatePatch,
): SpendCandidatePatch {
  const merged: Record<string, unknown> = { ...base, ...overlay }
  if (base.parameters || overlay.parameters) {
    merged.parameters = { ...(base.parameters ?? {}), ...(overlay.parameters ?? {}) }
  }
  return merged as SpendCandidatePatch
}

/**
 * 这一镜最终会被封印的那一份（逐镜层压全部层）。`view` 给的是**卡体此刻该显示哪一层**：
 * `'all'` 只叠公共层，`'each'`（默认）叠到逐镜层。
 */
export function effectivePatchForShot(
  draft: SpendDraft,
  shotId: string,
  view: SpendScope = 'each',
): SpendCandidatePatch {
  if (view === 'all') return draft.all
  return mergeCandidatePatch(draft.all, draft.perShot[shotId] ?? {})
}

/** 有效候选 = 宿主投影的那一镜 ⊕ 覆写。只回算价与落盘认识的那几个字段。 */
export function effectiveCandidate(
  shot: PendingSpendShot,
  patch: SpendCandidatePatch,
): Readonly<{ providerId: string; modelId: string; parameters: Record<string, unknown> }> {
  return Object.freeze({
    providerId: patch.providerId ?? shot.providerId,
    modelId: patch.modelId ?? shot.modelId,
    parameters: { ...shot.parameters, ...(patch.parameters ?? {}) },
  })
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function archetypeOf(meta: Record<string, unknown>): Record<string, unknown> {
  return meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
    ? (meta.archetype as Record<string, unknown>)
    : {}
}

/**
 * 覆写 → 节点（卡体绑的那份草稿节点）。**不写 store**：这个节点对象只活在卡里。
 *
 * 字段对照就是候选与节点 meta 之间那张唯一的映射表，与 {@link candidatePatchFromNode} 互为逆向；
 * 两个方向写在同一个文件里，才不会有一天一边加了字段另一边忘了（那正是「双账本」的长法）。
 */
export function applyPatchToNode(node: GenerationCanvasNode, patch: SpendCandidatePatch): GenerationCanvasNode {
  const meta = { ...((node.meta ?? {}) as Record<string, unknown>) }
  if (patch.modelId) meta.modelKey = patch.modelId
  if (patch.providerId) meta.modelVendor = patch.providerId
  if (patch.modeId) meta.archetype = { ...archetypeOf(meta), modeId: patch.modeId }
  for (const [key, value] of Object.entries(patch.parameters ?? {})) meta[key] = value
  return {
    ...node,
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    meta,
  }
}

/**
 * 节点现在的样子 → 候选补丁。**只送候选已经认识的那些键**：
 * 参数面到底有哪些键是模型档案说了算的（`archetypeMeta`），在这里再判一次就是第二份词表。
 * 候选自己带的键 + 模型身份 + 提示词，正好是「供应商会收到的那份载荷」里用户能在卡上改的全部。
 */
export function candidatePatchFromNode(
  node: GenerationCanvasNode,
  shot: PendingSpendShot,
): SpendCandidatePatch | undefined {
  const meta = (node.meta ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const prompt = typeof node.prompt === 'string' ? node.prompt : ''
  if (prompt !== shot.prompt) patch.prompt = prompt
  const modelId = text(meta.modelKey)
  if (modelId && modelId !== shot.modelId) patch.modelId = modelId
  const providerId = text(meta.modelVendor) || text(meta.vendor)
  if (providerId && providerId !== shot.providerId) patch.providerId = providerId
  const modeId = text(archetypeOf(meta).modeId)
  if (modeId && modeId !== (shot.modeId ?? '')) patch.modeId = modeId
  const parameters: Record<string, unknown> = {}
  let parametersChanged = false
  for (const key of Object.keys(shot.parameters)) {
    const next = meta[key]
    parameters[key] = next === undefined ? shot.parameters[key] : next
    if (next !== undefined && next !== shot.parameters[key]) parametersChanged = true
  }
  if (parametersChanged) patch.parameters = parameters
  return Object.keys(patch).length > 0 ? (patch as SpendCandidatePatch) : undefined
}

/**
 * 用户在卡上动了一下之后的新账本。
 *
 * `scope` 决定这一下落到哪一层：「全部」落公共层、「逐镜」落这一镜层——**另一层原样留着**
 * （切模式不丢覆写）。落进去的是「这个节点相对于宿主那一镜的差」，所以改回原值等于把
 * 那个字段从这一层里去掉，不会留下一个和原值相等的空覆写。
 */
export function draftAfterNodeEdit(
  draft: SpendDraft,
  shot: PendingSpendShot,
  node: GenerationCanvasNode,
  scope: SpendScope,
): SpendDraft {
  const patch = candidatePatchFromNode(node, shot) ?? {}
  if (scope === 'all') return { all: patch, perShot: draft.perShot }
  return { all: draft.all, perShot: { ...draft.perShot, [shot.shotId]: patch } }
}

/** 这一批到底有没有被改过（没有 → 确认那一刻不必先发 `generation.revise`）。 */
export function draftIsEmpty(draft: SpendDraft): boolean {
  if (Object.keys(draft.all).length > 0) return false
  return Object.values(draft.perShot).every((patch) => Object.keys(patch).length === 0)
}

/**
 * 确认那一刻要发给主进程的改稿清单：每一镜一条（有改动的才发）。
 *
 * 这就是**回写画布草稿节点**的唯一时机——主进程落完补丁会把计划投影回画布
 * （`notifyPlanChanged` → 落地链），节点跟着变。卡这边从头到尾没碰过画布，
 * 所以「候选 → 节点」始终是单向的。
 */
export function revisionsForConfirm(
  shots: readonly PendingSpendShot[],
  draft: SpendDraft,
  targetShotIds?: readonly string[],
): readonly Readonly<{ shotId: string; patch: SpendCandidatePatch }>[] {
  const wanted = targetShotIds ? new Set(targetShotIds) : undefined
  return shots
    .filter((shot) => !wanted || wanted.has(shot.shotId))
    .map((shot) => ({ shotId: shot.shotId, patch: effectivePatchForShot(draft, shot.shotId) }))
    .filter((entry) => Object.keys(entry.patch).length > 0)
}
