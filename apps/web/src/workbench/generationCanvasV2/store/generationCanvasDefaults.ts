import { createGenerationNode } from '../model/graphOps'
import type { GenerationCanvasSnapshot } from '../model/generationCanvasTypes'

export function createDefaultGenerationCanvasSnapshot(): GenerationCanvasSnapshot {
  const textNode = createGenerationNode({
    id: 'gen-v2-text-1',
    kind: 'text',
    title: '剧本片段',
    x: 96,
    y: 360,
    prompt: '写下镜头、角色或画面提示词。',
  })
  const imageNode = createGenerationNode({
    id: 'gen-v2-image-1',
    kind: 'image',
    title: '关键画面',
    x: 440,
    y: 380,
    prompt: '承接上游提示词生成图片。',
  })
  return {
    nodes: [textNode, imageNode],
    edges: [{ id: 'edge-gen-v2-text-1-gen-v2-image-1', source: textNode.id, target: imageNode.id }],
    selectedNodeIds: [],
  }
}
