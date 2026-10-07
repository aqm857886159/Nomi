import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { SpendReferenceInput } from '../../../../electron/shared/contracts/pendingSpendConfirm'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { resolveReferenceSlots } from '../../generationCanvas/runner/referenceSlots'
import { applyArchetypeModeSwitch, referenceSlotAccept } from '../../generationCanvas/nodes/controls/archetypeMeta'
import { archetypeForNode, referenceDemandForRole, resolveModeForConnectedReferences } from '../../generationCanvas/agent/referenceEdgeCapability'
import { findNodeResultUrl } from '../../generationCanvas/runner/referenceUrl'
import { readParameterReferenceSlots } from '../../generationCanvas/model/parameterReferenceSlots'
import { edgeReferenceInputs, nodeOwnReferenceInputs, placeReferenceInputs, referenceRoleOfSlot, type NodeReferenceInput, type ReferenceRole } from '../../generationCanvas/model/referenceInputSlots'

export function pendingReferenceInputs(shot: PendingSpendShot): SpendReferenceInput[] {
  return (shot.references ?? []).map(({ url, ...reference }) => ({ reference, ...(url ? { url } : {}) }))
}

/** 画布那一份图（只读）：卡上这一镜的占位节点此刻连着什么。 */
export type SpendCanvasGraph = Readonly<{ nodes: readonly GenerationCanvasNode[]; edges: readonly GenerationCanvasEdge[] }>

/**
 * 卡上这一镜默认摆出来的参考 = 宿主那一镜自己的 ∪ 画布上这一镜的占位节点（`placedId`）带着的（同一张图不重复放）。
 * 画布那一份两样都算，和画布自己生成时读的是同一份（付费卡第 4 条：卡上所见即所发 = 画布上摆着的）：
 *   · 连到占位节点的线（按卡这张框对齐后的生成方式落槽，`edgeReferenceInputs`）；源还没出图的不收——此刻发不出去，也不说会发；
 *   · 占位节点**自己参考槽里**摆着的值（画布上往「首帧」那一格选了一张素材、或落地回写进去的，`nodeOwnReferenceInputs`）。
 *     以前只收连线：画布节点上看得见的那张，卡上没有，也没发出去——花钱出的是不带它的图。
 *
 * 生成方式按画布那一条规则对齐：宿主那一镜可能停在没有参考槽的模式上（文生图），画布上的参考图就摆不进卡、
 * 也发不出去（2026-10-02 pb02：卡上写「文生图」，供应商收到 0 张）。画布自己在连线、换模型、提交三处都用
 * `resolveModeForConnectedReferences` 把节点切到收得下这几条参考的模式（`applyArchetypeModeSwitch` 顺带把越界的参数夹回）；
 * 卡读同一对函数，不另写一条规则。卡上之后的改动（含拿掉这张、改回文生图）都相对这一份记，见 `candidatePatchFromNode`。
 *
 * 读画布只在这一处：画布上的参考进的是卡自己那张框的参考槽（和卡上传的同一种），卡那张框的 id 不是占位节点的 id
 * （见 `projectSpendNode`），所以卡体那件 composer 看不见、也够不着画布上的边。
 *
 * `kept` = 卡上这一镜还留着的参考（账本里记过这一镜的参考清单才有）。画布上有、却不在清单里的 = 用户在卡上拿掉了：
 * 这一次不发它，也不为它切生成方式——拿掉唯一那张，卡回到宿主那一镜原来的生成方式（文生图），不会停在一个空着必填槽的
 * 「图生图」上（第 8 行）。画布一根线、一格槽都不动。
 */
export function placeSpendReferences(
  node: GenerationCanvasNode,
  own: readonly SpendReferenceInput[],
  canvas?: SpendCanvasGraph,
  placedId?: string,
  kept?: ReadonlySet<string>,
): GenerationCanvasNode {
  if (!canvas || !placedId) return placeReferenceInputs(node, own)
  const nodesById = new Map(canvas.nodes.map((entry) => [entry.id, entry] as const))
  const keeps = (url: string): boolean => !kept || kept.has(url)
  const edges = kept
    ? canvas.edges.filter((edge) => edge.target !== placedId || keeps(findNodeResultUrl(nodesById, edge.source)))
    : canvas.edges
  const placed = nodesById.get(placedId)
  const placedOwn = placed ? nodeOwnReferenceInputs(placed).filter((input) => keeps(input.url)) : []
  const onCanvas = (candidate: GenerationCanvasNode): GenerationCanvasNode => ({ ...candidate, id: placedId })
  const modeId = resolveModeForConnectedReferences(onCanvas(node), canvas.nodes, edges, placedOwn.map((input) => referenceDemandForRole(input.role, input.kind)))
  const archetype = modeId ? archetypeForNode(node) : null
  const moded = modeId && archetype ? { ...node, meta: applyArchetypeModeSwitch({ ...(node.meta ?? {}) }, archetype, modeId) } : node
  const seen = new Set(own.map((input) => input.url).filter((url): url is string => Boolean(url)))
  const fromCanvas: NodeReferenceInput[] = []
  for (const input of [...edgeReferenceInputs(onCanvas(moded), canvas.nodes, edges), ...placedOwn]) {
    if (seen.has(input.url)) continue
    seen.add(input.url)
    fromCanvas.push(input)
  }
  return placeReferenceInputs(moded, [...own, ...fromCanvas])
}

export function referenceInputsFromNode(node: GenerationCanvasNode, shot: PendingSpendShot): SpendReferenceInput[] {
  const original = pendingReferenceInputs(shot)
  const inputs: SpendReferenceInput[] = []
  const append = (url: string, kind: 'image' | 'video' | 'audio', role: ReferenceRole) => {
    const retained = original.find(input => input.url === url && 'reference' in input && (input.reference.kind ?? kind) === kind
      && ((input.reference.role ?? role) === role || (['character', 'reference'].includes(role) && ['character', 'reference'].includes(input.reference.role ?? 'reference'))))
    const next = retained ?? { url, kind, role }
    if (!inputs.some(input => JSON.stringify(input) === JSON.stringify(next))) inputs.push(next)
  }
  for (const slot of resolveReferenceSlots(node, [], [])) {
    for (const fill of slot.fills) if (fill.url) append(fill.url, referenceSlotAccept(slot.slotKind), referenceRoleOfSlot(slot.slotKind, slot.numbered))
  }
  for (const parameter of readParameterReferenceSlots(node.meta)) {
    const url = node.meta?.[parameter.key]
    if (typeof url === 'string' && url) append(url, parameter.mediaKind ?? 'image', parameter.group)
  }
  // Unavailable previews cannot be implicitly deleted by an unrelated parameter edit.
  const slots = resolveReferenceSlots(node, [], [])
  const parameters = readParameterReferenceSlots(node.meta)
  inputs.push(...original.filter(input => {
    if (!input.url) return true
    const reference = 'reference' in input ? input.reference : input
    const role = reference.role ?? 'reference'
    const kind = reference.kind ?? 'image'
    const matches = (candidate: string) => candidate === role || (['character', 'reference'].includes(role) && ['character', 'reference'].includes(candidate))
    return !slots.some(slot => slot.accept.includes(kind) && matches(referenceRoleOfSlot(slot.slotKind, slot.numbered)))
      && !parameters.some(parameter => (parameter.mediaKind ?? 'image') === kind && matches(parameter.group))
  }))
  return inputs
}
