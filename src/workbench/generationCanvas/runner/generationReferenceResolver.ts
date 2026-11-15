import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { sortEdgesByOrder } from '../model/graphOps'
import { archetypeForNode, referenceAssetKindForNode } from '../agent/referenceEdgeCapability'
import { validateEdgeKinds } from '../../../../electron/shared/canvas/edgeAdmission'
import { isDerivedOutputPair } from '../model/derivedOutput'
import { effectiveArchetypeMode, type ArchetypeModeResolution } from '../nodes/controls/archetypeMeta'
import { resolveReferencePlacement } from './referenceSlots'
import { asUrl, findNodeResultUrl, resolveReferenceUrl } from './referenceUrl'
import { resolveIndexedParameterReferenceAssignments } from '../model/parameterReferenceSlots'
import { isComfyuiVendorKey } from '../model/comfyuiVendor'
import { readParameterReferenceContract } from '../../../../electron/catalog/parameterReferenceContract'

export type ResolvedGenerationReferences = {
  /** Live parameter-specific inputs. null reserves a pending edge without reviving stale uploaded values. */
  parameterReferenceUrls?: Record<string, string | null>
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
  /**
   * 这次按哪种方式发（effectiveArchetypeMode 按这张画布上的输入现算一次）。发送链路往下（请求组装、任务种类、@ 投影）
   * 都读这一份，不各自再算。认不出档案的节点没有。
   */
  archetypeMode?: ArchetypeModeResolution
}

function pushUnique(output: string[], value: unknown) {
  const url = asUrl(value)
  if (url && !output.includes(url)) output.push(url)
}

// Canvas selection/viewport updates frequently re-render every mounted node
// while the immutable nodes/edges arrays stay the same. Keep the graph
// indexes outside the resolver so those renders do not rebuild O(nodes + edges)
// maps for every node.
const nodesByIdCache = new WeakMap<GenerationCanvasNode[], Map<string, GenerationCanvasNode>>()
const sortedEdgesCache = new WeakMap<GenerationCanvasEdge[], GenerationCanvasEdge[]>()
const edgesByTargetCache = new WeakMap<GenerationCanvasEdge[], Map<string, GenerationCanvasEdge[]>>()
const assetKindByUrlCache = new WeakMap<GenerationCanvasNode[], Map<string, 'image' | 'video' | 'audio'>>()

function getNodesById(nodes: GenerationCanvasNode[]): Map<string, GenerationCanvasNode> {
  const cached = nodesByIdCache.get(nodes)
  if (cached) return cached
  const next = new Map(nodes.map((candidate) => [candidate.id, candidate]))
  nodesByIdCache.set(nodes, next)
  return next
}

function getSortedEdges(edges: GenerationCanvasEdge[]): GenerationCanvasEdge[] {
  const cached = sortedEdgesCache.get(edges)
  if (cached) return cached
  const next = sortEdgesByOrder(edges)
  sortedEdgesCache.set(edges, next)
  return next
}

function getEdgesByTarget(edges: GenerationCanvasEdge[]): Map<string, GenerationCanvasEdge[]> {
  const cached = edgesByTargetCache.get(edges)
  if (cached) return cached
  const next = new Map<string, GenerationCanvasEdge[]>()
  for (const edge of getSortedEdges(edges)) {
    const targetEdges = next.get(edge.target)
    if (targetEdges) targetEdges.push(edge)
    else next.set(edge.target, [edge])
  }
  edgesByTargetCache.set(edges, next)
  return next
}

/**
 * URL → 媒体种类（按节点顺序，先到先得）。导出给生成框的依赖面签名用（nodes/composerGraphSnapshot）：
 * 本节点 meta 里的参考 URL 被归成哪一类，正是读这张表——两边必须是同一张表、同一条先到先得规则。
 */
