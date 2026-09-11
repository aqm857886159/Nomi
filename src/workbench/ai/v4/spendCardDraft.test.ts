// 覆写账本的语义（2026-09-11 用户拍板的那三条）：
//   ① 卡上改的东西**不落画布**，只落这份账本；
//   ② 「全部」改公共层、「逐镜」改这一镜层，**逐镜压全部**；
//   ③ 来回切模式两层都还在（不丢覆写）。
import { describe, expect, it } from 'vitest'
import type { PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import {
  applyPatchToNode,
  candidatePatchFromNode,
  draftAfterNodeEdit,
  draftIsEmpty,
  effectiveCandidate,
  effectivePatchForShot,
  revisionsForConfirm,
  EMPTY_SPEND_DRAFT,
} from './spendCardDraft'

function shot(id: string, overrides: Partial<PendingSpendShot> = {}): PendingSpendShot {
  return {
    shotId: id,
    nodeId: `node-${id}`,
    index: 1,
    prompt: '六棱柱',
    providerId: 'apimart',
    modelId: 'gpt-image-2',
    parameters: { size: '1024x1024', quality: 'standard' },
    price: { known: true, amount: 0.3 },
    ...overrides,
  }
}

function node(meta: Record<string, unknown>, prompt = '六棱柱'): GenerationCanvasNode {
  return { id: 'node-a', kind: 'image', position: { x: 0, y: 0 }, prompt, meta } as unknown as GenerationCanvasNode
}

describe('spendCardDraft', () => {
  it('节点 → 补丁只带候选认识的键，没改就没有补丁', () => {
    const base = shot('a')
    expect(candidatePatchFromNode(node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }), base))
      .toBeUndefined()
    const patch = candidatePatchFromNode(node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024', quality: 'standard', title: '别管我' }), base)
    expect(patch?.parameters).toEqual({ size: '1536x1024', quality: 'standard' })
    expect(patch).not.toHaveProperty('title')
  })

  it('补丁 → 节点与 节点 → 补丁 是同一张映射表的两个方向', () => {
    const base = shot('a')
    const patched = applyPatchToNode(
      node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }),
      { modelId: 'seedream', providerId: 'kie', modeId: 'omni', parameters: { size: '1536x1024' }, prompt: '换一句' },
    )
    expect(patched.meta).toMatchObject({ modelKey: 'seedream', modelVendor: 'kie', size: '1536x1024' })
    expect((patched.meta as { archetype: { modeId: string } }).archetype.modeId).toBe('omni')
    expect(patched.prompt).toBe('换一句')
    expect(candidatePatchFromNode(patched, base)).toMatchObject({
      modelId: 'seedream', providerId: 'kie', modeId: 'omni', prompt: '换一句',
    })
  })

  it('「逐镜」只改这一镜，别的镜一个字不动', () => {
    const shots = [shot('a', { nodeId: 'n-a' }), shot('b', { nodeId: 'n-b', index: 2 })]
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, shots[0],
      node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024', quality: 'standard' }), 'each')
    expect(effectivePatchForShot(draft, 'a').parameters).toEqual({ size: '1536x1024', quality: 'standard' })
    expect(effectivePatchForShot(draft, 'b')).toEqual({})
  })

  it('「全部」改公共层，每一镜都吃到', () => {
    const shots = [shot('a'), shot('b', { index: 2 })]
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, shots[0],
      node({ modelKey: 'seedream', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }), 'all')
    expect(effectivePatchForShot(draft, 'a').modelId).toBe('seedream')
    expect(effectivePatchForShot(draft, 'b').modelId).toBe('seedream')
  })

  it('逐镜覆写压全部，来回切模式两层都还在', () => {
    const first = shot('a')
    const second = shot('b', { index: 2 })
    // 先在「逐镜」里把 a 改成 seedream
    let draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, first,
      node({ modelKey: 'seedream', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }), 'each')
    // 再切「全部」把整批改成 nano-banana（视图此刻只叠公共层，所以基线是宿主那一份）
    draft = draftAfterNodeEdit(draft, first,
      node({ modelKey: 'nano-banana', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }), 'all')
    expect(effectivePatchForShot(draft, 'a').modelId, '逐镜层压在公共层上面').toBe('seedream')
    expect(effectivePatchForShot(draft, 'b').modelId, '没有逐镜覆写的镜吃公共层').toBe('nano-banana')
    expect(effectivePatchForShot(draft, 'a', 'all').modelId, '「全部」视图看到的是正在编辑的那一层').toBe('nano-banana')
  })

  it('有效候选 = 宿主那一镜 ⊕ 覆写；没被覆写的参数原样留着', () => {
    const base = shot('a')
    const candidate = effectiveCandidate(base, { modelId: 'seedream', parameters: { size: '1536x1024' } })
    expect(candidate).toEqual({
      providerId: 'apimart', modelId: 'seedream',
      parameters: { size: '1536x1024', quality: 'standard' },
    })
  })

  it('确认那一刻只发有改动的镜；限定 shotIds 时别的镜不发', () => {
    const shots = [shot('a'), shot('b', { index: 2 })]
    const draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, shots[1],
      node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024', quality: 'standard' }), 'each')
    expect(draftIsEmpty(draft)).toBe(false)
    expect(draftIsEmpty(EMPTY_SPEND_DRAFT)).toBe(true)
    expect(revisionsForConfirm(shots, draft).map((entry) => entry.shotId)).toEqual(['b'])
    expect(revisionsForConfirm(shots, draft, ['a'])).toEqual([])
  })

  it('改回原值等于没改：不留一个和原值相等的空覆写', () => {
    const base = shot('a')
    let draft = draftAfterNodeEdit(EMPTY_SPEND_DRAFT, base,
      node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1536x1024', quality: 'standard' }), 'each')
    expect(draftIsEmpty(draft)).toBe(false)
    draft = draftAfterNodeEdit(draft, base,
      node({ modelKey: 'gpt-image-2', modelVendor: 'apimart', size: '1024x1024', quality: 'standard' }), 'each')
    expect(draftIsEmpty(draft)).toBe(true)
  })
})
