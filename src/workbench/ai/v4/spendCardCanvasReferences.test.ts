// 付费卡第 4 条：画布上连到这一镜占位节点的参考图算数——卡上看得见，确认时发出去；卡上拿掉就不发，画布连线不动。
import { describe, expect, it } from 'vitest'
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import { applyPatchToNode, candidatePatchFromNode, draftAfterNodeEdit, effectivePatchForShot, EMPTY_SPEND_DRAFT, keptReferenceUrls, projectSpendNode, type SpendDraft } from './spendCardDraft'
import { referenceInputsFromNode } from './spendCardReferences'
import { edgeReferenceInputs } from '../../generationCanvas/model/referenceInputSlots'
import { decideArrayReferenceRemoval, resolveReferenceSlots } from '../../generationCanvas/runner/referenceSlots'
import { referenceSlotStorage } from '../../generationCanvas/nodes/controls/archetypeMeta'

const REF_URL = 'nomi-local://asset/project-1/ref-cat.png'

const shot: PendingSpendShot = {
  shotId: 'shot-2', nodeId: 'node-2', index: 2, prompt: '清晨的渔港', providerId: 'apimart', modelId: 'doubao-seedance-2.0',
  kind: 'video', modeId: 'omni', variantId: 'fast', parameters: { resolution: '480p', duration: 4 }, price: { known: false },
}

/** 宿主那一镜停在没有参考槽的模式上（pb02：Agent 起草的图片镜头是「文生图」）。 */
const textOnlyShot: PendingSpendShot = {
  shotId: 'shot-1', nodeId: 'node-1', index: 1, prompt: '同一个人站在黄昏的海边，逆光', providerId: 'apimart', modelId: 'gpt-image-2',
  kind: 'image', parameters: { aspect_ratio: '1:1' }, price: { known: false },
}

/** 画布上那一镜的占位节点（同一个模型档案），一张图片节点连到它。 */
function canvas(target: PendingSpendShot = shot): { placed: GenerationCanvasNode; nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[] } {
  const card = projectSpendNode(target)!
  const placed = { ...card, id: target.nodeId!, position: { x: 400, y: 0 } } as GenerationCanvasNode
  const image = { id: 'img-1', kind: 'image', position: { x: 0, y: 0 }, prompt: '', status: 'success',
    result: { id: 'r1', type: 'image', url: REF_URL, createdAt: 1 }, meta: {} } as unknown as GenerationCanvasNode
  const edge = { id: 'e-1', source: 'img-1', target: target.nodeId } as unknown as GenerationCanvasEdge
  return { placed, nodes: [image, placed], edges: [edge] }
}

const modeOf = (node: GenerationCanvasNode) => (node.meta as { archetype?: { modeId?: string } }).archetype?.modeId
const urlsOn = (node: GenerationCanvasNode, target: PendingSpendShot) => referenceInputsFromNode(node, target).map((input) => input.url)

/** 卡上此刻摆着的那张框 = 默认那张 ⊕ 账本里这一镜的改动（`useAgentPanelSpendConfirm.shownNodeFor` 的同一个算法）。 */
function shown(target: PendingSpendShot, graph: ReturnType<typeof canvas>, draft: SpendDraft): GenerationCanvasNode {
  const patch = effectivePatchForShot(draft, target.shotId)
  return applyPatchToNode(projectSpendNode(target, graph.placed, undefined, graph, keptReferenceUrls(patch))!, patch)
}

