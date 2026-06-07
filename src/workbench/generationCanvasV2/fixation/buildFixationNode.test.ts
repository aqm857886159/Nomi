import { describe, expect, it } from 'vitest'
import { buildFixationNodeSpec } from './buildFixationNode'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

function node(patch: Partial<GenerationCanvasNode>): GenerationCanvasNode {
  return { id: 'src', kind: 'image', title: '阿狸', position: { x: 0, y: 0 }, ...patch }
}

describe('buildFixationNodeSpec', () => {
  it('源节点无图 → null', () => {
    expect(buildFixationNodeSpec(node({}))).toBeNull()
  })

  it('源节点有模型 → 照搬源模型 meta（含供应商）', () => {
    const spec = buildFixationNodeSpec(node({
      result: { type: 'image', url: 'https://x/a.png' },
      meta: { modelKey: 'seedream', modelVendor: 'apimart', vendor: 'apimart', modelLabel: 'Seedream' },
    }))
    expect(spec?.meta.modelKey).toBe('seedream')
    expect(spec?.meta.vendor).toBe('apimart')
  })

  it('源节点无模型（上传图）→ 回退到 GPT Image 2 档案，但**不钉死任何供应商**（vendor 由运行/检查器解析）', () => {
    const spec = buildFixationNodeSpec(node({ result: { type: 'image', url: 'https://x/up.png' } }))
    expect(spec).not.toBeNull()
    // 不再硬编码 kie：回退 meta 不带任何供应商字段
    expect(spec?.meta.vendor).toBeUndefined()
    expect(spec?.meta.modelVendor).toBeUndefined()
    expect(spec?.meta.imageModelVendor).toBeUndefined()
    // modelKey 仍能解析到 gpt-image-2 档案（供应商无关）
    expect(resolveArchetypeForModel({ modelKey: spec?.meta.modelKey as string })?.id).toBe('gpt-image-2')
    expect((spec?.meta.archetype as { modeId?: string })?.modeId).toBe('i2i')
  })
})
