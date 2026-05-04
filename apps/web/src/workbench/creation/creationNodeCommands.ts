import type { GenerationCanvasNode } from '../generationCanvasV2/model/generationCanvasTypes'
import type { WorkspaceMode } from '../workbenchStore'
import { createNodeFromSelection } from './createNodeFromSelection'

type AddGenerationNode = (input: {
  kind: 'text' | 'image' | 'video'
  title?: string
  prompt?: string
  position?: { x: number; y: number }
}) => GenerationCanvasNode

type CreationNodeCommandDependencies = {
  addGenerationNode: AddGenerationNode
  setWorkspaceMode: (mode: WorkspaceMode) => void
}

export function createStoryboardNodeFromContent(
  content: string,
  dependencies: CreationNodeCommandDependencies,
): boolean {
  const prompt = content.trim()
  if (!prompt) return false

  dependencies.addGenerationNode({ kind: 'text', title: '故事板', prompt })
  dependencies.setWorkspaceMode('generation')
  return true
}

export function createImageNodeFromContent(
  content: string,
  dependencies: CreationNodeCommandDependencies,
): boolean {
  return createNodeFromSelection({
    selectedText: content,
    kind: 'image',
    addGenerationNode: dependencies.addGenerationNode,
    setWorkspaceMode: dependencies.setWorkspaceMode,
  })
}
