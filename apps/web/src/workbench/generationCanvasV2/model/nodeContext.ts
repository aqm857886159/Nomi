import type { GenerationCanvasEdge, GenerationCanvasNode } from './generationCanvasTypes'

export type GenerationNodeContext = {
  node: GenerationCanvasNode | null
  upstream: GenerationCanvasNode[]
  prompt: string
  references: string[]
  resultUrls: string[]
  hasCycle: boolean
}

export function collectNodeContext(
  nodes: GenerationCanvasNode[],
  edges: GenerationCanvasEdge[],
  nodeId: string,
): GenerationNodeContext {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const upstream: GenerationCanvasNode[] = []
  let hasCycle = false

  const visit = (id: string) => {
    if (visiting.has(id)) {
      hasCycle = true
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    edges
      .filter((edge) => edge.target === id)
      .forEach((edge) => {
        visit(edge.source)
        const source = nodeById.get(edge.source)
        if (source && !upstream.some((item) => item.id === source.id)) {
          upstream.push(source)
        }
      })
    visiting.delete(id)
    visited.add(id)
  }

  visit(nodeId)

  const target = nodeById.get(nodeId) || null
  const promptParts = [...upstream, target].filter(Boolean).map((item) => item?.prompt || '').filter(Boolean)
  const references = [...new Set([...upstream, target].flatMap((item) => item?.references || []))]
  const resultUrls = upstream
    .map((item) => item.result?.url || item.result?.thumbnailUrl || '')
    .filter(Boolean)

  return {
    node: target,
    upstream,
    prompt: promptParts.join('\n\n'),
    references,
    resultUrls,
    hasCycle,
  }
}

