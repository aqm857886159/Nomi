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
      result: { id: 'r1', type: 'image', url: 'https://x/a.png', createdAt: 0 },
      meta: { modelKey: 'seedream', modelVendor: 'apimart', vendor: 'apimart', modelLabel: 'Seedream' },
    }))
    expect(spec?.meta.modelKey).toBe('seedream')
    expect(spec?.meta.vendor).toBe('apimart')
  })

  it('源节点无模型（上传图）→ 回退到 GPT Image 2 档案，但**不钉死任何供应商**（vendor 由运行/检查器解析）', () => {
    const spec = buildFixationNodeSpec(node({ result: { id: 'r2', type: 'image', url: 'https://x/up.png', createdAt: 0 } }))
    expect(spec).not.toBeNull()
    // 不再硬编码 kie：回退 meta 不带任何供应商字段
    expect(spec?.meta.vendor).toBeUndefined()
    expect(spec?.meta.modelVendor).toBeUndefined()
    expect(spec?.meta.imageModelVendor).toBeUndefined()
    // modelKey 仍能解析到 gpt-image-2 档案（供应商无关）
    expect(resolveArchetypeForModel({ modelKey: spec?.meta.modelKey as string, vendorKey: null })?.id).toBe('gpt-image-2')
    expect((spec?.meta.archetype as { modeId?: string })?.modeId).toBe('i2i')
  })

  it('派生节点从角色卡真实右边缘落点，不使用名义宽度', () => {
    const spec = buildFixationNodeSpec(node({
      kind: 'character',
      size: { width: 300, height: 190 },
      result: { id: 'r3', type: 'image', url: 'https://x/character.png', createdAt: 0 },
    }))

    expect(spec?.position.x).toBe(264)
  })
})
