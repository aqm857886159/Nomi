export type GenerationNodeKind =
  | 'text'
  | 'character'
  | 'scene'
  | 'image'
  | 'keyframe'
  | 'video'
  | 'shot'
  | 'output'
  | 'panorama'

export type GenerationNodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'error'

export type GenerationResultType = 'image' | 'video' | 'text'

export type GenerationNodeTaskKind = 'text' | 'image' | 'video' | 'workflow' | 'asset' | 'unknown'

export type GenerationNodeResult = {
  id: string
  type: GenerationResultType
  url?: string
  thumbnailUrl?: string
  text?: string
  model?: string
  durationSeconds?: number
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  assetId?: string
  assetRefId?: string
  raw?: unknown
  createdAt: number
}

export type GenerationNodeProgress = {
  runId?: string
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  phase?: string
  message?: string
  percent?: number
  updatedAt: number
}

export type GenerationNodeRunStatus = Exclude<GenerationNodeStatus, 'idle'> | 'cancelled'

export type GenerationNodeRunRecord = {
  id: string
  status: GenerationNodeRunStatus
  taskId?: string
  taskKind?: GenerationNodeTaskKind
  assetId?: string
  assetRefId?: string
  progress?: GenerationNodeProgress
  resultId?: string
  error?: string
  raw?: unknown
  startedAt: number
  updatedAt: number
  completedAt?: number
  durationSeconds?: number
}

export type GenerationCanvasNode = {
  id: string
  kind: GenerationNodeKind
  title: string
  position: { x: number; y: number }
  size?: { width: number; height: number }
  prompt?: string
  references?: string[]
  result?: GenerationNodeResult
  history?: GenerationNodeResult[]
  progress?: GenerationNodeProgress
  runs?: GenerationNodeRunRecord[]
  status?: GenerationNodeStatus
  error?: string
  meta?: Record<string, unknown>
}

export type GenerationCanvasEdge = {
  id: string
  source: string
  target: string
  mode?: GenerationCanvasEdgeMode
}

export type GenerationCanvasEdgeMode =
  | 'reference'
  | 'first_frame'
  | 'last_frame'
  | 'style_ref'
  | 'character_ref'
  | 'composition_ref'

export type GenerationCanvasSelectionRect = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type GenerationCanvasSnapshot = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  selectedNodeIds: string[]
}