describe('付费卡 · 画布连线带来的参考图', () => {
  it('卡上摆出画布连到这一镜的参考图，确认时它在发出去的那一份里（第 7 行）', () => {
    const graph = canvas()
    expect(edgeReferenceInputs(graph.placed, graph.nodes, graph.edges).map((input) => input.url)).toEqual([REF_URL])
    const card = projectSpendNode(shot, graph.placed, undefined, graph)!
    expect(urlsOn(card, shot), '卡上看得见这张参考图').toContain(REF_URL)
    const sent = candidatePatchFromNode(card, shot)
    expect(sent?.referenceInputs?.map((input) => input.url), '确认时发出去的就是卡上那一份').toEqual([REF_URL])
  })

  it('宿主那一镜是「文生图」：卡按画布那条规则切到收得下这张图的模式，摆出来、照发（pb02）', () => {
    const graph = canvas(textOnlyShot)
    const card = projectSpendNode(textOnlyShot, graph.placed, undefined, graph)!
    expect(modeOf(card), '卡上的生成方式跟着画布连线切到图生图').toBe('i2i')
    expect(urlsOn(card, textOnlyShot), '卡上看得见这张参考图').toEqual([REF_URL])
    const sent = candidatePatchFromNode(card, textOnlyShot)
    expect(sent?.modeId, '发给宿主的是卡上那个生成方式').toBe('i2i')
    expect(sent?.referenceInputs?.map((input) => input.url), '供应商收到这张参考图').toEqual([REF_URL])
    // 没有画布连线时还是宿主那一份，卡不自己改生成方式。
    expect(modeOf(projectSpendNode(textOnlyShot, graph.placed, undefined, { nodes: graph.nodes, edges: [] })!)).toBe('t2i')
  })

  it('卡上拿掉这张参考图：账本记得住，卡上不再摆它，发出去的那一份里没有它；画布连线一根不动（第 8 行）', () => {
    const graph = canvas()
    const before = JSON.stringify(graph.edges)
    const card = projectSpendNode(shot, graph.placed, undefined, graph)!
    const removed = applyPatchToNode(card, { referenceInputs: [] })
    // 卡上点掉那一下：相对他动手之前那张框记进账本（`draftAfterNodeEdit` 的 baseline）。
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, shot, removed, undefined, card)
    const next = shown(shot, graph, draft)
    expect(urlsOn(next, shot), '下一拍卡上还是没有它（画布那一份不会自己摆回来）').not.toContain(REF_URL)
    const sent = candidatePatchFromNode(next, shot)
    expect(sent?.referenceInputs ?? [], '供应商收到 0 张参考图').toEqual([])
    expect(JSON.stringify(graph.edges), '画布上的连线没动').toBe(before)
  })

  it('宿主那一镜是「文生图」、卡上拿掉画布连来的唯一那张：卡回到文生图，发出去的是文生图、不带参考，画布连线不动（第 8 行）', () => {
    const graph = canvas(textOnlyShot)
    const before = JSON.stringify(graph.edges)
    const card = projectSpendNode(textOnlyShot, graph.placed, undefined, graph)!
    expect(modeOf(card)).toBe('i2i')
    const removed = applyPatchToNode(card, { referenceInputs: [] })
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, textOnlyShot, removed, undefined, card)
    const next = shown(textOnlyShot, graph, draft)
    expect(modeOf(next), '不停在一个空着必填槽的图生图上').toBe('t2i')
    expect(urlsOn(next, textOnlyShot)).toEqual([])
    const sent = candidatePatchFromNode(next, textOnlyShot)
    expect(sent?.referenceInputs ?? [], '供应商收到 0 张参考图').toEqual([])
    expect(sent?.modeId === undefined || sent.modeId === 't2i').toBe(true)
    expect(JSON.stringify(graph.edges), '画布上的连线没动').toBe(before)
  })

  it('卡上把对齐过的生成方式改回文生图：账本记得住，发出去的是文生图、不带参考', () => {
    const graph = canvas(textOnlyShot)
    const card = projectSpendNode(textOnlyShot, graph.placed, undefined, graph)!
    const back = applyPatchToNode(card, { modeId: 't2i' })
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, textOnlyShot, back, undefined, card)
    expect(effectivePatchForShot(draft, textOnlyShot.shotId).modeId, '这一下记进账本了').toBe('t2i')
    const next = shown(textOnlyShot, graph, draft)
    expect(modeOf(next)).toBe('t2i')
    expect(urlsOn(next, textOnlyShot)).toEqual([])
    const sent = candidatePatchFromNode(next, textOnlyShot)
    expect(sent?.referenceInputs ?? [], '文生图不带参考').toEqual([])
    expect(sent?.modeId === undefined || sent.modeId === 't2i').toBe(true)
  })

  it('卡上只改了提示词：画布连来的参考图和对齐后的生成方式照旧，账本里只有那句话', () => {
    const graph = canvas(textOnlyShot)
    const card = projectSpendNode(textOnlyShot, graph.placed, undefined, graph)!
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, textOnlyShot, { ...card, prompt: '换一句' }, undefined, card)
    expect(effectivePatchForShot(draft, textOnlyShot.shotId)).toEqual({ prompt: '换一句' })
    const next = shown(textOnlyShot, graph, draft)
    expect(modeOf(next)).toBe('i2i')
    expect(urlsOn(next, textOnlyShot)).toEqual([REF_URL])
  })

  it('卡那张框不是画布上的占位节点：卡体 composer 点 × 拿掉画布连来的那张，只删卡自己的参考槽，不断画布的边（第 8 行）', () => {
    const graph = canvas(textOnlyShot)
    const card = projectSpendNode(textOnlyShot, graph.placed, undefined, graph)!
    expect(card.id, '卡那张框有自己的 id').not.toBe(textOnlyShot.nodeId)
    // composer 读的是同一张画布（store 里的 nodes / edges），按这张框的 id 找边：一条都不是它的。
    const slots = resolveReferenceSlots(card, graph.nodes, graph.edges)
    const fills = slots.flatMap((slot) => slot.fills)
    expect(fills.map((fill) => fill.url), '卡上摆着画布连来的那张').toEqual([REF_URL])
    expect(fills.every((fill) => fill.origin.type === 'upload'), '它在卡自己的参考槽里，不是一条画布的边').toBe(true)
    const metaKey = referenceSlotStorage({ kind: slots[0]!.slotKind })!.metaKey
    // 点 × 的那一刻 composer 按这一项的来源决定怎么删（decideArrayReferenceRemoval，画布与卡共用）：只删卡上的值。
    expect(decideArrayReferenceRemoval(card, graph.nodes, graph.edges, metaKey, 0)).toEqual({ kind: 'remove-upload', url: REF_URL })
  })

  it('连了线但源还没出图：此刻发不出去，卡上也不说会发', () => {
    const { placed, nodes, edges } = canvas()
    const pendingSource = nodes.map((node) => node.id === 'img-1' ? { ...node, result: undefined, status: 'idle' } as unknown as GenerationCanvasNode : node)
    expect(edgeReferenceInputs(placed, pendingSource, edges)).toEqual([])
  })

  it("占位节点自己参考槽里摆着的那张（画布上往格子里选的素材，没有连线）：卡上看得见、照发；卡上拿掉就不发，画布那一格不动", () => {
    const graph = canvas(textOnlyShot)
    const metaKey = referenceSlotStorage({ kind: "image_ref" })!.metaKey
    const placed = { ...graph.placed, meta: { ...graph.placed.meta, archetype: { id: "gpt-image-2", modeId: "i2i" }, [metaKey]: [REF_URL] } } as GenerationCanvasNode
    const own = { placed, nodes: [graph.nodes[0]!, placed], edges: [] as GenerationCanvasEdge[] }
    const before = JSON.stringify(placed.meta)
    const card = projectSpendNode(textOnlyShot, placed, undefined, own)!
    expect(modeOf(card), "卡按画布那条规则切到收得下它的生成方式").toBe("i2i")
    expect(urlsOn(card, textOnlyShot), "卡上看得见它").toEqual([REF_URL])
    expect(candidatePatchFromNode(card, textOnlyShot)?.referenceInputs?.map((input) => input.url), "点生成时发出去").toEqual([REF_URL])
    const removed = applyPatchToNode(card, { referenceInputs: [] })
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, textOnlyShot, removed, undefined, card)
    const next = shown(textOnlyShot, own, draft)
    expect(urlsOn(next, textOnlyShot), "卡上拿掉之后不再摆").toEqual([])
    expect(candidatePatchFromNode(next, textOnlyShot)?.referenceInputs ?? [], "不发").toEqual([])
    expect(JSON.stringify(placed.meta), "画布那一格没动").toBe(before)
  })
})
