import { describe, expect, it } from 'vitest'
import { deleteStoryboardRows, restoreStoryboardDeletion, restoredStoryboardPlan } from './storyboardDeleteUndo'
import { stableShotId, type StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { addShot } from '../../generationCanvas/agent/storyboardPlanEdits'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
const plan = (): StoryboardPlan => ({ title: 'Original', anchors: [], shots: [1, 2, 3].map(index => ({ index, shotId: `s${index}`, prompt: `Prompt ${index}`, durationSec: 3, anchorIds: [] })) })

describe('local storyboard deletion inverse', () => {
  it('restores missing deleted rows in original order without overwriting surviving edits or new fields', () => {
    const before = plan()
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0], before.shots[2]], [], null)
    const current = { ...after, title: 'Later', shots: after.shots.map(shot => ({ ...shot, prompt: 'Later prompt', params: { aspect_ratio: '16:9' } })) }
    const restored = restoredStoryboardPlan(current, undo)
    expect(restored.title).toBe('Later')
    expect(restored.shots.map(shot => shot.shotId)).toEqual(['s1', 's2', 's3'])
    expect(restored.shots[1]).toMatchObject({ prompt: 'Later prompt', params: { aspect_ratio: '16:9' } })
    expect(restored.shots.map(shot => shot.index)).toEqual([1, 2, 3])
  })
  it('does not resurrect a later-deleted survivor or overwrite an already-restored row', () => {
    const before = plan()
    const { undo } = deleteStoryboardRows(before, [before.shots[0]], [], null)
    const existing = { ...before.shots[0], prompt: 'Newer restored content' }
    const restored = restoredStoryboardPlan({ ...before, shots: [existing, before.shots[2]] }, undo)
    expect(restored.shots.map(shot => shot.shotId)).toEqual(['s1', 's3'])
    expect(restored.shots[0].prompt).toBe('Newer restored content')
  })
  it('restores legacy rows by identity after a survivor edit and append', () => {
    const before = plan(); before.shots = before.shots.map(({ shotId: _id, ...shot }) => shot)
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0]], [], null)
    after.shots[0] = { ...after.shots[0], prompt: 'Changed' }
    const appended = addShot(after, undo.before.map(stableShotId))
    const restored = restoredStoryboardPlan(appended, undo)
    expect(restored.shots.map(stableShotId)).toEqual(['shot-1', 'shot-2', 'shot-3', 'shot-4'])
    expect(restored.shots.map(shot => shot.prompt)).toEqual(['Prompt 1', 'Changed', 'Prompt 3', ''])
  })
  it('rejects a stale row object before any deletion; a deleted anchor no longer blocks undo (anchorIds do nothing)', () => {
    const before = plan(); before.anchors = [{ id: 'a', kind: 'character', carrier: 'text', name: 'A', description: 'A' }]; before.shots[0].anchorIds = ['a']
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0]], [], null)
    expect(() => restoredStoryboardPlan({ ...after, anchors: [] }, undo)).not.toThrow()
    expect(() => deleteStoryboardRows(before, [{ ...before.shots[0] }], [], null)).toThrow('target changed')
  })
  it('groups multi-node deletion into one original Undo barrier', () => {
    const store = useGenerationCanvasStore
    store.getState().restoreSnapshot({ nodes: ['n1','n2'].map(id => ({ id, kind: 'image', title: id, categoryId: 'shots', position: { x: 0, y: 0 } })), edges: [], groups: [] })
    const before = plan()
    deleteStoryboardRows(before, before.shots.slice(0, 2), ['n1', 'n2', 'n1'], store.getState())
    expect(store.getState().nodes).toHaveLength(0)
    store.getState().undo()
    expect(store.getState().nodes.map(node => node.id)).toEqual(['n1', 'n2'])
  })
  it('compensates missing nodes, valid edges and existing group membership while retaining later canvas edits/results', () => {
    const store = useGenerationCanvasStore
    const nodes = ['n1','n2'].map(id => ({ id, kind: 'image', title: id, categoryId: 'shots', position: { x: 0, y: 0 }, groupId: 'g' }))
    store.getState().restoreSnapshot({ nodes, edges: [{ id: 'e', source: 'n1', target: 'n2' }], groups: [{ id: 'g', name: 'Group', categoryId: 'shots', nodeIds: ['n1', 'n2'], createdAt: 1, updatedAt: 1 }] })
    const before = plan()
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0]], ['n1'], store.getState())
    store.getState().updateNode('n2', { position: { x: 77, y: 99 }, result: { id: 'new-result', type: 'image', url: 'https://example.invalid/result.png', createdAt: 2 } })
    const later = store.getState().nodes.find(node => node.id === 'n2')
    restoreStoryboardDeletion(after, undo, store.getState())
    expect(store.getState().nodes.find(node => node.id === 'n2')).toEqual(later)
    expect(store.getState().nodes.find(node => node.id === 'n1')?.groupId).toBe('g')
    expect(store.getState().groups[0].nodeIds).toEqual(expect.arrayContaining(['n1','n2']))
    expect(store.getState().edges.map(edge => edge.id)).toEqual(['e'])
  })
  it('does not recreate deleted groups, dangling edges or rewind a newly loaded canvas', () => {
    const store = useGenerationCanvasStore
    store.getState().restoreSnapshot({ nodes: ['n1','n2'].map(id => ({ id, kind: 'image', title: id, categoryId: 'shots', position: { x: 0, y: 0 } })), edges: [{ id: 'e', source: 'n1', target: 'n2' }], groups: [] })
    const before = plan()
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0]], ['n1'], store.getState())
    store.getState().deleteNode('n2')
    restoreStoryboardDeletion(after, undo, store.getState())
    expect(store.getState().nodes.map(node => node.id)).toEqual(['n1'])
    expect(store.getState().edges).toEqual([])
    store.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] })
    expect(() => restoreStoryboardDeletion(after, undo, store.getState())).toThrow('canvas target changed')
  })
  for (const change of ['none', 'links', 'recreated', 'member', 'deleted'] as const) it(`preserves current groups and compensates original group edges only for an unchanged group: ${change}`, () => {
    const store = useGenerationCanvasStore
    const nodes = ['source', 'member', 'other'].map(id => ({ id, kind: 'image', title: id, categoryId: 'shots', position: { x: 0, y: 0 } }))
    const edge = { id: 'original-group-edge', source: 'source', target: 'member', mode: 'reference', viaGroupId: 'g' }
    const group = { id: 'g', name: 'Original group', categoryId: 'shots', nodeIds: ['member', 'other'], inputLinks: [{ sourceNodeId: 'source' }], createdAt: 1, updatedAt: 1 }
    store.getState().restoreSnapshot({ nodes, edges: [edge], groups: [group] })
    const before = plan()
    const { plan: after, undo } = deleteStoryboardRows(before, [before.shots[0]], ['member'], store.getState())
    if (change === 'links') store.setState({ groups: store.getState().groups.map(value => ({ ...value, inputLinks: [] })) })
    if (change === 'recreated') store.setState({ groups: store.getState().groups.map(value => ({ ...value, createdAt: 2, name: 'New group using old id' })) })
    if (change === 'member') store.setState({ groups: store.getState().groups.map(value => ({ ...value, nodeIds: [] })) })
    if (change === 'deleted') store.setState({ groups: [] })
    const latestGroups = store.getState().groups
    restoreStoryboardDeletion(after, undo, store.getState())
    if (change === 'none') {
      expect(store.getState().edges).toContainEqual(edge)
      expect(store.getState().groups[0].nodeIds).toContain('member')
    } else {
      expect(store.getState().groups).toEqual(latestGroups)
      expect(store.getState().nodes.find(node => node.id === 'member')?.groupId).toBeUndefined()
      expect(store.getState().edges).toEqual([])
    }
  })

})
