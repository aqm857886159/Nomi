import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { resolveReferenceSlots } from '../runner/referenceSlots'
import { projectPromptForDisplay } from '../../assets/promptMentions'

/** 把持久化 mention 标记按当前有序参考图投影成非编辑态的 @imageN 文本。 */
export function useNodeDisplayPrompt(node: GenerationCanvasNode): string {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  return React.useMemo(() => {
    const imageSlot = resolveReferenceSlots(node, nodes, edges).find((slot) => slot.slotKind === 'image_ref')
    const orderedImageUrls = imageSlot?.fills.flatMap((fill) => (fill.url ? [fill.url] : [])) ?? []
    return projectPromptForDisplay(node.prompt || '', orderedImageUrls)
  }, [edges, node, nodes])
}
