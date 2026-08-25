// DesignNumberInput —— 数字输入（Mantine NumberInput 的 Nomi 封装，带步进器）。
// props 即 Mantine NumberInputProps（min / max / step / clampBehavior / suffix / allowDecimal…）。
// 组合取自真实调用点：能力编辑器的参数默认值；以及生成参数（张数 / 时长 / 引导强度）。
import React from 'react'
import { DesignNumberInput } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignNumberInput>, 'value' | 'onChange'> & {
    initial?: number | string
  },
): JSX.Element {
  const { initial = 1, ...rest } = props
  const [value, setValue] = React.useState<number | string>(initial)
  return <DesignNumberInput {...rest} value={value} onChange={setValue} />
}

/** 生成参数的真实一组：都有单位、都有上下限。 */
export const GenerationParams = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}>
    <Demo label="生成张数" initial={4} min={1} max={8} />
    <Demo label="视频时长" initial={5} min={1} max={12} suffix=" 秒" />
    <Demo label="引导强度" initial={7.5} min={1} max={20} step={0.5} allowDecimal />
  </div>
)

/** clampBehavior：超出 min/max 时是立即回夹还是允许暂时越界。 */
export const Bounds = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}>
    <Demo label="并发数（1–6，立即回夹）" initial={6} min={1} max={6} clampBehavior="strict" />
    <Demo label="随机种子（不限）" initial={20260826} allowNegative={false} thousandSeparator="" />
  </div>
)

/** 状态：报错 / 禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 300 }}>
    <Demo label="生成张数" initial={12} min={1} max={8} error="这个模型一次最多 8 张" />
    <Demo label="视频时长" initial={5} suffix=" 秒" disabled description="该模型时长固定" />
  </div>
)
