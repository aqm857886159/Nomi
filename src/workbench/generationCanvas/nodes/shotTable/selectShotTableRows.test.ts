import { describe, expect, it } from 'vitest'
import { selectShotTableRows } from './selectShotTableRows'
import { createStoryboardShotTable } from '../../../../../electron/shared/canvas/shotTable'
import type { StoryboardDesign } from '../../../workbenchTypes'
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'

const design: StoryboardDesign = { id: 'design', documentId: 'doc', title: 'Shot', status: 'draft', committed: false, createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1, plan: { title: 'Shot', anchors: [], shots: [{ index: 1, shotId: 'shot-1', prompt: 'Original', durationSec: 3, anchorIds: [] }] } }
const table = createStoryboardShotTable('doc', 'design')
function read(nodes: GenerationCanvasNode[] = [], current = design) {
  return selectShotTableRows({ table, designs: { doc: [current] }, nodes, imageModelOptions: [], videoModelOptions: [] })
}
describe('shot table read-through view', () => {
  it('reflects owner edits without mutating or storing rows', () => {
    expect(read()[0].prompt).toBe('Original')
    expect(read([], { ...design, plan: { ...design.plan, shots: [{ ...design.plan.shots[0], prompt: 'Changed' }] } })[0].prompt).toBe('Changed')
    expect(table).not.toHaveProperty('rows')
  })
  it('honors original node overrides while ignoring variants', () => {
    const node: GenerationCanvasNode = { id: 'original', kind: 'video', title: '', position: { x: 0, y: 0 }, status: 'idle', prompt: 'Hand edited', meta: { storyboardDesignId: 'design', shotId: 'shot-1', overriddenFields: ['prompt'] } }
    const variant: GenerationCanvasNode = { ...node, id: 'variant', regeneratedFrom: node.id, prompt: 'Variant' }
    expect(read([variant, node])[0].prompt).toBe('Hand edited')
    expect(read([variant])[0].prompt).toBe('Original')
  })
  it('does not show a sibling design or resurrect a removed source', () => {
    expect(read([], { ...design, id: 'sibling' })).toEqual([])
  })
})
