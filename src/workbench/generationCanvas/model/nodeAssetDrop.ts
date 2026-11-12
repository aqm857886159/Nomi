// 拖入 / 连线 → 参考 的**纯**路由逻辑（无 React / 无 store / 无 toast，可单测）。
// 职责：把「拖进来的东西的类型(image/video/audio)」映射出来，并按「放进去之后」现算的方式（modeForInputs）
// 找到落哪一格、放不放得下（planNodeReferenceAdd）。写入由 nodeAssetWrite 经 appendArchetypeArrayValue 单源完成。
import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'
import { mediaKindFromExtension } from '../../../../electron/assets/mediaTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from './generationNodeKinds'
import {
  type ArchetypeArraySlot,
  type ArchetypeMode,
  archetypeModeArraySlots,
  collectModeInputs,
  effectiveArchetypeModeWithUpload,
  type ModeGraph,
  resolveArchetypeForModel,
} from '../nodes/controls/archetypeMeta'
import { isImageUploadSlot, REFERENCE_LIST_KEY } from '../nodes/controls/referenceList'
import { translateModelDisplayText } from '../../../i18n/modelDisplayText'

export type AssetDropKind = 'image' | 'video' | 'audio'

/** OS 文件 MIME → 资产类型（拖入桌面文件用）。 */
export function dropKindFromMime(mime: string | undefined | null): AssetDropKind | null {
  if (!mime) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return null
}

/**
 * OS 文件 → 资产类型：MIME 优先，MIME 为空按扩展名兜底（单源 electron/assets/mediaTypes）。
 * Windows 上 mkv 等常无注册 MIME（file.type=''）→ 此前被静默跳过，用户拖了没反应（silent-drop 家族）。
 */
export function dropKindFromFile(file: { type?: string; name?: string }): AssetDropKind | null {
  const byMime = dropKindFromMime(file.type)
  if (byMime) return byMime
  // application/octet-stream is not a useful media identity: browsers use it for
  // unregistered extensions (notably mkv and files imported without a MIME). Keep
  // the extension fallback for this sentinel, while still rejecting a concrete
  // non-media MIME such as application/pdf.
  if (file.type && file.type.toLowerCase() !== 'application/octet-stream') return null
  const kind = mediaKindFromExtension(String(file.name || ''))
  return kind === 'image' || kind === 'video' || kind === 'audio' ? kind : null
}

const WORKSPACE_KIND: Record<string, AssetDropKind> = { image: 'image', video: 'video', audio: 'audio' }

/** 项目文件树拖拽 payload.kind → 资产类型（其余字符串视为不可放）。 */
export function dropKindFromWorkspaceKind(kind: string | undefined | null): AssetDropKind | null {
  return (kind && WORKSPACE_KIND[kind]) || null
}

/** 画布节点种类 → 该节点产物的资产类型（连线为参考时判断 source 是什么）。 */
export function dropKindFromNodeKind(kind: GenerationNodeKind): AssetDropKind | null {
  if (isVideoLikeGenerationNodeKind(kind)) return 'video'
  if (isImageLikeGenerationNodeKind(kind)) return 'image'
  return null
}

const DROP_KINDS: readonly AssetDropKind[] = ['image', 'video', 'audio']

type NodeLike = Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>

function archetypeOfNode(node: NodeLike) {
  const m = (node.meta || {}) as Record<string, unknown>
  return resolveArchetypeForModel({
    modelKey: typeof m.modelKey === 'string' ? m.modelKey : undefined,
    modelAlias: typeof m.modelAlias === 'string' ? m.modelAlias : undefined,
    vendorKey: typeof m.modelVendor === 'string' ? m.modelVendor : typeof m.vendor === 'string' ? m.vendor : null,
    meta: m,
  })
}

/**
 * 摆法里收上传图的那一格（首帧 / 尾帧 / 参考图都算）：图片都住节点那一份有序参考列表（REFERENCE_LIST_KEY），
 * 按摆法落回首帧、尾帧或参考图。只有首帧 / 尾帧格的摆法（图生视频、首尾帧）也收得下一张上传图——
 * 以前只认 image_ref 格，往图生视频档案的文生节点拖一张图会被说「放不下」。
 */
function imageListSlot(layout: ArchetypeMode): ArchetypeArraySlot | null {
  const own = archetypeModeArraySlots(layout).find((slot) => slot.accept === 'image')
  if (own) return own
  const frame = layout.slots.find((slot) => isImageUploadSlot(slot.kind))
  return frame ? { metaKey: REFERENCE_LIST_KEY, label: translateModelDisplayText(frame.label), min: 0, accept: 'image', numbered: false } : null
}

/** 放进一件 kind 之后：按哪种摆法、落哪一格、放不放得下（modeForInputs 收得下全部输入才算放得下）。 */
export type NodeReferenceAddPlan = { slot: ArchetypeArraySlot | null; fits: boolean }

/**
 * 「再放一件 kind 进这个节点」的唯一判据——落格（addAssetUrlToNode）、生成框「+」给哪几类（addableReferenceKinds）、
 * 收不收拖放都问它。方式按「放进去之后的输入」现算（effectiveArchetypeModeWithUpload → modeForInputs），不读存着的方式。
 * 无档案 → null（内置家之内供应商无关；自定义中转不套档案，vendor 门在 resolveArchetypeForModel）。
 */
export function planNodeReferenceAdd(node: NodeLike, graph: ModeGraph, kind: AssetDropKind): NodeReferenceAddPlan | null {
  const archetype = archetypeOfNode(node)
  if (!archetype) return null
  const after = effectiveArchetypeModeWithUpload(archetype, node, graph, kind)
  const slot = kind === 'image' ? imageListSlot(after.mode) : archetypeModeArraySlots(after.mode).find((candidate) => candidate.accept === kind) ?? null
  const fits = after.status === 'ok' && after.taken === collectModeInputs(node, graph).inputs.length + 1
  return { slot, fits }
}

/** 生成框「+」给哪几类素材：放进去之后收得下、又有对口的格的那几类。一类都没有 =「+」置灰、点不开（模型到上限）。 */
export function addableReferenceKinds(node: NodeLike, graph: ModeGraph): AssetDropKind[] {
  return DROP_KINDS.filter((kind) => {
    const plan = planNodeReferenceAdd(node, graph, kind)
    return Boolean(plan?.slot && plan.fits)
  })
}

/**
 * 把一件 kind 放进这个节点之后，它落哪一格（无档案 / 那个摆法没有对口的格 → []）。不给 kind 就合并三种的格
 * （「这个节点收不收拖放」用）。判据同 planNodeReferenceAdd。
 */
export function resolveNodeArraySlots(
  node: NodeLike,
  graph: ModeGraph,
  kind?: AssetDropKind,
): ArchetypeArraySlot[] {
  const slots: ArchetypeArraySlot[] = []
  for (const asset of kind ? [kind] : DROP_KINDS) {
    const slot = planNodeReferenceAdd(node, graph, asset)?.slot
    if (slot && !slots.some((existing) => existing.metaKey === slot.metaKey)) slots.push(slot)
  }
  return slots
}
