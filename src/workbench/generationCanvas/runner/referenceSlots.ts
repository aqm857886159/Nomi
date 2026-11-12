import { remainingReferenceCapacity } from '../../../../electron/shared/videoCapabilities/crossFieldConstraints'
// 能力驱动的参考槽解析 —— **唯一真相源**（方案 docs/plan/2026-06-14-connection-reference-capability-model.md）。
//
// 一个函数把「目标当前模式声明的槽」+「指向它的画布边」+「meta 里手动上传的值」解析成
// 每个槽的有序填充。显示 / 生成 / 校验 / 对账 四处共用它，杜绝「显示读 meta、生成读边」的分裂。
//
// 设计要点（已过对抗评审）：
// - **能力驱动**：槽由 archetype 当前模式声明，边按「源资产类型 ∩ 槽 accept」一对一落槽（不靠连边时猜 mode）。
// - **有序**：fills 按位置（Kling image_ref[0]=首帧 [1]=尾帧），不是无序集。
// - **未解析态**：连了边但源未生成 = pending-generation；视频源待抽帧 = pending-extraction。
//   故 fills 即使 url 为 null 也保留，显示画「已连接·待生成」占位 → 不再「连线没用」。
// - **来源判别**：每个 fill 标明来自边（带源节点 id + 语义）还是上传。
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind } from '../../../../electron/shared/modelArchetypes'
import { effectiveArchetypeMode, referenceSlotStorage } from '../nodes/controls/archetypeMeta'
import { archetypeForNode, referenceAssetKindForNode, SLOT_ACCEPTS, preferredSlotKinds, type ReferenceAssetKind } from '../agent/referenceEdgeCapability'
import { sortEdgesByOrder } from '../model/graphOps'
import { asUrl, findNodeResultUrl } from './referenceUrl'
import { isImageUploadSlot, listPlacementInputs, placeUploadedImages } from '../nodes/controls/referenceList'

export type ReferenceFillOrigin =
  | { type: 'edge'; sourceNodeId: string; semantic?: GenerationCanvasEdgeMode }
  | { type: 'upload' }

/** resolved=已可用；pending-generation=连了边但源还没出图；pending-extraction=视频源待抽帧成首帧。 */
export type ReferenceFillStatus = 'resolved' | 'pending-generation' | 'pending-extraction'

export type ReferenceFill = {
  position: number
  url: string | null
  status: ReferenceFillStatus
  origin: ReferenceFillOrigin
}

export type ResolvedReferenceSlot = {
  slotKind: ArchetypeReferenceSlotKind
  label: string
  min: number
  max?: number
  /** 角色图按序对应 prompt character1..N（缩略图标 ①②③）。 */
  numbered: boolean
  accept: readonly ReferenceAssetKind[]
  /** 已占用的填充，按 position 升序；空位不入列（length ≤ max）。 */
  fills: ReferenceFill[]
}

/** 一条边该落到目标的哪个声明槽、优先哪个位置。落不下 → null。 */
function assignEdgeToSlot(
  mode: GenerationCanvasEdgeMode | undefined,
  assetKind: ReferenceAssetKind,
  slots: readonly ArchetypeReferenceSlot[],
): { slotIndex: number; preferredPosition?: number } | null {
  const accepts = (slot: ArchetypeReferenceSlot) => SLOT_ACCEPTS[slot.kind].includes(assetKind)
  const findKind = (kind: ArchetypeReferenceSlotKind) => slots.findIndex((s) => s.kind === kind && accepts(s))

  if (mode === 'first_frame') {
    const ff = findKind('first_frame'); if (ff >= 0) return { slotIndex: ff, preferredPosition: 0 }
    const ir = findKind('image_ref'); if (ir >= 0) return { slotIndex: ir, preferredPosition: 0 } // Kling/Sora 首帧 = image_ref[0]
  } else if (mode === 'last_frame') {
    const lf = findKind('last_frame'); if (lf >= 0) return { slotIndex: lf, preferredPosition: 0 }
    const ir = findKind('image_ref'); if (ir >= 0) return { slotIndex: ir, preferredPosition: 1 } // 尾帧 = image_ref[1]
  }
  // 通用 reference / style_ref / character_ref / composition_ref / 未知：按源资产挑第一个能吃的槽
  return genericSlotCandidates(assetKind, slots)[0] ?? null
}

