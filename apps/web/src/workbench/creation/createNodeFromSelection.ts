import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'
import type { WorkspaceMode } from '../workbenchStore'

export type SelectionGenerationKind = 'image' | 'video'

type NodePosition = { x: number; y: number }
type AddGenerationCanvasNode = (input: {
  kind: SelectionGenerationKind
  title: string
  prompt: string
  position?: NodePosition
}) => GenerationCanvasNode

type CreateNodeFromSelectionInput = {
  selectedText: string
  kind: SelectionGenerationKind
  position?: NodePosition
  addGenerationNode: AddGenerationCanvasNode
  setWorkspaceMode: (mode: WorkspaceMode) => void
}

export function createNodeFromSelection(input: CreateNodeFromSelectionInput): boolean {
  const prompt = typeof input.selectedText === 'string' ? input.selectedText.trim() : ''
  if (!prompt) return false

  const label = input.kind === 'image' ? '图片' : '视频'
  input.addGenerationNode({
    kind: input.kind,
    title: label,
    prompt,
    position: input.position,
  })
  input.setWorkspaceMode('generation')
  return true
}
