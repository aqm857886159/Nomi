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
import type { ArchetypeReferenceSlot, ArchetypeReferenceSlotKind } from '../../../config/modelArchetypes'
import { currentArchetypeMode, referenceSlotStorage } from '../nodes/controls/archetypeMeta'
import { archetypeForNode, referenceAssetKindForNode, SLOT_ACCEPTS, type ReferenceAssetKind } from '../agent/referenceEdgeCapability'
import { sortEdgesByOrder } from '../model/graphOps'
import { asUrl, findNodeResultUrl } from './referenceUrl'

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
  max: number
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
  slots: ArchetypeReferenceSlot[],
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
  const order: ArchetypeReferenceSlotKind[] = assetKind === 'video'
    ? ['video_ref', 'source_video', 'first_frame']
    : ['image_ref', 'first_frame', 'last_frame']
  for (const kind of order) { const i = findKind(kind); if (i >= 0) return { slotIndex: i } }
  const any = slots.findIndex(accepts)
  return any >= 0 ? { slotIndex: any } : null
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
  const archetype = archetypeForNode(target)
  if (!archetype) return []
  const meta = (target.meta || {}) as Record<string, unknown>
  const mode = currentArchetypeMode(archetype, meta)
  const slots = mode.slots
  if (slots.length === 0) return []
  const nodesById = new Map(nodes.map((n) => [n.id, n]))

  // 每个槽一个定长 (max) 位置数组，先放边（含位置偏好）、再放上传到剩余空位、去重。
  const positionsBySlot: (ReferenceFill | null)[][] = slots.map((s) => Array.from({ length: Math.max(s.max, 0) }, () => null))
  const seenUrlBySlot: Set<string>[] = slots.map(() => new Set<string>())

  const placeAt = (slotIndex: number, fill: Omit<ReferenceFill, 'position'>, preferred?: number) => {
    const row = positionsBySlot[slotIndex]
    if (row.length === 0) return
    if (fill.url) {
      if (seenUrlBySlot[slotIndex].has(fill.url)) return
      seenUrlBySlot[slotIndex].add(fill.url)
    }
    let pos = preferred != null && preferred < row.length && row[preferred] === null ? preferred : -1
    if (pos < 0) pos = row.findIndex((cell) => cell === null)
    if (pos < 0) return // 槽已满
    row[pos] = { ...fill, position: pos }
  }

  // 1) 边：一对一落槽。dangling / 源无可参考资产 → 跳过（连了但不可作参考）。
  //    **按 order 升序**落槽 → 数组参考 character1..N 顺序稳定，与生成侧同一口径（audit §1d）。
  for (const edge of sortEdgesByOrder(edges)) {
    if (edge.target !== target.id) continue
    const source = nodesById.get(edge.source)
    if (!source) continue
    const assetKind = referenceAssetKindForNode(source)
    if (!assetKind) continue
    const assignment = assignEdgeToSlot(edge.mode, assetKind, slots)
    if (!assignment) continue
    const slot = slots[assignment.slotIndex]
    // 待抽帧接力判据必须按**媒体类型**（assetKind，line 110 已按 result.type 算），不能按 source.kind：
    // 导入的视频素材 kind='asset'（图/视频同种类），按 kind 判会漏判 → 视频 URL 落 first_frame 图槽
    // 渲染成 <img src=video.mp4> 加载失败（与「导入视频当参考被判成图」同一根因，只是换到 i2v 单首帧入口）。
    const isRelay = slot.kind === 'first_frame' && assetKind === 'video'
    const rawUrl = findNodeResultUrl(nodesById, edge.source)
    const status: ReferenceFillStatus = isRelay ? 'pending-extraction' : rawUrl ? 'resolved' : 'pending-generation'
    placeAt(assignment.slotIndex, {
      // 待抽帧时不把视频 URL 当填充值（封死「视频/封面冒充首帧」）；待生成时 url 暂空。
      url: isRelay ? null : rawUrl || null,
      status,
      origin: { type: 'edge', sourceNodeId: edge.source, ...(edge.mode ? { semantic: edge.mode } : {}) },
    }, assignment.preferredPosition)
  }

  // 2) 上传：meta 里手动放的值（无源节点），填剩余空位。
  slots.forEach((slot, slotIndex) => {
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

  return slots.map((slot, slotIndex) => ({
    slotKind: slot.kind,
    label: slot.label,
    min: slot.min,
    max: slot.max,
    numbered: Boolean(slot.characterIndexed),
    accept: SLOT_ACCEPTS[slot.kind],
    fills: positionsBySlot[slotIndex].filter((cell): cell is ReferenceFill => cell !== null),
  }))
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
