import { beforeEach, describe, expect, it } from 'vitest'
import { useGenerationCanvasStore } from './generationCanvasStore'
import { setCanvasEventSinkForTests, type CanvasShadowEvent } from '../events/canvasEventEmitter'
import type { GenerationCanvasNode, GenerationNodeResult, NodeGroup } from '../model/generationCanvasTypes'
import { MEDIA_DIMENSION_UPDATE_OPTIONS } from '../nodes/nodeSizing'

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

describe('connectToNode — 连一张图进图片节点自动切到「参考图/改图」模式(根因回归 2026-06-29)', () => {
  function archImageNode(id: string, modeId: string): GenerationCanvasNode {
    return { id, kind: 'image', title: id, position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots', meta: { archetype: { id: 'nano-banana', modeId } } }
  }

  it('源图 → 目标图片节点停在默认「文生图」(t2i,无参考槽) → 连线后 modeId 变 edit(改图)', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('src', 'shots'), archImageNode('dst', 't2i')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    useGenerationCanvasStore.getState().startConnection('src')
    const verdict = useGenerationCanvasStore.getState().connectToNode('dst')
    expect(verdict.ok).toBe(true)

    const state = useGenerationCanvasStore.getState()
    // 边真建上了
    expect(state.edges.some((e) => e.source === 'src' && e.target === 'dst')).toBe(true)
    // 目标自动切到含 image_ref 槽的「改图」模式——不再停在文生图
    const dst = state.nodes.find((n) => n.id === 'dst')
    expect((dst?.meta?.archetype as { modeId?: string } | undefined)?.modeId).toBe('edit')
  })

  it('目标已在「改图」模式 → 连线不重复切(尊重现状,幂等)', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('src', 'shots'), archImageNode('dst', 'edit')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    useGenerationCanvasStore.getState().startConnection('src')
    useGenerationCanvasStore.getState().connectToNode('dst')
    const dst = useGenerationCanvasStore.getState().nodes.find((n) => n.id === 'dst')
    expect((dst?.meta?.archetype as { modeId?: string } | undefined)?.modeId).toBe('edit')
  })

  it('从目标左侧输入端起拖到源图 → 真边仍是源图→目标，并自动切到改图', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('src', 'shots'), archImageNode('dst', 't2i')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    useGenerationCanvasStore.getState().startConnection('dst', 'left')
    const verdict = useGenerationCanvasStore.getState().connectToNode('src')
    expect(verdict.ok).toBe(true)

    const state = useGenerationCanvasStore.getState()
    expect(state.edges).toMatchObject([{ source: 'src', target: 'dst' }])
    const dst = state.nodes.find((n) => n.id === 'dst')
    expect((dst?.meta?.archetype as { modeId?: string } | undefined)?.modeId).toBe('edit')
  })
})

