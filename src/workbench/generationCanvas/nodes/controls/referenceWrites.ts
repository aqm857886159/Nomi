/**
 * 参考行的写入动作（从 NodeParameterControls 原样搬出，保持单一写路径）：
 * 数组槽删除、首尾帧等单槽的指派 / 换图、两帧对调。宿主壳只负责把它们接到界面上。
 * 加参考不在这里：生成框里所有「加一件」都走 addAssetUrlToNode（和拖入同一个入口，落格与方式按放进去之后现算）。
 */
import { useGenerationCanvasStore } from '../../store/generationCanvasStore'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../model/generationCanvasTypes'
import {
  edgeModeForGroup, parameterReferenceMetaPatch, readParameterReferenceSlots,
  resolveParameterReferenceAssignments, type ImageUrlSlot,
} from '../../model/parameterReferenceSlots'
import {
  archetypeArrayWrite, readArchetypeArrayForWrite,
} from './archetypeMeta'
import { decideArrayReferenceRemoval, resolveReferencePlacement } from '../../runner/referenceSlots'
import { firstFrameLeftEmpty, putInReferenceSlot, readReferenceList, removeFromReferenceList, swapInReferenceList, withReferenceList } from './referenceList'
import { removeMention } from '../../../assets/promptMentions'
import { moveArrayItem } from '../../../assets/assetTypes'
import { resultPreviewUrl as resultPreviewUrlOf } from './parameterControlModel'
import { nodeReferenceCapacity } from './nodeCrossFieldConstraints'
import { frameSwapKeepsSendable } from '../../../../../electron/shared/modelArchetypes/modeForInputs'
import type { useNodeWriteAccess } from '../nodeWriteAccess'
import { directorPreviewReferenceRemoval, markDirectorPreviewDismissed } from '../director/agent/directorPreviewReferenceLifecycle'
import { lastAttachedCameraMoveUrl, withoutPreviewLines, withoutVideoDirective } from '../director/agent/attachCameraMoveToTarget'

type Access = ReturnType<typeof useNodeWriteAccess>
type ArchMode = Parameters<typeof nodeReferenceCapacity>[0]

/** 参考删除是一个用户手势：画布写口先打一次快照，再用同一个 updateNode 落下全部字段，避免被前一笔导演台写入吞掉 Cmd+Z。面板草稿写口不碰画布历史。 */
function updateReferenceNode(ctx: ReferenceWriteContext, patch: Partial<GenerationCanvasNode>, barrier: 'new' | 'existing' = 'new'): void {
  const canvas = useGenerationCanvasStore.getState()
  // NodeParameterControls is read-only in the panel host, so a deletion can only reach this path from the canvas.
  // Keep the snapshot explicit: the director's preceding attach runs in a suppressed transaction and must not swallow Cmd+Z.
  if (barrier === 'new') canvas.captureHistory()
  ctx.updateNode(ctx.node.id, patch, { history: false })
}

export type ReferenceWriteContext = {
  node: GenerationCanvasNode
  archMode: ArchMode | null
  /** 惰性取：宿主壳里这份列表晚于写入句柄算出，但只在事件里才用到。 */
  getImageUrlSlots: () => ImageUrlSlot[]
  latestNode: Access['latestNode']
  updateNode: Access['updateNode']
  getLatestMeta: () => Record<string, unknown>
  updateMeta: (patch: Record<string, unknown>) => void
  storeConnectNodes: (source: string, target: string, mode: ReturnType<typeof edgeModeForGroup>, slotKey?: string) => void
  storeDisconnectEdge: (edgeId: string, options?: { scope: 'parameter' }) => void
  closeSlot: () => void
  feedback: (key: string, values: Record<string, unknown>) => void
}

/**
 * 「先放一边」的那张放回在用之后的 meta（纯函数）：按放回之后重新推导一次，真落进槽了才返回新 meta；放不下返回 null。
 * 首帧格「特意空着」（旧数据只存了尾帧）挡住它时，用户这一点就是要用它：放进首帧、开关一并收掉。
 */
