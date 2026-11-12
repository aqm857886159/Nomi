import React from 'react'

/** 方式刚被输入自动改掉（放多了、原来那种放不下）：行尾说一句「放了 N 张，已改成 X」。 */
export type ModeSwitchNotice = { count: number; allImages: boolean; modeName: string }

/** 模型自己放不下的几张（任何方式都收不下全部）：行尾报数「可灵 4.0 最多用 2 张，第 3 张不会发 / 其余 28 张不会发」。 */
export type ModelLimitNotice = { model: string; max: number; total: number }

/**
 * 参考行行尾的一句 12px 小字（统一规则 5：不写解释句、不放彩色提示条；有后果且一眼可见的说明才写）。
 * 优先级：模型不收参考图 > 渠道指路 > 模型放不下（报数）> 方式刚被改掉 > 「参考图 N 张」（图片节点加「· 按图改」）。
 */
/** 行尾报数：只有图 →「参考图 N 张」；有两种以上（或只有视频 / 音频）→「图 30 · 视频 10 · 音频 10」。每种都到上限再加「，都放满了」。 */
export function referenceCountText(t: (key: string, values?: Record<string, unknown>) => string, counts: ReferenceKindCounts, full = false): string {
  const kinds = (['image', 'video', 'audio'] as const).filter((kind) => counts[kind] > 0)
  if (!kinds.length) return ''
  const head = kinds.length === 1 && kinds[0] === 'image'
    ? t('assetLibrary.refRow.count', { count: counts.image })
    : kinds.map((kind) => t(kind === 'image' ? 'assetLibrary.refRow.kindImage' : kind === 'video' ? 'assetLibrary.refRow.kindVideo' : 'assetLibrary.refRow.kindAudio', { count: counts[kind] })).join(' · ')
  return full ? `${head}${t('assetLibrary.refRow.allFull')}` : head
}

export type ReferenceKindCounts = { image: number; video: number; audio: number }

export default function referenceRowTail(t: (key: string, values?: Record<string, unknown>) => string, { refsUnsupported, unusedCount, counts, full, guidanceNote, modelLimit, switchNotice, imageEdit }: {
  refsUnsupported: boolean
  unusedCount: number
  /** 参考数组里各类型放了几个。 */
  counts: ReferenceKindCounts
  /** 每种都到上限。 */
  full?: boolean
  guidanceNote: React.ReactNode
  modelLimit?: ModelLimitNotice | null
  switchNotice?: ModeSwitchNotice | null
  /** 图片节点放了图：这次是按图改。 */
  imageEdit?: boolean
}): React.JSX.Element | undefined {
  const count = (n: number) => t('assetLibrary.refRow.count', { count: n })
  if (refsUnsupported) return unusedCount > 0 ? <span>{count(unusedCount)} · {t('assetLibrary.refRow.unsupportedNote')}</span> : undefined
  const countLabel = referenceCountText(t, counts, full)
  const countNode = countLabel ? <span>{countLabel}</span> : null
  if (guidanceNote) return <>{countNode}{guidanceNote}</>
  if (modelLimit && modelLimit.total > modelLimit.max) {
    const from = modelLimit.max + 1
    return (
      <span data-reference-tail-kind="model-limit">
        {from === modelLimit.total
          ? t('assetLibrary.refRow.modelLimitOne', { model: modelLimit.model, max: modelLimit.max, from })
          : t('assetLibrary.refRow.modelLimitRange', { model: modelLimit.model, max: modelLimit.max, rest: modelLimit.total - modelLimit.max })}
      </span>
    )
  }
  if (switchNotice) {
    return (
      <span data-reference-tail-kind="mode-switched">
        {t(switchNotice.allImages ? 'assetLibrary.refRow.switchedTo' : 'assetLibrary.refRow.switchedToItems', { count: switchNotice.count })}
        <b className="font-semibold text-nomi-ink-80">{switchNotice.modeName}</b>
      </span>
    )
  }
  if (!countNode) return undefined
  if (imageEdit) return <span>{countLabel} · {t('assetLibrary.refRow.imageEdit')}</span>
  return countNode
}
