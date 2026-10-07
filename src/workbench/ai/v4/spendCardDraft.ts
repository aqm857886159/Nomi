import { z } from 'zod'
import { spendReferenceInputSchema } from '../../../../electron/shared/contracts/pendingSpendConfirm'
import { pendingReferenceInputs, placeSpendReferences, referenceInputsFromNode, type SpendCanvasGraph } from './spendCardReferences'
import { placeReferenceInputs } from '../../generationCanvas/model/referenceInputSlots'
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
import { resolveArchetypeForModel } from '../../../../electron/shared/modelArchetypes'
import { generationJsonValueSchema, type GenerationJsonValue } from '../../../../electron/shared/agentCapabilities/generationPlanSchemas'
import { resolveRenderedControls } from '../../generationCanvas/nodes/nodeModelArchetype'
import type { ModelOption } from '../../../config/models'
import { isGenerationNodeKind } from '../../generationCanvas/model/generationNodeKinds'
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'

/** 候选里用户能在卡上改的那几件（就是「供应商会收到的那份载荷」的可编辑面）。 */
const spendCandidatePatchSchema = z.object({
  prompt: z.string().optional(),
  modelId: z.string().optional(),
  providerId: z.string().optional(),
  modeId: z.string().optional(),
  // 参数值只许是宿主认的 JSON 值（与 `generationPlanInputSchema` 同一个 owner）：卡的改稿经 IPC 原样过去，
  // 写成 `unknown` 就能混进 `undefined`，宿主只在确认那一刻才拒（2026-09-26 真付费 T5，卡点了没反应）。
  parameters: z.record(generationJsonValueSchema).readonly().optional(),
  referenceInputs: z.array(spendReferenceInputSchema).readonly().optional(),
}).strict().readonly()
export type SpendCandidatePatch = z.infer<typeof spendCandidatePatchSchema>

/**
 * 每一镜各自的改动。2026-09-30 起只有这一层：卡上每一页的主按钮只生成那一镜（付费卡逐镜），
 * 「逐镜 / 全部」范围切换和它的「全部」那一层一起删了（P1）。Parameter values remain model-owned.
 */
const spendDraftSchema = z.object({
  perShot: z.record(spendCandidatePatchSchema).readonly(),
}).strict().readonly()
export type SpendDraft = z.infer<typeof spendDraftSchema>

/** 上一版存下的账本多一层「全部」。只在读盘那一处认它，读进来就压进每一镜——他打过的字一个不丢。 */
const legacySpendDraftSchema = z.object({
  all: spendCandidatePatchSchema,
  perShot: z.record(spendCandidatePatchSchema).readonly(),
}).strict()

export const EMPTY_SPEND_DRAFT: SpendDraft = Object.freeze({ perShot: Object.freeze({}) })

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

/** 这一镜最终会被封印的那一份：就是这一镜自己的改动。 */
export function effectivePatchForShot(draft: SpendDraft, shotId: string): SpendCandidatePatch {
  return draft.perShot[shotId] ?? {}
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
  const referencedNode = patch.referenceInputs ? placeReferenceInputs({ ...node, meta }, patch.referenceInputs) : { ...node, meta }
  return {
    ...referencedNode,
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    meta: referencedNode.meta,
  }
}

/**
 * 节点现在的样子 → 候选补丁。复用参数条的控件解析，保留原候选字段并收集新声明字段。
 *
 * `baseline` = 用户在卡上动手之前那张框（宿主那一镜 ⊕ 画布连线带来的参考，生成方式已按活边对齐，见
 * `placeSpendReferences`）。卡上改一下记进账本时传它：生成方式和参考图都相对它比，于是「拿掉画布连来的那张」
 * 「改回文生图」都记得住——相对宿主那一镜比的话，这两下和宿主那一份一样，记成「没改」，下一拍画布那一份又摆回来。
 * 点下去那一刻要发给宿主的那一份不传它：相对宿主那一镜比，画布连来的参考图和对齐后的生成方式照发。
 */