describe('边命令的唯一身份', () => {
  it('同两点多语义边改标签时只改命中的那一条', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('src', 'shots'), node('dst', 'shots')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    const state = useGenerationCanvasStore.getState()
    state.connectNodes('src', 'dst', 'first_frame')
    state.connectNodes('src', 'dst', 'last_frame')
    const [first, last] = useGenerationCanvasStore.getState().edges
    expect(first?.id).not.toBe(last?.id)

    useGenerationCanvasStore.getState().updateEdgeMode(last!.id, 'style_ref')

    expect(useGenerationCanvasStore.getState().edges.map((edge) => edge.mode)).toEqual(['first_frame', 'style_ref'])
  })
})

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

  it('P4 S5: createGroup 带 materializationOperationId 章 + 明确成员 id（分镜组落地用）', () => {
    // 补两个 shots 分类节点（beforeEach 只有 shot-1）。
    useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'shot-a', categoryId: 'shots', exactPosition: true, position: { x: 0, y: 0 } })
    useGenerationCanvasStore.getState().addNode({ kind: 'video', title: 'shot-b', categoryId: 'shots', exactPosition: true, position: { x: 200, y: 0 } })
    const ids = useGenerationCanvasStore.getState().nodes.filter((n) => n.categoryId === 'shots' && n.id !== 'shot-1').map((n) => n.id)
    expect(ids.length).toBe(2)
    const created = useGenerationCanvasStore.getState().createGroup('shots', '分镜组·计划名', { materializationOperationId: 'canvas-landing:run-1', nodeIds: ids })
    expect(created?.materializationOperationId).toBe('canvas-landing:run-1')
    // 明确成员被收进组，且节点 groupId 指向它。
    expect(created?.nodeIds.slice().sort()).toEqual(ids.slice().sort())
    for (const id of ids) {
      expect(useGenerationCanvasStore.getState().nodes.find((n) => n.id === id)?.groupId).toBe(created?.id)
    }
  })

  it('ungroups without deleting member nodes', () => {
    useGenerationCanvasStore.getState().ungroup('cast-group')

    const state = useGenerationCanvasStore.getState()
    expect(state.groups.some((candidate) => candidate.id === 'cast-group')).toBe(false)
    expect(state.nodes.find((candidate) => candidate.id === 'cast-1')?.groupId).toBeUndefined()
    expect(state.nodes.some((candidate) => candidate.id === 'cast-1')).toBe(true)
  })

  it('解散框：节点留下，**边一根都不撤**（解散的是组织方式，不是节点关系）', () => {
    // 框工具第一档的 ⋯ 菜单里「解散」走的就是这条路。它必须与既有 ungroup 逐字同义——
    // 一旦顺手把成员之间的边也撤了，用户失去的是接线，而他以为自己只是拆了个框。
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('m1', 'cast', 'frame-1'), node('m2', 'cast', 'frame-1')],
      edges: [{ id: 'm1->m2', source: 'm1', target: 'm2' }],
      selectedNodeIds: [],
      groups: [{ ...group('frame-1', 'cast', ['m1', 'm2']), frameBounds: { x: 0, y: 0, w: 600, h: 400 } }],
    })
    useGenerationCanvasStore.getState().ungroup('frame-1')

    const state = useGenerationCanvasStore.getState()
    expect(state.groups.some((candidate) => candidate.id === 'frame-1')).toBe(false)
    expect(state.edges.map((edge) => edge.id)).toEqual(['m1->m2'])
    expect(state.nodes.map((candidate) => candidate.id).sort()).toEqual(['m1', 'm2'])
  })

  it('createFrame：画出来的空框可用，边界就是用户拖的那个矩形', () => {
    const bounds = { x: 120, y: 80, w: 640, h: 420 }
    const frame = useGenerationCanvasStore.getState().createFrame('shots', bounds, '未命名框')
    expect(frame?.frameBounds).toEqual(bounds)
    expect(frame?.nodeIds).toEqual([])
    // 画出来的和 ⌘G 建出来的是同一种东西（P1：框只有一种），所以照样进 groups。
    expect(useGenerationCanvasStore.getState().groups.some((candidate) => candidate.id === frame?.id)).toBe(true)
  })

  it('groupSelectedNodes 顺手写下 frameBounds——⌘G 建的也是框', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('g1', 'shots'), node('g2', 'shots')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    useGenerationCanvasStore.getState().selectNodes(['g1', 'g2'])
    const created = useGenerationCanvasStore.getState().groupSelectedNodes('shots')
    expect(created).toBeTruthy()
    expect(created?.frameBounds).toBeTruthy()
    expect(created?.frameBounds?.w).toBeGreaterThan(0)
  })

  it('setGroupDescription：说明可以被清空（与改名不同，说明本来就可以没有）', () => {
    const frame = useGenerationCanvasStore.getState().createFrame('shots', { x: 0, y: 0, w: 400, h: 300 })
    const frameId = frame?.id || ''
    useGenerationCanvasStore.getState().setGroupDescription(frameId, '  第二幕 · 咖啡馆  ')
    expect(useGenerationCanvasStore.getState().groups.find((g) => g.id === frameId)?.description).toBe('第二幕 · 咖啡馆')
    useGenerationCanvasStore.getState().setGroupDescription(frameId, '')
    expect(useGenerationCanvasStore.getState().groups.find((g) => g.id === frameId)?.description).toBeUndefined()
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

  it('duplicates a clean variant with every incoming edge and no prior output state', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        node('reference', 'cast'),
        node('first-frame', 'cast'),
        {
          ...node('target', 'cast', 'cast-group'),
          status: 'success',
          result: imageResult('current', 'nomi-local://current.png'),
          history: [imageResult('old', 'nomi-local://old.png')],
          runs: [{ id: 'run-1', status: 'success', startedAt: 1 }],
          progress: { percent: 100, message: 'done' },
          error: 'old error',
          references: [{ id: 'ref-1', kind: 'image', url: 'nomi-local://ref.png' }],
          meta: { nested: { strength: 0.8 } },
        },
        node('downstream', 'cast'),
      ],
      edges: [
        { id: 'incoming-reference', source: 'reference', target: 'target', mode: 'reference', targetParamKey: 'image_ref', order: 2 },
        { id: 'incoming-first', source: 'first-frame', target: 'target', mode: 'first_frame', order: 5 },
        { id: 'outgoing', source: 'target', target: 'downstream', mode: 'reference', order: 0 },
      ],
      selectedNodeIds: ['target'],
      groups: [group('cast-group', 'cast', ['target'])],
    })

    const duplicated = useGenerationCanvasStore.getState().duplicateNodeForRegeneration('target')
    expect(duplicated).toBeTruthy()

    const state = useGenerationCanvasStore.getState()
    const copy = state.nodes.find((candidate) => candidate.id === duplicated?.id)
    expect(copy).toMatchObject({
      status: 'idle',
      history: [],
      derivedFrom: 'target',
      groupId: 'cast-group',
    })
    expect(copy?.result).toBeUndefined()
    expect(copy?.runs).toEqual([])
    expect(copy?.progress).toBeUndefined()
    expect(copy?.error).toBeUndefined()
    expect(copy?.references).toEqual([{ id: 'ref-1', kind: 'image', url: 'nomi-local://ref.png' }])
    expect(copy?.references).not.toBe(state.nodes.find((candidate) => candidate.id === 'target')?.references)
    expect(copy?.meta).toEqual({ nested: { strength: 0.8 } })
    expect((copy?.meta?.nested as object | undefined)).not.toBe(
      (state.nodes.find((candidate) => candidate.id === 'target')?.meta?.nested as object | undefined),
    )

    const clonedIncoming = state.edges.filter((edge) => edge.target === duplicated?.id)
    expect(clonedIncoming).toHaveLength(2)
    expect(clonedIncoming.map(({ id: _id, target: _target, ...edge }) => edge)).toEqual([
      { source: 'reference', mode: 'reference', targetParamKey: 'image_ref', order: 2 },
      { source: 'first-frame', mode: 'first_frame', order: 5 },
    ])
    expect(clonedIncoming.every((edge) => edge.id !== 'incoming-reference' && edge.id !== 'incoming-first')).toBe(true)
    expect(state.edges.some((edge) => edge.source === duplicated?.id && edge.target === 'downstream')).toBe(false)
  })

  it('persists group collapse as one undoable state change', () => {
    useGenerationCanvasStore.getState().setGroupCollapsed('cast-group', true)
    expect(useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === 'cast-group')?.collapsed).toBe(true)

    useGenerationCanvasStore.getState().undo()
    expect(useGenerationCanvasStore.getState().groups.find((candidate) => candidate.id === 'cast-group')?.collapsed).not.toBe(true)
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

  it('can move a group without emitting drag preview events', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [
        { ...node('cast-1', 'cast', 'cast-group'), position: { x: 10, y: 20 } },
        { ...node('cast-2', 'cast', 'cast-group'), position: { x: 40, y: 60 } },
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [group('cast-group', 'cast', ['cast-1', 'cast-2'])],
    })

    const captured: CanvasShadowEvent[] = []
    setCanvasEventSinkForTests((events) => captured.push(...events))
    try {
      useGenerationCanvasStore.getState().moveGroupNodes('cast-group', { x: 5, y: -10 }, { persist: false, emit: false })
      expect(useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'cast-1')?.position).toEqual({ x: 15, y: 10 })
      expect(captured).toEqual([])

      useGenerationCanvasStore.getState().moveGroupNodes('cast-group', { x: 1, y: 0 }, { persist: false })
      expect(captured.some((event) => event.type === 'canvas.node.moved')).toBe(true)
    } finally {
      setCanvasEventSinkForTests(null)
    }
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

