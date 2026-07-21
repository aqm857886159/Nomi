import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { sortEdgesByOrder } from '../model/graphOps'
import { archetypeForNode, referenceAssetKindForNode } from '../agent/referenceEdgeCapability'
import { currentArchetypeMode } from '../nodes/controls/archetypeMeta'
import { asUrl, findNodeResultUrl, resolveReferenceUrl } from './referenceUrl'

export type ResolvedGenerationReferences = {
  referenceImages: string[]
  /** 连线进来的视频/音频参考（按源节点类型分流，不混进 referenceImages）。喂 omni 的 video_ref/audio_ref
   *  槽——B4 修：此前视频源 URL 漏进 referenceImages 当图片/首帧发，且 video_ref 槽只收 meta 上传。 */
  referenceVideos: string[]
  referenceAudios: string[]
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

/**
 * 目标当前模式是否把「通用 reference 的视频源」当**首帧接力**消费（而非参考视频）。
 * 与显示侧 assignEdgeToSlot 的视频落槽序 ['video_ref','source_video','first_frame'] 同口径：
 * 有专门视频槽（video_ref/source_video）→ 当参考视频（false）；只有 first_frame 槽 → 走首帧接力（true）。
 * 无档案 → false（不知道 i2v 语义，保持「视频进 referenceVideos」现行为）。
 * 存在意义：封死「显示侧落 first_frame 槽显示待抽帧，发送侧却把视频当参考视频丢掉」的分裂
 * （reference-mode 视频连 first-frame-only i2v，手动连线默认就走这条 → 会永远待抽帧、发不出）。
 */
function targetRelaysVideoToFirstFrame(target: GenerationCanvasNode): boolean {
  const archetype = archetypeForNode(target)
  if (!archetype) return false
  const mode = currentArchetypeMode(archetype, (target.meta || {}) as Record<string, unknown>)
  const kinds = new Set(mode.slots.map((slot) => slot.kind))
  if (kinds.has('video_ref') || kinds.has('source_video')) return false
  return kinds.has('first_frame')
}

export function resolveGenerationReferences(
  node: GenerationCanvasNode,
  context: { nodes?: GenerationCanvasNode[]; edges?: GenerationCanvasEdge[] } = {},
): ResolvedGenerationReferences {
  const nodes = context.nodes || [node]
  const edges = context.edges || []
  const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]))
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
      // 源是视频 → 尾帧接力：标记待抽帧，绝不把视频 URL/封面当首帧塞进去
      // （封死「用封面冒充尾帧」的静默回退，评审必改①）。源是 image → 现行为不变。
      // 媒体类型按 referenceAssetKindForNode（result.type 单源）判，不按 node.kind：导入的视频素材
      // kind='asset'（图/视频同种类），按 kind 会漏判 → 把视频 URL 当首帧发出去。video-gen 节点无 result
      // 时 kind='video' 仍返回 video（exec==='video'），覆盖不丢。
      const ffSource = nodesById.get(edge.source)
      if (ffSource && referenceAssetKindForNode(ffSource) === 'video') {
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
    // 通用 reference（含旧快照 mode 缺失）只收**直接连到目标**的源结果。不能再借 collectNodeContext
    // 递归扫祖先：A→B→C 时 C 的参考应是 B，而不是 [A,B]；单图模型若截 max=1 会错误发送 A。
    if (!edge.mode || edge.mode === 'reference') {
      // 视频源 + 目标只有首帧槽（无参考视频槽）→ 首帧接力，与显示侧 resolveReferenceSlots 落 first_frame
      // 槽（pending-extraction）同一口径。否则会「显示待抽帧、发送却把视频当参考视频丢掉」= 永远待抽帧、
      // 发不出（reference-mode 视频连 first-frame-only i2v 的陷阱，手动连线的默认路径就撞这条）。
      const src = nodesById.get(edge.source)
      if (src && referenceAssetKindForNode(src) === 'video' && targetRelaysVideoToFirstFrame(node)) {
        relayFromVideoUrl = relayFromVideoUrl || sourceUrl
        continue
      }
      pushUnique(referenceImages, sourceUrl)
    }
  }

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

  // B4：按源节点资产类型把视频/音频 URL 从 referenceImages 分流出去——否则连线进来的视频参考会被当
  // 图片参考发（甚至经下面 fallback 冒充首帧）。URL→kind 由各节点 result.type / kind 派生（单源）。
  const assetKindByUrl = new Map<string, 'image' | 'video' | 'audio'>()
  for (const candidate of nodes) {
    const rType = candidate.result?.type
    const kind: 'image' | 'video' | 'audio' =
      rType === 'video' || (!rType && candidate.kind === 'video') ? 'video'
      : rType === 'audio' || (!rType && candidate.kind === 'audio') ? 'audio'
      : 'image'
    for (const u of [candidate.result?.url, ...((candidate.history || []).map((h) => h.url))]) {
      const url = asUrl(u)
      if (url && !assetKindByUrl.has(url)) assetKindByUrl.set(url, kind)
    }
  }
  const imageReferenceImages: string[] = []
  const referenceVideos: string[] = []
  const referenceAudios: string[] = []
  for (const url of cleanReferenceImages) {
    const kind = assetKindByUrl.get(url) || 'image'
    if (kind === 'video') referenceVideos.push(url)
    else if (kind === 'audio') referenceAudios.push(url)
    else imageReferenceImages.push(url)
  }

  const firstFrameUrl =
    firstFrameFromEdge ||
    asUrl(meta.firstFrameUrl) ||
    asUrl(meta.first_frame_url) ||
    resolveReferenceUrl(nodesById, meta.firstFrameRef) ||
    resolveReferenceUrl(nodesById, meta.firstFrameReference) ||
    // relay 时首帧要等抽帧填，绝不 fallback 到通用参考图（否则又冒充）。只从**图片**参考兜底（视频已分流）。
    (relayFromVideoUrl ? undefined : imageReferenceImages[0]) ||
    undefined
  const lastFrameUrl =
    lastFrameFromEdge ||
    asUrl(meta.lastFrameUrl) ||
    asUrl(meta.last_frame_url) ||
    resolveReferenceUrl(nodesById, meta.lastFrameRef) ||
    resolveReferenceUrl(nodesById, meta.lastFrameReference) ||
    undefined

  return {
    referenceImages: imageReferenceImages,
    referenceVideos,
    referenceAudios,
    firstFrameUrl,
    lastFrameUrl,
    styleReferenceImages,
    characterReferenceImages,
    compositionReferenceImages,
    ...(stagingComposition ? { stagingComposition } : {}),
    ...(relayFromVideoUrl ? { relayFromVideoUrl } : {}),
  }
}