export function getAssetKindByUrl(nodes: GenerationCanvasNode[]): Map<string, 'image' | 'video' | 'audio'> {
  const cached = assetKindByUrlCache.get(nodes)
  if (cached) return cached
  const next = new Map<string, 'image' | 'video' | 'audio'>()
  for (const candidate of nodes) {
    const rType = candidate.result?.type
    const kind: 'image' | 'video' | 'audio' =
      rType === 'video' || (!rType && candidate.kind === 'video')
        ? 'video'
        : rType === 'audio' || (!rType && candidate.kind === 'audio')
          ? 'audio'
          : 'image'
    for (const u of [candidate.result?.url, ...(candidate.history || []).map((h) => h.url)]) {
      const url = asUrl(u)
      if (url && !next.has(url)) next.set(url, kind)
    }
  }
  assetKindByUrlCache.set(nodes, next)
  return next
}

/**
 * 目标当前模式是否把「通用 reference 的视频源」当**首帧接力**消费（而非参考视频）。
 * 与显示侧 assignEdgeToSlot 的视频落槽序 ['video_ref','source_video','first_frame'] 同口径：
 * 有专门视频槽（video_ref/source_video）→ 当参考视频（false）；只有 first_frame 槽 → 走首帧接力（true）。
 * 无档案 → false（不知道 i2v 语义，保持「视频进 referenceVideos」现行为）。
 * 存在意义：封死「显示侧落 first_frame 槽显示待抽帧，发送侧却把视频当参考视频丢掉」的分裂
 * （reference-mode 视频连 first-frame-only i2v，手动连线默认就走这条 → 会永远待抽帧、发不出）。
 */