export function candidatePatchFromNode(
  node: GenerationCanvasNode,
  shot: PendingSpendShot,
  option?: ModelOption,
  baseline?: GenerationCanvasNode,
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
  const baselineModeId = baseline ? text(archetypeOf((baseline.meta ?? {}) as Record<string, unknown>).modeId) : (shot.modeId ?? '')
  if (modeId && modeId !== baselineModeId) patch.modeId = modeId
  const referenceInputs = referenceInputsFromNode(node, shot)
  const baselineInputs = baseline ? referenceInputsFromNode(baseline, shot) : pendingReferenceInputs(shot)
  const baselineReferences = referenceInputsFromNode(placeReferenceInputs(node, baselineInputs), shot)
  if (JSON.stringify(referenceInputs) !== JSON.stringify(baselineReferences)) patch.referenceInputs = referenceInputs
  const parameters: Record<string, GenerationJsonValue> = {}
  let parametersChanged = false
  const selected = option ?? { modelKey: text(meta.modelKey), vendor: text(meta.modelVendor), value: text(meta.modelKey), label: text(meta.modelKey), kind: node.kind }
  const controls = resolveRenderedControls(selected as ModelOption, meta, node.kind === 'image', node.kind === 'video')
  const keys = new Set([...Object.keys(shot.parameters), ...controls.map(control => control.binding === 'parameter' ? control.key : control.binding)])
  for (const key of keys) {
    const next = meta[key]
    // 参数条上有控件、节点和候选都没有值的键（如没填的 seed）= 这一镜不带它，不是「值为 undefined」。
    const value = generationJsonValueSchema.safeParse(next === undefined ? shot.parameters[key] : next)
    if (value.success) parameters[key] = value.data
    // 按值比，不按引用比：参考槽这类数组值，节点上那一份和候选里那一份永远不是同一个对象——按引用比会让
    // 一张没动过的卡在点「生成这张」时也去改一次候选（白推一版计划）。
    if (next !== undefined && JSON.stringify(next) !== JSON.stringify(shot.parameters[key])) parametersChanged = true
  }
  if (parametersChanged) patch.parameters = parameters
  return Object.keys(patch).length > 0 ? (patch as SpendCandidatePatch) : undefined
}

/**
 * 用户在卡上动了一下之后的新账本：这一下只落在这一页这一镜上，别的镜原样留着。
 * 相对 `baseline`（他动手之前卡上默认摆的那张框）算；不传就相对宿主那一镜。
 */
export function draftAfterNodeEdit(
  draft: SpendDraft,
  shot: PendingSpendShot,
  node: GenerationCanvasNode,
  option?: ModelOption,
  baseline?: GenerationCanvasNode,
): SpendDraft {
  return { perShot: { ...draft.perShot, [shot.shotId]: candidatePatchFromNode(node, shot, option, baseline) ?? {} } }
}

/** 这一批到底有没有被改过（没有 → 确认那一刻不必先发 `generation.revise`）。 */
export function draftIsEmpty(draft: SpendDraft): boolean {
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
    .map((shot) => {
      const patch = effectivePatchForShot(draft, shot.shotId)
      if (!patch.referenceInputs) return { shotId: shot.shotId, patch }
      // A shot may only claim a pinned reference identity it already had; any other
      // media it asks for travels by URL (the host resolves and re-pins it).
      const referenceInputs = patch.referenceInputs.map(input => {
        if (!('reference' in input) || !input.url || !input.reference.kind) return input
        const retained = shot.references?.some(reference => reference.assetId === input.reference.assetId
          && reference.contentHash === input.reference.contentHash && reference.version === input.reference.version
          && reference.kind === input.reference.kind && reference.role === input.reference.role)
        return retained ? input : { url: input.url, kind: input.reference.kind,
          ...(input.reference.role ? { role: input.reference.role } : {}) }
      })
      return { shotId: shot.shotId, patch: { ...patch, referenceInputs } }
    })
    .filter((entry) => Object.keys(entry.patch).length > 0)
}

