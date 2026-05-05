import type { Edge, Node } from '@xyflow/react'
import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationCanvasSnapshot, GenerationNodeKind, GenerationResultType } from './generationCanvasTypes'
import { createGenerationNode } from './graphOps'

type LegacyNodeData = Record<string, unknown>
type LegacyNode = Node<LegacyNodeData> & {
  width?: number
  height?: number
}
type LegacyEdge = Edge<Record<string, unknown>>

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

function readFirstResultUrl(value: unknown): string {
  if (!Array.isArray(value)) return ''
  for (const item of value) {
    const record = readRecord(item)
    const url = readString(record.url)
    if (url) return url
  }
  return ''
}

function normalizeGenerationKind(value: unknown): GenerationNodeKind {
  const raw = readString(value)
  if (raw === 'video' || raw === 'composeVideo') return 'video'
  if (raw === 'image' || raw === 'imageEdit' || raw === 'storyboard' || raw === 'keyframe') return 'image'
  if (raw === 'character') return 'character'
  if (raw === 'scene') return 'scene'
  return 'text'
}

function resolvePrompt(data: LegacyNodeData): string {
  return readString(data.prompt)
    || readString(data.storyboard)
    || readString(data.text)
    || readString(data.content)
    || readString(data.systemPrompt)
}

function resolveResult(data: LegacyNodeData): { type: GenerationResultType; url: string } | null {
  const videoUrl = readString(data.videoUrl) || readFirstResultUrl(data.videoResults)
  if (videoUrl) return { type: 'video', url: videoUrl }
  const imageUrl = readString(data.imageUrl) || readString(data.url) || readFirstResultUrl(data.imageResults)
  if (imageUrl) return { type: 'image', url: imageUrl }
  return null
}

function resolveNodeSize(node: LegacyNode, data: LegacyNodeData): { width: number; height: number } | undefined {
  const style = readRecord(node.style)
  const width = readFiniteNumber(node.width) ?? readFiniteNumber(style.width) ?? readFiniteNumber(data.nodeWidth)
  const height = readFiniteNumber(node.height) ?? readFiniteNumber(style.height) ?? readFiniteNumber(data.nodeHeight)
  if (width === null || height === null) return undefined
  return {
    width: Math.max(220, Math.round(width)),
    height: Math.max(120, Math.round(height)),
  }
}

export function importLegacyFlowGraph(input: {
  nodes: LegacyNode[]
  edges: LegacyEdge[]
}): GenerationCanvasSnapshot {
  const nodes: GenerationCanvasNode[] = input.nodes.flatMap((legacyNode, index): GenerationCanvasNode[] => {
    if (legacyNode.type === 'groupNode' || legacyNode.type === 'ioNode') return []
    const data = readRecord(legacyNode.data)
    const kind = normalizeGenerationKind(data.kind || data.type || legacyNode.type)
    const result = resolveResult(data)
    const node = createGenerationNode({
      id: String(legacyNode.id || `legacy-flow-node-${index + 1}`),
      kind,
      title: readString(data.label) || readString(data.name) || readString(data.title) || `节点 ${index + 1}`,
      x: Math.round(legacyNode.position?.x ?? 120 + index * 28),
      y: Math.round(legacyNode.position?.y ?? 160 + index * 24),
      prompt: resolvePrompt(data),
    })
    return [{
      ...node,
      ...(resolveNodeSize(legacyNode, data) ? { size: resolveNodeSize(legacyNode, data) } : {}),
      ...(result
        ? {
            result: {
              id: `${node.id}-imported-result`,
              type: result.type,
              url: result.url,
              createdAt: Date.now(),
            },
            status: 'success',
          }
        : {}),
    }]
  })

  const nodeIds = new Set(nodes.map((node) => node.id))
  const edges: GenerationCanvasEdge[] = input.edges.flatMap((edge, index): GenerationCanvasEdge[] => {
    const source = String(edge.source || '').trim()
    const target = String(edge.target || '').trim()
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
    return [{
      id: String(edge.id || `legacy-flow-edge-${index + 1}`),
      source,
      target,
    }]
  })

  return {
    nodes,
    edges,
    selectedNodeIds: [],
  }
}
