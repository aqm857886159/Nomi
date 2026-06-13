import type { GenerationCanvasEdge, GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'
import { collectNodeContext } from '../model/nodeContext'

export type ResolvedGenerationReferences = {
  referenceImages: string[]
  firstFrameUrl?: string
  lastFrameUrl?: string
  styleReferenceImages: string[]
  characterReferenceImages: string[]
  compositionReferenceImages: string[]
  /**
   * T5 尾帧接力：first_frame 边的源是 video 节点时，这里是源视频的 URL——
   * 表示「用源视频的尾帧当本节点首帧」。runController 提交生成前 await 抽帧
   * 把它换成真实图片 URL 填进 firstFrameUrl；resolver 不在此拿视频 URL/封面
   * 冒充首帧（封死 thumbnail 静默回退，audit 2026-06-12 评审必改）。
   */
  relayFromVideoUrl?: string
}

function asUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  // nomi-local:// 是项目内素材协议（抽帧 IPC 的返回值就是它）——必须放行，
  // 否则尾帧接力抽出的帧 URL 进 resolver 即被丢弃（评审必改②）。
  return /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('blob:') || trimmed.startsWith('nomi-local://') ? trimmed : ''
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
  let relayFromVideoUrl = ''

  for (const edge of edges) {
    if (edge.target !== node.id) continue
    const sourceUrl = findNodeResultUrl(nodesById, edge.source)
    if (!sourceUrl) continue
    if (edge.mode === 'first_frame') {
      // 源是 video 节点 → 尾帧接力：标记待抽帧，绝不把视频 URL/封面当首帧塞进去
      // （封死「用封面冒充尾帧」的静默回退，评审必改①）。源是 image → 现行为不变。
      if (nodesById.get(edge.source)?.kind === 'video') {
        relayFromVideoUrl = relayFromVideoUrl || sourceUrl
        continue
      }
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
  // 尾帧接力源（视频文件 URL）不是参考图，从 referenceImages 剔除——否则它既被当
  // 普通图片参考、又会经 referenceImages[0] fallback 冒充首帧（封死第二条泄漏路径）。
  const cleanReferenceImages = relayFromVideoUrl
    ? referenceImages.filter((url) => url !== relayFromVideoUrl)
    : referenceImages

  const firstFrameUrl =
    firstFrameFromEdge ||
    asUrl(meta.firstFrameUrl) ||
    asUrl(meta.first_frame_url) ||
    resolveReferenceUrl(nodesById, meta.firstFrameRef) ||
    resolveReferenceUrl(nodesById, meta.firstFrameReference) ||
    // relay 时首帧要等抽帧填，绝不 fallback 到通用参考图（否则又冒充）。
    (relayFromVideoUrl ? undefined : cleanReferenceImages[0]) ||
    undefined
  const lastFrameUrl =
    lastFrameFromEdge ||
    asUrl(meta.lastFrameUrl) ||
    asUrl(meta.last_frame_url) ||
    resolveReferenceUrl(nodesById, meta.lastFrameRef) ||
    resolveReferenceUrl(nodesById, meta.lastFrameReference) ||
    undefined

  return {
    referenceImages: cleanReferenceImages,
    firstFrameUrl,
    lastFrameUrl,
    styleReferenceImages,
    characterReferenceImages,
    compositionReferenceImages,
    ...(relayFromVideoUrl ? { relayFromVideoUrl } : {}),
  }
}
