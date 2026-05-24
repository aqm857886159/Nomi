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
})
