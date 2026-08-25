// NomiSelect — 全仓统一的「选择面板」通用组件（触发 pill + token 化下拉）。
// 组合取自真实调用点：模型芯片（CanvasSelectionToolbar 并发档 / InlineParameterBar 比例）、
// 自定义调用作用域选择器（CustomCallScopeSelector：leadingLabel + trailing + triggerBadge）。
//
// 注：下拉展开态是 hover/click 驱动的 portal 浮层，静态卡里渲染不出来；
// 这里展示的是触发 pill 的各形态（真实使用中 90% 的时间用户看到的就是它）。
import React from 'react'
import { NomiSelect } from 'nomi'

const MODELS = [
  { value: 'seedream-4', label: 'Seedream 4.0', trailing: '¥0.28', trailingTone: 'muted' as const },
  { value: 'nano-banana', label: 'Nano Banana', trailing: '¥0.15', trailingTone: 'muted' as const },
  { value: 'flux-kontext', label: 'FLUX.1 Kontext', trailing: '¥0.32', trailingTone: 'muted' as const },
  { value: 'sd35-local', label: 'SD 3.5 本地', trailing: '免费', trailingTone: 'accent' as const },
]

/** 受控壳：卡片里也能真的点开/切换，不是死图。 */
function Demo(props: Omit<React.ComponentProps<typeof NomiSelect>, 'value' | 'onChange'> & { initial: string }): JSX.Element {
  const { initial, ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <NomiSelect {...rest} value={value} onChange={setValue} />
}

export const ModelPicker = (): JSX.Element => (
  <Demo initial="seedream-4" options={MODELS} ariaLabel="选择生成模型" triggerMaxWidth={200} />
)

/** 画布参数条：左侧小灰标签 + 当前值（InlineParameterBar 的比例/画幅档）。 */
export const WithLeadingLabel = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo
      initial="16:9"
      leadingLabel="比例"
      ariaLabel="选择画面比例"
      options={[
        { value: 'auto', label: '自动' },
        { value: '1:1', label: '1:1 方形' },
        { value: '16:9', label: '16:9 横屏' },
        { value: '9:16', label: '9:16 竖屏' },
      ]}
    />
    <Demo
      initial="3"
      leadingLabel="并发"
      ariaLabel="选择并发数"
      options={[
        { value: '1', label: '1 条' },
        { value: '3', label: '3 条' },
        { value: '6', label: '6 条' },
      ]}
    />
  </div>
)

/** 触发上的小徽标：标注「这个档位已配置过脚本」（CustomCallScopeSelector）。 */
export const WithTriggerBadge = (): JSX.Element => (
  <Demo
    initial="text_to_image"
    leadingLabel="作用域"
    ariaLabel="选择自定义调用作用域"
    triggerBadge={{ text: '已配置', tone: 'accent' }}
    triggerMaxWidth={220}
    options={[
      { value: 'fallback', label: '通用兜底', trailing: '已配置', trailingTone: 'accent' as const },
      { value: 'text_to_image', label: '文生图', trailing: '已配置', trailingTone: 'accent' as const },
      { value: 'image_to_video', label: '图生视频', trailing: 'video', trailingTone: 'muted' as const },
    ]}
  />
)

/** xs（时间轴/紧凑工具条 24px）vs sm（画布参数 28px），以及禁用态。 */
export const SizesAndDisabled = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo initial="sm" size="sm" ariaLabel="sm 尺寸" options={[{ value: 'sm', label: 'sm · 28px 画布参数' }]} />
    <Demo initial="xs" size="xs" ariaLabel="xs 尺寸" options={[{ value: 'xs', label: 'xs · 24px 时间轴' }]} />
    <NomiSelect
      value="locked"
      options={[{ value: 'locked', label: '未接入模型' }]}
      onChange={() => {}}
      ariaLabel="禁用示例"
      disabled
    />
  </div>
)
