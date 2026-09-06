import { connectNodes, disconnectEdge, removeNodes } from '../model/graphOps'
import { normalizeParameterEdges, readParameterReferenceSlots } from '../model/parameterReferenceSlots'
import { resolveCanvasReferenceConnection } from '../model/canvasReferenceConnection'
import { archetypeForNode, resolveTargetModeForEdge } from '../agent/referenceEdgeCapability'
import { applyArchetypeModeSwitch } from '../nodes/controls/archetypeMeta'
import type { GenerationCanvasEdge, GenerationCanvasEdgeMode, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'
import { groupMemberNodes, planGroupLinkEdges, removeGroupLinkEdgesForMember, upsertGroupInputLink, upsertGroupOutputLink } from '../model/groupInputLinks'
import { createGroupId } from './canvasIds'
import { frameBoundsFromMembers } from '../model/canvasFrameBounds'
import { createCanvasFrameStoreActions } from './canvasFrameStoreActions'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { bumpPersistRevision, isCategoryId, shouldEmitCanvasMutation, shouldPersistCanvasMutation } from './canvasGuards'
import { getHistoryFlags, pushUndoSnapshot } from '../events/canvasUndoJournal'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import type { CanvasGraphActions, CanvasSliceCreator } from './canvasStoreTypes'

/**
 * 连线落地后，若目标当前「生成方式」收不下这条参考、档案却有能收的模式 → 自动切过去(t2i→改图)。
 * 三个连线入口共用(手动拖把柄 connectToNode、agent 计划 connectNodes、3D 站位 StagingCaptureHost)，
 * 杜绝「拉图进新图片节点却停在文生图」这类 bug 从任一入口复发(P2)。**幂等**：当前模式已能落该参考则
 * resolveTargetModeForEdge 返回 null → no-op，故对「已正确规划模式」的 agent 路径零影响。走 updateNode
 * 单一写路径(与手动切 ModeBar 同)。须在边已确认建上之后调用。
 */
type ModeSwitchStore = {
  nodes: GenerationCanvasNode[]
  updateNode: (nodeId: string, patch: { meta: Record<string, unknown> }) => void
}
function autoPromoteTargetModeForEdge(
  store: ModeSwitchStore,
  sourceNodeId: string,
  targetNodeId: string,
  mode: GenerationCanvasEdgeMode | undefined,
): void {
  const source = store.nodes.find((n) => n.id === sourceNodeId)
  const target = store.nodes.find((n) => n.id === targetNodeId)
  if (!source || !target) return
  const nextModeId = resolveTargetModeForEdge(source, target, mode)
  if (!nextModeId) return
  const archetype = archetypeForNode(target)
  if (!archetype) return
  store.updateNode(targetNodeId, { meta: applyArchetypeModeSwitch((target.meta || {}) as Record<string, unknown>, archetype, nextModeId) })
}

/**
 * 把一条组入参物化成真边（组内每个成员一根）。**唯一物化点**——`connectToGroup`（新建入参）和
 * `moveNodeToGroup`（新成员进组补边）都走它，杜绝两处各写一遍再慢慢漂。
 * 返回计数供调用方出人话 toast（跳过的必须说，不许静默丢）。
 */
type GroupLinkStore = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
}
type GroupMaterializedConnection = {
  sourceNodeId: string
  targetNodeId: string
  mode: GenerationCanvasEdgeMode
  edge: GenerationCanvasEdge
}
type GroupMaterializeOutcome = {
  edges: GenerationCanvasEdge[]
  connected: GroupMaterializedConnection[]
  skipped: number
  alreadyConnected: number
}

type GroupEdgeDisconnectScope =
  | { groupId: string; direction: 'input'; sourceNodeId: string; mode?: GenerationCanvasEdgeMode }
  | { groupId: string; direction: 'output'; targetNodeId: string }

/**
 * 展开边反查用户当初建的那条编组声明。断开命令必须以该声明为边界，
 * 否则 N 根重叠物化边只少一根，用户视觉上就是“没反应”。
 */
