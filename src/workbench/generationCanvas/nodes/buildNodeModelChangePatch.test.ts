import { describe, expect, it } from 'vitest'
import type { ModelOption } from '../../../config/models'
import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { buildNodeModelChangePatch } from './buildNodeModelChangePatch'

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
    expect(patch.changeset).toEqual({
      retained: [],
      removed: [{ key: 'old_only', value: 'x' }],
      changedDefaults: [{ key: 'quality', from: undefined, to: 'high' }],
    })
  })

  it('reports retained controls and defaults that replace an existing value', () => {
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
    expect(patch.changeset).toEqual({
      retained: [{ key: 'ratio', value: 'wide' }],
      removed: [],
      changedDefaults: [{ key: 'quality', from: 'low', to: 'standard' }],
    })
  })

  it('uses the video product aspect default and promotes a referenced archetype mode', () => {
    const source: GenerationCanvasNode = {
      ...createGenerationNode({ id: 'source', kind: 'image' }),
      result: { id: 'result', type: 'image', url: 'https://example.com/source.png', createdAt: 0 },
      meta: { aspect_ratio: '9:16' },
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
    expect(patch.meta.archetype).toMatchObject({ modeId: 'first' })
  })
})