export function metaWithParkedRestored(target: GenerationCanvasNode, nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[], url: string, mode?: ArchMode | null): Record<string, unknown> | null {
  const meta = (target.meta || {}) as Record<string, unknown>
  const list = readReferenceList(meta, mode)
  if (!list.includes(url)) return null
  const lands = (next: Record<string, unknown>) => !resolveReferencePlacement({ ...target, meta: next }, nodes, edges).unused.includes(url)
  const restored = withReferenceList(meta, list, { unpark: [url], mode })
  if (lands(restored)) return restored
  const withoutGap = withReferenceList(meta, list, { unpark: [url], mode, firstFrameEmpty: false })
  return firstFrameLeftEmpty(meta) && lands(withoutGap) ? withoutGap : null
}

/**
 * 「先放一边」的那张（旧工程打开时界面看不见的残留，参考行淡显「未用到」）点一下：放回在用（#1269 条件 4）。
 * 放得下才写；放不下就不写、说清楚（「已放满，先删一张再添加」），不做点了没反应的事。
 */
export function restoreParkedReference(ctx: ReferenceWriteContext, url: string): void {
  const { node } = ctx
  const state = useGenerationCanvasStore.getState()
  const target = { ...(ctx.latestNode(node.id) ?? node), meta: ctx.getLatestMeta() }
  const nextMeta = metaWithParkedRestored(target, state.nodes, state.edges, url, ctx.archMode)
  if (!nextMeta) {
    if (readReferenceList(target.meta, ctx.archMode).includes(url)) ctx.feedback('assetLibrary.refRow.addFull', {})
    return
  }
  ctx.updateNode(node.id, { meta: nextMeta })
}

type ReferencePatch = { meta?: Record<string, unknown>; prompt?: string }

/**
 * 两个删除入口共用：删掉的若是导演台此刻挂着的那份预演 = 用户不要这份预演，同一次写入记退出、抹掉运镜句。
 * 「挂着的是哪份」只问挂接核的读口；用户自己加的同网址参考不算退出。
 */
function withDirectorPreviewDismissal(ctx: ReferenceWriteContext, nodes: readonly GenerationCanvasNode[], currentNode: GenerationCanvasNode, patch: ReferencePatch, url: string): ReferencePatch {
  if (!directorPreviewReferenceRemoval(nodes, currentNode, url, lastAttachedCameraMoveUrl(currentNode))) return patch
  const prompt = withoutPreviewLines(withoutVideoDirective(patch.prompt ?? currentNode.prompt ?? ''))
  return {
    ...patch,
    meta: markDirectorPreviewDismissed(patch.meta ?? ctx.getLatestMeta(), url),
    ...(prompt !== (patch.prompt ?? currentNode.prompt ?? '') ? { prompt } : {}),
  }
}

export function removeFromArray(ctx: ReferenceWriteContext, metaKey: string, index: number): void {
  const { node } = ctx
  // 「×」按这一项的来源分流（单一真相源 decideArrayReferenceRemoval）：
  // 来自连边 → 断边（之前只删 meta 不断边，边来源的图重渲染又被解析回来 = 「叉不掉」根因）；
  // 来自上传 → 按 url 删 meta（显示 index 是「边+上传」合并列表的下标，不能直接拿去 filter meta 数组）。
  const state = useGenerationCanvasStore.getState()
  const currentNode = ctx.latestNode(node.id) ?? node
  const decision = decideArrayReferenceRemoval(ctx.latestNode(node.id) ?? node, state.nodes, state.edges, metaKey, index)
  // 所有数组参考删除都同步抹掉描述框里指向它的 @ chip（图片 / 视频 / 音频共用同一条规则，
  // 保 undo 原子性 + 一次持久化）。提示词也从最新节点读取，避免删除按钮的渲染快照覆盖刚刚发生的编辑。
  const promptAfterRemovingMention = (url: string | null) =>
    url ? removeMention(currentNode.prompt || '', url) : null

  if (decision.kind === 'disconnect-edge') {
    ctx.storeDisconnectEdge(decision.edgeId)
    // B5：同一 url 既来自边、又残留在 meta 上传里（去重后只显示边那份）→ 仅断边会让它以 upload 形态
    // 重现（「叉一次还在」）。断边时一并清掉 meta 里的同 url 上传（与断边/删 chip 合成一次持久化，保 undo 原子）。
    const latestMeta = ctx.getLatestMeta()
    const metaArr = readArchetypeArrayForWrite(latestMeta, metaKey, ctx.archMode)
    const cleanedMeta = decision.url ? metaArr.filter((u) => u !== decision.url) : metaArr
    const nextPrompt = promptAfterRemovingMention(decision.url)
    const patch: { meta?: Record<string, unknown>; prompt?: string } = {}
    if (cleanedMeta.length !== metaArr.length) patch.meta = archetypeArrayWrite(latestMeta, metaKey, cleanedMeta)
    if (nextPrompt != null && nextPrompt !== (currentNode.prompt || '')) patch.prompt = nextPrompt
    const finalPatch = decision.url ? withDirectorPreviewDismissal(ctx, state.nodes, currentNode, patch, decision.url) : patch
    if (Object.keys(finalPatch).length > 0) updateReferenceNode(ctx, finalPatch, 'existing')
    return
  }
  if (decision.kind === 'noop') return

  // remove-upload：按 url 从 meta 数组删（不是显示 index）。
  const latestMeta = ctx.getLatestMeta()
  const next = readArchetypeArrayForWrite(latestMeta, metaKey, ctx.archMode).filter((u) => u !== decision.url)
  const nextPrompt = promptAfterRemovingMention(decision.url)
  updateReferenceNode(ctx, withDirectorPreviewDismissal(ctx, state.nodes, currentNode, {
    meta: archetypeArrayWrite(latestMeta, metaKey, next),
    ...(nextPrompt != null && nextPrompt !== (currentNode.prompt || '') ? { prompt: nextPrompt } : {}),
  }, decision.url))
}