function resolveGroupEdgeDisconnectScope(
  edge: GenerationCanvasEdge,
  groups: readonly NodeGroup[],
): GroupEdgeDisconnectScope | null {
  if (!edge.viaGroupId) return null
  const group = groups.find((candidate) => candidate.id === edge.viaGroupId)
  if (!group) return null
  const output = group.outputLinks?.find((link) => link.targetNodeId === edge.target)
  if (output && group.nodeIds.includes(edge.source)) {
    return { groupId: group.id, direction: 'output', targetNodeId: output.targetNodeId }
  }
  const input = group.inputLinks?.find((link) => (
    link.sourceNodeId === edge.source
      && (link.mode == null || link.mode === edge.mode)
      && group.nodeIds.includes(edge.target)
  ))
  return input
    ? { groupId: group.id, direction: 'input', sourceNodeId: input.sourceNodeId, ...(input.mode ? { mode: input.mode } : {}) }
    : null
}

function isEdgeInDisconnectScope(edge: GenerationCanvasEdge, scope: GroupEdgeDisconnectScope): boolean {
  if (edge.viaGroupId !== scope.groupId) return false
  if (scope.direction === 'output') return edge.target === scope.targetNodeId
  return edge.source === scope.sourceNodeId && (scope.mode == null || edge.mode === scope.mode)
}
function materializeGroupLink(
  pre: GroupLinkStore,
  groupId: string,
  sourceNodeId: string,
  targets: GenerationCanvasNode[],
): GroupMaterializeOutcome {
  const plan = planGroupLinkEdges({ link: { sourceNodeId }, targets, nodes: pre.nodes, edges: pre.edges })
  let edges = pre.edges
  const connected: GroupMaterializedConnection[] = []
  for (const item of plan.connect) {
    const next = connectNodes(edges, item.sourceNodeId, item.targetNodeId, item.mode, item.targetParamKey)
    if (next === edges) continue
    // connectNodes 是 append；给刚加的那条盖上溯源章（成员移出组时据此精确撤边、不误伤手工边）。
    const added = next[next.length - 1]
    if (!added) continue
    const materialized = { ...added, viaGroupId: groupId }
    next[next.length - 1] = materialized
    edges = next
    connected.push({ sourceNodeId: item.sourceNodeId, targetNodeId: item.targetNodeId, mode: item.mode ?? 'reference', edge: materialized })
  }
  return { edges, connected, skipped: plan.skipped.length, alreadyConnected: plan.alreadyConnected.length }
}

/** 编组作为来源：每个成员各向同一目标物化一条真边；顺序计算使用逐条追加后的 edges。 */
function materializeGroupOutputLink(
  pre: GroupLinkStore,
  groupId: string,
  sources: GenerationCanvasNode[],
  target: GenerationCanvasNode,
): GroupMaterializeOutcome {
  let edges = pre.edges
  const connected: GroupMaterializedConnection[] = []
  let skipped = 0
  let alreadyConnected = 0
  for (const source of sources) {
    if (source.id === target.id) continue
    const connection = resolveCanvasReferenceConnection(source, target, pre.nodes, edges)
    const slots = readParameterReferenceSlots(target.meta)
    if (edges.some((edge) => edge.source === source.id && edge.target === target.id &&
      (edge.targetParamKey ? slots.some((slot) => slot.key === edge.targetParamKey) : connection.ok && edge.mode === connection.mode))) {
      alreadyConnected += 1
      continue
    }
    if (!connection.ok) {
      skipped += 1
      continue
    }
    const { mode, targetParamKey } = connection
    const next = connectNodes(edges, source.id, target.id, mode, targetParamKey)
    if (next === edges) continue
    const added = next[next.length - 1]
    if (!added) continue
    const materialized = { ...added, viaGroupId: groupId }
    next[next.length - 1] = materialized
    edges = next
    connected.push({ sourceNodeId: source.id, targetNodeId: target.id, mode: mode ?? 'reference', edge: materialized })
  }
  return { edges, connected, skipped, alreadyConnected }
}

