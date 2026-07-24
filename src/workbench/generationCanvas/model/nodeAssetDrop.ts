// 拖入 / 连线 → 参考 的**纯**路由逻辑（无 React / 无 store / 无 toast，可单测）。
// 职责：把「拖进来的东西的类型(image/video/audio)」映射出来，并据节点当前模型档案的当前模式，
// 找到匹配该类型的数组参考槽。写入由 nodeAssetWrite 经 appendArchetypeArrayValue 单源完成。
import type { GenerationNodeKind } from './generationCanvasTypes'
import { isImageLikeGenerationNodeKind, isVideoLikeGenerationNodeKind } from './generationNodeKinds'
import {
  type ArchetypeArraySlot,
  archetypeModeArraySlots,
  currentArchetypeMode,
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

/**
 * 节点当前模型档案 + 当前模式声明的数组参考槽（无档案 / 当前模式无数组槽 → []）。
 * 内置家之内供应商无关；自定义中转不套档案（vendor 门在 resolveArchetypeForModel）。从持久化的
 * node.meta 解析（单源真相）。
 */
export function resolveNodeArraySlots(meta: Record<string, unknown> | undefined): ArchetypeArraySlot[] {
  const m = meta || {}
  const archetype = resolveArchetypeForModel({
    modelKey: typeof m.modelKey === 'string' ? m.modelKey : undefined,
    modelAlias: typeof m.modelAlias === 'string' ? m.modelAlias : undefined,
    vendorKey: typeof m.modelVendor === 'string' ? m.modelVendor : typeof m.vendor === 'string' ? m.vendor : null,
    meta: m,
  })
  if (!archetype) return []
  return archetypeModeArraySlots(currentArchetypeMode(archetype, m))
}

/** 在数组槽列表里挑出 accept 匹配 kind 的那个（每模式每类型至多一个；无则 null）。 */
export function findArraySlotForKind(slots: ArchetypeArraySlot[], kind: AssetDropKind): ArchetypeArraySlot | null {
  return slots.find((slot) => slot.accept === kind) || null
}
