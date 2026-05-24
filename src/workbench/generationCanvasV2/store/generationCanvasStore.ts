import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { subscribeWithSelector } from 'zustand/middleware'
import {
  connectNodes,
  createGenerationNode,
  disconnectEdge,
  removeNodes,
  rollbackNodeHistory,
  upsertNode,
} from '../model/graphOps'
import { isGenerationNodeKind, isImageLikeGenerationNodeKind } from '../model/generationNodeKinds'
import { nodeGroupSchema } from '../model/generationCanvasSchema'
import { CATEGORY_IDS, type CategoryId } from '../model/generationCanvasTypes'
import type {
  GenerationCanvasEdge,
  GenerationCanvasNode,
  GenerationCanvasSelectionRect,
  GenerationCanvasSnapshot,
  GenerationNodeKind,
  GenerationNodeProgress,
  GenerationNodeResult,
  GenerationNodeRunRecord,
  GenerationNodeStatus,
  GenerationNodeTaskKind,
  NodeGroup,
} from '../model/generationCanvasTypes'
import type { WorkbenchAiMessage } from '../../ai/workbenchAiTypes'

type CreateNodeInput = {
  kind: GenerationNodeKind
  title?: string
  prompt?: string
  position?: { x: number; y: number }
  select?: boolean
}

type NodeProgressInput = Omit<GenerationNodeProgress, 'updatedAt'> & {
  updatedAt?: number
}

type NodeRunRecordInput = Omit<GenerationNodeRunRecord, 'id' | 'startedAt' | 'updatedAt'> & {
  id?: string
  startedAt?: number
  updatedAt?: number
}

type NodeRunRecordPatch = Partial<Omit<GenerationNodeRunRecord, 'id' | 'startedAt'>> & {
  updatedAt?: number
}

type CanvasMutationOptions = {
  persist?: boolean
}

type GenerationCanvasState = {
  isReady: boolean
  persistRevision: number
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
  canvasZoom: number
  canvasOffset: { x: number; y: number }
  generationAiDraft: string
  generationAiMessages: WorkbenchAiMessage[]
  generationAiCollapsed: boolean
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  markReady: () => void
  captureHistory: () => void
  setCanvasTransform: (zoom: number, offset: { x: number; y: number }) => void
  setCanvasZoom: (zoom: number) => void
  setGenerationAiDraft: (draft: string) => void
  setGenerationAiMessages: (messages: WorkbenchAiMessage[] | ((messages: WorkbenchAiMessage[]) => WorkbenchAiMessage[])) => void
  setGenerationAiCollapsed: (collapsed: boolean) => void
  resetGenerationAiConversation: () => void
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  commitPersistedChange: () => void
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>, options?: CanvasMutationOptions) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }, options?: CanvasMutationOptions) => void
  moveSelectedNodes: (delta: { x: number; y: number }, options?: CanvasMutationOptions) => void
  selectNodesInRect: (rect: GenerationCanvasSelectionRect, additive?: boolean) => void
  deleteSelectedNodes: () => void
  copySelectedNodes: () => void
  cutSelectedNodes: () => void
  pasteNodes: () => void
  undo: () => void
  redo: () => void
  selectNode: (nodeId: string, additive?: boolean) => void
  clearSelection: () => void
  startConnection: (nodeId: string) => void
  cancelConnection: () => void
  connectToNode: (targetNodeId: string) => void
  connectNodes: (sourceNodeId: string, targetNodeId: string, mode?: GenerationCanvasEdge['mode']) => void
  updateEdgeMode: (edgeId: string, mode: GenerationCanvasEdge['mode']) => void
  disconnectEdge: (edgeId: string) => void
  setNodeStatus: (nodeId: string, status: GenerationNodeStatus, error?: string) => void
  setNodeProgress: (nodeId: string, progress?: NodeProgressInput) => void
  appendNodeRun: (nodeId: string, run: NodeRunRecordInput) => GenerationNodeRunRecord
  trackNodeRun: (nodeId: string, runId: string, patch: NodeRunRecordPatch) => void
  addNodeResult: (nodeId: string, result: GenerationNodeResult) => void
  duplicateNodeForRegeneration: (nodeId: string) => GenerationCanvasNode | null
  /** Phase E: move a node into a different category (sidebar drop / right-click). */
  reassignNodeCategory: (nodeId: string, categoryId: string) => void
  copyNodeToCategory: (nodeId: string, categoryId: string) => GenerationCanvasNode | null
  deleteNode: (nodeId: string) => void
  createGroup: (categoryId: string, name?: string) => NodeGroup | null
  renameGroup: (groupId: string, name: string) => void
  setGroupColor: (groupId: string, color: string) => void
  ungroup: (groupId: string) => void
  deleteGroup: (groupId: string, deleteNodes?: boolean) => void
  moveNodeToGroup: (nodeId: string, groupId: string) => void
  removeNodeFromGroup: (nodeId: string) => void
  reorderGroup: (categoryId: string, activeGroupId: string, overGroupId: string) => void
  rollbackHistory: (nodeId: string, resultId: string) => void
  readSnapshot: () => GenerationCanvasSnapshot
  restoreSnapshot: (snapshot: unknown) => void
}

