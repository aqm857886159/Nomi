import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

export type ClipNodeOutputInput = {
  sourceClipNodeId: string
  sourceClipId?: string
  outputUrl: string
  relativePath: string
  durationSeconds: number
}

export function buildClipNodeOutputPatch(input: ClipNodeOutputInput): Pick<GenerationCanvasNode, 'result' | 'status' | 'meta'> {
  const result: GenerationNodeResult = {
    id: `clip-export:${input.relativePath}`,
    type: 'video',
    url: input.outputUrl,
    durationSeconds: Math.max(0.1, input.durationSeconds),
    taskKind: 'asset',
    createdAt: Date.now(),
  }
  return {
    result,
    status: 'success',
    meta: {
      sourceClipNodeId: input.sourceClipNodeId,
      ...(input.sourceClipId ? { sourceClipId: input.sourceClipId } : {}),
      outputRelativePath: input.relativePath,
      outputKind: 'clip-node-export',
    },
  }
}
