import { createEdgeId, createGenerationNode, removeNodes, upsertNode } from '../model/graphOps'
import { normalizeParameterEdges } from '../model/parameterReferenceSlots'
import { resolveInsertionPosition } from './resolveInsertionPosition'
import { tidyCanvasLayout } from './tidyCanvasLayout'
import { getDefaultCategoryForNodeKind, type GenerationCanvasNode } from '../model/generationCanvasTypes'
import { resolveNodeVisualSize } from '../nodes/nodeSizing'
import { isShotNumberedNode, nextShotIndex } from '../model/shotNumbering'
import { buildCanvasNode } from '../../../../electron/capabilityCore/canvasNodeFactory'
import { RENDERER_NODE_FACTORY_DEPS } from './rendererNodeFactoryDeps'
import { CLIPBOARD_OFFSET, createClipboardNodeId, createNodeId } from './canvasIds'
import { bumpPersistRevision, isCategoryId, shouldEmitCanvasMutation, shouldPersistCanvasMutation } from './canvasGuards'
import { getHistoryFlags, getUndoJournalGeneration, pushUndoSnapshot } from '../events/canvasUndoJournal'
import { getActiveCanvasGestureContext } from '../events/canvasGestureContext'
import { emitCanvasGesture } from '../events/canvasEventEmitter'
import { useWorkbenchStore } from '../../workbenchStore'
import type { CanvasNodeActions, CanvasSliceCreator } from './canvasStoreTypes'
import i18n from '../../../i18n'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { captureCanvasWorkflowTemplate, instantiateCanvasWorkflowTemplate } from '../plugins/canvasWorkflowTemplates'

// 删节点 → 时间轴对账(数据一致性):clip 创建时把节点产物 url 快照冻结、无 node→clip 同步,
// 删了节点时间轴仍引用悬空/过期素材(导出会渲染已删节点的旧帧)。删完节点单向通知 workbenchStore
// 移除引用该 sourceNodeId 的 clip。跨 store 最小耦合:只在 action 运行时取 getState()(live binding,
// 不在模块初始化期触碰,避免 workbenchStore→genStore→canvasNodeActions→workbenchStore 循环初始化)。
// 调用方缺失/无悬空 clip 时是 no-op,绝不影响画布删除本身。
function reconcileTimelineForDeletedNodes(nodeIds: readonly string[]): void {
  useWorkbenchStore.getState().reconcileTimelineForDeletedNodes(nodeIds)
}

// 编辑突发(burst)粒度的撤销点:提示词/参数是逐键连续写入,原先完全不打 barrier →
// Cmd+Z 一撤直接跳回上一个结构操作,把整段输入连带丢掉(「回退不到我之前的地方」,
// 2026-06-12 用户复现)。同一节点的连续编辑算一步;换节点或停顿 >3s 开新一步。
const EDIT_BURST_WINDOW_MS = 3000
let lastEditBurst = { nodeId: '', at: 0, generation: -1 }

function pushEditBurstBarrier(nodeId: string, state: unknown): void {
  // Agent edits/compensation own a transaction barrier. They must not start or
  // prolong a user's typing burst and swallow the next manual edit's Undo.
  if (getActiveCanvasGestureContext()?.suppressUndoBarriers) return
  const now = Date.now()
  const generation = getUndoJournalGeneration()
  if (lastEditBurst.generation !== generation || lastEditBurst.nodeId !== nodeId || now - lastEditBurst.at > EDIT_BURST_WINDOW_MS) {
    pushUndoSnapshot(state)
  }
  lastEditBurst = { nodeId, at: now, generation }
}

