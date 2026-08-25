// DesignCheckbox —— 复选框（Mantine Checkbox 的 Nomi 封装，radius 默认 sm）。
// 与 DesignSwitch 的分工：Checkbox 用于「多选 / 确认后才生效」，Switch 用于「立即生效的开关」。
// 组合取自真实调用点：能力编辑器的参数默认值勾选；以及导出面板的多选项。
import React from 'react'
import { DesignCheckbox } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignCheckbox>, 'checked' | 'onChange'> & { initial?: boolean },
): JSX.Element {
  const { initial = false, ...rest } = props
  const [checked, setChecked] = React.useState(initial)
  return <DesignCheckbox {...rest} checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
}

/** 导出面板的真实多选组。 */
export const ExportOptions = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 340 }}>
    <Demo initial label="导出后打开所在文件夹" />
    <Demo initial label="烧录字幕到画面" description="关掉则输出独立的字幕文件" />
    <Demo label="同时导出每一镜的单独文件" />
  </div>
)

/** 状态轴：未选 / 已选 / 半选 / 禁用 / 报错。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 340 }}>
    <Demo label="未选中" />
    <Demo initial label="已选中" />
    <DesignCheckbox indeterminate label="部分选中（3 / 8 镜）" onChange={() => {}} />
    <DesignCheckbox checked disabled label="本地模型不支持这项" onChange={() => {}} />
    <DesignCheckbox checked={false} label="我已阅读并同意" error="要继续得先勾选这项" onChange={() => {}} />
  </div>
)

/** size 轴。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo initial size="xs" label="xs" />
    <Demo initial size="sm" label="sm" />
    <Demo initial size="md" label="md" />
  </div>
)
