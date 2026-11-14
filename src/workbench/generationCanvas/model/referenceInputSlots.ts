// 「这一次生成带哪些参考」在**一个节点上**长什么样——宿主候选落到画布节点时用的那一张对照表。
//
// 参考在两处出现：宿主候选里钉住的那几条（`candidate.references`）、画布节点（连线 + 节点自己参考槽里的值）。
// 两处说的必须是同一件事，所以「一条参考 ↔ 节点上的哪一格」只在这里写一次：
//   · `nodeOwnReferenceInputs`：节点自己参考槽里此刻摆着的值（不含连线）→ 一组参考；
//   · `planReferenceProjection`：宿主候选 → 画布节点要补的东西（画布上已有的图补一条真边，其余补进参考槽）。
// 槽位解析一律走 `resolveReferenceSlots`（显示 / 生成 / 校验共用的那一个），不另写第二份。
// （付费卡以前也在这里摆它自己那张框的参考槽；D2 之后卡不再有参数框，只读节点本身。）
import type { GenerationReference } from '../../../../electron/shared/agentCapabilities/generationPlanSchemas'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode } from './generationCanvasTypes'
import { resolveReferencePlacement, resolveReferenceSlots } from '../runner/referenceSlots'
import { isImageUploadSlot, withReferenceList } from '../nodes/controls/referenceList'
import { effectiveArchetypeModeWithInputs, referenceSlotAccept, referenceSlotStorage, type ArchetypeMode } from '../nodes/controls/archetypeMeta'
import { readParameterReferenceSlots, parameterReferenceMetaPatch } from './parameterReferenceSlots'
import { resultUrl } from '../runner/referenceUrl'
import { archetypeForNode, edgeModeForReferenceRole, referenceDemandForRole } from '../agent/referenceEdgeCapability'

export type ReferenceRole = NonNullable<GenerationReference['role']>
export type ReferenceInputKind = 'image' | 'video' | 'audio'
/** 一条摆在节点上的参考（没有钉住身份的那一种：只有地址、媒体种类、用途）。 */
export type NodeReferenceInput = Readonly<{ url: string; kind: ReferenceInputKind; role: ReferenceRole }>
/** 宿主候选里的一条参考换成的地址形状（用途可缺：缺了按通用参考）。 */
export type CandidateReferenceInput = Readonly<{ url: string; kind: ReferenceInputKind; role?: ReferenceRole }>

/** 槽位 → 用途。首 / 尾帧照名，音频槽是 audio，编号的角色槽是 character，其余是通用参考。 */
export function referenceRoleOfSlot(kind: string, numbered: boolean): ReferenceRole {
  return kind === 'first_frame' || kind === 'last_frame' ? kind
    : kind === 'audio_ref' ? 'audio' : numbered ? 'character' : 'reference'
}

const PAIRED_ROLES: readonly ReferenceRole[] = ['character', 'reference']

/**
 * 一组参考 → 摆进节点的参考槽（按 layout 这个摆法；先清空这些槽，再按序摆）。摆不下的（这个摆法没有对口的槽）不摆。
 * 和 `resolveReferenceSlots` 互为逆向：摆完再解析，读回来的就是这一组。
 */
function placeReferenceInputs(node: GenerationCanvasNode, inputs: readonly CandidateReferenceInput[], layout?: ArchetypeMode): GenerationCanvasNode {
  const meta: Record<string, unknown> = { ...node.meta }
  const placement = resolveReferencePlacement(node, [], [], layout ? { layout } : {})
  const slots = placement.slots
  const parameters = readParameterReferenceSlots(meta)
  // 图片（首帧 / 尾帧 / 参考图）住节点那一份有序参考列表（referenceList）：按槽的声明顺序排好，
  // placeUploadedImages 会按同一顺序落回这些槽；当前方式本来就用不上的那些（未用到）接在后面，不丢。
  const imagesBySlot: string[][] = slots.map(() => [])
  for (const slot of slots) {
    if (isImageUploadSlot(slot.slotKind)) continue
    const storage = referenceSlotStorage({ kind: slot.slotKind })
    if (storage) meta[storage.metaKey] = storage.isArray ? [] : null
  }
  for (const parameter of parameters) Object.assign(meta, parameterReferenceMetaPatch(parameter, parameters, null))
  for (const input of inputs) {
    if (!input.url) continue
    const kind = input.kind
    const role = input.role ?? 'reference'
    const slot = slots.find(slot => slot.accept.includes(kind) && referenceRoleOfSlot(slot.slotKind, slot.numbered) === role)
      ?? slots.find(slot => slot.accept.includes(kind) && PAIRED_ROLES.includes(role) && PAIRED_ROLES.includes(referenceRoleOfSlot(slot.slotKind, slot.numbered)))
    const slotIndex = slot ? slots.indexOf(slot) : -1
    if (slot && isImageUploadSlot(slot.slotKind)) {
      if (slot.max === 1) imagesBySlot[slotIndex] = [input.url]
      else imagesBySlot[slotIndex]!.push(input.url)
      continue
    }
    const storage = slot && referenceSlotStorage({ kind: slot.slotKind })
    if (storage) {
      if (storage.isArray) meta[storage.metaKey] = [...(Array.isArray(meta[storage.metaKey]) ? meta[storage.metaKey] as string[] : []), input.url]
      else meta[storage.metaKey] = input.url
    } else {
      const parameter = parameters.find(slot => (slot.mediaKind ?? 'image') === kind && slot.group === (role === 'first_frame' || role === 'last_frame' ? role : 'reference') && !meta[slot.key])
      if (parameter) Object.assign(meta, parameterReferenceMetaPatch(parameter, parameters, input.url))
    }
  }
  if (!slots.some((slot) => isImageUploadSlot(slot.slotKind))) return { ...node, meta }
  const placed = imagesBySlot.flat()
  const kinds = slots.map((slot) => slot.slotKind)
  const firstIndex = kinds.indexOf('first_frame')
  const lastIndex = kinds.indexOf('last_frame')
  const firstFrameEmpty = firstIndex >= 0 && lastIndex >= 0 && imagesBySlot[firstIndex]!.length === 0 && imagesBySlot[lastIndex]!.length > 0
  const keptUnused = placement.unused.filter((url) => !placed.includes(url))
  return { ...node, meta: withReferenceList(meta, [...placed, ...keptUnused], { firstFrameEmpty }) }
}

