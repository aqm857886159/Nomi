import { isTextPromptEdge } from '../agent/referenceEdgeCapability'
import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import { sortEdgesByOrder } from '../model/graphOps'
import { docToPlainText } from './textActions'

type TextPromptContext = {
  nodes?: readonly GenerationCanvasNode[]
  edges?: readonly GenerationCanvasEdge[]
}

function textNodePlainContent(node: GenerationCanvasNode): string {
  const docText = docToPlainText(node.contentJson)
  if (docText) return docText
  const resultText = typeof node.result?.text === 'string' ? node.result.text.trim() : ''
  if (resultText) return resultText
  return (node.prompt || '').trim()
}

export function collectConnectedTextPromptParts(
  node: GenerationCanvasNode,
  context: TextPromptContext = {},
): string[] {
  const executionKind = getGenerationNodeExecutionKind(node.kind)
  if (executionKind !== 'image' && executionKind !== 'video') return []

  const nodes = context.nodes || [node]
  const edges = context.edges || []
  if (edges.length === 0) return []

  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const seenSources = new Set<string>()
  const parts: string[] = []
  for (const edge of sortEdgesByOrder([...edges])) {
    if (edge.target !== node.id || seenSources.has(edge.source)) continue
    const source = nodesById.get(edge.source)
    if (!source || !isTextPromptEdge(source, node)) continue
    const text = textNodePlainContent(source)
    if (!text) continue
    seenSources.add(source.id)
    parts.push(text)
  }
  return parts
}

export function withConnectedTextPrompts(
  node: GenerationCanvasNode,
  context: TextPromptContext = {},
): GenerationCanvasNode {
  const textParts = collectConnectedTextPromptParts(node, context)
  if (textParts.length === 0) return node
  const prompt = [(node.prompt || '').trim(), ...textParts].filter(Boolean).join('\n\n')
  return prompt === (node.prompt || '') ? node : { ...node, prompt }
}
