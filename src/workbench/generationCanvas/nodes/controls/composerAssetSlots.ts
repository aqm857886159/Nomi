import type { ArchetypeMode } from '../../../../../electron/shared/modelArchetypes'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { AssetSlot } from '../../../assets/AssetReference'
import type { ImageUrlSlot } from '../../model/parameterReferenceSlots'
import type { ArchetypeArraySlot } from './archetypeMeta'

/**
 * P1 统一参考槽：生成框参考行的声明式 AssetSlot 列表（单帧连边 / 数组 meta / 源视频 meta 三类），
 * 再按这条渠道的可达性收窄（从 NodeParameterControls 原样搬出，判据不变）。
 */
export function composerAssetSlots(input: {
  imageUrlSlots: readonly ImageUrlSlot[]
  arraySlots: readonly ArchetypeArraySlot[]
  sourceVideoSlot: { metaKey: string; label: string } | null
  archMode: ArchetypeMode | null
  slotReachByKey: Readonly<Record<string, unknown>>
  singleReferenceCaption: string
}): AssetSlot[] {
  const { imageUrlSlots, arraySlots, sourceVideoSlot, archMode, slotReachByKey, singleReferenceCaption } = input
  const slots: AssetSlot[] = [
    ...imageUrlSlots.map((s): AssetSlot => ({
      key: s.key,
      // 唯一翻译点：档案路的槽标签在 archetypeModeSlots 里已翻过（对已是英文的再翻是 no-op，
      // 查不到即原样返回），启发式路（通用中转 / ComfyUI 导入）此前根本没翻 → 英文用户在这个槽
      // 上看到的是中文「参考图」。收在这里翻一次，两条路才真的一个口径。
      label: translateModelDisplayText(s.label),
      accept: s.mediaKind ?? 'image',
      form: 'single',
      persistAsEdge: true,
      numbered: false,
      max: 1,
      // 尾帧可不填（档案里 last_frame 的 min = 0）：格下写「尾帧（可不填）」。
      optional: s.group === 'last_frame' && Boolean(archMode?.slots.some((slot) => slot.kind === 'last_frame' && slot.min === 0)),
    })),
    ...arraySlots.map((s): AssetSlot => ({
      key: s.metaKey, label: translateModelDisplayText(s.label), accept: s.accept, form: 'array',
      persistAsEdge: false, numbered: s.numbered, max: s.max, caption: s.caption,
    })),
    ...(sourceVideoSlot
      ? [{ key: sourceVideoSlot.metaKey, label: translateModelDisplayText(sourceVideoSlot.label), accept: 'video', form: 'single', persistAsEdge: false, numbered: false, max: 1 } as AssetSlot]
      : []),
  ]
  return slots
    // 这条渠道压根发不出的槽：不显示。让用户连上一个「连了也不会进请求」的东西，才是真的坑。
    .filter((slot) => slotReachByKey[slot.key] !== 'none')
    // 只挤得进单图聚合位的槽：如实收成 1 张并说明白，别让用户放了 9 张以为都发得出去。
    .map((slot) => (slotReachByKey[slot.key] === 'single' && (slot.max === undefined || slot.max > 1)
      ? { ...slot, max: 1, caption: singleReferenceCaption }
      : slot))
}