export const createCanvasNodeActions: CanvasSliceCreator<CanvasNodeActions> = (set, get) => ({
  addNode: (input) => {
    const currentState = get()
    if (input.typeId && !canvasPluginRegistry.resolve(input.typeId)) {
      throw new Error(`canvas plugin node is not registered: ${input.typeId}`)
    }
    if (input.pluginState && input.typeId !== input.pluginState.typeId) {
      throw new Error('canvas plugin node state type does not match node type')
    }
    // 节点出生必带 categoryId：调用方没给就按 kind 推断（与迁移共用同一映射）。
    // 这是「无分类节点」的总闸——漏传 categoryId 的创建入口曾在下次打开项目时
    // 触发 legacy 迁移 toast 甚至删节点（审计 A4 的入口集）。
    const categoryId = isCategoryId(input.categoryId) ? input.categoryId : getDefaultCategoryForNodeKind(input.kind)
    // 落点真碰撞避让总闸：所有交互式建卡入口都经此 addNode——工具栏 / 定妆 / 素材导入 /
    // agent 单建 / 裁剪截图等派生卡。任一传进来的落点（或缺省落点）都拿「同分类」已有卡做
    // 真实 AABB 避让，挪到第一个不遮挡的空位 → 卡片之间不再相互遮挡（用户报障的根因：
    // 旧版除工具栏外各入口都信任原始落点、零避让）。只比同分类：画布按 activeCategoryId
    // 分屏渲染，跨分类卡不同屏、不会遮挡，拿它们避让只会把新卡无谓推远。批量建卡（create_nodes）
    // 与项目加载直接 set nodes、不走这里，故其自有的紧凑布局不受影响。
    // exactPosition：调用方已算好成组紧凑布局（切图瓦片），信任原值、不避让——否则会被逐张推散。
    const siblings = currentState.nodes.filter((node) => (node.categoryId || 'shots') === (categoryId || 'shots'))
    const position = input.exactPosition && input.position
      ? input.position
      : resolveInsertionPosition(input.kind, input.position ?? { x: 120, y: 360 }, siblings)
    // 节点构造经**共用工厂**（与 electron 能力核/MCP 同一份纯函数）：title/size/prompt/references/history/
    // status/meta/categoryId/shotIndex 全由工厂按 UI 同款规则补齐。store 只留 store 关注点
    // （落点避让、撤销点、set、事件）。镜号 = 出生即分配的存储身份（max+1，审计 A2）——工厂据传入的
    // currentState.nodes 算 max+1；categoryId 已在上面定好，显式传入让工厂与 store 一致。
    const nextNode = buildCanvasNode(
      {
        kind: input.kind,
        title: input.title,
        prompt: input.prompt,
        x: position.x,
        y: position.y,
        categoryId,
        ...(input.meta ? { meta: input.meta } : {}),
        ...(input.size ? { size: input.size } : {}),
      },
      currentState.nodes,
      RENDERER_NODE_FACTORY_DEPS,
    ) as GenerationCanvasNode
    if (input.typeId) nextNode.typeId = input.typeId
    if (input.pluginState) nextNode.pluginState = input.pluginState
    pushUndoSnapshot(currentState)
    set((state) => {
      state.nodes = upsertNode(state.nodes, nextNode)
      state.selectedNodeIds = input.select === false ? state.selectedNodeIds : [nextNode.id]
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    // S5-a 影子日志:nextNode 是 immer 外构造的 plain 对象,emit 内部再深拷贝一层
    emitCanvasGesture([{ type: 'canvas.node.added', payload: { node: nextNode } }])
    return nextNode
  },
  commitPersistedChange: () => {
    set((state) => {
      bumpPersistRevision(state)
    })
  },
  updateNode: (nodeId, patch, options) => {
    if (!get().nodes.some((candidate) => candidate.id === nodeId)) return
    // 用户态内容与插件 envelope 编辑按统一撤销边界落点；状态机等运行态 patch 不打。
    // 插件只能通过这个 action 请求 state patch，因此不会产生绕过 undo 的第二条写路径。
    if (options?.history !== false && ('prompt' in patch || 'meta' in patch || 'title' in patch)) {
      pushEditBurstBarrier(nodeId, get())
    } else if (options?.history !== false && 'pluginState' in patch) {
      pushUndoSnapshot(get())
    }
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      const declarationChanged = 'meta' in patch && node.meta?.parameterReferenceSlots !== patch.meta?.parameterReferenceSlots
      Object.assign(node, patch)
      if (declarationChanged) state.edges = normalizeParameterEdges(state.nodes, state.edges)
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
    if (shouldEmitCanvasMutation(options)) {
      emitCanvasGesture([{ type: 'canvas.node.updated', payload: { nodeId, patch } }])
    }
  },
  updateNodes: (updates) => {
    const currentState = get()
    const existingIds = new Set(currentState.nodes.map((node) => node.id))
    const applicable = updates.filter((update) => existingIds.has(update.nodeId))
    if (applicable.length === 0) return
    pushUndoSnapshot(currentState)
    set((state) => {
      const patches = new Map(applicable.map((update) => [update.nodeId, update.patch]))
      let declarationChanged = false
      for (const node of state.nodes) {
        const patch = patches.get(node.id)
        if (patch) {
          if ('meta' in patch && node.meta?.parameterReferenceSlots !== patch.meta?.parameterReferenceSlots) declarationChanged = true
          Object.assign(node, patch)
        }
      }
      if (declarationChanged) state.edges = normalizeParameterEdges(state.nodes, state.edges)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture(
      applicable.map(({ nodeId, patch }) => ({ type: 'canvas.node.updated', payload: { nodeId, patch } })),
    )
  },
  updateNodePrompt: (nodeId, prompt) => {
    if (!get().nodes.some((candidate) => candidate.id === nodeId)) return
    pushEditBurstBarrier(nodeId, get())
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.prompt = prompt
      bumpPersistRevision(state)
    })
    emitCanvasGesture([{ type: 'canvas.node.prompt-changed', payload: { nodeId, prompt } }])
  },
  setNodeLocked: (nodeId, locked) => {
    const existing = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!existing || Boolean(existing.locked) === locked) return
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.locked = locked
      bumpPersistRevision(state)
    })
    // 专用事件(非 node.updated):锁是审计要点(谁锁的/何时锁的),日志里必须一眼可查。
    // title 随事件携带:S9 记忆提炼器增量扫描拿不到旧事件里的标题,事件自含可读。
    emitCanvasGesture([{ type: locked ? 'canvas.node.locked' : 'canvas.node.unlocked', payload: { nodeId, title: existing.title } }])
  },
  moveNode: (nodeId, position, options) => {
    // 守卫上移到 set 外(影子日志要与真实变更同真值;语义与原内嵌守卫等价)
    const existing = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!existing || (existing.position.x === position.x && existing.position.y === position.y)) return
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.position = position
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
    if (shouldEmitCanvasMutation(options)) {
      emitCanvasGesture([{ type: 'canvas.node.moved', payload: { nodeId, position } }])
    }
  },
  moveSelectedNodes: (delta, options) => {
    set((state) => {
      const selected = new Set(state.selectedNodeIds)
      if (!selected.size || (delta.x === 0 && delta.y === 0)) return
      let moved = false
      for (const node of state.nodes) {
        if (!selected.has(node.id)) continue
        node.position = {
          x: Math.round(node.position.x + delta.x),
          y: Math.round(node.position.y + delta.y),
        }
        moved = true
      }
      if (moved && shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
    // 后态读取:每个被移动节点一条 moved,共享一个手势 txn
    if (!shouldEmitCanvasMutation(options) || (delta.x === 0 && delta.y === 0)) return
    const selected = new Set(get().selectedNodeIds)
    if (selected.size) {
      emitCanvasGesture(
        get().nodes
          .filter((node) => selected.has(node.id))
          .map((node) => ({ type: 'canvas.node.moved', payload: { nodeId: node.id, position: node.position } })),
      )
    }
  },
  tidyCategory: (categoryId, targetAspect) => {
    const state0 = get()
    const catNodes = state0.nodes.filter((node) => (node.categoryId || 'shots') === categoryId)
    if (!catNodes.length) return
    const idSet = new Set(catNodes.map((node) => node.id))
    const catEdges = state0.edges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target))
    const positions = tidyCanvasLayout(catNodes, catEdges, targetAspect)
    // 全部位置已是目标态 → 不打撤销点、不持久（避免空操作污染撤销栈 / 触发存盘）。
    const changed = catNodes.some((node) => {
      const next = positions.get(node.id)
      return next && (next.x !== node.position.x || next.y !== node.position.y)
    })
    if (!changed) return
    pushUndoSnapshot(state0)
    set((state) => {
      for (const node of state.nodes) {
        const next = positions.get(node.id)
        if (next) node.position = { x: next.x, y: next.y }
      }
      bumpPersistRevision(state)
    })
    emitCanvasGesture(
      catNodes
        .map((node) => positions.get(node.id) && { node, pos: positions.get(node.id)! })
        .filter((entry): entry is { node: GenerationCanvasNode; pos: { x: number; y: number } } => Boolean(entry))
        .map((entry) => ({ type: 'canvas.node.moved' as const, payload: { nodeId: entry.node.id, position: entry.pos } })),
    )
  },
  deleteSelectedNodes: () => {
    const currentState = get()
    if (!currentState.selectedNodeIds.length) return
    const removedIds = [...currentState.selectedNodeIds]
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture(removedIds.map((nodeId) => ({ type: 'canvas.node.removed', payload: { nodeId } })))
    reconcileTimelineForDeletedNodes(removedIds)
  },
  selectNode: (nodeId, additive = false) => {
    set((state) => {
      if (!additive) {
        state.selectedNodeIds = [nodeId]
        return
      }
      const nextIds = state.selectedNodeIds.includes(nodeId)
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId]
      state.selectedNodeIds = nextIds
    })
  },
  selectNodes: (nodeIds) => {
    const state = get()
    const existing = new Set(state.nodes.map((node) => node.id))
    const seen = new Set<string>()
    const nextSelection = nodeIds.filter((nodeId) => {
      if (!existing.has(nodeId) || seen.has(nodeId)) return false
      seen.add(nodeId)
      return true
    })
    if (
      nextSelection.length === state.selectedNodeIds.length &&
      nextSelection.every((nodeId, index) => nodeId === state.selectedNodeIds[index])
    ) return
    set({ selectedNodeIds: nextSelection })
  },
  clearSelection: () => {
    // 已经是「空选区 + 无待连」时直接返回：点空白是高频动作（现在拖画布也走这条路），
    // 每次都 set 会造出新的 selectedNodeIds 数组，把「选区变了」的信号广播给每个订阅者
    // （节点选择器、边层 memo…）——明明什么都没变。幂等守卫放在 store 这层，所有入口通吃。
    const state = get()
    if (state.selectedNodeIds.length === 0 && state.pendingConnectionSourceId === '') return
    set({ selectedNodeIds: [], pendingConnectionSourceId: '', pendingConnectionSourceSide: 'right' })
  },
  // v0.7.5: 全选当前分类的所有节点（如果传 categoryId 则限定，否则全选画布所有节点）
  selectAllNodes: (categoryId?: string) => {
    set((state) => {
      const ids = state.nodes
        .filter((n) => !categoryId || (n.categoryId || 'shots') === categoryId)
        .map((n) => n.id)
      state.selectedNodeIds = ids
    })
  },
  // 框选：选中与矩形相交（AABB）的当前分类节点。additive 时与现有选区并集。
  selectNodesInRect: (rect, categoryId, additive = false) => {
    const left = Math.min(rect.x1, rect.x2)
    const right = Math.max(rect.x1, rect.x2)
    const top = Math.min(rect.y1, rect.y2)
    const bottom = Math.max(rect.y1, rect.y2)
    set((state) => {
      const hits = state.nodes.filter((node) => {
        if (categoryId && (node.categoryId || 'shots') !== categoryId) return false
        const { width: w, height: h } = resolveNodeVisualSize(node)
        return node.position.x + w >= left && node.position.x <= right &&
          node.position.y + h >= top && node.position.y <= bottom
      }).map((node) => node.id)
      if (!additive) {
        state.selectedNodeIds = hits
        return
      }
      const merged = new Set(state.selectedNodeIds)
      hits.forEach((id) => merged.add(id))
      state.selectedNodeIds = Array.from(merged)
    })
  },
  duplicateNodeForRegeneration: (nodeId) => {
    const state = get()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return null
    // 变体落点经同分类避让：默认贴在原卡右下 +40，被占则螺旋挪开，不压住原卡或邻卡。
    const dupSiblings = state.nodes.filter((candidate) => (candidate.categoryId || 'shots') === (node.categoryId || 'shots'))
    const preferredDupPosition = { x: node.position.x + 40, y: node.position.y + 40 }
    let dupPosition = resolveInsertionPosition(node.kind, preferredDupPosition, dupSiblings)
    // Keep a duplicate in the usable canvas when the first free spiral slot
    // happens to be above/left of the origin. The below-source fallback still
    // goes through the shared collision resolver and preserves spacing.
    if (dupPosition.x < 0 || dupPosition.y < 0) {
      dupPosition = resolveInsertionPosition(
        node.kind,
        { x: node.position.x, y: node.position.y + resolveNodeVisualSize(node).height + 48 },
        dupSiblings,
      )
    }
    const nextNode = createGenerationNode({
      id: createNodeId(node.kind),
      kind: node.kind,
      title: node.title,
      prompt: node.prompt,
      x: dupPosition.x,
      y: dupPosition.y,
    })
    const copiedNode: GenerationCanvasNode = {
      ...nextNode,
      history: [],
      references: structuredClone(node.references ?? []),
      meta: structuredClone(node.meta ?? {}),
      size: node.size ? { ...node.size } : nextNode.size,
      prompt: node.prompt || '',
      categoryId: node.categoryId,
      groupId: node.groupId,
      derivedFrom: node.id,
      runs: [],
      status: 'idle',
      // 变体是新身份：领自己的镜头编号，不继承原节点的号。
      ...(isShotNumberedNode(node) ? { shotIndex: nextShotIndex(state.nodes) } : {}),
    }
    const incomingEdges = state.edges
      .filter((edge) => edge.target === nodeId)
      .map((edge, index) => ({
        ...structuredClone(edge),
        id: createEdgeId(edge.source, copiedNode.id, edge.order ?? index),
        target: copiedNode.id,
      }))
    pushUndoSnapshot(state)
    set((current) => {
      current.nodes.push(copiedNode)
      current.edges.push(...incomingEdges)
      if (copiedNode.groupId) {
        const group = current.groups.find((candidate) => candidate.id === copiedNode.groupId)
        if (group && !group.nodeIds.includes(copiedNode.id)) {
          group.nodeIds.push(copiedNode.id)
          group.updatedAt = Date.now()
        }
      }
      current.selectedNodeIds = [copiedNode.id]
      bumpPersistRevision(current)
      Object.assign(current, getHistoryFlags())
    })
    // 一笔手势写完新节点、继承的入边与组成员变化；旧产物/运行态不进入变体。
    const touchedGroup = copiedNode.groupId ? get().groups.find((group) => group.id === copiedNode.groupId) : undefined
    emitCanvasGesture([
      { type: 'canvas.node.added', payload: { node: copiedNode } },
      ...incomingEdges.map((edge) => ({ type: 'canvas.edge.added' as const, payload: { edge } })),
      ...(touchedGroup ? [{ type: 'canvas.group.updated', payload: { group: touchedGroup } }] : []),
    ])
    return copiedNode
  },
  reassignNodeCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return
    const existing = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!existing || existing.categoryId === id) return
    // 完整 patch（分类 + 编号跟随）：store 变更与发出的事件用同一份，否则 replay≢store
    // （编号变更不入事件，重放出残留 shotIndex——S5-a 安全网抓出的真分叉）。
    // 编号跟随分镜成员身份：离开分镜清号（patch 用 null=删除信号），进入分镜领新号
    // （不复用旧号——旧号可能已被后续节点顶替语义）。
    const willBeShotNumbered = isShotNumberedNode({ kind: existing.kind, categoryId: id })
    const patch: Record<string, unknown> = { categoryId: id }
    if (willBeShotNumbered) {
      patch.shotIndex = nextShotIndex(get().nodes)
    } else if (typeof existing.shotIndex === 'number') {
      patch.shotIndex = null
    }
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.categoryId = id
      if (willBeShotNumbered) {
        node.shotIndex = patch.shotIndex as number
      } else if (typeof node.shotIndex === 'number') {
        delete node.shotIndex
      }
      bumpPersistRevision(state)
    })
    emitCanvasGesture([{ type: 'canvas.node.updated', payload: { nodeId, patch } }])
  },
  copyNodeToCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const source = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!source) return null
    const { id: _sourceId, categoryId: _sourceCategoryId, groupId: _sourceGroupId, shotIndex: _sourceShotIndex, ...rest } = source
    // 副本落进目标分类：默认 +OFFSET，再拿目标分类已有卡避让（目标分类可能已塞满，
    // 固定偏移会直接压上去）。比同分类——目标分类 id，不是源分类。
    const copySiblings = get().nodes.filter((candidate) => (candidate.categoryId || 'shots') === (id || 'shots'))
    const copyPosition = resolveInsertionPosition(
      source.kind,
      { x: source.position.x + CLIPBOARD_OFFSET, y: source.position.y + CLIPBOARD_OFFSET },
      copySiblings,
    )
    const copiedNode: GenerationCanvasNode = {
      ...rest,
      id: createClipboardNodeId(source.id),
      title: source.title ? i18n.t('generationCommon.whiteboard.copyName', { name: source.title }) : source.title,
      position: copyPosition,
      categoryId: id,
      // 跨分类副本是新身份：落分镜则领新号，不复制原号（编号唯一）。
      ...(isShotNumberedNode({ kind: source.kind, categoryId: id })
        ? { shotIndex: nextShotIndex(get().nodes) }
        : {}),
      derivedFrom: source.id,
      references: source.references ? [...source.references] : undefined,
      history: source.history ? [...source.history] : undefined,
      runs: source.runs ? [...source.runs] : undefined,
      meta: source.meta ? { ...source.meta } : undefined,
      size: source.size ? { ...source.size } : source.size,
    }
    pushUndoSnapshot(get())
    set((state) => {
      state.nodes.push(copiedNode)
      state.selectedNodeIds = [copiedNode.id]
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([{ type: 'canvas.node.added', payload: { node: copiedNode } }])
    return copiedNode
  },
  deleteNode: (nodeId) => {
    const current = get()
    if (!current.nodes.some((candidate) => candidate.id === nodeId)) return
    pushUndoSnapshot(current)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, [nodeId])
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = state.groups.map((group) => ({
        ...group,
        nodeIds: group.nodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId),
      }))
      state.selectedNodeIds = state.selectedNodeIds.filter((candidateNodeId) => candidateNodeId !== nodeId)
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    // node.removed 只表达"删节点+其边"(deleteSelectedNodes 不清组,语义须分开);
    // 本 action 还清理了组成员 → 发受影响组的后态(影子期不改 store 行为,只如实记账)。
    const touchedGroups = get().groups.filter((group) => current.groups.some((before) => before.id === group.id && before.nodeIds.includes(nodeId)))
    emitCanvasGesture([
      { type: 'canvas.node.removed', payload: { nodeId } },
      ...touchedGroups.map((group) => ({ type: 'canvas.group.updated', payload: { group } })),
    ])
    reconcileTimelineForDeletedNodes([nodeId])
  },
  saveSelectedAsWorkflowTemplate: (name) => {
    const currentState = get()
    const template = captureCanvasWorkflowTemplate(
      currentState.nodes,
      currentState.edges,
      currentState.selectedNodeIds,
      name || '',
      `workflow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      currentState.groups,
    )
    if (!template) return null
    set((state) => {
      state.workflowTemplates = [...state.workflowTemplates, template]
      bumpPersistRevision(state)
    })
    return template
  },
  instantiateWorkflowTemplate: (templateId, position) => {
    const template = get().workflowTemplates.find((candidate) => candidate.id === templateId)
    if (!template) return []
    return get().instantiateWorkflowTemplateSnapshot(template, position)
  },
  instantiateWorkflowTemplateSnapshot: (template, position) => {
    const currentState = get()
    const instantiated = instantiateCanvasWorkflowTemplate(template, position, createNodeId, createEdgeId)
    if (!instantiated.nodes.length) return []
    pushUndoSnapshot(currentState)
    set((state) => {
      state.nodes = [...state.nodes, ...instantiated.nodes]
      state.edges = [...state.edges, ...instantiated.edges]
      state.groups = [...state.groups, ...instantiated.groups]
      state.selectedNodeIds = instantiated.nodes.map((node) => node.id)
      state.pendingConnectionSourceId = ''
      state.pendingConnectionSourceSide = 'right'
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    emitCanvasGesture([
      ...instantiated.nodes.map((node) => ({ type: 'canvas.node.added' as const, payload: { node } })),
      ...instantiated.edges.map((edge) => ({ type: 'canvas.edge.added' as const, payload: { edge } })),
      ...instantiated.groups.map((group) => ({ type: 'canvas.group.created' as const, payload: { group } })),
    ])
    return instantiated.nodes
  },
})