function targetRelaysVideoToFirstFrame(archetypeMode: ArchetypeModeResolution | undefined): boolean {
  if (!archetypeMode) return false
  const mode = archetypeMode.mode
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
  const nodesById = getNodesById(nodes)
  const edgesByTarget = getEdgesByTarget(edges)
  const nodeArchetype = archetypeForNode(node)
  const archetypeMode = nodeArchetype ? effectiveArchetypeMode(nodeArchetype, node, { nodes, edges }) : undefined
  // 旧项目里已经存在的非法旧边（视频 / 声音 → 文本、剪辑 → 图片……）不删用户数据，但执行时一律忽略：
  // 目标这一类不收这种输入，它们不该变成参考素材。判据与新建连线同一份（edgeAdmission.validateEdgeKinds）；出处边（派生输出）不在此列。
  const incomingEdges = (edgesByTarget.get(node.id) || []).filter((edge) => {
    const source = nodesById.get(edge.source)
    return !source || validateEdgeKinds(source, node, edge.mode).ok || isDerivedOutputPair(source, node.kind)
  })
  const referenceImages: string[] = []
  const styleReferenceImages: string[] = []
  const characterReferenceImages: string[] = []
  const compositionReferenceImages: string[] = []
  let firstFrameFromEdge = ''
  let lastFrameFromEdge = ''
  let relayFromVideoUrl = ''
  let stagingComposition = false
  const parameterContract = readParameterReferenceContract(node.meta)
  const parameterSlots = parameterContract?.slots ?? []
  const usesComfyParameterContract = Boolean(parameterContract && isComfyuiVendorKey(parameterContract.vendorKey))
  const parameterAssignments = resolveIndexedParameterReferenceAssignments(node, parameterSlots, nodesById, incomingEdges)
  const slotByEdgeId = new Map(parameterAssignments.flatMap(({ slot, edge }) => edge ? [[edge.id, slot] as const] : []))
  const parameterReferenceUrls: Record<string, string | null> = Object.fromEntries(parameterAssignments
    .flatMap(({ slot, edge }) => {
      // A keyed edge is authoritative even while pending: null masks the older
      // upload instead of letting a stale per-key value come back. Without an
      // edge, the independently uploaded value is the live value for this key.
      if (edge) return [[slot.key, findNodeResultUrl(nodesById, edge.source) || null]]
      const uploaded = asUrl(node.meta?.[slot.key])
      return uploaded ? [[slot.key, uploaded]] : []
    }))
  if (usesComfyParameterContract) {
    return {
      parameterReferenceUrls,
      referenceImages: [],
      referenceVideos: [],
      referenceAudios: [],
      styleReferenceImages: [],
      characterReferenceImages: [],
      compositionReferenceImages: [],
    }
  }
  const parameterOwnedUrls = new Set(parameterAssignments.flatMap(({ slot, edge }) => [
    asUrl(node.meta?.[slot.key]),
    edge ? findNodeResultUrl(nodesById, edge.source) : '',
  ]).filter(Boolean))

  // **按 order 升序**遍历 → referenceImages（喂 buildArchetypeInputParams 的数组槽）顺序稳定，
  // 与显示侧 resolveReferenceSlots 同一口径，保住 character1..N（audit 2026-06-16 §1d「数组参考收口到有序边」）。
  for (const edge of incomingEdges) {
    // A named edge belongs only to its current declaration, never to another model's generic inputs.
    const parameterSlot = slotByEdgeId.get(edge.id)
    if (edge.targetParamKey && !parameterSlot) continue
    if (parameterSlots.length && !parameterSlot) continue
    const mode = parameterSlot?.mediaKind === 'video' ? 'reference'
      : parameterSlot && parameterSlot.group !== 'reference' ? parameterSlot.group : edge.mode
    const sourceUrl = findNodeResultUrl(nodesById, edge.source)
    if (!sourceUrl) continue
    // Imported Comfy media parameters are a keyed transport contract. Their
    // edges have already populated parameterReferenceUrls above and must not
    // also feed generic image/frame fallbacks.
    if (usesComfyParameterContract && parameterSlot) continue
    if (mode === 'first_frame') {
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
    if (mode === 'last_frame') {
      lastFrameFromEdge = lastFrameFromEdge || sourceUrl
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (mode === 'style_ref') {
      pushUnique(styleReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (mode === 'character_ref') {
      pushUnique(characterReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      continue
    }
    if (mode === 'composition_ref') {
      pushUnique(compositionReferenceImages, sourceUrl)
      pushUnique(referenceImages, sourceUrl)
      if (nodesById.get(edge.source)?.meta?.stagingComposition === true) stagingComposition = true
      continue
    }
    // 通用 reference（含旧快照 mode 缺失）只收**直接连到目标**的源结果。不能再借 collectNodeContext
    // 递归扫祖先：A→B→C 时 C 的参考应是 B，而不是 [A,B]；单图模型若截 max=1 会错误发送 A。
    if (!mode || mode === 'reference') {
      // 视频源 + 目标只有首帧槽（无参考视频槽）→ 首帧接力，与显示侧 resolveReferenceSlots 落 first_frame
      // 槽（pending-extraction）同一口径。否则会「显示待抽帧、发送却把视频当参考视频丢掉」= 永远待抽帧、
      // 发不出（reference-mode 视频连 first-frame-only i2v 的陷阱，手动连线的默认路径就撞这条）。
      const src = nodesById.get(edge.source)
      if (!parameterSlot && src && referenceAssetKindForNode(src) === 'video' && targetRelaysVideoToFirstFrame(archetypeMode)) {
        relayFromVideoUrl = relayFromVideoUrl || sourceUrl
        continue
      }
      pushUnique(referenceImages, sourceUrl)
    }
  }

  const meta = node.meta || {}
  // 认得档案的节点：参考只有两个来源——画布边（上面）和节点那一份有序参考列表（referenceList，由
  // buildArchetypeInputParams / uploadPlacementForMode 按当前方式落槽，和参考行同一个推导）。旧的「别处抬上来」
  // 的来源（node.references、meta.referenceImages / upstreamResultUrls、firstFrameUrl / first_frame_url / *Ref 这些按槽存的键）
  // 参考行从来不显示，这里也不再抬成首帧 / 参考——URL 型的旧键已在 readReferenceList 里归一进列表，看得见、才发得出。
  const vendorKey = typeof meta.modelVendor === 'string' ? meta.modelVendor : typeof meta.vendor === 'string' ? meta.vendor : ''
  // 与 catalogTaskResolve.resolveTaskArchetype 同口径：ComfyUI 工作流不吃档案。
  const ownsUploadsViaList = !isComfyuiVendorKey(vendorKey) && Boolean(archetypeForNode(node))
  if (!ownsUploadsViaList) {
    ;(node.references || []).forEach((reference) => {
      const directUrl = asUrl(reference)
      pushUnique(referenceImages, directUrl || findNodeResultUrl(nodesById, reference))
    })
    ;[meta.referenceImages, meta.upstreamResultUrls].forEach((value) => {
      if (Array.isArray(value)) value.forEach((item) => pushUnique(referenceImages, item))
      else pushUnique(referenceImages, value)
    })
  }
  // 尾帧接力源（视频文件 URL）不是参考图，从 referenceImages 剔除——否则它既被当
  // 普通图片参考、又会经 referenceImages[0] fallback 冒充首帧（封死第二条泄漏路径）。
  const cleanReferenceImages = referenceImages.filter((url) =>
    url !== relayFromVideoUrl && (!usesComfyParameterContract || !parameterOwnedUrls.has(url)))

  // B4：按源节点资产类型把视频/音频 URL 从 referenceImages 分流出去——否则连线进来的视频参考会被当
  // 图片参考发（甚至经下面 fallback 冒充首帧）。URL→kind 由各节点 result.type / kind 派生（单源）。
  const assetKindByUrl = getAssetKindByUrl(nodes)
  const imageReferenceImages: string[] = []
  const referenceVideos: string[] = []
  const referenceAudios: string[] = []
  for (const url of cleanReferenceImages) {
    const kind = assetKindByUrl.get(url) || 'image'
    if (kind === 'video') referenceVideos.push(url)
    else if (kind === 'audio') referenceAudios.push(url)
    else imageReferenceImages.push(url)
  }

  const genericMetaUrl = (value: unknown) => {
    const url = asUrl(value)
    return usesComfyParameterContract && parameterOwnedUrls.has(url) ? '' : url
  }
  const legacyFirst = ownsUploadsViaList ? '' : (
    genericMetaUrl(meta.firstFrameUrl) ||
    genericMetaUrl(meta.first_frame_url) ||
    resolveReferenceUrl(nodesById, meta.firstFrameRef) ||
    resolveReferenceUrl(nodesById, meta.firstFrameReference))
  const legacyLast = ownsUploadsViaList ? '' : (
    genericMetaUrl(meta.lastFrameUrl) ||
    genericMetaUrl(meta.last_frame_url) ||
    resolveReferenceUrl(nodesById, meta.lastFrameRef) ||
    resolveReferenceUrl(nodesById, meta.lastFrameReference))
  // relay 时首帧要等抽帧填，绝不 fallback 到通用参考图（否则又冒充）。只从**图片**参考兜底（视频已分流）。
  const edgeFirst = firstFrameFromEdge || (relayFromVideoUrl ? '' : imageReferenceImages[0] || '')
  // 档案节点：首 / 尾帧格子里是谁，直接问参考行用的那一个推导（resolveReferencePlacement：连线按候选槽依次落、
  // 上传图按参考列表依次落）——发送侧和参考行同一个主人，第二条参考连线落尾帧时两边一起落（用户 10-22 拍板 ⑪）。
  // 待抽帧的视频占着首帧格但还没有地址：这里给空，提交时由 relayFrameResolver 把抽出的帧填进来。
  const frames = ownsUploadsViaList
    ? (() => {
      const placement = resolveReferencePlacement(node, nodes, edges)
      const slotOf = (kind: string) => placement.slots.find((slot) => slot.slotKind === kind)
      const urlIn = (kind: string) => slotOf(kind)?.fills.find((fill) => fill.url)?.url ?? ''
      return { hasFirst: Boolean(slotOf('first_frame')), hasLast: Boolean(slotOf('last_frame')), first: urlIn('first_frame'), last: urlIn('last_frame') }
    })()
    : null
  const firstFrameUrl = (frames?.hasFirst ? frames.first : edgeFirst || legacyFirst) || undefined
  const lastFrameUrl = (frames?.hasLast ? frames.last : lastFrameFromEdge || legacyLast) || undefined

  return {
    ...(parameterSlots.length ? { parameterReferenceUrls } : {}),
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
    ...(archetypeMode ? { archetypeMode } : {}),
  }
}