/** 节点自己参考槽里此刻摆着的值（当前生成方式的槽 + 参数图槽），不含连线带来的。 */
export function nodeOwnReferenceInputs(node: GenerationCanvasNode): NodeReferenceInput[] {
  const inputs: NodeReferenceInput[] = []
  for (const slot of resolveReferenceSlots(node, [], [])) {
    for (const fill of slot.fills) {
      if (fill.origin.type === 'upload' && fill.url) inputs.push({ url: fill.url, kind: referenceSlotAccept(slot.slotKind), role: referenceRoleOfSlot(slot.slotKind, slot.numbered) })
    }
  }
  for (const parameter of readParameterReferenceSlots(node.meta)) {
    const url = node.meta?.[parameter.key]
    if (typeof url === 'string' && url) inputs.push({ url, kind: parameter.mediaKind ?? 'image', role: parameter.group })
  }
  return inputs
}

/** 连到 `target` 的线此刻带来的参考（按 `target` 当前生成方式落槽）。源还没出图的不收：此刻发不出去，也不说会发。 */
function edgeReferenceInputs(
  target: GenerationCanvasNode,
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): NodeReferenceInput[] {
  const inputs: NodeReferenceInput[] = []
  for (const slot of resolveReferenceSlots(target, nodes as GenerationCanvasNode[], edges as GenerationCanvasEdge[])) {
    for (const fill of slot.fills) {
      if (fill.origin.type !== 'edge' || !fill.url) continue
      inputs.push({ url: fill.url, kind: referenceSlotAccept(slot.slotKind), role: referenceRoleOfSlot(slot.slotKind, slot.numbered) })
    }
  }
  return inputs
}

/** 节点此刻在用的所有参考地址（连线 + 自己槽里的值）。 */
function nodeReferenceUrls(target: GenerationCanvasNode, nodes: readonly GenerationCanvasNode[], edges: readonly GenerationCanvasEdge[]): Set<string> {
  return new Set([...edgeReferenceInputs(target, nodes, edges), ...nodeOwnReferenceInputs(target)].map((input) => input.url))
}

export type ReferenceProjection = Readonly<{
  /** 节点参考槽的新值（只有要补进槽里的才有）。 */
  meta?: Record<string, unknown>
  /** 要补的真边：参考就是画布上某个节点出的图，就连那个节点，不把它的地址抄进槽里（抄进去就是一条「本该是边」的孤儿）。 */
  connect: readonly Readonly<{ sourceNodeId: string; mode: GenerationCanvasEdgeMode }>[]
}>

/**
 * 宿主候选里的参考 → 画布占位节点要补什么（落地回写：卡上带参考生成之后，画布节点的参考槽里看得见它们）。
 *
 * **只补不删**：节点上已经有的（连线或槽里的值，按地址认）原样留着；候选里没有、节点上有的也留着——
 * 卡上拿掉画布上那张只改卡、不动画布（付费卡第 8 行），这里不替用户删画布上的东西。
 * 补进槽里之前先问「补完之后按什么摆」（`effectiveArchetypeModeWithInputs`，和发送时现算方式同一个 owner），按那个摆法落格：
 * 节点此刻是文字生成（文生图）时，补进去的参考不会因为没有格子被悄悄丢掉；不往节点里写方式。
 */
export function planReferenceProjection(
  target: GenerationCanvasNode,
  references: readonly CandidateReferenceInput[],
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): ReferenceProjection {
  const present = nodeReferenceUrls(target, nodes, edges)
  const uploads: CandidateReferenceInput[] = []
  const connect: Array<{ sourceNodeId: string; mode: GenerationCanvasEdgeMode }> = []
  for (const reference of references) {
    if (!reference.url || present.has(reference.url)) continue
    present.add(reference.url)
    const source = nodes.find((node) => node.id !== target.id && resultUrl(node.result) === reference.url)
    if (source) connect.push({ sourceNodeId: source.id, mode: edgeModeForReferenceRole(reference.role) })
    else uploads.push(reference)
  }
  if (!uploads.length) return { connect }
  const own = nodeOwnReferenceInputs(target)
  const archetype = archetypeForNode(target)
  // 节点自己的上传已在 target 里算过一次，这里只加新补的那几件。
  const layout = archetype
    ? effectiveArchetypeModeWithInputs(archetype, target, { nodes, edges }, uploads.map((input) => referenceDemandForRole(input.role, input.kind))).mode
    : undefined
  const placed = placeReferenceInputs(target, [...own, ...uploads], layout)
  return { meta: placed.meta ?? {}, connect }
}