type GenerationCanvasHistoryState = Pick<
  GenerationCanvasState,
  'nodes' | 'edges' | 'groups' | 'selectedNodeIds' | 'pendingConnectionSourceId'
>

type GenerationCanvasClipboard = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
}

const HISTORY_LIMIT = 80
const CLIPBOARD_OFFSET = 36

let undoStack: GenerationCanvasHistoryState[] = []
let redoStack: GenerationCanvasHistoryState[] = []
let clipboard: GenerationCanvasClipboard | null = null

function getHistoryFlags(): Pick<GenerationCanvasState, 'canUndo' | 'canRedo' | 'hasClipboard'> {
  return {
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    hasClipboard: clipboard !== null,
  }
}

function shouldPersistCanvasMutation(options?: CanvasMutationOptions): boolean {
  return options?.persist !== false
}

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === 'string' && (CATEGORY_IDS as readonly string[]).includes(value)
}

function bumpPersistRevision(state: Pick<GenerationCanvasState, 'persistRevision'>): void {
  state.persistRevision += 1
}

const seedNodes = [
  createGenerationNode({
    id: 'gen-v2-text-1',
    kind: 'text',
    title: '剧本片段',
    x: 96,
    y: 360,
    prompt: '写下镜头、角色或画面提示词。',
  }),
  createGenerationNode({
    id: 'gen-v2-image-1',
    kind: 'image',
    title: '关键画面',
    x: 440,
    y: 380,
    prompt: '承接上游提示词生成图片。',
  }),
]