/**
 * 删一张「未用到」的图（参考行淡显那张上的 ×，用户 10-22 拍板 ⑫）。上传的：从节点参考列表里删；连线来的（首尾帧已满、
 * 多出来的那条）：断开那条线。提示词里指向它的 @ 一起删，和删在用的那张同一个规矩。
 */
export function removeUnusedReference(ctx: ReferenceWriteContext, url: string): void {
  const { node } = ctx
  const state = useGenerationCanvasStore.getState()
  const currentNode = ctx.latestNode(node.id) ?? node
  const edge = state.edges.find((candidate) => candidate.target === node.id
    && resultPreviewUrlOf(state.nodes.find((source) => source.id === candidate.source)) === url)
  const nextPrompt = removeMention(currentNode.prompt || '', url)
  const promptPatch = nextPrompt !== (currentNode.prompt || '') ? { prompt: nextPrompt } : {}
  if (edge) {
    ctx.storeDisconnectEdge(edge.id)
    const finalPatch = withDirectorPreviewDismissal(ctx, state.nodes, currentNode, promptPatch, url)
    if (Object.keys(finalPatch).length > 0) updateReferenceNode(ctx, finalPatch, 'existing')
    return
  }
  const latestMeta = ctx.getLatestMeta()
  const list = readReferenceList(latestMeta, ctx.archMode)
  if (!list.includes(url)) return
  updateReferenceNode(ctx, withDirectorPreviewDismissal(ctx, state.nodes, currentNode, { meta: withReferenceList(latestMeta, removeFromReferenceList(list, url)), ...promptPatch }, url))
}

function existingEdgeOf(ctx: ReferenceWriteContext, slot: ImageUrlSlot) {
  const state = useGenerationCanvasStore.getState()
  const target = state.nodes.find((candidate) => candidate.id === ctx.node.id) || ctx.node
  return {
    state,
    target,
    edge: resolveParameterReferenceAssignments(target, state.nodes, state.edges, ctx.getImageUrlSlots())
      .find((assignment) => assignment.slot.key === slot.key)?.edge,
  }
}

/**
 * 档案节点的首帧 / 尾帧格子：它不是存储位置，而是「参考列表里落进这个槽的那一张」。返回这个格子在当前方式里的槽下标，
 * 以及现在每个槽里落着的上传图（resolveReferencePlacement，与参考行、请求组装同一个推导）。非档案槽 → null（走旧的按键写）。
 */
function frameSlotIndex(ctx: ReferenceWriteContext, kind: 'first_frame' | 'last_frame'): number {
  return ctx.archMode?.slots.findIndex((candidate) => candidate.kind === kind) ?? -1
}