/**
 * 一条边可以落的槽，按偏好排好序（第一格放不下就落下一格）。首 / 尾帧语义的边只认那一格（它们说的就是那一格）；
 * 参考类的边（reference / character_ref / style_ref / composition_ref / 未写语义）按 preferredSlotKinds 的顺序、
 * 再接上其余能吃这种资产的槽——所以首尾帧方式下，第一条参考连线落首帧、第二条落尾帧，和上传图按列表依次落首、尾帧
 * 同一个规矩（用户 10-22 拍板 ⑪）。
 */
function edgeSlotCandidates(
  mode: GenerationCanvasEdgeMode | undefined,
  assetKind: ReferenceAssetKind,
  slots: readonly ArchetypeReferenceSlot[],
): Array<{ slotIndex: number; preferredPosition?: number }> {
  if (mode === 'first_frame' || mode === 'last_frame') {
    const single = assignEdgeToSlot(mode, assetKind, slots)
    return single ? [single] : []
  }
  return genericSlotCandidates(assetKind, slots)
}

/** 参考类连线（没说是首 / 尾帧）能落的槽：先按 preferredSlotKinds 的偏好，再接上其余能吃这种资产的槽。 */
function genericSlotCandidates(
  assetKind: ReferenceAssetKind,
  slots: readonly ArchetypeReferenceSlot[],
): Array<{ slotIndex: number; preferredPosition?: number }> {
  const accepts = (slot: ArchetypeReferenceSlot) => SLOT_ACCEPTS[slot.kind].includes(assetKind)
  const ordered: number[] = []
  for (const kind of preferredSlotKinds('reference', assetKind)) {
    slots.forEach((slot, index) => { if (slot.kind === kind && accepts(slot) && !ordered.includes(index)) ordered.push(index) })
  }
  slots.forEach((slot, index) => { if (accepts(slot) && !ordered.includes(index)) ordered.push(index) })
  return ordered.map((slotIndex) => ({ slotIndex }))
}

/**
 * 删掉连线中点的用途胶囊后，「这张图是首帧」要在节点上看得见（用户 10-08 拍板，铁律⑩）。
 * 只有没有独立首帧槽、首帧落在 image_ref[0] 的档案（如 runway-gen4.5）才需要：槽里看不出来。
 * 返回要给第一张缩略图标「首帧」的那个 image_ref 槽；没有 first_frame 边（或那张图还没生成）→ null。
 */
export function firstFrameTaggedSlot(resolved: readonly ResolvedReferenceSlot[]): ResolvedReferenceSlot | null {
  if (resolved.some((slot) => slot.slotKind === 'first_frame')) return null
  const refs = resolved.find((slot) => slot.slotKind === 'image_ref')
  const first = refs?.fills[0]
  return refs && first && first.position === 0 && first.url && first.origin.type === 'edge' && first.origin.semantic === 'first_frame' ? refs : null
}

/**
 * 一条**首帧边**（图片源）落进这组声明槽里的哪一个——就是上面 `assignEdgeToSlot` 的判据，不另写一份。
 * 首帧槽优先，没有就是 image_ref[0]；这与发送侧一致：generationReferenceResolver 把首帧边的图同时放进
 * `firstFrameUrl`（喂首帧槽）与 `referenceImages`（喂 image_ref 数组槽），而没有模式同时声明这两种槽
 * （shotRowModel.plannedFirstFrame.test.ts 按全部视频档案逐模式核对）。
 * 消费方：分镜行「计划首帧」——那一行还没落画布，首帧边还不存在，但生成时它会落在这里。落不下 → null。
 */
export function firstFrameEdgeSlot(slots: readonly ArchetypeReferenceSlot[]): ArchetypeReferenceSlot | null {
  const assignment = assignEdgeToSlot('first_frame', 'image', slots)
  return assignment ? slots[assignment.slotIndex] ?? null : null
}

/**
 * 解析目标节点当前模式每个声明槽的填充。无档案（未知/未设模型）→ 返回 []（由旧 image-url 启发式路径兜，
 * 那是 P0-8 档案缺口，本函数不接管）。
 */
export function resolveReferenceSlots(
  target: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
): ResolvedReferenceSlot[] {
  return resolveReferencePlacement(target, nodes, edges).slots
}

export type ReferencePlacementOptions = {
  /** 渠道只收得下更少时按槽收窄上限（参考行用：中转只有单图位）。不传按档案声明。 */
  capOf?: (slot: ArchetypeReferenceSlot) => number | undefined
  /** 按这个摆法排（判断「再连一条进来放不放得下」时用连上之后现算的摆法）；不传 = 这张画布上现算的摆法。 */
  layout?: ArchetypeMode
}

