// 拖入 / 连线 → 参考 的**纯**路由逻辑（无 React / 无 store / 无 toast，可单测）。
// 职责：把「拖进来的东西的类型(image/video/audio)」映射出来，并据节点当前模型档案的当前模式，
// 找到匹配该类型的数组参考槽。写入由 nodeAssetWrite 经 appendArchetypeArrayValue 单源完成。
import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'
import { mediaKindFromExtension } from '../../../../electron/assets/mediaTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from './generationNodeKinds'
import {
  type ArchetypeArraySlot,
  archetypeModeArraySlots,
  effectiveArchetypeModeWithUpload,
  type ModeGraph,
  resolveArchetypeForModel,
} from '../nodes/controls/archetypeMeta'

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

/**
 * 把一件 kind 放进这个节点之后，它按哪种摆法、有哪些数组参考槽（无档案 / 那个摆法无数组槽 → []）。
 * 方式按「放进去之后的输入」现算（effectiveArchetypeModeWithUpload），不读存着的方式；不给 kind 就合并三种的槽
 * （「这个节点收不收拖放」用）。内置家之内供应商无关；自定义中转不套档案（vendor 门在 resolveArchetypeForModel）。
 */
export function resolveNodeArraySlots(
  node: Pick<GenerationCanvasNode, 'id' | 'meta' | 'kind'>,
  graph: ModeGraph,
  kind?: AssetDropKind,
): ArchetypeArraySlot[] {
  const m = (node.meta || {}) as Record<string, unknown>
  const archetype = resolveArchetypeForModel({
    modelKey: typeof m.modelKey === 'string' ? m.modelKey : undefined,
    modelAlias: typeof m.modelAlias === 'string' ? m.modelAlias : undefined,
    vendorKey: typeof m.modelVendor === 'string' ? m.modelVendor : typeof m.vendor === 'string' ? m.vendor : null,
    meta: m,
  })
  if (!archetype) return []
  const slots: ArchetypeArraySlot[] = []
  for (const asset of kind ? [kind] : DROP_KINDS) {
    const layout = effectiveArchetypeModeWithUpload(archetype, node, graph, asset).mode
    for (const slot of archetypeModeArraySlots(layout)) {
      if (slot.accept === asset && !slots.some((existing) => existing.metaKey === slot.metaKey)) slots.push(slot)
    }
  }
  return slots
}

/** 在数组槽列表里挑出 accept 匹配 kind 的那个（每模式每类型至多一个；无则 null）。 */
export function findArraySlotForKind(slots: ArchetypeArraySlot[], kind: AssetDropKind): ArchetypeArraySlot | null {
  return slots.find((slot) => slot.accept === kind) || null
}
