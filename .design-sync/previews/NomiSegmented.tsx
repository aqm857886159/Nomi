// NomiSegmented —— 分段选择器（设计系统通用件）。ink-05 圆角槽 + 选中项 paper 浮起带轻影。
// 用于「参数面板」这类少量离散档位的即点即改场景（2026-07-17 用户拍板的节点参数交互）。
//
// 关键实现（读源码得来，别改坏）：grid auto-fit + minmax(56px, 1fr) 严格等宽——
// 选项少于一行时拉伸填满父容器（两项各占一半，不缩在左边），多于一行时换行项与上行同宽。
// 所以卡里要给它一个**有宽度的父容器**才看得出真实形态。
//
// 组合取自真实调用点：设置页「默认制作模式」（settings.automation.mode）、
// ClipNode 导出范围（完整成片 / 独立片段）、生成参数的供应商切换与比例档。
import React from 'react'
import { NomiSegmented } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof NomiSegmented>, 'value' | 'onChange'> & { initial: string },
): JSX.Element {
  const { initial, ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <NomiSegmented {...rest} value={value} onChange={setValue} />
}

/** 设置页「默认制作模式」的真实三档。 */
export const AutomationMode = (): JSX.Element => (
  <div style={{ width: 360 }}>
    <Demo
      initial="balanced"
      ariaLabel="默认制作模式"
      options={[
        { value: 'guided', label: '引导', title: '每个关键阶段都暂停，适合第一次使用或高风险项目。' },
        { value: 'balanced', label: '平衡', title: '确认一次制作摘要后在预算内继续。' },
        { value: 'policy-auto', label: '策略自动', title: '仅在已知成本和既定策略内自动继续。' },
      ]}
    />
  </div>
)

/** 两项时严格等宽、各占一半（这是它相对 flex-1 方案的关键改进）。 */
export const TwoOptionsFillWidth = (): JSX.Element => (
  <div style={{ width: 300 }}>
    <Demo
      initial="full"
      ariaLabel="导出范围"
      className="rounded-nomi-sm p-0.5"
      options={[
        { value: 'full', label: '完整成片' },
        { value: 'segments', label: '独立片段 · 6' },
      ]}
    />
  </div>
)

/** 自定义 label：比例档的「图形 + 文字」双行组合（label 收 ReactNode）。 */
export const AspectRatios = (): JSX.Element => (
  <div style={{ width: 360 }}>
    <Demo
      initial="16:9"
      ariaLabel="画面比例"
      itemClassName="min-h-7 py-0.5"
      options={[
        { value: '1:1', label: <><span style={{ display: 'block', width: 18, height: 18, border: '1.5px solid currentColor', borderRadius: 2 }} />1:1</> },
        { value: '16:9', label: <><span style={{ display: 'block', width: 18, height: 10, border: '1.5px solid currentColor', borderRadius: 2 }} />16:9</> },
        { value: '9:16', label: <><span style={{ display: 'block', width: 10, height: 18, border: '1.5px solid currentColor', borderRadius: 2 }} />9:16</> },
        { value: '4:3', label: <><span style={{ display: 'block', width: 18, height: 13, border: '1.5px solid currentColor', borderRadius: 2 }} />4:3</> },
      ]}
    />
  </div>
)

/** 禁用档：本地模型不支持的分辨率置灰不可点，但仍占位（用户能看见「有这档，只是现在不能选」）。 */
export const WithDisabledOption = (): JSX.Element => (
  <div style={{ width: 320 }}>
    <Demo
      initial="1K"
      ariaLabel="输出分辨率"
      options={[
        { value: '1K', label: '1K' },
        { value: '2K', label: '2K' },
        { value: '4K', label: '4K', disabled: true, title: '当前模型不支持 4K' },
      ]}
    />
  </div>
)