// 2026-08-24 用户反馈：「下面是生了视频的，有这个报错窗口在，就一直看不了原本的视频」。
// 失败卡是 absolute inset-0 铺满正文的遮罩，节点的 result 一直在它下面好端端躺着——所以「关掉」
// 不能删数据，只能把节点放回它本来的样子：有产物 → success（片子露出来），没有 → idle。
describe('dismissNodeError — 收起失败卡', () => {
  it('节点有旧产物 → 回 success，产物原样保留（这正是用户要看的那条片子）', () => {
    const kept = imageResult('r-1', 'https://cdn/keep.png')
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ ...node('n1', 'shots'), result: kept, status: 'error', error: '模型「H3文生视频」没有「图生视频」通道' }],
      edges: [], selectedNodeIds: [], groups: [],
    })

    useGenerationCanvasStore.getState().dismissNodeError('n1')

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'n1')
    expect(stateNode?.status).toBe('success')
    expect(stateNode?.error).toBeUndefined()
    expect(stateNode?.result?.id).toBe('r-1')
  })

  it('节点没有产物 → 回 idle（空卡，可以直接重新生成）', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{ ...node('n1', 'shots'), status: 'error', error: 'boom' }],
      edges: [], selectedNodeIds: [], groups: [],
    })

    useGenerationCanvasStore.getState().dismissNodeError('n1')

    const stateNode = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === 'n1')
    expect(stateNode?.status).toBe('idle')
    expect(stateNode?.error).toBeUndefined()
  })

  it('不是失败态就不动它——别把正在跑的任务顺手掐了', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('n1', 'shots')],
      edges: [], selectedNodeIds: [], groups: [],
    })
    // 必须走 setNodeStatus 而不是塞进 snapshot：restoreSnapshot 会把 running 归一成 idle
    // （重启后不留僵尸 running，是刻意的），直接塞进去测不到「跑着的时候别动它」这件事。
    useGenerationCanvasStore.getState().setNodeStatus('n1', 'running')

    useGenerationCanvasStore.getState().dismissNodeError('n1')

    expect(useGenerationCanvasStore.getState().nodes.find((c) => c.id === 'n1')?.status).toBe('running')
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

  it('按真实媒体预览框选，不因持久化高度过期漏掉可见节点', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [{
        ...sized('loaded-image', 'shots', 0, -400),
        size: { width: 360, height: 280 },
        meta: { previewHeight: 432 },
        result: { id: 'result-1', type: 'image', url: 'nomi-local://asset/image.jpg', createdAt: 1 },
      }],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })

    useGenerationCanvasStore.getState().selectNodesInRect({ x1: 0, y1: 0, x2: 40, y2: 20 }, 'shots')
    expect(useGenerationCanvasStore.getState().selectedNodeIds).toEqual(['loaded-image'])
  })
})

