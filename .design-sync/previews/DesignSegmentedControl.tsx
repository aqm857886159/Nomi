// DesignSegmentedControl —— Mantine SegmentedControl 的 Nomi 封装（radius 默认 sm）。
// 与 NomiSegmented 的分工：这个是 Mantine 原生实现（带滑块动画、data 收 string|{label,value}），
// 用在**设置/表单**页；NomiSegmented 是 Nomi 自研的等宽 grid 版本，用在**画布参数面板**。
// 新代码优先用 NomiSegmented（设计系统通用件）。
import React from 'react'
import { DesignSegmentedControl } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignSegmentedControl>, 'value' | 'onChange'> & { initial: string },
): JSX.Element {
  const { initial, ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <DesignSegmentedControl {...rest} value={value} onChange={setValue} />
}

/** 设置页的外观切换：跟随系统 / 亮 / 暗。 */
export const ColorScheme = (): JSX.Element => (
  <Demo
    initial="auto"
    data={[
      { value: 'auto', label: '跟随系统' },
      { value: 'light', label: '亮色' },
      { value: 'dark', label: '暗色' },
    ]}
  />
)

/** fullWidth：铺满父容器（表单里的常见用法）。 */
export const FullWidth = (): JSX.Element => (
  <div style={{ width: 380 }}>
    <Demo
      fullWidth
      initial="image"
      data={[
        { value: 'image', label: '文生图' },
        { value: 'video', label: '图生视频' },
        { value: 'upscale', label: '放大修复' },
      ]}
    />
  </div>
)

/** 状态：整组禁用 / 单项禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
    <Demo
      initial="local"
      data={[
        { value: 'local', label: '本地模型' },
        { value: 'cloud', label: '云端模型', disabled: true },
      ]}
    />
    <Demo
      disabled
      initial="light"
      data={[
        { value: 'light', label: '亮色' },
        { value: 'dark', label: '暗色' },
      ]}
    />
  </div>
)
