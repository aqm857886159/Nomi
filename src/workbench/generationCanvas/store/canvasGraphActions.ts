import { connectNodes, disconnectEdge, removeNodes } from '../model/graphOps'
import { isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { validateReferenceEdge } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdge, NodeGroup } from '../model/generationCanvasTypes'
import { createGroupId } from './canvasIds'
import { bumpPersistRevision, isCategoryId, shouldPersistCanvasMutation } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from '../events/canvasUndoJournal'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasGraphActions, CanvasSliceCreator } from './canvasStoreTypes'

export const createCanvasGraphActions: CanvasSliceCreator<CanvasGraphActions> = (set, get) => ({
  startConnection: (nodeId) => {
    set({ pendingConnectionSourceId: nodeId })
  },
  cancelConnection: () => {
    set({ pendingConnectionSourceId: '' })
  },
  connectToNode: (targetNodeId) => {
    const sourceNodeId = get().pendingConnectionSourceId
    if (!sourceNodeId) return { ok: false, reason: 'dangling' }
    // mode 选择在 set 外用同一份 pre-state 计算(与原内嵌逻辑等价),事件要带上它
    const pre = get()
    const sourceNode = pre.nodes.find((n) => n.id === sourceNodeId)
    const targetNode = pre.nodes.find((n) => n.id === targetNodeId)
    let mode: GenerationCanvasEdge['mode'] = 'reference'
    if (sourceNode && targetNode && isImageLikeGenerationNodeKind(sourceNode.kind) && targetNode.kind === 'video') {
      const incoming = pre.edges.filter((e) => e.target === targetNodeId)
      if (!incoming.some((e) => e.mode === 'first_frame')) mode = 'first_frame'
      else if (!incoming.some((e) => e.mode === 'last_frame')) mode = 'last_frame'
    }
    // 连边能力校验收口到此(手动连线总闸):文本→图片、错配参考槽等盲连在创建期就拦——
    // T8 此前只补了 agent 入口,手动拖把柄/点输入口的边落库后才在生成期被静默丢弃。
    // agent 路径已在 generationCanvasTools 预校验;这里防的是手动入口。
    if (sourceNode && targetNode) {
      const verdict = validateReferenceEdge(sourceNode, targetNode, mode)
      if (!verdict.ok) {
        set((state) => {
          state.pendingConnectionSourceId = ''
        })
        return verdict
      }
    }
    const beforeEdges = pre.edges
    set((state) => {
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges !== state.edges) {
        state.edges = nextEdges
        bumpPersistRevision(state)
      }
      state.pendingConnectionSourceId = ''
    })
    if (get().edges !== beforeEdges) {
      emitCanvasGesture([{ type: 'canvas.edge.connected', payload: { sourceNodeId, targetNodeId, mode } }])
    }
    return { ok: true }
  },
  connectNodes: (sourceNodeId, targetNodeId, mode) => {
    const beforeEdges = get().edges
    set((state) => {
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges === state.edges) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
    if (get().edges !== beforeEdges) {
      emitCanvasGesture([{ type: 'canvas.edge.connected', payload: { sourceNodeId, targetNodeId, ...(mode ? { mode } : {}) } }])
    }
  },
  updateEdgeMode: (edgeId, mode) => {
    const existing = get().edges.find((candidate) => candidate.id === edgeId)
    if (!existing || existing.mode === mode) return
    set((state) => {
      const edge = state.edges.find((candidate) => candidate.id === edgeId)
      if (!edge || edge.mode === mode) return
      edge.mode = mode
      bumpPersistRevision(state)
    })
    emitCanvasGesture([{ type: 'canvas.edge.mode-changed', payload: { edgeId, mode } }])
  },
  disconnectEdge: (edgeId) => {
    const beforeCount = get().edges.length
    set((state) => {
      const nextEdges = disconnectEdge(state.edges, edgeId)
      if (nextEdges.length === state.edges.length) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
    if (get().edges.length !== beforeCount) {
      emitCanvasGesture([{ type: 'canvas.edge.disconnected', payload: { edgeId } }])
    }
  },
  moveGroupNodes: (groupId, delta, options) => {
    // 预判"会不会真的动"(与内嵌守卫同条件),动了才发事件
    const pre = get()
    const preGroup = pre.groups.find((candidate) => candidate.id === groupId)
    const willMoveIds = preGroup?.nodeIds.length && (delta.x !== 0 || delta.y !== 0)
      ? pre.nodes.filter((node) => preGroup.nodeIds.includes(node.id) && (node.categoryId || 'shots') === preGroup.categoryId).map((node) => node.id)
      : []
    set((state) => {
      if (delta.x === 0 && delta.y === 0) return
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group?.nodeIds.length) return
      const nodeIds = new Set(group.nodeIds)
      let moved = false
      for (const node of state.nodes) {
        if (!nodeIds.has(node.id) || (node.categoryId || 'shots') !== group.categoryId) continue
        node.position = {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y),
        }
        moved = true
      }
      if (!moved) return
      group.updatedAt = Date.now()
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
    if (willMoveIds.length) {
      const post = get()
      const postGroup = post.groups.find((candidate) => candidate.id === groupId)
      emitCanvasGesture([
        ...post.nodes.filter((node) => willMoveIds.includes(node.id)).map((node) => ({ type: 'canvas.node.moved', payload: { nodeId: node.id, position: node.position } })),
        ...(postGroup ? [{ type: 'canvas.group.updated', payload: { group: postGroup } }] : []),
      ])
    }
  },
  createGroup: (categoryId, name) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const now = Date.now()
    const existingCount = get().groups.filter((group) => group.categoryId === id).length
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds: [],
      createdAt: now,
      updatedAt: now,
    }
    pushUndoSnapshot(get())
    set((state) => {
      state.groups.push(group)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([{ type: 'canvas.group.created', payload: { group } }])
    return group
  },
  groupSelectedNodes: (categoryId, name) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const current = get()
    const selected = new Set(current.selectedNodeIds)
    const nodeIds = current.nodes
      .filter((node) => selected.has(node.id) && (node.categoryId || 'shots') === id)
      .map((node) => node.id)
    if (nodeIds.length < 2) return null
    const now = Date.now()
    const existingCount = current.groups.filter((group) => group.categoryId === id).length
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds,
      createdAt: now,
      updatedAt: now,
    }
    // 受影响的旧组(成员被抢走的)pre 捕获,post 发后态
    const affectedGroupIds = current.groups.filter((g) => g.nodeIds.some((nodeId) => nodeIds.includes(nodeId))).map((g) => g.id)
    pushUndoSnapshot(current)
    set((state) => {
      for (const existingGroup of state.groups) {
        existingGroup.nodeIds = existingGroup.nodeIds.filter((nodeId) => !nodeIds.includes(nodeId))
      }
      for (const node of state.nodes) {
        if (nodeIds.includes(node.id)) node.groupId = group.id
      }
      state.groups.push(group)
      state.selectedNodeIds = nodeIds
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const post = get()
    emitCanvasGesture([
      ...post.groups.filter((g) => affectedGroupIds.includes(g.id)).map((g) => ({ type: 'canvas.group.updated', payload: { group: g } })),
      ...nodeIds.map((nodeId) => ({ type: 'canvas.node.updated', payload: { nodeId, patch: { groupId: group.id } } })),
      { type: 'canvas.group.created', payload: { group } },
    ])
    return group
  },
  renameGroup: (groupId, name) => {
    const nextName = String(name || '').trim()
    if (!nextName) return
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing || existing.name === nextName) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      group.name = nextName
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const renamed = get().groups.find((candidate) => candidate.id === groupId)
    if (renamed) emitCanvasGesture([{ type: 'canvas.group.updated', payload: { group: renamed } }])
  },
  setGroupColor: (groupId, color) => {
    const nextColor = String(color || '').trim()
    if (!nextColor) return
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing || existing.color === nextColor) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      group.color = nextColor
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const recolored = get().groups.find((candidate) => candidate.id === groupId)
    if (recolored) emitCanvasGesture([{ type: 'canvas.group.updated', payload: { group: recolored } }])
  },
  ungroup: (groupId) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
    const releasedNodeIds = [...existing.nodeIds]
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      const nodeIds = new Set(group.nodeIds)
      for (const node of state.nodes) {
        if (nodeIds.has(node.id)) delete node.groupId
      }
      state.groups = state.groups.filter((candidate) => candidate.id !== groupId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([{ type: 'canvas.group.removed', payload: { groupId, releasedNodeIds } }])
  },
  ungroupGroups: (groupIds) => {
    const current = get()
    const targets = new Set(groupIds)
    if (!targets.size || !current.groups.some((group) => targets.has(group.id))) return
    const removedGroups = current.groups.filter((group) => targets.has(group.id)).map((group) => ({ groupId: group.id, releasedNodeIds: [...group.nodeIds] }))
    pushUndoSnapshot(current)
    set((state) => {
      const nodeIds = new Set<string>()
      for (const group of state.groups) {
        if (!targets.has(group.id)) continue
        group.nodeIds.forEach((nodeId) => nodeIds.add(nodeId))
      }
      for (const node of state.nodes) {
        if (nodeIds.has(node.id)) delete node.groupId
      }
      state.groups = state.groups.filter((candidate) => !targets.has(candidate.id))
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture(removedGroups.map((item) => ({ type: 'canvas.group.removed', payload: item })))
  },
  deleteGroup: (groupId, deleteNodes = false) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
    const memberIds = [...existing.nodeIds]
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      const nodeIds = new Set(group.nodeIds)
      if (deleteNodes) {
        const next = removeNodes(state.nodes, state.edges, Array.from(nodeIds))
        state.nodes = next.nodes
        state.edges = next.edges
        state.selectedNodeIds = state.selectedNodeIds.filter((nodeId) => !nodeIds.has(nodeId))
      } else {
        for (const node of state.nodes) {
          if (nodeIds.has(node.id)) delete node.groupId
        }
      }
      state.groups = state.groups.filter((candidate) => candidate.id !== groupId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    // 删组带节点 = 组移除 + N 个节点移除;只删组 = 组移除(成员经 releasedNodeIds 释放)
    emitCanvasGesture(
      deleteNodes
        ? [
            { type: 'canvas.group.removed', payload: { groupId, releasedNodeIds: [] } },
            ...memberIds.map((nodeId) => ({ type: 'canvas.node.removed', payload: { nodeId } })),
          ]
        : [{ type: 'canvas.group.removed', payload: { groupId, releasedNodeIds: memberIds } }],
    )
  },
  moveNodeToGroup: (nodeId, groupId) => {
    const id = String(groupId || '').trim()
    if (!id) return
    const current = get()
    const sourceNode = current.nodes.find((candidate) => candidate.id === nodeId)
    const targetGroup = current.groups.find((candidate) => candidate.id === id)
    if (!sourceNode || !targetGroup || sourceNode.categoryId !== targetGroup.categoryId) return
    const touchedGroupIds = new Set([id, ...current.groups.filter((g) => g.nodeIds.includes(nodeId)).map((g) => g.id)])
    pushUndoSnapshot(current)
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      const group = state.groups.find((candidate) => candidate.id === id)
      if (!node || !group || node.categoryId !== group.categoryId) return
      for (const candidate of state.groups) {
        candidate.nodeIds = candidate.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      }
      node.groupId = group.id
      if (!group.nodeIds.includes(nodeId)) group.nodeIds.push(nodeId)
      group.updatedAt = Date.now()
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const post = get()
    emitCanvasGesture([
      { type: 'canvas.node.updated', payload: { nodeId, patch: { groupId: id } } },
      ...post.groups.filter((g) => touchedGroupIds.has(g.id)).map((g) => ({ type: 'canvas.group.updated', payload: { group: g } })),
    ])
  },
  removeNodeFromGroup: (nodeId) => {
    const pre = get()
    const hadGroup = Boolean(pre.nodes.find((candidate) => candidate.id === nodeId)?.groupId)
    const touchedGroupIds = pre.groups.filter((g) => g.nodeIds.includes(nodeId)).map((g) => g.id)
    pushUndoSnapshot(pre)
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node?.groupId) return
      for (const group of state.groups) {
        group.nodeIds = group.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      }
      delete node.groupId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    if (hadGroup) {
      const post = get()
      emitCanvasGesture([
        // patch 无法表达"删键"(JSON 拷贝吞 undefined)→ 专用语义事件
        { type: 'canvas.node.ungrouped', payload: { nodeId } },
        ...post.groups.filter((g) => touchedGroupIds.includes(g.id)).map((g) => ({ type: 'canvas.group.updated', payload: { group: g } })),
      ])
    }
  },
  reorderGroup: (categoryId, activeGroupId, overGroupId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id) || activeGroupId === overGroupId) return
    pushUndoSnapshot(get())
    set((state) => {
      const categoryGroups = state.groups.filter((group) => group.categoryId === id)
      const activeIndex = categoryGroups.findIndex((group) => group.id === activeGroupId)
      const overIndex = categoryGroups.findIndex((group) => group.id === overGroupId)
      if (activeIndex < 0 || overIndex < 0) return
      const reordered = [...categoryGroups]
      const [active] = reordered.splice(activeIndex, 1)
      if (!active) return
      reordered.splice(overIndex, 0, active)
      const queue = [...reordered]
      state.groups = state.groups.map((group) => group.categoryId === id ? queue.shift() || group : group)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    // 纯排序变化无法用 upsert 表达 → 全量组数组后态(组对象很轻)
    emitCanvasGesture([{ type: 'canvas.groups.reordered', payload: { groups: get().groups } }])
  },
  restoreGraph: (nodes, edges) => {
    // S6-5 整笔撤销补偿:按原 id 放回被删节点/边。幂等:已存在的 id 跳过(不覆盖现状态)。
    const existingNodeIds = new Set(get().nodes.map((node) => node.id))
    const existingEdgeIds = new Set(get().edges.map((edge) => edge.id))
    const addNodes = nodes.filter((node) => node?.id && !existingNodeIds.has(node.id))
    const addEdges = edges.filter((edge) => edge?.id && !existingEdgeIds.has(edge.id))
    if (!addNodes.length && !addEdges.length) return
    pushUndoSnapshot(get())
    set((state) => {
      state.nodes = [...state.nodes, ...addNodes]
      state.edges = [...state.edges, ...addEdges]
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([
      ...addNodes.map((node) => ({ type: 'canvas.node.added', payload: { node } })),
      ...addEdges.map((edge) => ({ type: 'canvas.edge.added', payload: { edge } })),
    ])
  },
})
