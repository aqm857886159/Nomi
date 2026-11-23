// 宿主候选里的参考 → 画布占位节点要补什么（落地回写）。只补不删；画布上已有的图补真边，不抄地址进槽。
import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'
import { nodeOwnReferenceInputs, planReferenceProjection } from './referenceInputSlots'
import { findOrphanArrayReferences, resolveReferenceSlots } from '../runner/referenceSlots'
import { effectiveArchetypeMode } from '../nodes/controls/archetypeMeta'
import { archetypeForNode } from '../agent/referenceEdgeCapability'

const CANVAS = 'nomi-local://asset/p/assets/canvas.png'
const UPLOAD = 'nomi-local://asset/p/assets/upload.png'
const USER_OWN = 'nomi-local://asset/p/assets/user-own.png'
const STORE = 'nomi-local://asset/p/assets/store.png'
const XIAOLIN = 'nomi-local://asset/p/assets/xiaolin.png'

function target(meta: Record<string, unknown> = {}): GenerationCanvasNode {
  return { id: 'shot', kind: 'image', title: '', prompt: '', position: { x: 0, y: 0 },
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart', archetype: { id: 'gpt-image-2', modeId: 't2i' }, ...meta } } as GenerationCanvasNode
}
const source = { id: 'src', kind: 'image', title: '猫', prompt: '', position: { x: 0, y: 0 }, status: 'success',
  result: { id: 'r', type: 'image', url: CANVAS, createdAt: 1 } } as unknown as GenerationCanvasNode
const urlsOn = (node: GenerationCanvasNode, nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[]) =>
  resolveReferenceSlots(node, nodes, edges).flatMap((slot) => slot.fills.map((fill) => fill.url))

describe('planReferenceProjection（落地回写画布节点的参考）', () => {
  it('参考是画布上某个节点出的图：补一条真边，不把地址抄进参考槽（抄进去就是一条「本该是边」的孤儿）', () => {
    const node = target()
    const plan = planReferenceProjection(node, [{ url: CANVAS, kind: 'image', role: 'reference' }], [source, node], [])
    expect(plan.connect).toEqual([{ sourceNodeId: 'src', mode: 'reference' }])
    expect(plan.meta).toBeUndefined()
  })

  it('其余参考补进参考槽：节点停在文生图时按画布那条规则切到收得下它的模式，不因为没有格子悄悄丢掉', () => {
    const node = target()
    const plan = planReferenceProjection(node, [{ url: UPLOAD, kind: 'image', role: 'reference' }], [node], [])
    const after = { ...node, meta: plan.meta }
    expect(urlsOn(after, [after], [])).toEqual([UPLOAD])
    expect(findOrphanArrayReferences([after], []), '不是画布产物的地址，留在槽里不算孤儿').toEqual([])
  })

  it('只补不删：节点上已有的（连线 / 用户自己放进槽里的）原样留着，已经在的不重复补', () => {
    const node = target({ archetype: { id: 'gpt-image-2', modeId: 'i2i' } })
    const withOwn = { ...node, meta: { ...node.meta, referenceImageUrls: [USER_OWN] } } as GenerationCanvasNode
    const edges: GenerationCanvasEdge[] = [{ id: 'e', source: 'src', target: 'shot', mode: 'reference' }]
    const plan = planReferenceProjection(withOwn, [
      { url: CANVAS, kind: 'image', role: 'reference' },
      { url: UPLOAD, kind: 'image', role: 'reference' },
    ], [source, withOwn], edges)
    expect(plan.connect, '那条线已经在').toEqual([])
    const after = { ...withOwn, meta: plan.meta }
    expect(nodeOwnReferenceInputs(after).map((input) => input.url)).toEqual([USER_OWN, UPLOAD])
    expect(urlsOn(after, [source, after], edges)).toEqual([CANVAS, USER_OWN, UPLOAD])
  })

  it('候选里一张都没有节点上缺的：什么都不动', () => {
    const node = target({ archetype: { id: 'gpt-image-2', modeId: 'i2i' }, referenceImageUrls: [UPLOAD] })
    expect(planReferenceProjection(node, [{ url: UPLOAD, kind: 'image', role: 'reference' }], [node], [])).toEqual({ connect: [] })
  })

  it('P21 首尾帧：素材库两张无 role 图片落进 firstlast 节点，首帧与尾帧两格都有（不再静默丢成 []）', () => {
    const firstlastNode: GenerationCanvasNode = {
      id: 'shot-firstlast', kind: 'video', title: '便利店到小林', prompt: '推进镜头', position: { x: 0, y: 0 },
      meta: {
        modelKey: 'doubao-seedance-2.0',
        modelVendor: 'apimart',
        archetype: { id: 'seedance-2-apimart', modeId: 'firstlast', variantId: 'fast' },
      },
    } as GenerationCanvasNode
    const plan = planReferenceProjection(
      firstlastNode,
      [{ url: STORE, kind: 'image' }, { url: XIAOLIN, kind: 'image' }],
      [firstlastNode],
      [],
    )
    expect(plan.connect).toEqual([])
    expect(plan.meta?.referenceImageUrls).toEqual([STORE, XIAOLIN])
    const after = { ...firstlastNode, meta: plan.meta }
    const resolved = resolveReferenceSlots(after, [after], [])
    expect(resolved.find((slot) => slot.slotKind === 'first_frame')?.fills.map((fill) => fill.url)).toEqual([STORE])
    expect(resolved.find((slot) => slot.slotKind === 'last_frame')?.fills.map((fill) => fill.url)).toEqual([XIAOLIN])
    const archetype = archetypeForNode(after)!
    expect(effectiveArchetypeMode(archetype, after, { nodes: [after], edges: [] }).mode.id).toBe('firstlast')
  })

  it('首尾帧显式 role 优先占对应格，无 role 图片依次落剩余空格', () => {
    const firstlastNode: GenerationCanvasNode = {
      id: 'shot-firstlast-role', kind: 'video', title: '显式首帧优先', prompt: '推进镜头', position: { x: 0, y: 0 },
      meta: {
        modelKey: 'doubao-seedance-2.0',
        modelVendor: 'apimart',
        archetype: { id: 'seedance-2-apimart', modeId: 'firstlast', variantId: 'fast' },
      },
    } as GenerationCanvasNode
    const plan = planReferenceProjection(
      firstlastNode,
      [{ url: XIAOLIN, kind: 'image' }, { url: STORE, kind: 'image', role: 'first_frame' }],
      [firstlastNode],
      [],
    )
    const after = { ...firstlastNode, meta: plan.meta }
    const resolved = resolveReferenceSlots(after, [after], [])
    expect(resolved.find((slot) => slot.slotKind === 'first_frame')?.fills.map((fill) => fill.url)).toEqual([STORE])
    expect(resolved.find((slot) => slot.slotKind === 'last_frame')?.fills.map((fill) => fill.url)).toEqual([XIAOLIN])
  })

  it('反例 C：画布人手建空视频卡并切到 firstlast 且未连图，不报错也不删卡', () => {
    const emptyCard: GenerationCanvasNode = {
      id: 'manual-empty', kind: 'video', title: '手建空卡', prompt: '', position: { x: 0, y: 0 },
      meta: {
        modelKey: 'doubao-seedance-2.0',
        modelVendor: 'apimart',
        archetype: { id: 'seedance-2-apimart', modeId: 'firstlast' },
      },
    } as GenerationCanvasNode
    expect(planReferenceProjection(emptyCard, [], [emptyCard], [])).toEqual({ connect: [] })
    expect(() => resolveReferenceSlots(emptyCard, [emptyCard], [])).not.toThrow()
  })
})
