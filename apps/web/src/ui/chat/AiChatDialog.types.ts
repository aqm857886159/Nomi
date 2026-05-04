import type { AgentSkillDto, MemoryConversationItemDto } from '../../api/server'

export type ChatRole = 'assistant' | 'user'

export type ChatTodoItem = {
  status: 'pending' | 'in_progress' | 'completed'
  content: string
}

export type ChatMessage = {
  id: string
  role: ChatRole
  content: string
  ts: string
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  assets?: Array<{ title: string; url: string; thumbnailUrl?: string }>
  progressLines?: string[]
  turnVerdict?: {
    status: 'satisfied' | 'partial' | 'failed'
    reasons: string[]
  }
  diagnosticFlags?: Array<{
    code: string
    severity: 'high' | 'medium'
    title: string
    detail: string
  }>
  todoSnapshot?: ChatTodoItem[]
}

export type ChatSessionLane = 'general' | 'canvas' | 'storyboard'

export type SendOptions = {
  text?: string
  skill?: AgentSkillDto | null
  attachCanvasContext?: boolean
}

export type UploadedReferenceAssetMeta = {
  assetId?: string
  name?: string
}

export type ProjectTextMaterialState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  count: number
  error: string
}

export type InspirationQuickAction = {
  skill: AgentSkillDto | null
  title: string
  description?: string
  prompt?: string
}

export type ChatQuickActionPreset = {
  title: string
  description?: string
  prompt?: string
}

export type ChatHistoryItem = MemoryConversationItemDto
