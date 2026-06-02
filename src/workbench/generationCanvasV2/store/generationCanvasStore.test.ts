import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

function node(id: string, categoryId: GenerationCanvasNode['categoryId'], groupId?: string): GenerationCanvasNode {
  return {
    id,
    kind: 'image',
    title: id,
    position: { x: 10, y: 20 },
    prompt: `${id} prompt`,
    categoryId,
    ...(groupId ? { groupId } : {}),
  }
}

function group(id: string, categoryId: NodeGroup['categoryId'], nodeIds: string[] = []): NodeGroup {
  return {
    id,
    name: id,
    categoryId,
    nodeIds,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('generationCanvasStore snapshot normalization', () => {
  it('keeps the category when creating a node', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })

    const created = useGenerationCanvasStore.getState().addNode({
      kind: 'image',
      position: { x: 123, y: 456 },
      categoryId: 'scene',
    })

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === created.id)
    expect(created.categoryId).toBe('scene')
    expect(stateNode?.categoryId).toBe('scene')
    expect(stateNode?.position).toEqual({ x: 123, y: 456 })
  })

  it('drops removed semantic scene nodes from legacy snapshots', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        node('image-1', 'shots'),
        {
          id: 'semantic-1',
          kind: 'semanticScene',
          title: '语义场景',
          position: { x: 30, y: 40 },
        },
      ],
      edges: [
        { id: 'edge-image-semantic', source: 'image-1', target: 'semantic-1' },
      ],
      selectedNodeIds: ['semantic-1', 'image-1'],
      groups: [group('shots-group', 'shots', ['image-1', 'semantic-1'])],
    })

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.map((candidate) => candidate.id)).toEqual(['image-1'])
    expect(state.edges).toEqual([])
    expect(state.selectedNodeIds).toEqual(['image-1'])
    expect(state.groups.find((candidate) => candidate.id === 'shots-group')?.nodeIds).toEqual(['image-1'])
  })
})

