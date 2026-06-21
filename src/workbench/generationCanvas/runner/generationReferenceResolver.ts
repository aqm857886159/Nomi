import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { sortEdgesByOrder } from '../model/graphOps'
import { collectNodeContext } from '../model/nodeContext'
import { asUrl, findNodeResultUrl, resolveReferenceUrl } from './referenceUrl'

export type ResolvedGenerationReferences = {
  referenceImages: string[]
  firstFrameUrl?: string
  lastFrameUrl?: string
  styleReferenceImages: string[]
  characterReferenceImages: string[]
  compositionReferenceImages: string[]
  /** 至少有一条 composition_ref 的源是 staging 站位图（image 节点 meta.stagingComposition）。
   *  → 出关键帧时给 prompt 加「构图控制+写实重渲染」后缀，避免照搬灰模 3D 外观。 */
  stagingComposition?: boolean
  /**
   * T5 尾帧接力：first_frame 边的源是 video 节点时，这里是源视频的 URL——
   * 表示「用源视频的尾帧当本节点首帧」。runController 提交生成前 await 抽帧
   * 把它换成真实图片 URL 填进 firstFrameUrl；resolver 不在此拿视频 URL/封面
   * 冒充首帧（封死 thumbnail 静默回退，audit 2026-06-12 评审必改）。
   */
  relayFromVideoUrl?: string
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
  let stagingComposition = false

  // **按 order 升序**遍历 → referenceImages（喂 buildArchetypeInputParams 的数组槽）顺序稳定，
  // 与显示侧 resolveReferenceSlots 同一口径，保住 character1..N（audit 2026-06-16 §1d「数组参考收口到有序边」）。
  for (const edge of sortEdgesByOrder(edges)) {
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
      if (nodesById.get(edge.source)?.meta?.stagingComposition === true) stagingComposition = true
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
    ...(stagingComposition ? { stagingComposition } : {}),
    ...(relayFromVideoUrl ? { relayFromVideoUrl } : {}),
  }
}
