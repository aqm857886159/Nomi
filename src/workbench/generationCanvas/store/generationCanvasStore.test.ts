import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import type { GenerationCanvasNode, GenerationNodeResult, NodeGroup } from '../model/generationCanvasTypes'

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

function imageResult(id: string, url: string): GenerationNodeResult {
  return { id, type: 'image', url, createdAt: 1 }
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

  it('keeps scene3d trajectory data in node meta across restore/read snapshot', () => {
    const scene3dState = {
      objects: [],
      cameras: [],
      trajectories: [
        {
          id: 'trajectory-1',
          name: '轨迹1',
          points: [
            { id: 'point-1', position: [0, 0, 0] },
            { id: 'point-2', position: [2, 0, 1] },
          ],
          curveControls: [{ segmentStartPointId: 'point-1', position: [1, 0, 1] }],
          tension: 0.5,
          closed: false,
          color: '#ef4444',
        },
      ],
      trajectoryBindings: [
        {
          id: 'binding-1',
          trajectoryId: 'trajectory-1',
          objects: [{ objectId: 'camera-1', offsetRatio: 0 }],
          startTime: 0,
          endTime: 3,
          direction: 'forward',
        },
      ],
      trajectoryGroups: [{ id: 'group-1', name: '组1', trajectoryIds: ['trajectory-1'] }],
      sceneTimeline: { totalDuration: 3 },
      environment: { preset: 'city', showGrid: true, showAxes: true, showSky: false, darkMode: false, backgroundColor: '#f6f3ee' },
      editorCamera: { position: [-5, 3, 6], target: [0, 1, 0], rotation: [0, 0, 0], mode: 'edit' },
    }

    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          id: 'scene3d-1',
          kind: 'scene3d',
          title: '3D 场景',
          position: { x: 10, y: 20 },
          meta: { scene3dState },
        },
      ],
      edges: [],
      selectedNodeIds: ['scene3d-1'],
      groups: [],
    })

    const snapshot = useGenerationCanvasStore.getState().readSnapshot()
    expect(snapshot.nodes[0]?.meta?.scene3dState).toEqual(scene3dState)
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
    // S5-b-0(session 摘除):重开项目不再恢复选区——选区是会话态不进项目文件
    expect(state.selectedNodeIds).toEqual([])
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
    // S5-b-0:restoreSnapshot 不再恢复选区——按真实用户流显式选中再成组
    useGenerationCanvasStore.getState().selectNode('cast-1')
    useGenerationCanvasStore.getState().selectNode('cast-2', true)
    useGenerationCanvasStore.getState().selectNode('shot-1', true)

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

describe('generationCanvasStore clipboard paste placement', () => {
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { ...node('copy-a', 'shots'), position: { x: 100, y: 200 } },
        { ...node('copy-b', 'shots'), position: { x: 260, y: 240 } },
      ],
      edges: [{ id: 'edge-copy-a-copy-b', source: 'copy-a', target: 'copy-b' }],
      selectedNodeIds: [],
      groups: [],
    })
  })

  it('pastes copied nodes at the requested canvas position while preserving their relative layout', () => {
    const store = useGenerationCanvasStore.getState()
    store.selectNode('copy-a')
    store.selectNode('copy-b', true)
    store.copySelectedNodes()
    store.pasteNodes({ x: 500, y: 600 })

    const pasted = useGenerationCanvasStore.getState().nodes.filter((candidate) => candidate.id.includes('-copy-'))
    expect(pasted.map((candidate) => candidate.position)).toEqual([
      { x: 500, y: 600 },
      { x: 660, y: 640 },
    ])
    expect(useGenerationCanvasStore.getState().edges.some((edge) => edge.source === pasted[0]?.id && edge.target === pasted[1]?.id)).toBe(true)
  })
})

describe('generationCanvasStore result history', () => {
  it('keeps the previous main image when a new result is added', () => {
    const first = imageResult('r-old', 'https://cdn/old.png')
    const next = imageResult('r-new', 'https://cdn/new.png')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          ...node('image-1', 'shots'),
          result: first,
          history: [],
          status: 'success',
        },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })

    useGenerationCanvasStore.getState().addNodeResult('image-1', next)

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'image-1')
    expect(stateNode?.result?.id).toBe('r-new')
    expect(stateNode?.history?.map((entry) => entry.id)).toEqual(['r-new', 'r-old'])
  })

  it('can switch the main image while keeping the previous one in history', () => {
    const first = imageResult('r-old', 'https://cdn/old.png')
    const next = imageResult('r-new', 'https://cdn/new.png')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          ...node('image-1', 'shots'),
          result: next,
          history: [next, first],
          status: 'success',
        },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })

    useGenerationCanvasStore.getState().updateNode('image-1', {
      result: first,
      history: [first, next],
      status: 'success',
      error: undefined,
    })

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'image-1')
    expect(stateNode?.result?.id).toBe('r-old')
    expect(stateNode?.history?.map((entry) => entry.id)).toEqual(['r-old', 'r-new'])
  })

  it('can switch the main image using a fresh result object from history', () => {
    const first = imageResult('r-old', 'https://cdn/old.png')
    const next = imageResult('r-new', 'https://cdn/new.png')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        {
          ...node('image-1', 'shots'),
          result: next,
          history: [next, first],
          status: 'success',
        },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })

    const latest = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'image-1')
    const target = latest?.history?.find((entry) => entry.id === 'r-old')
    expect(target).toBeTruthy()

    useGenerationCanvasStore.getState().updateNode('image-1', {
      result: { ...target! },
      history: [{ ...target! }, next],
      status: 'success',
      error: undefined,
    })

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'image-1')
    expect(stateNode?.result).not.toBe(target)
    expect(stateNode?.result?.id).toBe('r-old')
    expect(stateNode?.result?.url).toBe('https://cdn/old.png')
    expect(stateNode?.history?.map((entry) => entry.id)).toEqual(['r-old', 'r-new'])
  })
})

describe('selectNodesInRect (框选 AABB)', () => {
  // 节点默认 200x200（无 size 时回退 300x220，这里显式给 size 控制几何）
  function sized(id: string, categoryId: GenerationCanvasNode['categoryId'], x: number, y: number): GenerationCanvasNode {
    return { ...node(id, categoryId), position: { x, y }, size: { width: 100, height: 100 } }
  }
  beforeEach(() => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        sized('a', 'shots', 0, 0), // 0..100
        sized('b', 'shots', 300, 300), // 300..400
        sized('c', 'cast', 50, 50), // 50..150，但属于别的分类
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
  })

  it('只选中与矩形相交且同分类的节点', () => {
    useGenerationCanvasStore.getState().selectNodesInRect({ x1: -20, y1: -20, x2: 120, y2: 120 }, 'shots')
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual(['a'])
  })

  it('框到分类外的节点不选（cast 不在 shots 框选里）', () => {
    useGenerationCanvasStore.getState().selectNodesInRect({ x1: 40, y1: 40, x2: 160, y2: 160 }, 'shots')
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual(['a'])
  })

  it('反向拖（x2<x1）归一化后仍正确相交', () => {
    useGenerationCanvasStore.getState().selectNodesInRect({ x1: 420, y1: 420, x2: 280, y2: 280 }, 'shots')
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual(['b'])
  })

  it('additive 与现有选区并集', () => {
    useGenerationCanvasStore.getState().selectNode('b')
    useGenerationCanvasStore.getState().selectNodesInRect({ x1: -10, y1: -10, x2: 110, y2: 110 }, 'shots', true)
    expect([...useGenerationCanvasStore.getState().selectedNodeIds].sort()).toEqual(['a', 'b'])
  })
})
