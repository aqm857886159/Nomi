import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { DERIVED_NODE_GAP, planDerivedNode, QUICK_ACTION_META_KEY, readQuickActionMeta } from './deriveFromNode'

const labels = { actionLabel: '多机位九宫格', formatTitle: (action: string, source: string) => `${action} · ${source}` }

function imageNode(over: Partial<GenerationCanvasNode> = {}): GenerationCanvasNode {
  return {
    id: 'src',
    kind: 'image',
    title: '雨夜街口',
    categoryId: 'shots',
    position: { x: 100, y: 40 },
    size: { width: 320, height: 180 },
    status: 'success',
    meta: { modelKey: 'gpt-image-2', modelVendor: 'apimart' },
    result: { id: 'r', type: 'image', url: 'nomi-local://asset/p/a.png', createdAt: 1 },
    ...over,
  } as GenerationCanvasNode
}

describe('planDerivedNode — 一键派生只规划，不写画布、不花钱', () => {
  it('新节点放在源右侧、连一条参考边、标题带出身', () => {
    const source = imageNode()
    const plan = planDerivedNode(source, { actionId: 'multi-angle-grid' }, labels)
    expect(plan.position).toEqual({ x: 100 + resolveNodeVisualSize(source).width + DERIVED_NODE_GAP, y: 40 })
    expect(plan.edge).toEqual({ sourceNodeId: 'src', mode: 'reference' })
    expect(plan.title).toBe('多机位九宫格 · 雨夜街口')
    expect(plan.categoryId).toBe('shots')
  })

  it('提示词只引用效果库条目，不在这里抄模板正文', () => {
    const plan = planDerivedNode(imageNode(), { actionId: 'three-view' }, labels)
    expect(plan.effectId).toBe('effect-character-three-view')
    expect(JSON.stringify(plan)).not.toMatch(/turnaround|正面|侧面/)
  })

  it('宫格类记下行列（出图后「切成 N 张」用），非宫格类不记', () => {
    expect(planDerivedNode(imageNode(), { actionId: 'multi-angle-grid' }, labels).meta.grid).toEqual({ rows: 3, cols: 3 })
    expect(planDerivedNode(imageNode(), { actionId: 'next-moment' }, labels).meta.grid).toBeUndefined()
  })

  it('沿用图片源的模型；非图片源（视频截帧场景）不硬套视频模型', () => {
    expect(planDerivedNode(imageNode(), { actionId: 'outpaint' }, labels).model).toEqual({ vendorKey: 'apimart', modelKey: 'gpt-image-2' })
    const video = imageNode({ kind: 'video', meta: { modelKey: 'seedance-2', modelVendor: 'apimart' } })
    expect(planDerivedNode(video, { actionId: 'outpaint' }, labels).model).toBeNull()
  })

  it('用户补充只在非空时带上；源没有标题时标题就是动作名', () => {
    expect(planDerivedNode(imageNode(), { actionId: 'next-moment', userSupplement: '  ' }, labels).userSupplement).toBeUndefined()
    expect(planDerivedNode(imageNode({ title: '' }), { actionId: 'next-moment' }, labels).title).toBe('多机位九宫格')
  })
})

describe('readQuickActionMeta', () => {
  it('读回派生记录；脏数据当没有', () => {
    const meta = { [QUICK_ACTION_META_KEY]: { id: 'multi-angle-grid', sourceNodeId: 'src', grid: { rows: 3, cols: 3 } } }
    expect(readQuickActionMeta({ meta })).toEqual({ id: 'multi-angle-grid', sourceNodeId: 'src', grid: { rows: 3, cols: 3 } })
    expect(readQuickActionMeta({ meta: { [QUICK_ACTION_META_KEY]: 'x' } })).toBeNull()
    expect(readQuickActionMeta({ meta: { [QUICK_ACTION_META_KEY]: { id: 'next-moment', sourceNodeId: 'src', grid: { rows: 'a' } } } }))
      .toEqual({ id: 'next-moment', sourceNodeId: 'src' })
  })
})
