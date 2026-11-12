// 「切过去再切回来」「换模型」之后**真正发出去的东西**：方式问唯一 owner（effectiveArchetypeMode，按输入现算），
// 请求体走发送路径的同一个构造函数 buildArchetypeInputParams，看参考张数和角色（首帧 / 尾帧 / 参考图）对不对。
// （验收阻断 1、2：界面上看着对、发出去却少了图，用户照样被扣钱。）
import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import { resolveArchetypeForModel, type ModelArchetype } from '../../../../../electron/shared/modelArchetypes'
import { createGenerationNode } from '../../model/graphOps'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { buildNodeModelChangePatch } from '../buildNodeModelChangePatch'
import { applyHumanModeChoice, buildArchetypeInputParams, effectiveArchetypeMode } from './archetypeMeta'

const seedance = resolveArchetypeForModel({ modelKey: 'seedance-2', vendorKey: 'apimart', meta: {} } as never)!

/** 底栏方式菜单：只写偏好（参考列表不动）。 */
const choose = (meta: Record<string, unknown>, spec: ModelArchetype, modeId: string) => applyHumanModeChoice(meta, spec, modeId)
/** 这次真按哪种方式发：只有上传图、没有连线的节点问唯一 owner。 */
function sendMode(meta: Record<string, unknown>, spec: ModelArchetype) {
  const node = { id: 'v', kind: 'video', meta } as GenerationCanvasNode
  return effectiveArchetypeMode(spec, node, { nodes: [node], edges: [] }).mode
}
const body = (meta: Record<string, unknown>, spec: ModelArchetype) => buildArchetypeInputParams(meta, sendMode(meta, spec), {})
/** 请求体里出现的所有图片地址（不管它放在哪个键、什么形状里）。 */
function imagesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === 'string') { if (/^(a|b|c|u\d+)$/.test(value)) found.add(value) }
  else if (Array.isArray(value)) value.forEach((item) => imagesIn(item, found))
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => imagesIn(item, found))
  return found
}

describe('选方式之后发出去的请求', () => {
  const three = { archetype: { id: seedance.id, modeId: 'omni' }, referenceImageUrls: ['a', 'b', 'c'] }
  const two = { archetype: { id: seedance.id, modeId: 'omni' }, referenceImageUrls: ['a', 'b'] }

  it('参考方式：三张都在参考图里发出去', () => {
    expect(body(three, seedance).reference_image_urls).toEqual(['a', 'b', 'c'])
  })

  it('两张选首尾帧：首帧 a、尾帧 b（角色对）', () => {
    const sent = body(choose(two, seedance, 'firstlast'), seedance)
    expect(sent).toMatchObject({ first_frame_url: 'a', last_frame_url: 'b' })
    expect([...imagesIn(sent)].sort()).toEqual(['a', 'b'])
  })

  it('三张时首尾帧放不下：选了也不生效，照全能参考把三张都发出去（一张不少）', () => {
    expect(body(choose(three, seedance, 'firstlast'), seedance)).toEqual(body(three, seedance))
  })

  it('再切回参考：和切之前发出去的完全一样（一张不少）', () => {
    const back = choose(choose(two, seedance, 'firstlast'), seedance, 'omni')
    expect(body(back, seedance)).toEqual(body(two, seedance))
  })
})

describe('换模型之后发出去的请求（上传的首尾帧）', () => {
  const option = (modelKey: string): ModelOption => ({ value: modelKey, modelKey, vendor: 'apimart', label: modelKey, kind: 'video' } as ModelOption)
  const swap = (modelKey: string, chosenBy?: 'human') => {
    const archetype = { id: 'seedance-2', modeId: 'firstlast', ...(chosenBy ? { modeChosenBy: chosenBy } : {}) }
    const node = { ...createGenerationNode({ id: 'v', kind: 'video' }), meta: { modelKey: 'seedance-2', modelVendor: 'apimart', vendor: 'apimart', archetype, firstFrameUrl: 'a', lastFrameUrl: 'b' } }
    const meta = buildNodeModelChangePatch({ node, nodes: [node], edges: [], modelOptions: [option('seedance-2'), option(modelKey)], value: modelKey, vendor: 'apimart' }).meta
    return { meta, spec: resolveArchetypeForModel({ modelKey, vendorKey: 'apimart', meta: {} } as never)! }
  }

  it.each(['wan-2.7', 'veo-3.1', 'kling-3.0', 'grok-imagine-1.5-video'])('换到 %s：两张图都在发出去的请求里（不会掉成纯文生）', (modelKey) => {
    const { meta, spec } = swap(modelKey)
    expect(sendMode(meta, spec).intent).not.toBe('text')
    expect([...imagesIn(body(meta, spec))].sort()).toEqual(['a', 'b'])
  })

  // 方式按输入现算（2026-11-12）：人手在方式菜单里选过首尾帧 → 换模型带过去，按首尾帧发、首尾顺序不乱。
  it('Veo 3.1 · 人手选过首尾帧：按「首尾帧」类型发，两张图按首、尾的顺序', () => {
    const { meta, spec } = swap('veo-3.1', 'human')
    expect(body(meta, spec)).toMatchObject({ generation_type: 'frame', image_urls: ['a', 'b'] })
  })

  // 老项目存的首尾帧来历不明，换模型不带（carryHumanModePreference）：新模型按输入现算，两张图按参考发、一张不少。
  it('Veo 3.1 · 老项目存的首尾帧：不带偏好，按参考发，两张图都在、顺序不乱', () => {
    const { meta, spec } = swap('veo-3.1')
    expect(body(meta, spec)).toMatchObject({ generation_type: 'reference', image_urls: ['a', 'b'] })
  })
})
