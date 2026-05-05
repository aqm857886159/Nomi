import { create } from 'zustand'
import {
  connectNodes,
  createGenerationNode,
  disconnectEdge,
  patchNode,
  removeNodes,
  rollbackNodeHistory,
  upsertNode,
} from '../model/graphOps'
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
} from '../model/generationCanvasTypes'

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

type GenerationCanvasState = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  selectedNodeIds: string[]
  pendingConnectionSourceId: string
  canvasZoom: number
  canvasOffset: { x: number; y: number }
  canUndo: boolean
  canRedo: boolean
  hasClipboard: boolean
  captureHistory: () => void
  setCanvasTransform: (zoom: number, offset: { x: number; y: number }) => void
  setCanvasZoom: (zoom: number) => void
  addNode: (input: CreateNodeInput) => GenerationCanvasNode
  updateNode: (nodeId: string, patch: Partial<GenerationCanvasNode>) => void
  updateNodePrompt: (nodeId: string, prompt: string) => void
  moveNode: (nodeId: string, position: { x: number; y: number }) => void
  moveSelectedNodes: (delta: { x: number; y: number }) => void
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
  rollbackHistory: (nodeId: string, resultId: string) => void
  readSnapshot: () => GenerationCanvasSnapshot
  restoreSnapshot: (snapshot: unknown) => void
}

type GenerationCanvasHistoryState = Pick<
  GenerationCanvasState,
  'nodes' | 'edges' | 'selectedNodeIds' | 'pendingConnectionSourceId'
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
      title: node.title ? `${node.title} Copy` : node.title,
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

function isGenerationNodeKind(value: unknown): value is GenerationNodeKind {
  return typeof value === 'string'
    && ['text', 'character', 'scene', 'image', 'keyframe', 'video', 'shot', 'output'].includes(value)
}

