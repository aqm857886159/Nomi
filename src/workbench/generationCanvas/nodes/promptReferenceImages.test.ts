import { expect, it } from 'vitest'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { NodeWriteAccess } from './nodeWriteAccess'
import { applyPromptReferenceImages } from './promptReferenceImages'
import { effectiveArchetypeMode } from './controls/archetypeMeta'
import { archetypeForNode } from '../agent/referenceEdgeCapability'

const REF = 'data:image/jpeg;base64,AAAA'
const OTHER = 'https://example.test/second.png'

function card(meta: Record<string, unknown>): { access: NodeWriteAccess; read: () => GenerationCanvasNode } {
  let current = { id: 'card', kind: 'image', title: 'Image', position: { x: 0, y: 0 }, meta } as GenerationCanvasNode
  return {
    access: {
      latestNode: (nodeId) => (nodeId === current.id ? current : undefined),
      updateNode: (nodeId, patch) => { if (nodeId === current.id) current = { ...current, ...patch } as GenerationCanvasNode },
    },
    read: () => current,
  }
}

const onModel = (modelKey: string, vendor: string, modeId?: string) => ({
  modelKey, modelAlias: modelKey, modelVendor: vendor, vendor,
  ...(modeId ? { archetype: { id: modelKey, modeId } } : {}),
})

it('a card that has no model yet keeps the images in the image-reference slot (deduped) for the first mode choice', () => {
  const { access, read } = card({})
  expect(applyPromptReferenceImages('card', [REF, REF, OTHER], access)).toBe('placed')
  expect(read().meta?.referenceImageUrls).toEqual([REF, OTHER])
  expect(read().meta?.archetype).toBeUndefined()
})

it('a card already on a model that also edits images keeps its stored mode; the images make it send as the edit mode', () => {
  const { access, read } = card(onModel('gpt-image-2', 'apimart', 't2i'))
  expect(applyPromptReferenceImages('card', [REF], access)).toBe('placed')
  // 机器不写方式（方式按输入现算）：存着的还是 t2i，放进来的图让这次按改图发。
  expect((read().meta?.archetype as { modeId?: string }).modeId).toBe('t2i')
  expect(read().meta?.referenceImageUrls).toEqual([REF])
  const archetype = archetypeForNode(read())!
  expect(effectiveArchetypeMode(archetype, read(), { nodes: [read()], edges: [] }).mode.id).toBe('i2i')
})

it('a model with no image reference in any mode reports unsupported and writes nothing', () => {
  const { access, read } = card(onModel('imagen-4', 'kie', 't2i'))
  expect(applyPromptReferenceImages('card', [REF], access)).toBe('unsupported')
  expect(read().meta?.referenceImageUrls).toBeUndefined()
})

it('no reference images is a no-op', () => {
  const { access, read } = card({})
  expect(applyPromptReferenceImages('card', ['', ''], access)).toBe('none')
  expect(read().meta).toEqual({})
})
