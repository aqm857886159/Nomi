import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { projectPromptForDisplay } from '../../assets/promptMentions'
import { currentReferenceMedia } from './mentionCandidates'

/** 把持久化 mention 标记按当前有序媒体参考投影成非编辑态的 @imageN/@videoN/@audioN 文本。 */
export function useNodeDisplayPrompt(node: GenerationCanvasNode): string {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  return React.useMemo(() => {
    return projectPromptForDisplay(node.prompt || '', currentReferenceMedia(node, nodes, edges))
  }, [edges, node, nodes])
}