function normalizeGenerationCanvasSnapshot(input: unknown): GenerationCanvasSnapshot {
  if (!input || typeof input !== 'object') {
    return {
      nodes: seedNodes,
      edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
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
        return [{
          ...(node as GenerationCanvasNode),
          id,
          kind,
          title: typeof node.title === 'string' ? node.title : id,
          position: { x, y },
        }]
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

export const useGenerationCanvasStore = create<GenerationCanvasState>((set, get) => ({
  nodes: seedNodes,
  edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: 'gen-v2-text-1', target: 'gen-v2-image-1' }],
  selectedNodeIds: [],
  pendingConnectionSourceId: '',
  canvasZoom: 1,
  canvasOffset: { x: 0, y: 0 },
  canUndo: false,
  canRedo: false,
  hasClipboard: false,
  captureHistory: () => {
    set((state) => {
      pushUndoSnapshot(state)
      return { ...state, ...getHistoryFlags() }
    })
  },
  setCanvasTransform: (zoom, offset) => set({ canvasZoom: zoom, canvasOffset: offset }),
  setCanvasZoom: (zoom) => set({ canvasZoom: zoom }),
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
    set((state) => ({
      ...state,
      nodes: upsertNode(state.nodes, nextNode),
      selectedNodeIds: input.select === false ? state.selectedNodeIds : [nextNode.id],
      pendingConnectionSourceId: '',
      ...getHistoryFlags(),
    }))
    return nextNode
  },
  updateNode: (nodeId, patch) => {
    set((state) => ({ nodes: patchNode(state.nodes, nodeId, patch) }))
  },
  updateNodePrompt: (nodeId, prompt) => {
    set((state) => ({ nodes: patchNode(state.nodes, nodeId, { prompt }) }))
  },
  moveNode: (nodeId, position) => {
    set((state) => ({ nodes: patchNode(state.nodes, nodeId, { position }) }))
  },
  moveSelectedNodes: (delta) => {
    set((state) => {
      const selected = new Set(state.selectedNodeIds)
      if (!selected.size) return state
      return {
        ...state,
        nodes: state.nodes.map((node) => {
          if (!selected.has(node.id)) return node
          return {
            ...node,
            position: {
              x: Math.round(node.position.x + delta.x),
              y: Math.round(node.position.y + delta.y),
            },
          }
        }),
      }
    })
  },
  selectNodesInRect: (rect, additive = false) => {
    set((state) => {
      const rectIds = state.nodes.filter((node) => nodeIntersectsRect(node, rect)).map((node) => node.id)
      if (!additive) return { ...state, selectedNodeIds: rectIds, pendingConnectionSourceId: '' }
      const next = new Set(state.selectedNodeIds)
      rectIds.forEach((id) => next.add(id))
      return { ...state, selectedNodeIds: Array.from(next), pendingConnectionSourceId: '' }
    })
  },
  deleteSelectedNodes: () => {
    set((state) => {
      if (!state.selectedNodeIds.length) return state
      pushUndoSnapshot(state)
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      return { ...next, selectedNodeIds: [], ...getHistoryFlags() }
    })
  },
  copySelectedNodes: () => {
    const nextClipboard = buildSelectedClipboard(get())
    if (!nextClipboard) return
    clipboard = nextClipboard
    set(getHistoryFlags())
  },
  cutSelectedNodes: () => {
    set((state) => {
      const nextClipboard = buildSelectedClipboard(state)
      if (!nextClipboard) return state
      clipboard = nextClipboard
      pushUndoSnapshot(state)
      const next = removeNodes(state.nodes, state.edges, state.selectedNodeIds)
      return { ...next, selectedNodeIds: [], ...getHistoryFlags() }
    })
  },
  pasteNodes: () => {
    set((state) => {
      if (!clipboard) return state
      const cloned = cloneClipboardPayload(clipboard)
      if (!cloned.nodes.length) return state
      pushUndoSnapshot(state)
      clipboard = {
        nodes: cloned.nodes,
        edges: cloned.edges,
      }
      return {
        nodes: [...state.nodes, ...cloned.nodes],
        edges: [...state.edges, ...cloned.edges],
        selectedNodeIds: cloned.selectedNodeIds,
        pendingConnectionSourceId: '',
        ...getHistoryFlags(),
      }
    })
  },
  undo: () => {
    set((state) => {
      const previous = undoStack.at(-1)
      if (!previous) return state
      undoStack = undoStack.slice(0, -1)
      redoStack = [...redoStack, snapshotHistoryState(state)].slice(-HISTORY_LIMIT)
      return { ...previous, ...getHistoryFlags() }
    })
  },
  redo: () => {
    set((state) => {
      const next = redoStack.at(-1)
      if (!next) return state
      redoStack = redoStack.slice(0, -1)
      undoStack = [...undoStack, snapshotHistoryState(state)].slice(-HISTORY_LIMIT)
      return { ...next, ...getHistoryFlags() }
    })
  },
  selectNode: (nodeId, additive = false) => {
    set((state) => {
      if (!additive) return { selectedNodeIds: [nodeId] }
      const nextIds = state.selectedNodeIds.includes(nodeId)
        ? state.selectedNodeIds.filter((id) => id !== nodeId)
        : [...state.selectedNodeIds, nodeId]
      return { selectedNodeIds: nextIds }
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
      const IMAGE_LIKE_KINDS = new Set(['image', 'keyframe', 'character', 'scene'])
      const sourceNode = state.nodes.find((n) => n.id === sourceNodeId)
      const targetNode = state.nodes.find((n) => n.id === targetNodeId)
      let mode: GenerationCanvasEdge['mode'] = 'reference'
      if (sourceNode && targetNode && IMAGE_LIKE_KINDS.has(sourceNode.kind) && targetNode.kind === 'video') {
        const incoming = state.edges.filter((e) => e.target === targetNodeId)
        if (!incoming.some((e) => e.mode === 'first_frame')) mode = 'first_frame'
        else if (!incoming.some((e) => e.mode === 'last_frame')) mode = 'last_frame'
      }
      return {
        edges: connectNodes(state.edges, sourceNodeId, targetNodeId, mode),
        pendingConnectionSourceId: '',
      }
    })
  },
  connectNodes: (sourceNodeId, targetNodeId, mode) => {
    set((state) => ({ edges: connectNodes(state.edges, sourceNodeId, targetNodeId, mode) }))
  },
  updateEdgeMode: (edgeId, mode) => {
    set((state) => ({
      edges: state.edges.map((edge) => (edge.id === edgeId ? { ...edge, mode } : edge)),
    }))
  },
  disconnectEdge: (edgeId) => {
    set((state) => ({ edges: disconnectEdge(state.edges, edgeId) }))
  },
  setNodeStatus: (nodeId, status, error) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        const nextError = status === 'error' ? error || node.error || 'Generation failed' : undefined
        const latestRun = node.runs?.[0]
        const runs = latestRun && latestRun.status !== 'success' && latestRun.status !== 'error' && latestRun.status !== 'cancelled'
          ? [mergeRunRecord(latestRun, { status: status === 'idle' ? 'cancelled' : status, error: nextError }), ...(node.runs || []).slice(1)]
          : node.runs

        return {
          ...node,
          status,
          error: nextError,
          progress: status === 'queued' || status === 'running' ? node.progress : undefined,
          runs,
        }
      }),
    }))
  },
  setNodeProgress: (nodeId, progress) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        if (!progress) return { ...node, progress: undefined }
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
        return {
          ...node,
          status: node.status === 'queued' ? 'running' : node.status || 'running',
          error: undefined,
          progress: nextProgress,
          runs,
        }
      }),
    }))
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
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        return {
          ...node,
          status: normalizedRun.status === 'cancelled' ? 'idle' : normalizedRun.status,
          error: normalizedRun.status === 'error' ? normalizedRun.error || node.error || 'Generation failed' : undefined,
          progress: normalizedRun.progress,
          runs: [normalizedRun, ...(node.runs || []).filter((entry) => entry.id !== normalizedRun.id)],
        }
      }),
    }))
    return normalizedRun
  },
  trackNodeRun: (nodeId, runId, patch) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
        const runIndex = (node.runs || []).findIndex((entry) => entry.id === runId)
        if (runIndex < 0) return node
        const nextRuns = [...(node.runs || [])]
        const nextRun = mergeRunRecord(nextRuns[runIndex], patch)
        nextRuns[runIndex] = nextRun
        const isLatestRun = runIndex === 0
        return {
          ...node,
          status: isLatestRun ? (nextRun.status === 'cancelled' ? 'idle' : nextRun.status) : node.status,
          error: isLatestRun && nextRun.status === 'error' ? nextRun.error || 'Generation failed' : undefined,
          progress: isLatestRun ? nextRun.progress : node.progress,
          runs: nextRuns,
        }
      }),
    }))
  },
  addNodeResult: (nodeId, result) => {
    set((state) => ({
      nodes: state.nodes.map((node) => {
        if (node.id !== nodeId) return node
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
        return {
          ...node,
          result,
          history: [result, ...(node.history || []).filter((entry) => entry.id !== result.id)],
          status: 'success',
          error: undefined,
          progress: undefined,
          runs,
        }
      }),
    }))
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
    }
    set((current) => ({
      ...current,
      nodes: current.nodes.map((candidate) => (candidate.id === nodeId ? { ...candidate, history: history.length ? history : candidate.history } : candidate)).concat(copiedNode),
      selectedNodeIds: [copiedNode.id],
    }))
    return copiedNode
  },
  rollbackHistory: (nodeId, resultId) => {
    set((state) => ({ nodes: rollbackNodeHistory(state.nodes, nodeId, resultId) }))
  },
  readSnapshot: () => {
    const state = get()
    return {
      nodes: state.nodes,
      edges: state.edges,
      selectedNodeIds: state.selectedNodeIds,
    }
  },
  restoreSnapshot: (snapshot) => {
    const normalized = normalizeGenerationCanvasSnapshot(snapshot)
    undoStack = []
    redoStack = []
    clipboard = null
    set({
      nodes: normalized.nodes,
      edges: normalized.edges,
      selectedNodeIds: normalized.selectedNodeIds,
      pendingConnectionSourceId: '',
      canvasZoom: 1,
      canvasOffset: { x: 0, y: 0 },
      ...getHistoryFlags(),
    })
  },
}))