/**
 * 同 resolveReferenceSlots，另给出节点参考列表里**当前方式用不上**的图（unused，参考行淡显「未用到」），
 * 其中「先放一边」的旧工程残留另列在 parked（点一下放回在用）。在用 ∪ unused = 节点上那一份参考列表，一张不少。
 */
export function resolveReferencePlacement(
  target: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
  options: ReferencePlacementOptions = {},
): { slots: ResolvedReferenceSlot[]; unused: string[]; parked: string[] } {
  const archetype = archetypeForNode(target)
  if (!archetype) return { slots: [], unused: [], parked: [] }
  const meta = (target.meta || {}) as Record<string, unknown>
  // 参考行按「图怎么摆」排（layout）。layout 与这次发的方式不一样，只出现在这次一张都没收下的时候（首尾帧版式空着、
  // 或只放了尾帧被按文字发）：格子照版式显示，节点上的图一张都不落进去、全部淡显「未用到」——请求里也确实不带它们。
  const resolution = options.layout ? null : effectiveArchetypeMode(archetype, target, { nodes, edges })
  const mode = options.layout ?? resolution!.layout
  const sendsNothing = Boolean(resolution && resolution.layout.id !== resolution.mode.id)
  const slots = mode.slots
  if (slots.length === 0) {
    const inputs = listPlacementInputs(meta, mode)
    return { slots: [], unused: inputs.list, parked: inputs.list.filter((url) => inputs.parked.has(url)) }
  }
  const nodesById = new Map(nodes.map((n) => [n.id, n]))

  // 按实际输入增长，不为未公开的上限分配 Infinity/NaN 长度数组，也不编造数量限制。
  const positionsBySlot: (ReferenceFill | null)[][] = slots.map(() => [])
  const seenUrlBySlot: Set<string>[] = slots.map(() => new Set<string>())

  /** 放进去了返回 true；同一张已在这一格（去重）也算放好；槽满返回 false（交给下一个候选槽）。 */
  const placeAt = (slotIndex: number, fill: Omit<ReferenceFill, 'position'>, preferred?: number): boolean => {
    const row = positionsBySlot[slotIndex]
    const max = slots[slotIndex].max
    if (fill.url && seenUrlBySlot[slotIndex].has(fill.url)) return true
    let pos = preferred != null && (max === undefined || preferred < max) && row[preferred] == null ? preferred : -1
    if (pos < 0) pos = row.findIndex((cell) => cell === null)
    if (pos < 0 && (max === undefined || row.length < max)) pos = row.length
    if (pos < 0) return false // 槽已满
    while (row.length <= pos) row.push(null)
    if (fill.url) seenUrlBySlot[slotIndex].add(fill.url)
    row[pos] = { ...fill, position: pos }
    return true
  }

  // 1) 边：一对一落槽。dangling / 源无可参考资产 → 跳过（连了但不可作参考）。
  //    **按 order 升序**落槽 → 数组参考 character1..N 顺序稳定，与生成侧同一口径（audit §1d）。
  for (const edge of sortEdgesByOrder(edges)) {
    if (edge.target !== target.id) continue
    const source = nodesById.get(edge.source)
    if (!source) continue
    const assetKind = referenceAssetKindForNode(source)
    if (!assetKind) continue
    const rawUrl = findNodeResultUrl(nodesById, edge.source)
    // 候选槽依次试：第一格满了落下一格（首尾帧方式下第二条参考连线落尾帧）。
    for (const assignment of edgeSlotCandidates(edge.mode, assetKind, slots)) {
      const slot = slots[assignment.slotIndex]
      // 待抽帧接力判据必须按**媒体类型**（assetKind，line 110 已按 result.type 算），不能按 source.kind：
      // 导入的视频素材 kind='asset'（图/视频同种类），按 kind 判会漏判 → 视频 URL 落 first_frame 图槽
      // 渲染成 <img src=video.mp4> 加载失败（与「导入视频当参考被判成图」同一根因，只是换到 i2v 单首帧入口）。
      const isRelay = slot.kind === 'first_frame' && assetKind === 'video'
      const status: ReferenceFillStatus = isRelay ? 'pending-extraction' : rawUrl ? 'resolved' : 'pending-generation'
      const placed = placeAt(assignment.slotIndex, {
        // 待抽帧时不把视频 URL 当填充值（封死「视频/封面冒充首帧」）；待生成时 url 暂空。
        url: isRelay ? null : rawUrl || null,
        status,
        origin: { type: 'edge', sourceNodeId: edge.source, ...(edge.mode ? { semantic: edge.mode } : {}) },
      }, assignment.preferredPosition)
      if (placed) break
    }
  }

  // 2a) 视频 / 音频 / 源视频的上传：各住各的键，填剩余空位。
  slots.forEach((slot, slotIndex) => {
    if (sendsNothing || isImageUploadSlot(slot.kind)) return
    const storage = referenceSlotStorage(slot)
    if (!storage) return
    const raw = meta[storage.metaKey]
    const uploads = storage.isArray
      ? (Array.isArray(raw) ? raw : [])
      : [raw]
    for (const value of uploads) {
      const url = asUrl(value)
      if (!url) continue
      placeAt(slotIndex, { url, status: 'resolved', origin: { type: 'upload' } })
    }
  })

  // 2b) 图片上传：节点上那一份有序参考列表，按唯一规则 placeUploadedImages 依次落进收图的槽（与请求组装同一个函数、同一组输入）。
  const occupiedUrls = new Set(positionsBySlot.flatMap((row) => row.flatMap((cell) => (cell?.url ? [cell.url] : []))))
  const occupiedTotal = positionsBySlot.reduce((sum, row) => sum + row.filter(Boolean).length, 0)
  const inputs = listPlacementInputs(meta, mode)
  const placement = placeUploadedImages(mode, inputs.list, {
    countBySlot: positionsBySlot.map((row) => row.filter(Boolean).length),
    urls: occupiedUrls,
  }, {
    totalBudget: sendsNothing ? 0 : mode.maxTotalReferences === undefined ? undefined : mode.maxTotalReferences - occupiedTotal,
    firstFrameEmpty: inputs.firstFrameEmpty,
    parked: inputs.parked,
    ...(options.capOf ? { capOf: (slotIndex: number) => options.capOf!(slots[slotIndex]!) } : {}),
  })
  placement.bySlot.forEach((urls, slotIndex) => {
    for (const url of urls) placeAt(slotIndex, { url, status: 'resolved', origin: { type: 'upload' } })
  })

  return {
    unused: placement.unused,
    parked: placement.parked,
    slots: slots.map((slot, slotIndex) => ({
      slotKind: slot.kind,
      label: slot.label,
      min: slot.min,
      max: slot.max,
      numbered: Boolean(slot.characterIndexed),
      accept: SLOT_ACCEPTS[slot.kind],
      fills: positionsBySlot[slotIndex].filter((cell): cell is ReferenceFill => cell !== null),
    })),
  }
}