export const createCanvasGraphActions: CanvasSliceCreator<CanvasGraphActions> = (set, get, store) => ({
  // 框（Frame）自己的两个写口住在隔壁（R9 分层：本文件已顶到 800 行门岗）。
  ...createCanvasFrameStoreActions(set, get, store),
  startConnection: (nodeId, side = 'right') => {
    set({ pendingConnectionSourceId: nodeId, pendingConnectionSourceSide: side, pendingConnectionSourceKind: 'node' })
  },
  startGroupConnection: (groupId, side = 'right') => {
    const group = get().groups.find((candidate) => candidate.id === groupId)
    if (!group?.nodeIds.length) return
    set({ pendingConnectionSourceId: groupId, pendingConnectionSourceSide: side, pendingConnectionSourceKind: 'group' })
  },
  cancelConnection: () => {
    set({ pendingConnectionSourceId: '', pendingConnectionSourceSide: 'right', pendingConnectionSourceKind: 'node' })
  },
  connectToNode: (connectedNodeId) => {
    const pendingNodeId = get().pendingConnectionSourceId
    if (!pendingNodeId) return { ok: false, reason: 'dangling' }
    if (get().pendingConnectionSourceKind === 'group') {
      const groupId = pendingNodeId
      const groupSide = get().pendingConnectionSourceSide
      // Re-express the group-origin gesture through the existing node→group
      // commit path. This keeps materialization, declarations, undo and event
      // replay in one implementation instead of creating a parallel graph API.
      set({
        pendingConnectionSourceId: connectedNodeId,
        pendingConnectionSourceSide: groupSide === 'right' ? 'left' : 'right',
        pendingConnectionSourceKind: 'node',
      })
      return get().connectToGroup(groupId)
    }
    // mode 选择在 set 外用同一份 pre-state 计算(与原内嵌逻辑等价),事件要带上它
    const pre = get()
    // 右端口是输出：pending → 松手节点；左端口是输入：松手节点 → pending。
    // 过去 side 只决定预览线几何，落库永远 pending→松手节点，导致从输入端反向拖线时边语义颠倒。
    const sourceNodeId = pre.pendingConnectionSourceSide === 'left' ? connectedNodeId : pendingNodeId
    const targetNodeId = pre.pendingConnectionSourceSide === 'left' ? pendingNodeId : connectedNodeId
    const sourceNode = pre.nodes.find((n) => n.id === sourceNodeId)
    const targetNode = pre.nodes.find((n) => n.id === targetNodeId)
    // 边语义按**目标当前模式**挑（单一真相源 selectConnectionEdgeMode）：数组参考槽（omni 角色参考）→
    // character_ref（有序，对应 character1..N）；单帧 i2v → 首/尾帧填空。无源/目标 → 默认通用 reference。
    const connection = sourceNode && targetNode
      ? resolveCanvasReferenceConnection(sourceNode, targetNode, pre.nodes, pre.edges)
      : { ok: false as const, reason: 'dangling' as const }
    // 连边能力校验收口到此(手动连线总闸):错配参考槽等盲连在创建期就拦；
    // 文本→图片/视频的通用 reference 边作为 prompt 上下文放行。
    // T8 此前只补了 agent 入口,手动拖把柄/点输入口的边落库后才在生成期被静默丢弃。
    // agent 路径已在 generationCanvasTools 预校验;这里防的是手动入口。
    if (!connection.ok) {
      set((state) => {
        state.pendingConnectionSourceId = ''
        state.pendingConnectionSourceSide = 'right'
        state.pendingConnectionSourceKind = 'node'
      })
      return connection
    }
    const { mode, targetParamKey } = connection
    const beforeEdges = pre.edges
    set((state) => {
      const nextEdges = normalizeParameterEdges(state.nodes, connectNodes(state.edges, sourceNodeId, targetNodeId, mode, targetParamKey))
      if (nextEdges !== state.edges) {
        state.edges = nextEdges
        bumpPersistRevision(state)
      }
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      state.pendingConnectionSourceKind = 'node'
    })
    const afterEdges = get().edges
    if (afterEdges !== beforeEdges) {
      const addedEdge = afterEdges.find((candidate) => !beforeEdges.some((edge) => edge.id === candidate.id))
      if (addedEdge) emitCanvasGesture([{ type: 'canvas.edge.added', payload: { edge: addedEdge } }])
      // 边真建上了才切模式(重复连线等空操作不写 meta)。
      autoPromoteTargetModeForEdge(get(), sourceNodeId, targetNodeId, mode)
    }
    return { ok: true }
  },
  connectToGroup: (groupId) => {
    const pendingNodeId = get().pendingConnectionSourceId
    if (!pendingNodeId || get().pendingConnectionSourceKind !== 'node') {
      get().cancelConnection()
      return { ok: false, reason: 'dangling', connected: 0, skipped: 0, alreadyConnected: 0 }
    }
    const pre = get()
    const group = pre.groups.find((candidate) => candidate.id === groupId)
    const clearPending = (state: { pendingConnectionSourceId: string; pendingConnectionSourceSide: 'left' | 'right'; pendingConnectionSourceKind: 'node' | 'group' }) => {
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      state.pendingConnectionSourceKind = 'node'
    }
    if (!group) {
      set(clearPending)
      return { ok: false, reason: 'group_missing', connected: 0, skipped: 0, alreadyConnected: 0 }
    }
    const members = groupMemberNodes(group, pre.nodes).filter((node) => node.id !== pendingNodeId)
    if (!members.length) {
      set(clearPending)
      return { ok: false, reason: 'group_empty', connected: 0, skipped: 0, alreadyConnected: 0 }
    }
    const groupIsSource = pre.pendingConnectionSourceSide === 'left'
    const pendingNode = pre.nodes.find((node) => node.id === pendingNodeId)
    if (!pendingNode) {
      set(clearPending)
      return { ok: false, reason: 'dangling', connected: 0, skipped: 0, alreadyConnected: 0 }
    }
    const outcome = groupIsSource
      ? materializeGroupOutputLink(pre, groupId, members, pendingNode)
      : materializeGroupLink(pre, groupId, pendingNodeId, members)
    // 一个都连不上（全被能力校验拦下）→ 不记入参：记了也只会让后来进组的成员继续白试。
    if (!outcome.connected.length && !outcome.alreadyConnected) {
      set(clearPending)
      return { ok: false, reason: 'all_skipped', connected: 0, skipped: outcome.skipped, alreadyConnected: 0 }
    }
    pushUndoSnapshot(pre)
    set((state) => {
      state.edges = outcome.edges
      const target = state.groups.find((candidate) => candidate.id === groupId)
      if (target) {
        if (groupIsSource) target.outputLinks = upsertGroupOutputLink(target.outputLinks, { targetNodeId: pendingNodeId })
        else target.inputLinks = upsertGroupInputLink(target.inputLinks, { sourceNodeId: pendingNodeId })
        target.updatedAt = Date.now()
      }
      clearPending(state)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const post = get()
    emitCanvasGesture([
      ...outcome.connected.map((item) => ({
        // 组边必须记完整对象：viaGroupId 是成员移出时精确撤边的溯源，日志不能把它丢掉。
        type: 'canvas.edge.added' as const,
        payload: { edge: item.edge },
      })),
      ...post.groups.filter((g) => g.id === groupId).map((g) => ({ type: 'canvas.group.updated' as const, payload: { group: g } })),
    ])
    // 边建上了才切模式（与 connectToNode 同一后置时机，幂等）。
    for (const item of outcome.connected) {
      autoPromoteTargetModeForEdge(get(), item.sourceNodeId, item.targetNodeId, item.mode)
    }
    return { ok: true, connected: outcome.connected.length, skipped: outcome.skipped, alreadyConnected: outcome.alreadyConnected }
  },
  connectNodes: (sourceNodeId, targetNodeId, mode, targetParamKey, order) => {
    const beforeEdges = get().edges
    set((state) => {
      const target = state.nodes.find((node) => node.id === targetNodeId)
      const source = state.nodes.find((node) => node.id === sourceNodeId)
      const slots = readParameterReferenceSlots(target?.meta)
      const connection = slots.length && source && target
        ? resolveCanvasReferenceConnection(source, target, state.nodes, state.edges, mode, targetParamKey)
        : { ok: true as const, mode: mode ?? 'reference', targetParamKey }
      if (!connection.ok) return
      const key = connection.targetParamKey
      let nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, connection.mode, key, order)
      if (nextEdges === state.edges) return
      if (key) nextEdges = nextEdges.filter((edge) => edge.target !== targetNodeId || edge.targetParamKey !== key || (edge.source === sourceNodeId && edge.mode === connection.mode))
      state.edges = normalizeParameterEdges(state.nodes, nextEdges)
      bumpPersistRevision(state)
    })
    const afterEdges = get().edges
    if (afterEdges !== beforeEdges) {
      const addedEdge = afterEdges.find((candidate) => !beforeEdges.some((edge) => edge.id === candidate.id))
      if (addedEdge) emitCanvasGesture([
        ...beforeEdges.filter((edge) => !afterEdges.some((candidate) => candidate.id === edge.id))
          .map((edge) => ({ type: 'canvas.edge.removed' as const, payload: { edge } })),
        { type: 'canvas.edge.added', payload: { edge: addedEdge } },
      ])
      // agent 计划 / 3D 站位经此入口连线，同样把收不下参考的目标自动切到能收的模式(幂等，见 helper)。
      autoPromoteTargetModeForEdge(get(), sourceNodeId, targetNodeId, mode)
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
  disconnectEdge: (edgeId, options) => {
    const pre = get()
    const existing = pre.edges.find((candidate) => candidate.id === edgeId)
    if (!existing) return
    const groupScope = resolveGroupEdgeDisconnectScope(existing, pre.groups)
    const removedEdges = groupScope
      ? pre.edges.filter((edge) => isEdgeInDisconnectScope(edge, groupScope))
      : [existing]
    // Editing one inherited parameter ends that group relationship, retaining the other inputs as manual edges.
    const retainedEdges = options?.scope === 'parameter' && groupScope
      ? removedEdges.filter((edge) => edge.id !== edgeId).map((edge) => {
          const retained = { ...edge }
          delete retained.viaGroupId
          return retained
        })
      : []
    if (options?.scope === 'parameter') pushUndoSnapshot(pre)
    set((state) => {
      const nextEdges = groupScope
        ? [...state.edges.filter((edge) => !isEdgeInDisconnectScope(edge, groupScope)), ...retainedEdges]
        : disconnectEdge(state.edges, edgeId)
      if (nextEdges.length === state.edges.length) return
      state.edges = nextEdges
      if (groupScope) {
        const group = state.groups.find((candidate) => candidate.id === groupScope.groupId)
        if (group) {
          if (groupScope.direction === 'output') {
            const next = group.outputLinks?.filter((link) => link.targetNodeId !== groupScope.targetNodeId)
            if (next?.length) group.outputLinks = next
            else delete group.outputLinks
          } else {
            const next = group.inputLinks?.filter((link) => !(
              link.sourceNodeId === groupScope.sourceNodeId
                && (groupScope.mode == null || link.mode === groupScope.mode)
            ))
            if (next?.length) group.inputLinks = next
            else delete group.inputLinks
          }
          group.updatedAt = Date.now()
        }
      }
      bumpPersistRevision(state)
      if (options?.scope === 'parameter') Object.assign(state, getHistoryFlags())
    })
    const post = get()
    if (post.edges.length === pre.edges.length) return
    emitCanvasGesture(groupScope
      ? [
          ...removedEdges.map((edge) => ({ type: 'canvas.edge.removed' as const, payload: { edge } })),
          ...retainedEdges.map((edge) => ({ type: 'canvas.edge.added' as const, payload: { edge } })),
          ...post.groups
            .filter((group) => group.id === groupScope.groupId)
            .map((group) => ({ type: 'canvas.group.updated' as const, payload: { group } })),
        ]
      : [{ type: 'canvas.edge.disconnected', payload: { edgeId } }])
  },
  moveGroupNodes: (groupId, delta, options) => {
    // 预判"会不会真的动"(与内嵌守卫同条件),动了才发事件
    const shouldEmit = shouldEmitCanvasMutation(options)
    const pre = shouldEmit ? get() : null
    const preGroup = pre?.groups.find((candidate) => candidate.id === groupId)
    const preNodeIds = preGroup?.nodeIds.length ? new Set(preGroup.nodeIds) : null
    const willMoveIds = pre && preGroup && preNodeIds && (delta.x !== 0 || delta.y !== 0)
      ? pre.nodes.filter((node) => preNodeIds.has(node.id) && (node.categoryId || 'shots') === preGroup.categoryId).map((node) => node.id)
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
    if (shouldEmit && willMoveIds.length) {
      const post = get()
      const postGroup = post.groups.find((candidate) => candidate.id === groupId)
      emitCanvasGesture([
        ...post.nodes.filter((node) => willMoveIds.includes(node.id)).map((node) => ({ type: 'canvas.node.moved', payload: { nodeId: node.id, position: node.position } })),
        ...(postGroup ? [{ type: 'canvas.group.updated', payload: { group: postGroup } }] : []),
      ])
    }
  },
  createGroup: (categoryId, name, options) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const now = Date.now()
    const existingCount = get().groups.filter((group) => group.categoryId === id).length
    // P4 S5：物化通道可传入明确的成员 id（节点刚建好、还没进 selection），避免「先 selectNodes 再 group」
    // 的两步竞态。传入时按分类过滤（只收该分类节点，与 groupSelectedNodes 同规则）+ 从旧组抢走。
    const explicitNodeIds = Array.isArray(options?.nodeIds)
      ? get().nodes.filter((node) => options!.nodeIds!.includes(node.id) && (node.categoryId || 'shots') === id).map((node) => node.id)
      : []
    const stamp = options?.materializationOperationId?.trim()
    // 框的边界（2026-09-06 起是真相之一）：调用方给了就用它；没给就按成员包围盒算一次——
    // 建组当下算好，画布不必再靠「成员包围盒」这层皮反推（那正是拖出去框会追着长大的成因）。
    const frameBounds = options?.frameBounds ?? frameBoundsFromMembers(
      get().nodes
        .filter((node) => explicitNodeIds.includes(node.id))
        .map((node) => ({ x: node.position.x, y: node.position.y, ...resolveNodeVisualSize(node) })),
    )
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds: explicitNodeIds,
      ...(frameBounds ? { frameBounds } : {}),
      ...(stamp ? { materializationOperationId: stamp } : {}),
      createdAt: now,
      updatedAt: now,
    }
    pushUndoSnapshot(get())
    set((state) => {
      // 抢走旧组成员（同 groupSelectedNodes 语义）：一个节点只属一个组。
      if (explicitNodeIds.length) {
        for (const existingGroup of state.groups) {
          existingGroup.nodeIds = existingGroup.nodeIds.filter((nodeId) => !explicitNodeIds.includes(nodeId))
        }
        for (const node of state.nodes) {
          if (explicitNodeIds.includes(node.id)) node.groupId = group.id
        }
      }
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
    // 先选后组（⌘G）得到的和画出来的是**同一种框**（P1：框只有一种），
    // 只是它的初始边界由当时的成员包围盒决定，而不是由用户拖出来。
    const frameBounds = frameBoundsFromMembers(
      current.nodes
        .filter((node) => nodeIds.includes(node.id))
        .map((node) => ({ x: node.position.x, y: node.position.y, ...resolveNodeVisualSize(node) })),
    )
    const group: NodeGroup = {
      id: createGroupId(id),
      name: (name || '').trim() || `组 ${existingCount + 1}`,
      categoryId: id,
      nodeIds,
      ...(frameBounds ? { frameBounds } : {}),
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
  setGroupCollapsed: (groupId, collapsed) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing || Boolean(existing.collapsed) === collapsed) return
    pushUndoSnapshot(current)
    set((state) => {
      const group = state.groups.find((candidate) => candidate.id === groupId)
      if (!group) return
      group.collapsed = collapsed
      group.updatedAt = Date.now()
      if (collapsed) {
        const memberIds = new Set(group.nodeIds)
        state.selectedNodeIds = state.selectedNodeIds.filter((nodeId) => !memberIds.has(nodeId))
      }
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    const updated = get().groups.find((candidate) => candidate.id === groupId)
    if (updated) emitCanvasGesture([{ type: 'canvas.group.updated', payload: { group: updated } }])
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
    const leavingGroupIds = current.groups.filter((g) => g.id !== id && g.nodeIds.includes(nodeId)).map((g) => g.id)
    const touchedGroupIds = new Set([id, ...leavingGroupIds])
    // 「动态组端口」的另一半：新成员进组 → 按组入参自动补上同款边；离开原组 → 撤掉原组给它连的边。
    // 后者不撤会让改投别组的镜头**同时挂着两组的参考**、悄悄出错图（见 model/groupInputLinks.ts）。
    let nextEdges = current.edges
    for (const leavingGroupId of leavingGroupIds) {
      nextEdges = removeGroupLinkEdgesForMember(nextEdges, leavingGroupId, nodeId)
    }
    const joinedEdges: GroupMaterializedConnection[] = []
    for (const link of targetGroup.inputLinks ?? []) {
      const outcome = materializeGroupLink({ ...current, edges: nextEdges }, id, link.sourceNodeId, [sourceNode])
      nextEdges = outcome.edges
      for (const item of outcome.connected) joinedEdges.push(item)
    }
    for (const link of targetGroup.outputLinks ?? []) {
      const outputTarget = current.nodes.find((node) => node.id === link.targetNodeId)
      if (!outputTarget) continue
      const outcome = materializeGroupOutputLink({ ...current, edges: nextEdges }, id, [sourceNode], outputTarget)
      nextEdges = outcome.edges
      for (const item of outcome.connected) joinedEdges.push(item)
    }
    const removedGroupEdges = current.edges.filter((edge) => !nextEdges.includes(edge))
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
      if (nextEdges !== state.edges) state.edges = nextEdges
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    for (const item of joinedEdges) {
      autoPromoteTargetModeForEdge(get(), item.sourceNodeId, item.targetNodeId, item.mode)
    }
    const post = get()
    emitCanvasGesture([
      ...removedGroupEdges.map((edge) => ({ type: 'canvas.edge.removed' as const, payload: { edge } })),
      ...joinedEdges.map((item) => ({ type: 'canvas.edge.added' as const, payload: { edge: item.edge } })),
      { type: 'canvas.node.updated', payload: { nodeId, patch: { groupId: id } } },
      ...post.groups.filter((g) => touchedGroupIds.has(g.id)).map((g) => ({ type: 'canvas.group.updated', payload: { group: g } })),
    ])
  },
  removeNodeFromGroup: (nodeId) => {
    const pre = get()
    const hadGroup = Boolean(pre.nodes.find((candidate) => candidate.id === nodeId)?.groupId)
    const touchedGroupIds = pre.groups.filter((g) => g.nodeIds.includes(nodeId)).map((g) => g.id)
    // 退出组 → 撤掉这些组的组入参给它连的边（只认 viaGroupId，手工边不动）。
    let nextEdges = pre.edges
    for (const groupId of touchedGroupIds) {
      nextEdges = removeGroupLinkEdgesForMember(nextEdges, groupId, nodeId)
    }
    const removedGroupEdges = pre.edges.filter((edge) => !nextEdges.includes(edge))
    pushUndoSnapshot(pre)
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node?.groupId) return
      for (const group of state.groups) {
        group.nodeIds = group.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      }
      delete node.groupId
      if (nextEdges !== state.edges) state.edges = nextEdges
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    if (hadGroup) {
      const post = get()
      emitCanvasGesture([
        ...removedGroupEdges.map((edge) => ({ type: 'canvas.edge.removed' as const, payload: { edge } })),
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
