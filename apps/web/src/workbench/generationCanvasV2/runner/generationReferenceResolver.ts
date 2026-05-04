import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { collectNodeContext } from '../model/nodeContext'

export type ResolvedGenerationReferences = {
  referenceImages: string[]
  firstFrameUrl?: string
  lastFrameUrl?: string
  styleReferenceImages: string[]
  characterReferenceImages: string[]
  compositionReferenceImages: string[]
}

function asUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('blob:') ? trimmed : ''
}

function resultUrl(result: GenerationNodeResult | undefined): string {
  return asUrl(result?.url) || asUrl(result?.thumbnailUrl)
}

function findNodeResultUrl(nodesById: Map<string, GenerationCanvasNode>, reference: string): string {
  const [nodeId, resultId] = reference.split(':')
  const node = nodesById.get(nodeId)
  if (!node) return ''
  if (resultId) {
    const result = node.history?.find((entry) => entry.id === resultId)
    return resultUrl(result)
  }
  return resultUrl(node.result) || resultUrl(node.history?.[0])
}

function resolveReferenceUrl(nodesById: Map<string, GenerationCanvasNode>, reference: unknown): string {
  const directUrl = asUrl(reference)
  if (directUrl) return directUrl
  if (typeof reference !== 'string') return ''
  return findNodeResultUrl(nodesById, reference)
}

function pushUnique(output: string[], value: unknown) {
  const url = asUrl(value)
  if (url && !output.includes(url)) output.push(url)
}

export function resolveGenerationReferences(
  node: GenerationCanvasNode,
  context: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] } = {},
): ResolvedGenerationReferences {
  const nodes = context.nodes || [node]
  const edges = context.edges || []
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  const nodeContext = collectNodeContext(nodes, edges, node.id)
  const referenceImages: string[] = []
  const styleReferenceImages: string[] = []
  const characterReferenceImages: string[] = []
  const compositionReferenceImages: string[] = []
  let firstFrameFromEdge = ''
  let lastFrameFromEdge = ''

  for (const edge of edges) {
    if (edge.target !== node.id) continue
    const sourceUrl = findNodeResultUrl(nodesById, edge.source)
    if (!sourceUrl) continue
    if (edge.mode === 'first_frame') {
      firstFrameFromEdge = firstFrameFromEdge || sourceUrl
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (edge.mode === 'last_frame') {
      lastFrameFromEdge = lastFrameFromEdge || sourceUrl
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (edge.mode === 'style_ref') {
      pushUnique(styleReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (edge.mode === 'character_ref') {
      pushUnique(characterReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (edge.mode === 'composition_ref') {
      pushUnique(compositionReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      continue
    }
  }

  nodeContext.resultUrls.forEach((url) => pushUnique(referenceImages, url))
  ;(node.references || []).forEach((reference) => {
    const directUrl = asUrl(reference)
    pushUnique(referenceImages, directUrl || findNodeResultUrl(nodesById, reference))
  })
  const meta = node.meta || {}
  ;[meta.referenceImages, meta.upstreamResultUrls].forEach((value) => {
    if (Array.isArray(value)) value.forEach((item) => pushUnique(referenceImages, item))
    else pushUnique(referenceImages, value)
  })

  const firstFrameUrl =
    firstFrameFromEdge ||
    asUrl(meta.firstFrameUrl) ||
    asUrl(meta.first_frame_url) ||
    resolveReferenceUrl(nodesById, meta.firstFrameRef) ||
    resolveReferenceUrl(nodesById, meta.firstFrameReference) ||
    referenceImages[0] ||
    undefined
  const lastFrameUrl =
    lastFrameFromEdge ||
    asUrl(meta.lastFrameUrl) ||
    asUrl(meta.last_frame_url) ||
    resolveReferenceUrl(nodesById, meta.lastFrameRef) ||
    resolveReferenceUrl(nodesById, meta.lastFrameReference) ||
    undefined

  return {
    referenceImages,
    firstFrameUrl,
    lastFrameUrl,
    styleReferenceImages,
    characterReferenceImages,
    compositionReferenceImages,
  }
}