function archetypeFrameSlot(ctx: ReferenceWriteContext, slot: ImageUrlSlot): { slotIndex: number; uploadsBySlot: string[][]; list: string[]; meta: Record<string, unknown> } | null {
  const mode = ctx.archMode
  if (!mode || (slot.group !== 'first_frame' && slot.group !== 'last_frame')) return null
  const slotIndex = mode.slots.findIndex((candidate) => candidate.kind === slot.group)
  if (slotIndex < 0) return null
  const state = useGenerationCanvasStore.getState()
  const meta = ctx.getLatestMeta()
  const target = { ...(ctx.latestNode(ctx.node.id) ?? ctx.node), meta }
  const placement = resolveReferencePlacement(target, state.nodes, state.edges)
  const uploadsBySlot = placement.slots.map((resolved) => resolved.fills
    .filter((fill) => fill.origin.type === 'upload' && fill.url).map((fill) => fill.url as string))
  return { slotIndex, uploadsBySlot, list: readReferenceList(meta, mode), meta }
}

export function assignSlotSource(ctx: ReferenceWriteContext, slot: ImageUrlSlot, newSourceNodeId: string): void {
  const { state, target, edge: existingEdge } = existingEdgeOf(ctx, slot)
  if (!newSourceNodeId) {
    if (existingEdge) ctx.storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
    const frame = existingEdge ? null : archetypeFrameSlot(ctx, slot)
    const uploaded = frame?.uploadsBySlot[frame.slotIndex]?.[0]
    if (frame) {
      // 清掉的是落在这一格的那张上传图：从参考列表里删（别的图位置不变）。
      if (uploaded) ctx.updateNode(ctx.node.id, { meta: withReferenceList(frame.meta, removeFromReferenceList(frame.list, uploaded)) })
      ctx.closeSlot()
      return
    }
    const clearPatch = parameterReferenceMetaPatch(slot, ctx.getImageUrlSlots(), null)
    ctx.updateNode(ctx.node.id, { meta: { ...ctx.getLatestMeta(), ...clearPatch } }, { history: !existingEdge })
    ctx.closeSlot()
    return
  }
  const declared = readParameterReferenceSlots(target.meta).some((candidate) => candidate.key === slot.key)
  if (existingEdge?.source === newSourceNodeId) { ctx.closeSlot(); return }
  if (existingEdge) ctx.storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
  else state.captureHistory()
  // 档案首 / 尾帧格子里原来是一张上传图：用户这一步是「换掉这一格」，那张上传图从参考列表里拿掉（不让它挤到下一格）。
  const frame = existingEdge ? null : archetypeFrameSlot(ctx, slot)
  const replaced = frame?.uploadsBySlot[frame.slotIndex]?.[0]
  if (frame && replaced) ctx.updateNode(ctx.node.id, { meta: withReferenceList(frame.meta, removeFromReferenceList(frame.list, replaced)) }, { history: false })
  ctx.storeConnectNodes(newSourceNodeId, ctx.node.id, edgeModeForGroup(slot.group), declared ? slot.key : undefined)
  // S2 写收口：边即真相源——不再写 firstFrameUrl/firstFrameRef/referenceImages 等快照 meta（源未生成时快照为空=陈旧，
  // 且与其它参数写入竞态）；读取方都已边优先，源生成后 url 由边实时解析。
  ctx.closeSlot()
}

/** 上传 / 选项目素材只替换该槽来源；退出编组继承时其它槽保留为手工边。 */
export function setSlotUrl(ctx: ReferenceWriteContext, slot: ImageUrlSlot, url: string): void {
  const { edge: existingEdge } = existingEdgeOf(ctx, slot)
  if (existingEdge) ctx.storeDisconnectEdge(existingEdge.id, { scope: 'parameter' })
  const frame = archetypeFrameSlot(ctx, slot)
  if (frame) {
    // 档案首 / 尾帧：放进参考列表，让它落进这一格（putInReferenceSlot），不再写 firstFrameUrl / lastFrameUrl。
    // 往尾帧格放、首帧格空着（没有上传图）→ 记下「首帧特意空着」，图落尾帧；往首帧格放 → 首帧不再空着。
    const isLast = slot.group === 'last_frame'
    const firstHasUpload = (frame.uploadsBySlot[frameSlotIndex(ctx, 'first_frame')] ?? []).length > 0
    const firstFrameEmpty = isLast && !firstHasUpload
    const next = putInReferenceSlot(frame.list, frame.uploadsBySlot, frame.slotIndex, url)
    // 用户亲手放进这一格：就算这张原来是「先放一边」的旧图，也算放回在用。
    ctx.updateNode(ctx.node.id, { meta: withReferenceList(frame.meta, next, { firstFrameEmpty, unpark: [url], mode: ctx.archMode }) }, { history: !existingEdge })
    ctx.closeSlot()
    return
  }
  const patch = parameterReferenceMetaPatch(slot, ctx.getImageUrlSlots(), url)
  ctx.updateNode(ctx.node.id, { meta: { ...ctx.getLatestMeta(), ...patch } }, { history: !existingEdge })
  ctx.closeSlot()
}

