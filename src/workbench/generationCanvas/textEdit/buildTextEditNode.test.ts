import { describe, expect, it } from 'vitest'
import { buildTextEditNodeSpec, buildTextEditPrompt } from './buildTextEditNode'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(patch: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return { id: 'src', kind: 'image', title: '海报', position: { x: 10, y: 20 }, ...patch }
}

describe('buildTextEditNodeSpec', () => {
  it('源节点无图 → null', () => {
    expect(buildTextEditNodeSpec(node({}))).toBeNull()
  })

  it('源节点有改图模型 → 照搬源模型 meta（含供应商）', () => {
    const spec = buildTextEditNodeSpec(node({
      result: { type: 'image', url: 'https://x/poster.png' },
      meta: { modelKey: 'seedream', modelVendor: 'apimart', vendor: 'apimart', modelLabel: 'Seedream' },
    }))
    expect(spec?.meta.modelKey).toBe('seedream')
    expect(spec?.meta.vendor).toBe('apimart')
    expect(spec?.references).toEqual(['https://x/poster.png'])
  })

  it('源节点无模型 → 回退到 nano-banana 改图档案，不钉死供应商', () => {
    const spec = buildTextEditNodeSpec(node({ result: { type: 'image', url: 'https://x/up.png' } }))
    expect(spec).not.toBeNull()
    expect(spec?.meta.vendor).toBeUndefined()
    expect(spec?.meta.modelVendor).toBeUndefined()
    expect(resolveArchetypeForModel({ modelKey: spec?.meta.modelKey as string })?.id).toBe('nano-banana')
    expect((spec?.meta.archetype as { modeId?: string })?.modeId).toBe('i2i')
  })

  it('标题派生 + 位置在源节点右侧', () => {
    const spec = buildTextEditNodeSpec(node({ title: '促销海报', result: { type: 'image', url: 'https://x/a.png' } }))
    expect(spec?.title).toBe('促销海报·改字')
    expect(spec?.position.x).toBeGreaterThan(10)
  })

  it('提示词模板含原文/新文字占位 + 保字体约束', () => {
    const p = buildTextEditPrompt()
    expect(p).toContain('原文')
    expect(p).toContain('新文字')
    expect(p).toContain('字体')
  })
})
