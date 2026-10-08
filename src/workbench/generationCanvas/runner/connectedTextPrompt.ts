import { textNodeBody } from '../../../../electron/shared/canvas/textNodeBody'
import { isTextPromptEdge } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { sortEdgesByOrder } from '../model/graphOps'

type TextPromptContext = {
  nodes?: readonly GenerationCanvasNode[]
  edges?: readonly GenerationCanvasEdge[]
}

/** 「这个节点生成时会接进哪一条文字」——一条连线 = 一项。 */
export type ConnectedTextInput = Readonly<{ sourceId: string; title: string; text: string }>

/**
 * 文字接进生成提示词的唯一投影：哪些文本节点、按什么顺序、各自是哪段字。
 * 执行器（withConnectedTextPrompts）与以后界面上的「引用」小签都只读它——说的 = 摆的（铁律⑩）。
 */
export function projectConnectedTextInputs(
  node: GenerationCanvasNode,
  context: TextPromptContext = {},
): ConnectedTextInput[] {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  // 与 isTextPromptEdge 的目标面同口径（image/video/model3d），改必同改——漏一侧=边被分类成 prompt 上下文却永不被消费。
  if (executionKind !== 'image' && executionKind !== 'video' && executionKind !== 'model3d') return []

  const nodes = context.nodes || [node]
  const edges = context.edges || []
  if (edges.length === 0) return []

  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const seenSources = new Set<string>()
  const inputs: ConnectedTextInput[] = []
  for (const edge of sortEdgesByOrder([...edges])) {
    if (edge.target !== node.id || seenSources.has(edge.source)) continue
    const source = nodesById.get(edge.source)
    if (!source || !isTextPromptEdge(source, node, edge.mode)) continue
    const text = textNodeBody(source)
    if (!text) continue
    seenSources.add(source.id)
    inputs.push({ sourceId: source.id, title: source.title, text })
  }
  return inputs
}

/** 把投影拼成最终提示词（节点自己的提示词在前，文字按投影顺序接在后面，空行分隔）。 */
export function composeConnectedTextPrompt(prompt: string | undefined, inputs: readonly ConnectedTextInput[]): string {
  return [(prompt || '').trim(), ...inputs.map((input) => input.text)].filter(Boolean).join('\n\n')
}

export function withConnectedTextPrompts(
  node: GenerationCanvasNode,
  context: TextPromptContext = {},
): GenerationCanvasNode {
  const inputs = projectConnectedTextInputs(node, context)
  if (inputs.length === 0) return node
  const prompt = composeConnectedTextPrompt(node.prompt, inputs)
  return prompt === (node.prompt || '') ? node : { ...node, prompt }
}
