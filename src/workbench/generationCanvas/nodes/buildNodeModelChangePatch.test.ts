import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { EVERY_VARIANT, resolveModelArchetype } from '../../../../electron/shared/modelArchetypes'
import { buildNodeModelChangePatch } from './buildNodeModelChangePatch'
import { archetypeForNode } from '../agent/referenceEdgeCapability'
import { effectiveArchetypeMode } from './controls/archetypeMeta'

/** 换完模型这次真按哪种方式发（方式按输入现算，换模型不替节点挑方式，2026-11-12）。 */
function sendModeAfter(node: GenerationCanvasNode, meta: Record<string, unknown>, nodes: GenerationCanvasNode[], edges: GenerationCanvasEdge[]) {
  const next = { ...node, meta }
  return effectiveArchetypeMode(archetypeForNode(next)!, next, { nodes: nodes.map((item) => (item.id === node.id ? next : item)), edges }).mode
}

function option(partial: Partial<ModelOption> & Pick<ModelOption, 'value' | 'label'>): ModelOption {
  return partial
}

describe('buildNodeModelChangePatch', () => {
  it('projects ordered reference declarations with the selected model identity and replaces stale declarations', () => {
    const node = createGenerationNode({ id: 'video', kind: 'video' })
    const next = option({ value: 'three', vendor: 'custom', label: 'Three', meta: {
      parameters: ['a', 'b', 'c'].map((key) => ({ key, label: key, type: 'image-url' })),
    } })
    const patch = buildNodeModelChangePatch({ node, nodes: [node], edges: [], modelOptions: [next], value: 'three', vendor: 'custom' })
    expect(patch.meta.parameterReferenceSlots).toEqual({ modelKey: 'three', vendorKey: 'custom', slots: [
      { key: 'a', label: 'a', group: 'reference' }, { key: 'b', label: 'b', group: 'reference' }, { key: 'c', label: 'c', group: 'reference' },
    ] })
    const changed = buildNodeModelChangePatch({
      node: { ...node, meta: { ...patch.meta, a: 'https://old.test/a.png' } }, nodes: [node], edges: [],
      modelOptions: [next, option({ value: 'plain', label: 'Plain', vendor: 'custom' })], value: 'plain', vendor: 'custom',
    })
    expect(changed.meta.parameterReferenceSlots).toBeUndefined()
    expect(changed.meta.a).toBeUndefined()
  })

  it('removes previous controls and writes the complete next model address and defaults', () => {
    const current = option({
      value: 'old',
      label: 'Old',
      vendor: 'old-vendor',
      meta: {
        parameterControls: [
          { key: 'old_only', label: 'Old only', type: 'select', options: [{ value: 'x', label: 'x' }], defaultValue: 'x' },
        ],
      },
    })
    const next = option({
      value: 'next-value',
      modelKey: 'next-key',
      modelAlias: 'next-alias',
      label: 'Next model',
      vendor: 'next-vendor',
      meta: {
        parameterControls: [
          { key: 'quality', label: 'Quality', type: 'select', options: [{ value: 'high', label: 'High' }], defaultValue: 'high' },
        ],
      },
    })
    const node: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'image', kind: 'image' }),
      meta: { modelKey: 'old', modelVendor: 'old-vendor', old_only: 'x', keep_me: 1 },
    }

    const patch = buildNodeModelChangePatch({
      node,
      nodes: [node],
      edges: [],
      modelOptions: [current, next],
      value: 'next-value',
      vendor: 'next-vendor',
    })

    expect(patch.meta).toMatchObject({
      keep_me: 1,
      quality: 'high',
      modelKey: 'next-key',
      modelAlias: 'next-alias',
      modelVendor: 'next-vendor',
      vendor: 'next-vendor',
      modelLabel: 'Next model',
      imageModel: 'next-value',
      imageModelVendor: 'next-vendor',
    })
    expect(patch.meta.old_only).toBeUndefined()

  })

  it('retains compatible defaults and resets incompatible values', () => {
    const current = option({ value: 'old', label: 'Old', vendor: 'v', meta: {
      parameterControls: [
        { key: 'quality', label: 'Quality', type: 'select', options: [{ value: 'high', label: 'High' }], defaultValue: 'high' },
        { key: 'ratio', label: 'Ratio', type: 'select', options: [{ value: 'wide', label: 'Wide' }], defaultValue: 'wide' },
      ],
    } })
    const next = option({ value: 'next', label: 'Next', vendor: 'v', meta: {
      parameterControls: [
        { key: 'quality', label: 'Quality', type: 'select', options: [{ value: 'standard', label: 'Standard' }], defaultValue: 'standard' },
        { key: 'ratio', label: 'Ratio', type: 'select', options: [{ value: 'wide', label: 'Wide' }], defaultValue: 'wide' },
      ],
    } })
    const node = { ...createGenerationNode({ id: 'image', kind: 'image' }), meta: { modelKey: 'old', modelVendor: 'v', quality: 'low', ratio: 'wide' } }
    const patch = buildNodeModelChangePatch({ node, nodes: [node], edges: [], modelOptions: [current, next], value: 'next', vendor: 'v' })
    expect(patch.meta).toMatchObject({ ratio: 'wide', quality: 'standard' })
  })

  it('uses the video product aspect default; the first-frame edge makes it send as the first-frame mode', () => {
    const source: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'source', kind: 'image' }),
      result: { id: 'result', type: 'image', url: 'https://example.com/source.png', createdAt: 0 },
      meta: { aspect_ratio: '9:16', imageWidth: 720, imageHeight: 1280 },
    }
    const video: GenerationCanvasNode = createGenerationNode({ id: 'video', kind: 'video' })
    const edge: GenerationCanvasEdge = { id: 'edge', source: source.id, target: video.id, mode: 'first_frame' }
    const next = option({
      value: 'seedance-2',
      modelKey: 'seedance-2',
      label: 'Seedance 2',
      vendor: 'apimart',
      meta: {
        archetypeId: 'seedance-2',
        parameterControls: [
          {
            key: 'aspect_ratio',
            label: 'Aspect',
            type: 'select',
            options: [{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }],
            defaultValue: '16:9',
          },
        ],
      },
    })

    const patch = buildNodeModelChangePatch({
      node: video,
      nodes: [source, video],
      edges: [edge],
      modelOptions: [next],
      value: next.value,
      vendor: next.vendor,
    })

    expect(patch.meta.aspect_ratio).toBe('9:16')
    expect(sendModeAfter(video, patch.meta, [source, video], [edge]).id).toBe('first')
  })

  describe('换模型时上传放进槽里的图跟着走（验收阻断 2）', () => {
    const seedance = option({ value: 'seedance-2', modelKey: 'seedance-2', vendor: 'apimart', label: 'Seedance 2.0' })
    const archetypeKeys = ['wan-2.7', 'veo-3.1', 'kling-3.0', 'grok-imagine-1.5-video', 'seedance-2-apimart']
    const targets = archetypeKeys
      .map((key) => ({ key, found: resolveModelArchetype({ modelKey: key, vendorKey: 'apimart', meta: {} } as never, { variant: EVERY_VARIANT }) }))
      .filter((row) => row.found)
    const swapTo = (key: string, meta: Record<string, unknown>) => {
      const node: GenerationCanvasNode = { ...createGenerationNode({ id: 'v', kind: 'video' }), meta: { modelKey: 'seedance-2', modelVendor: 'apimart', vendor: 'apimart', archetype: { id: 'seedance-2', modeId: meta.__mode ?? 'firstlast' }, ...meta } }
      const next = option({ value: key, modelKey: key, vendor: 'apimart', label: key })
      return buildNodeModelChangePatch({ node, nodes: [node], edges: [], modelOptions: [seedance, next], value: key, vendor: 'apimart' })
    }

    it.each(targets.map((row) => [row.key]))('上传的两张首尾帧换到 %s：节点不会掉成文生，图落在该方式的槽里', (key) => {
      const result = swapTo(key, { firstFrameUrl: 'a', lastFrameUrl: 'b' })
      const node = { ...createGenerationNode({ id: 'v', kind: 'video' }) }
      const mode = sendModeAfter(node, result.meta, [node], [])
      expect(mode.intent, `${key} 换完按 ${mode.id} 发`).not.toBe('text')
      const kinds = new Set(mode.slots.map((slot) => slot.kind))
      // 参考列表不动：旧的首 / 尾帧键落成规范的一份有序列表，首帧在前（一张不少、顺序不变）
      expect(result.meta.referenceImageUrls).toEqual(['a', 'b'])
      expect(result.meta.firstFrameUrl).toBeUndefined()
      expect(kinds.has('first_frame') || kinds.has('image_ref'), key).toBe(true)
    })

    it('新模型一个能收图的方式都没有：图留在参考列表里（不丢），不删', () => {
      const textOnly = resolveModelArchetype({ modelKey: 'minimax-h3-regeneration', vendorKey: 'apimart', meta: {} } as never, { variant: EVERY_VARIANT })
      if (!textOnly) return
      const result = swapTo('minimax-h3-regeneration', { firstFrameUrl: 'a', lastFrameUrl: 'b' })
      expect(result.meta.referenceImageUrls).toEqual(['a', 'b'])
    })

    it('从带视频编辑偏好的模型换到可灵 4.0 Flash：沿用编辑方式且不把比例硬铺成 16:9', () => {
      const sourceVideo: GenerationCanvasNode = {
        ...createGenerationNode({ id: 'src-vid', kind: 'asset' }),
        meta: { aspect_ratio: '1:1' },
        result: { id: 'src-vid-res', type: 'video', url: 'https://example.com/src.mp4', createdAt: 1 },
      }
      const node: GenerationCanvasNode = {
        ...createGenerationNode({ id: 'v-edit', kind: 'video' }),
        meta: {
          modelKey: 'doubao-seedance-2.5',
          modelVendor: 'apimart',
          vendor: 'apimart',
          archetype: { id: 'seedance-2.5-apimart', modeId: 'edit', modeChosenBy: 'human' },
        },
      }
      const edge: GenerationCanvasEdge = { id: 'e-v', source: sourceVideo.id, target: node.id, mode: 'reference' }
      const fromOption = option({ value: 'doubao-seedance-2.5', modelKey: 'doubao-seedance-2.5', vendor: 'apimart', label: 'Seedance 2.5' })
      const kling = option({
        value: 'kling-v4-flash', modelKey: 'kling-v4-flash', vendor: 'apimart', label: '可灵 4.0 Flash',
        meta: {
          parameterControls: [{
            key: 'aspect_ratio', label: '比例', type: 'select',
            options: ['16:9', '9:16', '1:1', '21:9'].map((v) => ({ value: v, label: v })),
            defaultValue: '16:9',
          }],
        },
      })
      const patch = buildNodeModelChangePatch({
        node, nodes: [sourceVideo, node], edges: [edge], modelOptions: [fromOption, kling], value: 'kling-v4-flash', vendor: 'apimart',
      })
      expect(sendModeAfter(node, patch.meta, [sourceVideo, node], [edge]).id).toBe('edit')
      expect(patch.meta.aspect_ratio).toBeUndefined()
    })
  })
})