describe('updateNodes', () => {
  it('keeps derived media measurements out of durable revisions and events', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('media', 'shots')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    const beforeRevision = useGenerationCanvasStore.getState().persistRevision
    const captured: CanvasShadowEvent[] = []
    setCanvasEventSinkForTests((events) => captured.push(...events))
    try {
      useGenerationCanvasStore.getState().updateNode(
        'media',
        { meta: { imageWidth: 640, imageHeight: 360, imageAspectRatio: 16 / 9, previewHeight: 180 } },
        MEDIA_DIMENSION_UPDATE_OPTIONS,
      )
      expect(useGenerationCanvasStore.getState().persistRevision).toBe(beforeRevision)
      expect(captured).toEqual([])
      expect(useGenerationCanvasStore.getState().nodes[0]?.meta?.imageWidth).toBe(640)
    } finally {
      setCanvasEventSinkForTests(null)
    }
  })

  it('applies a bulk edit with one persist revision and one undo step', () => {
    useGenerationCanvasStore.getState().restoreSnapshot({
      nodes: [node('a', 'shots'), node('b', 'shots')],
      edges: [],
      selectedNodeIds: [],
      groups: [],
    })
    const beforeRevision = useGenerationCanvasStore.getState().persistRevision

    useGenerationCanvasStore.getState().updateNodes([
      { nodeId: 'a', patch: { meta: { modelKey: 'model-a' } } },
      { nodeId: 'b', patch: { meta: { modelKey: 'model-b' } } },
    ])

    let state = useGenerationCanvasStore.getState()
    expect(state.persistRevision).toBe(beforeRevision + 1)
    expect(state.nodes.map((candidate) => candidate.meta?.modelKey)).toEqual(['model-a', 'model-b'])

    state.undo()
    state = useGenerationCanvasStore.getState()
    expect(state.nodes.map((candidate) => candidate.meta?.modelKey)).toEqual([undefined, undefined])
  })
})
