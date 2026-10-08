import { describe, expect, it } from 'vitest'
import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../workbenchTypes'
import { deriveGenerationList, generationListRole, planShotKey } from './generationListModel'

const node = (partial: Partial<GenerationCanvasNode> & Pick<GenerationCanvasNode, 'id' | 'kind'>): GenerationCanvasNode =>
  ({ title: partial.id, prompt: '', position: { x: 0, y: 0 }, status: 'idle', categoryId: 'shots', ...partial }) as GenerationCanvasNode
const done = (id: string) => ({ status: 'success' as const, result: { id: `${id}-r`, type: 'image' as const, url: `https://example.test/${id}.png`, createdAt: 1 } })

const design: StoryboardDesign = {
  id: 'd1', documentId: 'doc', title: 'Rain', committed: false, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
  plan: {
    title: 'Rain',
    anchors: [{ id: 'lin', kind: 'character', name: 'Lin', description: '', carrier: 'visual' }],
    shots: [
      { shotId: 'b', index: 1, shotKind: 'image', durationSec: 3, anchorIds: ['lin'], prompt: 'first in plan order' },
      { shotId: 'a', index: 2, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'second, materialized' },
      { shotId: 'c', index: 3, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: 'third, only in the plan' },
    ],
  },
}

function fixture(): { nodes: GenerationCanvasNode[]; edges: GenerationCanvasEdge[]; groups: NodeGroup[] } {
  const nodes = [
    node({ id: 'anchor-lin', kind: 'character', meta: { referenceSheet: true, storyboardDesignId: 'd1', anchorId: 'lin' }, ...done('anchor-lin') }),
    // 画布上的顺序故意与方案镜序相反：列表必须按方案镜序排。
    node({ id: 'shot-a', kind: 'image', meta: { storyboardDesignId: 'd1', shotId: 'a' }, ...done('shot-a') }),
    node({ id: 'shot-b', kind: 'image', meta: { storyboardDesignId: 'd1', shotId: 'b' } }),
    node({ id: 'poster', kind: 'image', ...done('poster') }),
    node({ id: 'loose-image', kind: 'image' }),
    node({ id: 'director', kind: 'director' }),
    node({ id: 'clip', kind: 'clip' }),
    node({ id: 'voice', kind: 'audio', categoryId: 'audio' }),
    node({ id: 'note', kind: 'text' }),
    node({ id: 'asset-used', kind: 'asset', ...done('asset-used') }),
    node({ id: 'asset-loose', kind: 'asset', ...done('asset-loose') }),
    node({ id: 'scene-card', kind: 'scene', categoryId: 'scene' }),
  ]
  const edges: GenerationCanvasEdge[] = [
    { id: 'e1', source: 'asset-used', target: 'poster', mode: 'reference' },
    { id: 'e2', source: 'anchor-lin', target: 'shot-b', mode: 'reference' },
    { id: 'e3', source: 'shot-b', target: 'shot-a', mode: 'first_frame' },
  ]
  const groups: NodeGroup[] = [{ id: 'g1', name: 'Posters', categoryId: 'shots', nodeIds: ['poster'], createdAt: 1, updatedAt: 1 }]
  return { nodes, edges, groups }
}

const derive = (filter: { documentId: string; designId: string } | null = null) => {
  const { nodes, edges, groups } = fixture()
  return deriveGenerationList({ nodes, edges, groups, designsByDocumentId: { doc: [design] }, imageModelOptions: [], videoModelOptions: [], filter })
}

describe('generation list projection', () => {
  it('orders sections storyboard → canvas groups → ungrouped, storyboard in plan shot order', () => {
    const model = derive()
    expect(model.sections.map((section) => section.kind)).toEqual(['storyboard', 'group', 'ungrouped'])
    const storyboard = model.sections[0]
    expect(storyboard.cards.map((card) => card.storyboardShotNumber)).toEqual([1, 2, 3])
    expect(storyboard.cards.map((card) => card.nodeId)).toEqual(['shot-b', 'shot-a', null])
    // 还没落画布的方案镜也在（「生成整组」要能勾它），读的是方案里的提示词。
    expect(storyboard.cards[2]).toMatchObject({ key: planShotKey('d1', 'c'), planPrompt: 'third, only in the plan', status: 'ready' })
    expect(storyboard.cards[1].previous).toEqual({ nodeId: 'shot-b', connected: true })
    expect(storyboard.cards[0].anchor).toEqual({ name: 'Lin', ready: true })
    expect(model.anchors).toEqual([{ key: 'd1:lin', nodeId: 'anchor-lin', name: 'Lin', ready: true }])
  })

  it('places every canvas node exactly once: a card, a chip on the card that uses it, an anchor, or the unreferenced strip', () => {
    const model = derive()
    const cards = model.sections.flatMap((section) => section.cards).flatMap((card) => (card.nodeId ? [card.nodeId] : []))
    expect(new Set(cards).size).toBe(cards.length)
    const chips = model.sections.flatMap((section) => section.cards).flatMap((card) => card.referenceNodeIds)
    const anchors = model.anchors.flatMap((anchor) => (anchor.nodeId ? [anchor.nodeId] : []))
    const strip = model.sections.flatMap((section) => section.unreferencedAssetIds)
    const placed = new Set([...cards, ...chips, ...anchors, ...strip])
    expect([...placed].sort()).toEqual(fixture().nodes.map((candidate) => candidate.id).sort())
    // 素材不成卡
    expect(cards).not.toContain('asset-used')
    expect(chips).toContain('asset-used')
    expect(strip.sort()).toEqual(['asset-loose', 'scene-card'])
  })

  it('shows tool nodes as compact cards after the generation cards, and never asset kinds as cards', () => {
    const ungrouped = derive().sections.find((section) => section.kind === 'ungrouped')!
    expect(ungrouped.cards.map((card) => [card.nodeId, card.variant])).toEqual([
      ['loose-image', 'generation'], ['voice', 'generation'], ['note', 'generation'], ['director', 'tool'], ['clip', 'tool'],
    ])
    expect(generationListRole(node({ id: 'k', kind: 'image', meta: { storyboardKeyframe: true } }))).toBe('asset')
  })

  it('filters to one storyboard (creation page deep link) and reports a deleted filter target', () => {
    const filtered = derive({ documentId: 'doc', designId: 'd1' })
    expect(filtered.sections.map((section) => section.kind)).toEqual(['storyboard'])
    expect(filtered.filterMissing).toBe(false)
    const missing = derive({ documentId: 'doc', designId: 'gone' })
    expect(missing.filterMissing).toBe(true)
    expect(missing.sections.map((section) => section.kind)).toEqual(['storyboard', 'group', 'ungrouped'])
  })
})