/**
 * 数组参考槽「×」删除的来源判定（单一真相源）。
 * 显示值 = resolveReferenceSlots 的有 url fills（边+上传合并），故删除也必须按这一项的 origin 决定：
 * 来自边 → 断边；来自上传 → 按 url 删 meta。只删 meta 不断边 = 边来源的图重渲染又被解析回来（「叉不掉」根因）。
 * index 是显示列表（有 url fills）的下标，不是 meta 数组下标，两者不一一对应。
 */
export type ArrayReferenceRemoval =
  | { kind: 'disconnect-edge'; edgeId: string; url: string | null }
  | { kind: 'remove-upload'; url: string }
  | { kind: 'noop' }

/**
 * 地基收口对账（audit 2026-06-16 §1c+§1d）：扫全图，找出「应是边、却以 meta-only 上传形态显示」的
 * 数组参考孤儿——即某节点数组槽里以 `upload` 来源显示的参考，其 URL 其实对应**画布内某节点的产物**
 * （本该建成有序边，却残留在 meta 里，会和未来重连的边重复显示 / 顺序不可控）。连线路径已不再写
 * meta-only（completeNodeConnection 改建有序边）、迁移层把旧 meta 反查建边，故正常态返回空；
 * 非空 = 有路径绕过了「建边」收口（或脏数据），对账如实报，把整类分裂钉在 CI。
 * 同时校验：标 `edge` 来源的 fill 必有真实边（双向不变量）。返回人话偏差列表，喂 reconcileProposal
 * 的 auditOrphanArrayReferences 注入点。
 */