/**
 * 卡体那张生成框（还没算卡上的改动）：宿主那一镜的候选 + 画布上连到它占位节点的参考图（`canvas`，第 4 条：
 * 画布上连着的参考图算数，卡上看得见、照发；生成方式按画布那条规则对齐，见 `placeSpendReferences`）。
 * 画布上那个占位节点只提供标题和位置。卡上拿掉其中一张只改卡，不动画布连线。
 *
 * 这张框的 id 是卡自己的（`spend:<shotId>`），**不是**占位节点的 id。用了占位节点的 id，卡体那件 composer
 * 就会把画布上连到占位节点的边当成这张框自己的边：卡上点 × 拿掉画布连来的参考图，走的是画布那条「断边」——
 * 用户还没点生成，画布上的连线就被删了（第 8 行）；还会按画布的边替卡改比例。画布连来的参考只经
 * `placeSpendReferences` 一处进卡，进的是卡自己的参考槽。
 */
export function projectSpendNode(shot: PendingSpendShot, placed?: GenerationCanvasNode, option?: ModelOption, canvas?: SpendCanvasGraph, kept?: ReadonlySet<string>): GenerationCanvasNode | undefined {
  const archetype = resolveArchetypeForModel({ modelKey: shot.modelId, vendorKey: shot.providerId, meta: option?.meta })
  // 卡体那张生成框的种类只读宿主给的那一格（第 9 条）：和卡标题、画布节点、派发同一个答案。
  // 以前这里读模型目录自己的种类，画布读另一套，卡就会标题说视频、卡体是图片模型，还改不动。
  const kind = shot.kind
  if (!isGenerationNodeKind(kind)) return undefined
  return placeSpendReferences({
    id: `spend:${shot.shotId}`,
    kind,
    title: placed?.title ?? '',
    position: placed?.position ?? { x: 0, y: 0 },
    prompt: shot.prompt,
    meta: {
      ...shot.parameters,
      modelKey: shot.modelId,
      modelVendor: shot.providerId,
      ...(option ? { modelLabel: option.label } : {}),
      // 候选上写着变体就一并带上：卡上这张框显示的变体与宿主派发的，问的是同一个 owner、同一组输入。
      ...(archetype ? { archetype: { id: archetype.id, modeId: shot.modeId ?? archetype.defaultModeId, ...(shot.variantId ? { variantId: shot.variantId } : {}) } } : {}),
    },
  }, pendingReferenceInputs(shot), canvas, shot.nodeId, kept)
}

/** 账本里这一镜记过参考清单 = 卡上还留着的那几张（画布连来、不在清单里的就是用户在卡上拿掉的）；没记过 = 都留着。 */
export function keptReferenceUrls(patch: SpendCandidatePatch): ReadonlySet<string> | undefined {
  return patch.referenceInputs
    ? new Set(patch.referenceInputs.map((input) => input.url).filter((url): url is string => Boolean(url)))
    : undefined
}

/**
 * 卡上**没提交**的那些改动住在哪一本账本里。身份 = **这一次 `generate`**（`operationId`），
 * 不是卡上那一刻的报价（2026-09-22 裁决 B，`docs/plan/2026-09-22-waiting-for-user-one-owner.md` §1）。
 *
 * ── 为什么 `quoteId` / `planVersion` / `candidateRevision` 不在键里 ──
 *
 * 它们是**报价指纹**：一次改参数、一次价格刷新、一次「收回出价再出价」都会换一份。而用户正在打的
 * 那句话不是「这一次报价」的东西，是「这一次生成」的东西。绑死报价身份于是有两个必然的丢字现场：
 *   · **T-QA-27**：「全部」范围改参数，部分镜封印失败——成功的那几镜把 `quoteId` 推进一版，
 *     翻页回到还没提交的那一镜，他刚打的提示词已经是另一本账本里的了；
 *   · **T-QA-30**：× 收回这一次出价（裁决 D：只收回出价，草稿和节点都留着），同一份草稿再 `generate`
 *     必然换一个 `quoteId`——卡回来了，他没提交的手改读不回来。
 * 两条同根，根就在这一行。报价指纹仍然有它的岗位：「你确认的是不是你看到的那个数」那条现时性校验
 * （`confirm` 里比对 `saved.quoteId`），它不参与**寻址**。
 *
 * ── 为什么键里没有镜头维度 ──
 *
 * 有，但不在键里：镜头分层是这本账本**自己的结构**（`perShot`）。
 * 把 `shotId` 提进键 = 一次生成有 N 本账本，翻页、去掉一镜、点完一镜都要在几本之间搬字；那正是 R33 说的第二本账本。
 * 一次生成一本，一个键派生，`node scripts/door-map.mjs spendDraftKey` 数得出来。
 */
