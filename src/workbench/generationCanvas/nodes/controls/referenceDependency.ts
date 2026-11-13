// **跨槽依赖判定的单一真相源**（档案 `slot.requiresAnyOf` 的运行时对应物）。
//
// 为什么单独一个模块：这份判断有**两个消费者**——① `canRunGenerationNode` 决定生成钮能不能点、
// ② composer 决定置灰时说哪句人话。此前 composer 是按 `node.kind + acceptsDrop` **重猜**一遍原因
// （NodeGenerationComposer 的 disabledReason），跟闸门各算各的；新约束一进来猜出来的必然是错的
// （会说「需要先添加参考素材」，可用户明明加了音频）。两边同吃这里，杜绝再分家。
//
// 判定必须同时看**连线**与**上传**两个来源：用户连了一个图片节点进来，伴随要求就该算满足，
// 只读 meta（hasArchetypeArrayReferences 的口径）会把连线来的图当不存在 → 误拦。
import type { ArchetypeMode, ArchetypeReferenceSlotKind } from '../../../../../electron/shared/modelArchetypes'
import { readArchetypeArray, referenceSlotStorage } from './archetypeMeta'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'

/** 未满足跨槽依赖的槽 + 它缺的伴随项（析取：任一即可）。标签已本地化，可直接进文案。 */
export type UnmetReferenceDependency = {
  /** 有值却缺伴随的那个槽，如「参考音频」。 */
  slotLabel: string
  /** 缺的伴随槽标签，如 ['角色参考', '参考视频']；语义是**或**。 */
  companionLabels: string[]
}

/** 连线解析出的参考（ResolvedGenerationReferences 的子集，只取本判定要用的几项）。 */
export type EdgeReferenceCounts = {
  referenceImages?: readonly string[]
  referenceVideos?: readonly string[]
  referenceAudios?: readonly string[]
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
}

/** 当前模式里「已经有值」的槽 kind 集合（连线 + 上传合并）。 */
export function filledReferenceKinds(
  meta: Record<string, unknown> | undefined,
  mode: ArchetypeMode,
  fromEdges?: EdgeReferenceCounts,
): Set<ArchetypeReferenceSlotKind> {
  const filled = new Set<ArchetypeReferenceSlotKind>()
  for (const slot of mode.slots) {
    const storage = referenceSlotStorage(slot)
    if (!storage) continue
    const uploaded = storage.isArray
      ? readArchetypeArray(meta, storage.metaKey).length > 0
      : typeof meta?.[storage.metaKey] === 'string' && (meta[storage.metaKey] as string).trim().length > 0
    if (uploaded) {
      filled.add(slot.kind)
      continue
    }
    // 连线来源：按槽的资产类型取对应那条（image/video/audio 各走各的，别混）。
    const fromEdge =
      slot.kind === 'image_ref'
        ? fromEdges?.referenceImages?.length
        : slot.kind === 'video_ref' || slot.kind === 'source_video'
          ? fromEdges?.referenceVideos?.length
          : slot.kind === 'audio_ref'
            ? fromEdges?.referenceAudios?.length
            : slot.kind === 'first_frame'
              ? (fromEdges?.firstFrameUrl || '').length
              : slot.kind === 'last_frame'
                ? (fromEdges?.lastFrameUrl || '').length
                : 0
    if (fromEdge) filled.add(slot.kind)
  }
  return filled
}

/**
 * 当前模式里第一个「自己有值、但伴随项一个都没有」的槽。全部满足（或没有任何依赖声明）→ null。
 * 纯函数：不碰 store，好测。
 */
export function unmetReferenceDependency(
  mode: ArchetypeMode,
  filledKinds: ReadonlySet<ArchetypeReferenceSlotKind>,
): UnmetReferenceDependency | null {
  for (const slot of mode.slots) {
    const requires = slot.requiresAnyOf
    if (!requires?.length) continue
    if (!filledKinds.has(slot.kind)) continue // 本槽空 → 依赖无从谈起
    if (requires.some((kind) => filledKinds.has(kind))) continue // 析取：任一满足即可
    return {
      slotLabel: translateModelDisplayText(slot.label),
      companionLabels: requires
        .map((kind) => mode.slots.find((s) => s.kind === kind)?.label)
        .filter((label): label is string => Boolean(label))
        .map(translateModelDisplayText),
    }
  }
  return null
}

/** 节点级便利入口：解析当前模式 → 算已填 kind → 判依赖。无档案 → null（不接管）。 */
export function nodeUnmetReferenceDependency(
  meta: Record<string, unknown> | undefined,
  mode: ArchetypeMode | null | undefined,
  fromEdges?: EdgeReferenceCounts,
): UnmetReferenceDependency | null {
  if (!mode) return null
  return unmetReferenceDependency(mode, filledReferenceKinds(meta, mode, fromEdges))
}
