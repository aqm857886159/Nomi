// DesignTextInput —— 单行文本输入（Mantine TextInput 的 Nomi 封装，radius 默认 sm）。
// props 即 Mantine TextInputProps（label / description / placeholder / error / disabled / withAsterisk…）。
// 组合取自真实调用点：能力编辑器的槽位标签 / inputKey（后者用 classNames={{input:'font-nomi-mono'}} 走等宽）。
import React from 'react'
import { DesignTextInput } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignTextInput>, 'value' | 'onChange'> & { initial?: string },
): JSX.Element {
  const { initial = '', ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <DesignTextInput {...rest} value={value} onChange={(e) => setValue(e.currentTarget.value)} />
}

/** 能力编辑器的真实一组：人话标签 + 等宽的接口字段名。 */
export const InCapabilityEditor = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
    <Demo label="槽位名称" initial="参考图" placeholder="用户看到的名字" maxLength={160} />
    <Demo
      label="接口字段名"
      description="发给模型时用的 key，区分大小写"
      initial="reference_image_url"
      classNames={{ input: 'font-nomi-mono' }}
      maxLength={128}
    />
  </div>
)

/** 状态轴：常态 / 必填 / 报错 / 禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 340 }}>
    <Demo label="项目名称" initial="海边黄昏 · 第二版" />
    <Demo label="API Key" placeholder="sk-..." withAsterisk />
    <Demo label="接口字段名" initial="reference image" error="字段名不能含空格" />
    <Demo label="供应商" initial="APIMart" disabled description="已接入，改用重新授权" />
  </div>
)

/** size 轴：xs（紧凑行内）→ sm（默认）→ md（设置页）。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 300 }}>
    <Demo size="xs" initial="xs · 紧凑行内" />
    <Demo size="sm" initial="sm · 默认" />
    <Demo size="md" initial="md · 设置页" />
  </div>
)
