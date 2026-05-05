import type { CreationDocumentAction } from '../workbenchTypes'

export type WorkbenchAiMessage = {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  documentAction?: CreationDocumentAction
}
