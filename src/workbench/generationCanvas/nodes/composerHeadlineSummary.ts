/**
 * 生成浮框底栏参数 chip 的「两个值」摘要（docs/design/2026-09-10-node-composer-bar-v1.md §v1.1，
 * 2026-09-11 用户拍板）。
 *
 * 要权衡的那一个东西：chip 过去串接**所有**参数的当前值，视频节点上就成了
 * `1080p · 16:9 · 5 · 音频`——110px 的 pill 装不下，真机上截断成「1080p · 16:…」。
 * v1.1 改成只报**最影响结果和价格的那两个**：视频 = 比例 + 时长，图 = 比例 + 清晰度。
 * 代价是清晰度 / 生成音频这类值要点开 chip 才看得到——它们仍在同一块面板里，一次点击可达。
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

/**
 * 各执行类的「头两个值」按**控件 key** 挑，不按下标。
 * 比例在不同档案里叫 aspect_ratio / size / ratio，都收在这里；命中顺序 = 显示顺序。
 */
const HEADLINE_KEYS = {
  video: ['aspect_ratio', 'size', 'ratio', 'duration'],
  image: ['aspect_ratio', 'size', 'ratio', 'resolution'],
} as const

function controlDisplayValue(control: DynamicModelControl, meta: Record<string, unknown>): string {
  if (!isParameterControl(control)) {
    const value = catalogControlInitialValue(control, meta)
    const matched = control.options.find((option) => optionValue(option) === value)
    return matched ? optionLabel(matched) : value
  }
  const value = controlInitialValue(control, meta)
  const matched = control.options.find((option) => controlValueToString(option.value) === value)
  return matched ? matched.label : value
}

export function composerHeadlineSummary({
  isImageLike,
  isVideoLike,
  controls,
  meta,
  formatSeconds,
}: {
  isImageLike: boolean
  isVideoLike: boolean
  controls: readonly DynamicModelControl[]
  meta: Record<string, unknown>
  /** 时长要带单位（`5` 读不出是秒还是帧）。文案留给调用方翻译，本模块不碰 i18n。 */
  formatSeconds: (value: string) => string
}): string | undefined {
  // 只有图和视频有拍板过的「那两个值」。声音 / 文本 / 3D 没定过，就别替它们挑——
  // 挑错两个比不挑更糟（用户会以为那就是全部）。
  const wanted = isVideoLike ? HEADLINE_KEYS.video : isImageLike ? HEADLINE_KEYS.image : null
  if (!wanted) return undefined
  const parts = controls
    .filter((control) => (wanted as readonly string[]).includes(control.key))
    .sort((a, b) => (wanted as readonly string[]).indexOf(a.key) - (wanted as readonly string[]).indexOf(b.key))
    .map((control) => {
      const text = controlDisplayValue(control, meta)
      if (!text) return ''
      // 时长补单位只在**纯数字**时做：档案里 duration 的选项标签有的是「5」、有的已经写成
      // 「5s」/「5 秒」。无条件套单位会渲出「5ss」——一条只在某些模型上才现形的假文案。
      return control.key === 'duration' && /^\d+(\.\d+)?$/.test(text) ? formatSeconds(text) : text
    })
    .filter(Boolean)
  return parts.length ? parts.join(' · ') : undefined
}