describe('generationCanvasStore sidebar grouping actions', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        node('shot-1', 'shots'),
        node('cast-1', 'cast', 'cast-group'),
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [
        group('cast-group', 'cast', ['cast-1']),
        group('cast-group-2', 'cast', []),
        group('shots-group', 'shots', []),
      ],
    })
  })

  it('copies a node into another category as an independent derived node', () => {
    const copied = useGenerationCanvasStore.getState().copyNodeToCategory('cast-1', 'shots')

    expect(copied).toBeTruthy()
    expect(copied?.id).not.toBe('cast-1')
    expect(copied?.categoryId).toBe('shots')
    expect(copied?.groupId).toBeUndefined()
    expect(copied?.derivedFrom).toBe('cast-1')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.categoryId).toBe('cast')
    expect(state.nodes.some((candidate) => candidate.id === copied?.id)).toBe(true)
  })

  it('moves same-category nodes into groups and removes them from prior groups', () => {
    useGenerationCanvasStore.getState().moveNodeToGroup('cast-1', 'cast-group-2')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.categoryId).toBe('cast')
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBe('cast-group-2')
    expect(state.groups.find((candidate) => candidate.id === 'cast-group')?.nodeIds).toEqual([])
    expect(state.groups.find((candidate) => candidate.id === 'cast-group-2')?.nodeIds).toEqual(['cast-1'])
  })

  it('does not move an existing node into a group from another category', () => {
    useGenerationCanvasStore.getState().moveNodeToGroup('shot-1', 'cast-group-2')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'shot-1')?.categoryId).toBe('shots')
    expect(state.nodes.find((candidate) => candidate.id === 'shot-1')?.groupId).toBeUndefined()
    expect(state.groups.find((candidate) => candidate.id === 'cast-group-2')?.nodeIds).toEqual([])
  })

  it('can copy a cross-category node and then place the copy in the target group', () => {
    const copied = useGenerationCanvasStore.getState().copyNodeToCategory('cast-1', 'shots')
    expect(copied).toBeTruthy()

    useGenerationCanvasStore.getState().moveNodeToGroup(copied?.id || '', 'shots-group')

    const state = useGenerationCanvasStore.getState()
    const source = state.nodes.find((candidate) => candidate.id === 'cast-1')
    const targetCopy = state.nodes.find((candidate) => candidate.id === copied?.id)
    expect(source?.categoryId).toBe('cast')
    expect(source?.groupId).toBe('cast-group')
    expect(targetCopy?.categoryId).toBe('shots')
    expect(targetCopy?.groupId).toBe('shots-group')
    expect(targetCopy?.derivedFrom).toBe('cast-1')
    expect(state.groups.find((candidate) => candidate.id === 'shots-group')?.nodeIds).toEqual([copied?.id])
  })

  it('removes a node from its group without changing its category', () => {
    useGenerationCanvasStore.getState().removeNodeFromGroup('cast-1')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.categoryId).toBe('cast')
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBeUndefined()
    expect(state.groups.find((candidate) => candidate.id === 'cast-group')?.nodeIds).toEqual([])
  })

  it('creates and edits sidebar groups', () => {
    const created = useGenerationCanvasStore.getState().createGroup('shots', 'Board A')
    expect(created).toBeTruthy()

    useGenerationCanvasStore.getState().renameGroup(created?.id || '', 'Board B')
    useGenerationCanvasStore.getState().setGroupColor(created?.id || '', '#ffcc00')

    const groupState = useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === created?.id)
    expect(groupState?.categoryId).toBe('shots')
    expect(groupState?.name).toBe('Board B')
    expect(groupState?.color).toBe('#ffcc00')
  })

  it('ungroups without deleting member nodes', () => {
    useGenerationCanvasStore.getState().ungroup('cast-group')

    const state = useGenerationCanvasStore.getState()
    expect(state.groups.some((candidate) => candidate.id === 'cast-group')).toBe(false)
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBeUndefined()
    expect(state.nodes.some((candidate) => candidate.id === 'cast-1')).toBe(true)
  })

  it('deletes a group with its member nodes when requested', () => {
    useGenerationCanvasStore.getState().deleteGroup('cast-group', true)

    const state = useGenerationCanvasStore.getState()
    expect(state.groups.some((candidate) => candidate.id === 'cast-group')).toBe(false)
    expect(state.nodes.some((candidate) => candidate.id === 'cast-1')).toBe(false)
  })

  it('deletes a single node and removes it from group membership', () => {
    useGenerationCanvasStore.getState().deleteNode('cast-1')

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.some((candidate) => candidate.id === 'cast-1')).toBe(false)
    expect(state.groups.find((candidate) => candidate.id === 'cast-group')?.nodeIds).toEqual([])
  })

  it('duplicates for regeneration as a derived node in the same category and group', () => {
    const duplicated = useGenerationCanvasStore.getState().duplicateNodeForRegeneration('cast-1')
    expect(duplicated).toBeTruthy()

    const state = useGenerationCanvasStore.getState()
    const duplicateState = state.nodes.find((candidate) => candidate.id === duplicated?.id)
    expect(duplicateState?.categoryId).toBe('cast')
    expect(duplicateState?.groupId).toBe('cast-group')
    expect(duplicateState?.derivedFrom).toBe('cast-1')
    expect(state.groups.find((candidate) => candidate.id === 'cast-group')?.nodeIds).toContain(duplicated?.id)
  })

  it('groups selected nodes in the active category and removes prior group membership', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        node('cast-1', 'cast', 'cast-group'),
        node('cast-2', 'cast'),
        node('shot-1', 'shots'),
      ],
      edges: [],
      selectedNodeIds: ['cast-1', 'cast-2', 'shot-1'],
      groups: [group('cast-group', 'cast', ['cast-1'])],
    })

    const created = useGenerationCanvasStore.getState().groupSelectedNodes('cast')

    const state = useGenerationCanvasStore.getState()
    expect(created).toBeTruthy()
    expect(created?.nodeIds).toEqual(['cast-1', 'cast-2'])
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBe(created?.id)
    expect(state.nodes.find((candidate) => candidate.id === 'cast-2')?.groupId).toBe(created?.id)
    expect(state.nodes.find((candidate) => candidate.id === 'shot-1')?.groupId).toBeUndefined()
    expect(state.groups.find((candidate) => candidate.id === 'cast-group')?.nodeIds).toEqual([])
  })

  it('moves all nodes in a group together', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { ...node('cast-1', 'cast', 'cast-group'), position: { x: 10, y: 20 } },
        { ...node('cast-2', 'cast', 'cast-group'), position: { x: 40, y: 60 } },
        { ...node('shot-1', 'shots'), position: { x: 100, y: 120 } },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [group('cast-group', 'cast', ['cast-1', 'cast-2', 'shot-1'])],
    })

    useGenerationCanvasStore.getState().moveGroupNodes('cast-group', { x: 5, y: -10 })

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.position).toEqual({ x: 15, y: 10 })
    expect(state.nodes.find((candidate) => candidate.id === 'cast-2')?.position).toEqual({ x: 45, y: 50 })
    expect(state.nodes.find((candidate) => candidate.id === 'shot-1')?.position).toEqual({ x: 100, y: 120 })
  })

  it('moves legacy shots nodes without explicit category when grouped', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { ...node('legacy-shot-1', undefined), position: { x: 10, y: 20 }, groupId: 'shots-group' },
        { ...node('legacy-shot-2', undefined), position: { x: 40, y: 60 }, groupId: 'shots-group' },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [group('shots-group', 'shots', ['legacy-shot-1', 'legacy-shot-2'])],
    })

    useGenerationCanvasStore.getState().moveGroupNodes('shots-group', { x: 5, y: 5 })

    const state = useGenerationCanvasStore.getState()
    expect(state.nodes.find((candidate) => candidate.id === 'legacy-shot-1')?.position).toEqual({ x: 15, y: 25 })
    expect(state.nodes.find((candidate) => candidate.id === 'legacy-shot-2')?.position).toEqual({ x: 45, y: 65 })
  })

  it('ungroups multiple groups as one undoable operation', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        node('cast-1', 'cast', 'cast-group'),
        node('cast-2', 'cast', 'cast-group-2'),
      ],
      edges: [],
      selectedNodeIds: ['cast-1', 'cast-2'],
      groups: [group('cast-group', 'cast', ['cast-1']), group('cast-group-2', 'cast', ['cast-2'])],
    })

    useGenerationCanvasStore.getState().ungroupGroups(['cast-group', 'cast-group-2'])
    let state = useGenerationCanvasStore.getState()
    expect(state.groups).toEqual([])
    expect(state.nodes.every((candidate) => !candidate.groupId)).toBe(true)

    useGenerationCanvasStore.getState().undo()
    state = useGenerationCanvasStore.getState()
    expect(state.groups.map((candidate) => candidate.id)).toEqual(['cast-group', 'cast-group-2'])
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBe('cast-group')
    expect(state.nodes.find((candidate) => candidate.id === 'cast-2')?.groupId).toBe('cast-group-2')
  })
})
