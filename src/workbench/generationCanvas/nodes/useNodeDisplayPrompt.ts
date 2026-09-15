import React from 'react'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { selectStableCanvasNodes } from '../store/canvasNodeProjection'
import { projectPromptForDisplay } from '../../assets/promptMentions'
import { currentReferenceMedia } from './mentionCandidates'

/** 把持久化 mention 标记按当前有序媒体参考投影成非编辑态的 @imageN/@videoN/@audioN 文本。 */
export function useNodeDisplayPrompt(node: GenerationCanvasNode): string {
  // S3(2026-09-12)：这条挂在每张卡上。订阅整张 state.nodes 等于「画布上任何一个节点动一下，
  // 每张卡都重算一遍 @提及 投影」，而这份投影只看参考媒体、根本不看位置。改订位置无关的稳定投影
  // （canvasNodeProjection，2026-09-01 就是为这件事建的）：位置churn 下引用不变 → memo 命中 → 不重算。
  const nodes = useGenerationCanvasStore(selectStableCanvasNodes)
  const edges = useGenerationCanvasStore((state) => state.edges)
  return React.useMemo(() => {
    return projectPromptForDisplay(node.prompt || '', currentReferenceMedia(node, nodes, edges))
  }, [edges, node, nodes])
}