export function spendDraftKey(pending: { projectId: string; runId: string; operationId: string }): string {
  return 'nomi:spend-draft:' + JSON.stringify([pending.projectId, pending.runId, pending.operationId])
}
export function readSpendDraft(key: string, shotIds: readonly string[] = []): SpendDraft {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return EMPTY_SPEND_DRAFT
    const value: unknown = JSON.parse(raw)
    // Validate without applying reference-schema transforms to saved user input.
    if (spendDraftSchema.safeParse(value).success) return value as SpendDraft
    if (!legacySpendDraftSchema.safeParse(value).success) return EMPTY_SPEND_DRAFT
    // 上一版的「全部」那一层：压进每一镜（这一镜自己的改动压在上面），读盘归一只在这一处。
    const legacy = value as { all: SpendCandidatePatch; perShot: Readonly<Record<string, SpendCandidatePatch>> }
    const perShot: Record<string, SpendCandidatePatch> = {}
    for (const shotId of new Set([...shotIds, ...Object.keys(legacy.perShot)])) {
      const patch = mergeCandidatePatch(legacy.all, legacy.perShot[shotId] ?? {})
      if (Object.keys(patch).length > 0) perShot[shotId] = patch
    }
    return { perShot }
  } catch { return EMPTY_SPEND_DRAFT }
}
/**
 * 写回这一笔的账本。**一次生成一本**（`operationId`），没有第二本。
 *
 * 2026-09-21 删掉的那本：× 之后按「输入身份」另存一份 `nomi:dismissed-spend-draft:` 的
 * 找回账本（含每镜全文 prompt、逐镜再写一条、无回收）。它存在的唯一理由是「× 会把东西弄丢」，
 * 而那件事已经在根上修掉了——× 收回的只是这一次出价，草稿、参数、画布占位节点一个都不动
 * （2026-09-22 用户拍板）。没有东西丢，就没有东西要找回。
 *
 * 配额写满时 **吞掉**：这只是「关掉面板再回来还在不在」的便利，炸了不许打断用户正在编辑的这张付费卡。
 */
export function retainSpendDraft(key: string, draft: SpendDraft): void {
  try {
    if (draftIsEmpty(draft)) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(draft))
  } catch { /* storage is a convenience here; the live draft lives in React state */ }
}

/** 这一次生成上次留下的未提交改动（换了 `operationId` 就是另一本，读不到就是空）。 */
export function restoreSpendDraft(pending: PendingSpendConfirm): SpendDraft {
  return readSpendDraft(spendDraftKey(pending), pending.shots.map((shot) => shot.shotId))
}

/**
 * Consume exactly the durable/approved set, retaining all other input in this ledger.
 *
 * 2026-09-22 起没有 `successor` 参数了：键锚的是 `operationId`，而「封印完再读一次正式报价」
 * 拿回来的那一份**必然是同一次生成**（`confirm` 里就是这么比的）。换一份报价 = 换一个键，
 * 那是上一版才有的事；留着一个恒等于自己的参数，就是给同一个地址留第二个说法。
 */
export function consumeSpendDraft(
  pending: PendingSpendConfirm, draft: SpendDraft, shotIds?: readonly string[],
): SpendDraft {
  const consumed = new Set(shotIds ?? pending.shots.map(shot => shot.shotId))
  const perShot: Record<string, SpendCandidatePatch> = {}
  for (const shot of pending.shots) {
    if (consumed.has(shot.shotId)) continue
    const patch = effectivePatchForShot(draft, shot.shotId)
    if (!Object.keys(patch).length) continue
    perShot[shot.shotId] = patch
  }
  const remaining = { perShot }
  // 空账本 = 把这一笔的键删掉（`retainSpendDraft` 自己做），所以不需要先清一次再写。
  retainSpendDraft(spendDraftKey(pending), remaining)
  return remaining
}