function createNodeId(kind: GenerationNodeKind): string {
  return `gen-v2-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function createGroupId(categoryId: CategoryId): string {
  return `group-${categoryId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function createRunId(nodeId: string): string {
  return `run-${nodeId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createClipboardNodeId(nodeId: string): string {
  return `${nodeId}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function snapshotHistoryState(state: GenerationCanvasState): GenerationCanvasHistoryState {
  return {
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    selectedNodeIds: state.selectedNodeIds,
    pendingConnectionSourceId: state.pendingConnectionSourceId,
  }
}

function pushUndoSnapshot(state: GenerationCanvasState): void {
  undoStack = [...undoStack, snapshotHistoryState(state)].slice(-HISTORY_LIMIT)
  redoStack = []
}

function buildSelectedClipboard(state: GenerationCanvasState): GenerationCanvasClipboard | null {
  const selected = new Set(state.selectedNodeIds)
  if (!selected.size) return null
  const nodes = state.nodes.filter((node) => selected.has(node.id))
  if (!nodes.length) return null
  return {
    nodes,
    edges: state.edges.filter((edge) => selected.has(edge.source) && selected.has(edge.target)),
  }
}

function cloneClipboardPayload(payload: GenerationCanvasClipboard): GenerationCanvasHistoryState {
  const idMap = new Map<string, string>()
  const nodes = payload.nodes.map((node) => {
    const nextId = createClipboardNodeId(node.id)
    idMap.set(node.id, nextId)
    return {
      ...node,
      id: nextId,
      title: node.title ? `${node.title} 副本` : node.title,
      position: {
        x: node.position.x + CLIPBOARD_OFFSET,
        y: node.position.y + CLIPBOARD_OFFSET,
      },
    }
  })
  const edges = payload.edges.flatMap((edge) => {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) return []
    return [{
      ...edge,
      id: `edge-${source}-${target}`,
      source,
      target,
    }]
  })
  return {
    nodes,
    edges,
    groups: [],
    selectedNodeIds: nodes.map((node) => node.id),
    pendingConnectionSourceId: '',
  }
}

function nodeIntersectsRect(node: GenerationCanvasNode, rect: GenerationCanvasSelectionRect): boolean {
  const width = node.size?.width ?? 300
  const height = node.size?.height ?? 220
  const nodeRect = {
    minX: node.position.x,
    minY: node.position.y,
    maxX: node.position.x + width,
    maxY: node.position.y + height,
  }
  return nodeRect.minX <= rect.maxX
    && nodeRect.maxX >= rect.minX
    && nodeRect.minY <= rect.maxY
    && nodeRect.maxY >= rect.minY
}

export function __resetGenerationCanvasHistoryForTests(): void {
  undoStack = []
  redoStack = []
  clipboard = null
}

function getResultTaskKind(result: GenerationNodeResult): GenerationNodeTaskKind | undefined {
  if (result.taskKind) return result.taskKind
  if (result.type === 'text') return 'text'
  if (result.type === 'image') return 'image'
  if (result.type === 'video') return 'video'
  return undefined
}

function createProgress(progress: NodeProgressInput, fallbackRunId?: string): GenerationNodeProgress {
  const percent = typeof progress.percent === 'number' ? Math.min(100, Math.max(0, progress.percent)) : undefined
  return {
    ...progress,
    runId: progress.runId ?? fallbackRunId,
    percent,
    updatedAt: progress.updatedAt ?? Date.now(),
  }
}

function normalizeGenerationCanvasSnapshot(input: unknown): GenerationCanvasSnapshot {
  if (!input || typeof input !== 'object') {
    return {
      nodes: seedNodes,
      edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
      groups: [],
      selectedNodeIds: [],
    }
  }
  const raw = input as Record<string, unknown>
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes.flatMap((item): GenerationCanvasNode[] => {
        if (!item || typeof item !== 'object') return []
        const node = item as Record<string, unknown>
        const id = typeof node.id === 'string' ? node.id.trim() : ''
        const kind = isGenerationNodeKind(node.kind) ? node.kind : null
        const positionRaw = node.position && typeof node.position === 'object' ? node.position as Record<string, unknown> : {}
        const x = typeof positionRaw.x === 'number' && Number.isFinite(positionRaw.x) ? positionRaw.x : 0
        const y = typeof positionRaw.y === 'number' && Number.isFinite(positionRaw.y) ? positionRaw.y : 0
        if (!id || !kind) return []
        const rawCategoryId = typeof node.categoryId === 'string' ? node.categoryId.trim() : undefined
        const categoryId = isCategoryId(rawCategoryId) ? rawCategoryId : undefined
        const { categoryId: _discardedCategoryId, ...nodeWithoutCategoryId } = node
        const normalizedNode: Omit<GenerationCanvasNode, 'categoryId'> = {
          ...(nodeWithoutCategoryId as Omit<GenerationCanvasNode, 'categoryId'>),
          id,
          kind,
          title: typeof node.title === 'string' ? node.title : id,
          position: { x, y },
        }
        return [categoryId ? { ...normalizedNode, categoryId } : normalizedNode]
      })
    : []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges = Array.isArray(raw.edges)
    ? raw.edges.flatMap((item): GenerationCanvasEdge[] => {
        if (!item || typeof item !== 'object') return []
        const edge = item as Record<string, unknown>
        const id = typeof edge.id === 'string' ? edge.id.trim() : ''
        const source = typeof edge.source === 'string' ? edge.source.trim() : ''
        const target = typeof edge.target === 'string' ? edge.target.trim() : ''
        if (!id || !source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
        return [{ ...(edge as GenerationCanvasEdge), id, source, target }]
      })
    : []
  const selectedNodeIds = Array.isArray(raw.selectedNodeIds)
    ? raw.selectedNodeIds.filter((id): id is string => typeof id === 'string' && nodeIds.has(id))
    : []
  return {
    nodes,
    edges,
    groups: Array.isArray(raw.groups)
      ? raw.groups.flatMap((group): NodeGroup[] => {
          const parsed = nodeGroupSchema.safeParse(group)
          return parsed.success ? [parsed.data] : []
        })
      : [],
    selectedNodeIds,
  }
}

function getRunDurationSeconds(run: Pick<GenerationNodeRunRecord, 'startedAt' | 'completedAt' | 'durationSeconds'>): number | undefined {
  if (typeof run.durationSeconds === 'number') return run.durationSeconds
  if (typeof run.completedAt !== 'number') return undefined
  return Math.max(0, (run.completedAt - run.startedAt) / 1000)
}

function mergeRunRecord(
  run: GenerationNodeRunRecord,
  patch: NodeRunRecordPatch,
  now = Date.now(),
): GenerationNodeRunRecord {
  const isTerminalStatus = patch.status === 'success' || patch.status === 'error' || patch.status === 'cancelled'
  const completedAt = patch.completedAt ?? (isTerminalStatus ? now : run.completedAt)
  const nextRun = {
    ...run,
    ...patch,
    updatedAt: patch.updatedAt ?? now,
    completedAt,
    progress: isTerminalStatus && !patch.progress ? undefined : patch.progress ?? run.progress,
  }
  return {
    ...nextRun,
    durationSeconds: getRunDurationSeconds(nextRun),
  }
}

export const useGenerationCanvasStore = create<GenerationCanvasState>()(subscribeWithSelector(immer((set, get) => ({
  isReady: false,
  persistRevision: 0,
  nodes: seedNodes,
  edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
  groups: [],
  selectedNodeIds: [],
  pendingConnectionSourceId: '',
  canvasZoom: 1,
  canvasOffset: { x: 0, y: 0 },
  generationAiDraft: '',
  generationAiMessages: [],
  generationAiCollapsed: true,
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  markReady: () => set({ isReady: true }),
  captureHistory: () => {
    pushUndoSnapshot(get())
    set((state) => {
      Object.assign(state, getHistoryFlags())
    })
  },
  setCanvasTransform: (zoom, offset) => set({ canvasZoom: zoom, canvasOffset: offset }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),
  setGenerationAiDraft: (generationAiDraft) => {
    set({ generationAiDraft })
  },
  setGenerationAiMessages: (messages) => {
    set((state) => {
      state.generationAiMessages = typeof messages === 'function' ? messages(state.generationAiMessages) : messages
    })
  },
  setGenerationAiCollapsed: (generationAiCollapsed) => {
    set({ generationAiCollapsed })
  },
  resetGenerationAiConversation: () => {
    set({ generationAiDraft: '', generationAiMessages: [] })
  },
  addNode: (input) => {
    const currentState = get()
    const existingCount = currentState.nodes.filter((node) => node.kind === input.kind).length
    const nextNode = createGenerationNode({
      id: createNodeId(input.kind),
      kind: input.kind,
      title: input.title,
      prompt: input.prompt,
      x: input.position?.x ?? 120 + existingCount * 34,
      y: input.position?.y ?? 360 + existingCount * 30,
    })
    pushUndoSnapshot(currentState)
    set((state) => {
      state.nodes = upsertNode(state.nodes, nextNode)
      state.selectedNodeIds = input.select === false ? state.selectedNodeIds : [nextNode.id]
      state.pendingConnectionSourceId = ''
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
    return nextNode
  },
  commitPersistedChange: () => {
    set((state) => {
      bumpPersistRevision(state)
    })
  },
  updateNode: (nodeId, patch, options) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      Object.assign(node, patch)
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
  },
  updateNodePrompt: (nodeId, prompt) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.prompt = prompt
      bumpPersistRevision(state)
    })
  },
  moveNode: (nodeId, position, options) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (node.position.x === position.x && node.position.y === position.y) return
      node.position = position
      if (shouldPersistCanvasMutation(options)) bumpPersistRevision(state)
    })
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
  },
  selectNodesInRect: (rect, additive = false) => {
    set((state) => {
      const rectIds = state.nodes.filter((node) => nodeIntersectsRect(node, rect)).map((node) => node.id)
      if (!additive) {
        state.selectedNodeIds = rectIds
        state.pendingConnectionSourceId = ''
        return
      }
      const next = new Set(state.selectedNodeIds)
      rectIds.forEach((id) => next.add(id))
      state.selectedNodeIds = Array.from(next)
      state.pendingConnectionSourceId = ''
    })
  },
  deleteSelectedNodes: () => {
    const currentState = get()
    if (!currentState.selectedNodeIds.length) return
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  copySelectedNodes: () => {
    const nextClipboard = buildSelectedClipboard(get())
    if (!nextClipboard) return
    clipboard = nextClipboard
    set(getHistoryFlags())
  },
  cutSelectedNodes: () => {
    const currentState = get()
    const nextClipboard = buildSelectedClipboard(currentState)
    if (!nextClipboard) return
    clipboard = nextClipboard
    pushUndoSnapshot(currentState)
    set((state) => {
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      state.nodes = next.nodes
      state.edges = next.edges
      state.selectedNodeIds = []
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  pasteNodes: () => {
    const currentState = get()
    if (!clipboard) return
    const cloned = cloneClipboardPayload(clipboard)
    if (!cloned.nodes.length) return
    pushUndoSnapshot(currentState)
    clipboard = {
      nodes: cloned.nodes,
      edges: cloned.edges,
    }
    set((state) => {
      state.nodes = [...state.nodes, ...cloned.nodes]
      state.edges = [...state.edges, ...cloned.edges]
      state.selectedNodeIds = cloned.selectedNodeIds
      state.pendingConnectionSourceId = ''
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  undo: () => {
    const currentState = get()
    const previous = undoStack.at(-1)
    if (!previous) return
    undoStack = undoStack.slice(0, -1)
    redoStack = [...redoStack, snapshotHistoryState(currentState)].slice(-HISTORY_LIMIT)
    set((state) => {
      state.nodes = previous.nodes
      state.edges = previous.edges
      state.groups = previous.groups
      state.selectedNodeIds = previous.selectedNodeIds
      state.pendingConnectionSourceId = previous.pendingConnectionSourceId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
  },
  redo: () => {
    const currentState = get()
    const next = redoStack.at(-1)
    if (!next) return
    redoStack = redoStack.slice(0, -1)
    undoStack = [...undoStack, snapshotHistoryState(currentState)].slice(-HISTORY_LIMIT)
    set((state) => {
      state.nodes = next.nodes
      state.edges = next.edges
      state.groups = next.groups
      state.selectedNodeIds = next.selectedNodeIds
      state.pendingConnectionSourceId = next.pendingConnectionSourceId
      bumpPersistRevision(state)
      Object.assign(state, getHistoryFlags())
    })
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
  clearSelection: () => {
    set({ selectedNodeIds: [], pendingConnectionSourceId: '' })
  },
  startConnection: (nodeId) => {
    set({ pendingConnectionSourceId: nodeId })
  },
  cancelConnection: () => {
    set({ pendingConnectionSourceId: '' })
  },
  connectToNode: (targetNodeId) => {
    const sourceNodeId = get().pendingConnectionSourceId
    if (!sourceNodeId) return
    set((state) => {
      const sourceNode = state.nodes.find((n) => n.id === sourceNodeId)
      const targetNode = state.nodes.find((n) => n.id === targetNodeId)
      let mode: GenerationCanvasEdge['mode'] = 'reference'
      if (sourceNode && targetNode && isImageLikeGenerationNodeKind(sourceNode.kind) && targetNode.kind === 'video') {
        const incoming = state.edges.filter((e) => e.target === targetNodeId)
        if (!incoming.some((e) => e.mode === 'first_frame')) mode = 'first_frame'
        else if (!incoming.some((e) => e.mode === 'last_frame')) mode = 'last_frame'
      }
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges !== state.edges) {
        state.edges = nextEdges
        bumpPersistRevision(state)
      }
      state.pendingConnectionSourceId = ''
    })
  },
  connectNodes: (sourceNodeId, targetNodeId, mode) => {
    set((state) => {
      const nextEdges = connectNodes(state.edges, sourceNodeId, targetNodeId, mode)
      if (nextEdges === state.edges) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
  },
  updateEdgeMode: (edgeId, mode) => {
    set((state) => {
      const edge = state.edges.find((candidate) => candidate.id === edgeId)
      if (!edge || edge.mode === mode) return
      edge.mode = mode
      bumpPersistRevision(state)
    })
  },
  disconnectEdge: (edgeId) => {
    set((state) => {
      const nextEdges = disconnectEdge(state.edges, edgeId)
      if (nextEdges.length === state.edges.length) return
      state.edges = nextEdges
      bumpPersistRevision(state)
    })
  },
  setNodeStatus: (nodeId, status, error) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const nextError = status === 'error' ? error || node.error || 'Generation failed' : undefined
        const latestRun = node.runs?.[0]
      const runs = latestRun && latestRun.status !== 'success' && latestRun.status !== 'error' && latestRun.status !== 'cancelled'
          ? [mergeRunRecord(latestRun, { status: status === 'idle' ? 'cancelled' : status, error: nextError }), ...(node.runs || []).slice(1)]
          : node.runs

      node.status = status
      node.error = nextError
      node.progress = status === 'queued' || status === 'running' ? node.progress : undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  setNodeProgress: (nodeId, progress) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (!progress) {
        node.progress = undefined
        bumpPersistRevision(state)
        return
      }
        const nextProgress = createProgress(progress, node.runs?.[0]?.id)
        const runs = node.runs?.length
          ? [
              mergeRunRecord(node.runs[0], {
                status: node.runs[0].status === 'queued' ? 'running' : node.runs[0].status,
                progress: nextProgress,
                taskId: nextProgress.taskId ?? node.runs[0].taskId,
                taskKind: nextProgress.taskKind ?? node.runs[0].taskKind,
              }, nextProgress.updatedAt),
              ...node.runs.slice(1),
            ]
          : node.runs
      node.status = node.status === 'queued' ? 'running' : node.status || 'running'
      node.error = undefined
      node.progress = nextProgress
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  appendNodeRun: (nodeId, run) => {
    const now = Date.now()
    const nextRun: GenerationNodeRunRecord = {
      ...run,
      id: run.id ?? createRunId(nodeId),
      startedAt: run.startedAt ?? now,
      updatedAt: run.updatedAt ?? now,
    }
    const normalizedRun = {
      ...nextRun,
      durationSeconds: getRunDurationSeconds(nextRun),
    }
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      node.status = normalizedRun.status === 'cancelled' ? 'idle' : normalizedRun.status
      node.error = normalizedRun.status === 'error' ? normalizedRun.error || node.error || 'Generation failed' : undefined
      node.progress = normalizedRun.progress
      node.runs = [normalizedRun, ...(node.runs || []).filter((entry) => entry.id !== normalizedRun.id)]
      bumpPersistRevision(state)
    })
    return normalizedRun
  },
  trackNodeRun: (nodeId, runId, patch) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const runIndex = (node.runs || []).findIndex((entry) => entry.id === runId)
      if (runIndex < 0) return
        const nextRuns = [...(node.runs || [])]
        const nextRun = mergeRunRecord(nextRuns[runIndex], patch)
        nextRuns[runIndex] = nextRun
        const isLatestRun = runIndex === 0
      node.status = isLatestRun ? (nextRun.status === 'cancelled' ? 'idle' : nextRun.status) : node.status
      node.error = isLatestRun && nextRun.status === 'error' ? nextRun.error || 'Generation failed' : undefined
      node.progress = isLatestRun ? nextRun.progress : node.progress
      node.runs = nextRuns
      bumpPersistRevision(state)
    })
  },
  addNodeResult: (nodeId, result) => {
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
        const latestRun = node.runs?.[0]
        const completedAt = result.createdAt || Date.now()
        const runs = latestRun
          ? [
              mergeRunRecord(latestRun, {
                status: 'success',
                taskId: result.taskId ?? latestRun.taskId,
                taskKind: getResultTaskKind(result) ?? latestRun.taskKind,
                assetId: result.assetId ?? latestRun.assetId,
                assetRefId: result.assetRefId ?? latestRun.assetRefId,
                resultId: result.id,
                raw: result.raw ?? latestRun.raw,
                completedAt,
                durationSeconds: result.durationSeconds ?? latestRun.durationSeconds,
                progress: undefined,
                error: undefined,
              }, completedAt),
              ...(node.runs || []).slice(1),
            ]
          : node.runs
      node.result = result
      node.history = [result, ...(node.history || []).filter((entry) => entry.id !== result.id)]
      node.status = 'success'
      node.error = undefined
      node.progress = undefined
      node.runs = runs
      bumpPersistRevision(state)
    })
  },
  duplicateNodeForRegeneration: (nodeId) => {
    const state = get()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) return null
    const nextNode = createGenerationNode({
      id: createNodeId(node.kind),
      kind: node.kind,
      title: node.title,
      prompt: node.prompt,
      x: node.position.x + 40,
      y: node.position.y + 40,
    })
    const history = node.history ? [...node.history] : []
    const result = node.result
    if (result && !history.some((entry) => entry.id === result.id)) {
      history.unshift(result)
    }
    const copiedNode: GenerationCanvasNode = {
      ...nextNode,
      history,
      references: node.references ? [...node.references] : [],
      meta: node.meta ? { ...node.meta } : {},
      size: node.size ? { ...node.size } : nextNode.size,
      prompt: node.prompt || '',
      categoryId: node.categoryId,
      groupId: node.groupId,
      derivedFrom: node.id,
    }
    pushUndoSnapshot(state)
    set((current) => {
      const original = current.nodes.find((candidate) => candidate.id === nodeId)
      if (original && history.length) original.history = history
      current.nodes.push(copiedNode)
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
    return copiedNode
  },
  reassignNodeCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return
    set((state) => {
      const node = state.nodes.find((candidate) => candidate.id === nodeId)
      if (!node) return
      if (node.categoryId === id) return
      node.categoryId = id
      bumpPersistRevision(state)
    })
  },
  copyNodeToCategory: (nodeId, categoryId) => {
    const id = String(categoryId || '').trim()
    if (!isCategoryId(id)) return null
    const source = get().nodes.find((candidate) => candidate.id === nodeId)
    if (!source) return null
    const { id: _sourceId, categoryId: _sourceCategoryId, groupId: _sourceGroupId, ...rest } = source
    const copiedNode: GenerationCanvasNode = {
      ...rest,
      id: createClipboardNodeId(source.id),
      title: source.title ? `${source.title} 副本` : source.title,
      position: {
        x: source.position.x + CLIPBOARD_OFFSET,
        y: source.position.y + CLIPBOARD_OFFSET,
      },
      categoryId: id,
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
  },
  ungroup: (groupId) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
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
  },
  deleteGroup: (groupId, deleteNodes = false) => {
    const current = get()
    const existing = current.groups.find((group) => group.id === groupId)
    if (!existing) return
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
  },
  moveNodeToGroup: (nodeId, groupId) => {
    const id = String(groupId || '').trim()
    if (!id) return
    const current = get()
    const sourceNode = current.nodes.find((candidate) => candidate.id === nodeId)
    const targetGroup = current.groups.find((candidate) => candidate.id === id)
    if (!sourceNode || !targetGroup || sourceNode.categoryId !== targetGroup.categoryId) return
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
  },
  removeNodeFromGroup: (nodeId) => {
    pushUndoSnapshot(get())
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
  },
  rollbackHistory: (nodeId, resultId) => {
    set((state) => {
      const nextNodes = rollbackNodeHistory(state.nodes, nodeId, resultId)
      if (nextNodes === state.nodes) return
      state.nodes = nextNodes
      bumpPersistRevision(state)
    })
  },
  readSnapshot: () => {
    const state = get()
    return {
      nodes: state.nodes,
      edges: state.edges,
      groups: state.groups,
      selectedNodeIds: state.selectedNodeIds,
    }
  },
	restoreSnapshot: (snapshot) => {
	    const normalized = normalizeGenerationCanvasSnapshot(snapshot)
	    undoStack = []
    redoStack = []
    clipboard = null
	    set({
      isReady: true,
      persistRevision: get().persistRevision,
	      nodes: normalized.nodes,
      edges: normalized.edges,
      groups: normalized.groups,
      selectedNodeIds: normalized.selectedNodeIds,
      pendingConnectionSourceId: '',
      canvasZoom: 1,
      canvasOffset: { x: 0, y: 0 },
      ...getHistoryFlags(),
    })
  },
}))))