export function findOrphanArrayReferences(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): Array<{ where: string; field: string; expected: unknown; actual: unknown }> {
  const out: Array<{ where: string; field: string; expected: unknown; actual: unknown }> = []
  const nodeList = nodes as GenerationCanvasNode[]
  const edgeList = edges as GenerationCanvasEdge[]
  // URL → 画布内产出它的源节点 id（与迁移层同口径 providerUrl/url/thumbnailUrl）。
  const sourceByUrl = new Map<string, string>()
  for (const node of nodeList) {
    for (const candidate of [node.result?.providerUrl, node.result?.url, node.result?.thumbnailUrl, ...(node.history || []).flatMap((h) => [h.providerUrl, h.url, h.thumbnailUrl])]) {
      const u = asUrl(candidate)
      if (u && !sourceByUrl.has(u)) sourceByUrl.set(u, node.id)
    }
  }
  for (const node of nodeList) {
    for (const slot of resolveReferenceSlots(node, nodeList, edgeList)) {
      for (const fill of slot.fills) {
        if (fill.origin.type === 'edge') {
          // 标 edge 来源 → 必有真实边（构造性应恒真；脏快照则如实报）。
          const hasEdge = edgeList.some((e) => e.source === (fill.origin as { sourceNodeId: string }).sourceNodeId && e.target === node.id)
          if (!hasEdge) {
            out.push({ where: `「${node.title || node.id}」`, field: `数组参考槽 ${slot.label}`, expected: '有对应已提交边', actual: '显示出边参考但无边' })
          }
          continue
        }
        // 标 upload 来源、但 URL 其实是画布内某节点的产物 → 本该建边的孤儿（meta-only 残留）。
        const sourceId = fill.url ? sourceByUrl.get(fill.url) : undefined
        if (sourceId && sourceId !== node.id) {
          out.push({ where: `「${node.title || node.id}」`, field: `数组参考槽 ${slot.label}`, expected: '画布内来源应建成有序边', actual: 'meta-only 残留（无边有图）' })
        }
      }
    }
  }
  return out
}

export function decideArrayReferenceRemoval(
  target: GenerationCanvasNode,
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
  metaKey: string,
  index: number,
): ArrayReferenceRemoval {
  for (const rs of resolveReferenceSlots(target, nodes, edges)) {
    const storage = referenceSlotStorage({ kind: rs.slotKind })
    if (!storage || storage.metaKey !== metaKey) continue
    const fill = rs.fills.filter((f) => Boolean(f.url))[index]
    if (!fill) return { kind: 'noop' }
    if (fill.origin.type === 'edge') {
      const { sourceNodeId, semantic } = fill.origin
      const edge =
        edges.find((e) => e.source === sourceNodeId && e.target === target.id && (semantic ? e.mode === semantic : true)) ||
        edges.find((e) => e.source === sourceNodeId && e.target === target.id)
      return edge ? { kind: 'disconnect-edge', edgeId: edge.id, url: fill.url } : { kind: 'noop' }
    }
    return { kind: 'remove-upload', url: fill.url as string }
  }
  return { kind: 'noop' }
}

/** Same slot placement and aggregate budget for uploads and pending connections. */
export function canFitReferenceEdge(source: GenerationCanvasNode, target: GenerationCanvasNode, nodes: readonly GenerationCanvasNode[], edges: readonly GenerationCanvasEdge[], semantic: GenerationCanvasEdgeMode): boolean {
  const archetype = archetypeForNode(target)
  const asset = referenceAssetKindForNode(source)
  if (!archetype || !asset) return true
  // 连上之后这一格按什么摆，由连上之后的输入现算（不再先把方式写进节点）；已有的东西按那个摆法排一遍再看有没有空位。
  const pending: GenerationCanvasEdge = { id: `pending-${source.id}-${target.id}`, source: source.id, target: target.id, mode: semantic }
  const mode = effectiveArchetypeMode(archetype, target, { nodes, edges: [...edges, pending] }).layout
  const candidates = edgeSlotCandidates(semantic, asset, mode.slots)
  if (!candidates.length) return false
  const filled = resolveReferencePlacement(target, [...nodes], [...edges], { layout: mode }).slots
  const hasRoom = candidates.some(({ slotIndex }) => {
    const slot = filled[slotIndex]!
    return slot.max === undefined || slot.fills.length < slot.max
  })
  if (!hasRoom) return false
  return remainingReferenceCapacity(mode, Object.fromEntries(filled.map((item) => [item.slotKind, item.fills.length]))) > 0
}