/** 首尾帧对调：连线来的跟着边走，上传来的跟着 url 走；一次撤销回到对调前。 */
export function swapFrameSlots(ctx: ReferenceWriteContext, first: ImageUrlSlot, last: ImageUrlSlot, assetValuesByKey: Record<string, unknown>, edgeSourceOf: (slot: ImageUrlSlot) => string | undefined): void {
  type Source = { edgeSource: string } | { url: string } | null
  const describe = (slot: ImageUrlSlot): Source => {
    const edgeSource = edgeSourceOf(slot)
    if (edgeSource) return { edgeSource }
    const url = assetValuesByKey[slot.key]
    return typeof url === 'string' && url ? { url } : null
  }
  const a = describe(first)
  const b = describe(last)
  if (!a && !b) return
  // 档案节点、两格里只有上传图（没有连线）：列表里对调两张；只有一张时用「首帧特意空着」开关把它挪到另一格。一次写入。
  const uploadOnly = (!a || 'url' in a) && (!b || 'url' in b)
  const frame = uploadOnly ? archetypeFrameSlot(ctx, first) : null
  if (frame) {
    const firstUrl = a && 'url' in a ? a.url : ''
    const lastUrl = b && 'url' in b ? b.url : ''
    const next = firstUrl && lastUrl ? swapInReferenceList(frame.list, firstUrl, lastUrl) : frame.list
    ctx.updateNode(ctx.node.id, { meta: withReferenceList(frame.meta, next, { firstFrameEmpty: Boolean(firstUrl) && !lastUrl }) })
    return
  }
  useGenerationCanvasStore.getState().captureHistory()
  assignSlotSource(ctx, first, '')
  assignSlotSource(ctx, last, '')
  const put = (slot: ImageUrlSlot, value: Source) => {
    if (!value) return
    if ('edgeSource' in value) assignSlotSource(ctx, slot, value.edgeSource)
    else setSlotUrl(ctx, slot, value.url)
  }
  put(first, b)
  put(last, a)
}

/**
 * 首尾帧对调钮：对调后这个方式还发得出去才可点（判据只看档案的槽必填声明，见 frameSwapKeepsSendable）。
 * 没有首尾两格时 null（不出钮）。
 */
export function frameSwapControl(ctx: ReferenceWriteContext, slots: readonly ImageUrlSlot[], assetValuesByKey: Record<string, unknown>, edgeSourceOf: (slot: ImageUrlSlot) => string | undefined): { blocked: boolean; swap: () => void } | null {
  const first = slots.find((slot) => slot.group === 'first_frame')
  const last = slots.find((slot) => slot.group === 'last_frame')
  if (!first || !last) return null
  const filled = (slot: ImageUrlSlot) => {
    const value = assetValuesByKey[slot.key]
    return (typeof value === 'string' && value.length > 0) || Boolean(edgeSourceOf(slot))
  }
  const blocked = ctx.archMode ? !frameSwapKeepsSendable(ctx.archMode, { first: filled(first), last: filled(last) }) : false
  return { blocked, swap: () => { if (!blocked) swapFrameSlots(ctx, first, last, assetValuesByKey, edgeSourceOf) } }
}

/** 同槽内拖拽重排：移动数组项（图片走那一份有序列表）。character{N} 编号由 projectPromptForSend 按新位置重算。 */
export function reorderArray(ctx: ReferenceWriteContext, metaKey: string, from: number, to: number): void {
  const latest = ctx.getLatestMeta()
  const arr = readArchetypeArrayForWrite(latest, metaKey, ctx.archMode)
  if (from === to || from < 0 || to < 0 || from >= arr.length || to >= arr.length) return
  ctx.updateNode(ctx.node.id, { meta: archetypeArrayWrite(latest, metaKey, moveArrayItem(arr, from, to)) })
}
