// DesignSwitch —— 开关（Mantine Switch 的 Nomi 封装）。用于**立即生效**的布尔设置。
// 需要「确认后才生效」的用 DesignCheckbox。
// 组合取自真实调用点：能力编辑器（作为数组发送 / 按角色索引 / 提示词必填）、模型接入（我没有 API Key）。
import React from 'react'
import { DesignSwitch } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignSwitch>, 'checked' | 'onChange'> & { initial?: boolean },
): JSX.Element {
  const { initial = false, ...rest } = props
  const [checked, setChecked] = React.useState(initial)
  return <DesignSwitch {...rest} checked={checked} onChange={(e) => setChecked(e.currentTarget.checked)} />
}

/** 能力编辑器的真实设置组：开关在左、说明文字在右。 */
export const InCapabilityEditor = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 380 }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>
      <Demo initial aria-label="作为数组发送" />
      作为数组发送
    </label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>
      <Demo aria-label="按角色索引" />
      按角色索引
    </label>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>
      <Demo initial aria-label="提示词必填" />
      提示词必填
    </label>
  </div>
)

/** 带标签与说明的完整形态。 */
export const WithLabel = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: 380 }}>
    <Demo initial label="天黑自动切暗色" description="按本地时间；手动切一次后记住你的选择" />
    <Demo label="我没有 API Key" description="先用本地模型试试，之后随时可以接入" />
  </div>
)

/** 状态：开 / 关 / 禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
    <Demo initial label="已开启" />
    <Demo label="已关闭" />
    <DesignSwitch checked disabled label="锁定（由项目决定）" onChange={() => {}} />
  </div>
)
