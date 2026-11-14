/**
 * 生成浮框底栏参数 chip 的「两个值」摘要（docs/design/2026-09-10-node-composer-bar-v1.md §v1.1，
 * 2026-09-11 用户拍板）。
 *
 * 要权衡的那一个东西：chip 过去串接**所有**参数的当前值，视频节点上就成了
 * `1080p · 16:9 · 5 · 音频`——110px 的 pill 装不下，真机上截断成「1080p · 16:…」。
 * v1.1 改成只报**最影响结果和价格的几个**：视频 = 比例 + 清晰度 + 时长（B3 清单合同 10-19：「16:9 · 720p · 5s」，有清晰度参数就印），
 * 图 = 比例 + 清晰度。代价是生成音频这类值要点开 chip 才看得到——它们仍在同一块面板里，一次点击可达。
 *
 * 两个值**从档案 derive**，不写死文案：换个模型（没有时长、清晰度叫别的名字）照样说得对，
 * 一个都没有就返回 undefined → InlineParameterBar 回到它自己的默认串接，不假装有摘要。
 */
import {
  catalogControlInitialValue,
  controlInitialValue,
  controlValueToString,
  isParameterControl,
  optionLabel,
  optionValue,
  type DynamicModelControl,
} from './controls/parameterControlModel'
import { localizeAutoOption } from './parameterOptionPresentation'

/**
 * 各执行类的「头两个值」按**控件 key** 挑，不按下标。
 * 比例在不同档案里叫 aspect_ratio / size / ratio，都收在这里；命中顺序 = 显示顺序。
 */
const HEADLINE_KEYS = {
  video: ['aspect_ratio', 'size', 'ratio', 'resolution', 'duration'],
  image: ['aspect_ratio', 'size', 'ratio', 'resolution'],
} as const

/**
 * 一个控件当前值的显示文字。「自动」档（`auto` / `adaptive`）一律换成调用方给的本地化字样——
 * 面板里那一格早就这么显示了（`localizeAutoOption`），摘要里却露出英文原值（2026-10-05 审计 A11：
 * 中文界面里出现 `adaptive`），同一个值两种说法。
 */
function controlDisplayValue(control: DynamicModelControl, meta: Record<string, unknown>, autoLabel: string): string {
  if (!isParameterControl(control)) {
    const value = catalogControlInitialValue(control, meta)
    const matched = control.options.find((option) => optionValue(option) === value)
    return localizeAutoOption(value, matched ? optionLabel(matched) : value, autoLabel).text
  }
  const value = controlInitialValue(control, meta)
  const matched = control.options.find((option) => controlValueToString(option.value) === value)
  return localizeAutoOption(value, matched ? matched.label : value, autoLabel).text
}

/**
 * 底栏挤的时候摘要按整值往回退，先退谁（边界样张 K4，用户 2026-11-12「按推荐做」）：比例 → 有声 → 清晰度 → 时长。
 * 数小的先退；时长最后（它直接决定价格）。不在表里的值不进摘要。
 */
const HEADLINE_DROP_RANK: Record<string, number> = { aspect_ratio: 0, size: 0, ratio: 0, generate_audio: 1, audio: 1, resolution: 2, duration: 3 }

export type HeadlinePart = { key: string; text: string; dropRank: number }

type HeadlineInput = {
  isImageLike: boolean
  isVideoLike: boolean
  controls: readonly DynamicModelControl[]
  meta: Record<string, unknown>
  /** 时长要带单位（`5` 读不出是秒还是帧）。文案留给调用方翻译，本模块不碰 i18n。 */
  formatSeconds: (value: string) => string
  /** 「自动」档的本地化字样（`generationCommon.parameters.auto`）。 */
  autoLabel: string
}

export function composerHeadlineSummary(input: HeadlineInput): string | undefined {
  const parts = composerHeadlineParts(input)
  return parts.length ? parts.map((part) => part.text).join(' · ') : undefined
}

/** 摘要的每一个整值（带退让顺序）。底栏放不下时按 dropRank 从小到大整值地退，一个值不截半截。 */
export function composerHeadlineParts({ isImageLike, isVideoLike, controls, meta, formatSeconds, autoLabel }: HeadlineInput): HeadlinePart[] {
  // 只有图和视频有拍板过的「那两个值」。声音 / 文本 / 3D 没定过，就别替它们挑——
  // 挑错两个比不挑更糟（用户会以为那就是全部）。
  const wanted = isVideoLike ? HEADLINE_KEYS.video : isImageLike ? HEADLINE_KEYS.image : null
  if (!wanted) return []
  const parts = controls
    .filter((control) => (wanted as readonly string[]).includes(control.key))
    .sort((a, b) => (wanted as readonly string[]).indexOf(a.key) - (wanted as readonly string[]).indexOf(b.key))
    .map((control) => {
      const raw = controlDisplayValue(control, meta, autoLabel)
      // 时长补单位只在**纯数字**时做：档案里 duration 的选项标签有的是「5」、有的已经写成
      // 「5s」/「5 秒」。无条件套单位会渲出「5ss」——一条只在某些模型上才现形的假文案。
      const text = raw && control.key === 'duration' && /^\d+(\.\d+)?$/.test(raw) ? formatSeconds(raw) : raw
      return { key: control.key, text, dropRank: HEADLINE_DROP_RANK[control.key] ?? 0 }
    })
    .filter((part) => part.text)
  return parts
}

/** 摘要从全到简的几档：全部 → 去掉退让序最小的一批 → …，至少留一个值。 */
export function summaryFitCandidates(parts: readonly { text: string; dropRank: number }[]): string[] {
  if (!parts.length) return []
  const ranks = [...new Set(parts.map((part) => part.dropRank))].sort((a, b) => a - b)
  const out = [parts.map((part) => part.text).join(' · ')]
  for (const rank of ranks.slice(0, -1)) out.push(parts.filter((part) => part.dropRank > rank).map((part) => part.text).join(' · '))
  return out
}
