// DesignTextarea —— 多行文本输入（Mantine Textarea 的 Nomi 封装）。
// 注意：Nomi 默认开了 autosize=true——高度跟着内容长，不出现内部滚动条。
// 需要固定高度就显式传 autosize={false} + rows。
// 组合取自真实调用点：创作页的提示词输入、能力编辑器的自定义脚本。
import React from 'react'
import { DesignTextarea } from 'nomi'

function Demo(
  props: Omit<React.ComponentProps<typeof DesignTextarea>, 'value' | 'onChange'> & { initial?: string },
): JSX.Element {
  const { initial = '', ...rest } = props
  const [value, setValue] = React.useState(initial)
  return <DesignTextarea {...rest} value={value} onChange={(e) => setValue(e.currentTarget.value)} />
}

/** 创作页的提示词输入：autosize 让长提示词整段可见。 */
export const PromptInput = (): JSX.Element => (
  <div style={{ width: 420 }}>
    <Demo
      label="这一镜要什么"
      description="用大白话描述画面，Nomi 会拆成分镜"
      initial={
        '黄昏的海边，一个穿米色风衣的女人背对镜头站在礁石上，海风把头发吹起来。\n镜头从她背后缓缓推近，最后停在她侧脸的剪影上。'
      }
      minRows={3}
    />
  </div>
)

/** autosize 轴：默认自适应 vs 固定 4 行。 */
export const AutosizeVsFixed = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
    <div style={{ width: 260 }}>
      <Demo label="autosize（默认）" initial={'第一行\n第二行\n第三行'} />
    </div>
    <div style={{ width: 260 }}>
      <Demo label="固定 4 行" autosize={false} rows={4} initial={'第一行\n第二行\n第三行'} />
    </div>
  </div>
)

/** 状态：占位 / 报错 / 禁用。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 380 }}>
    <Demo label="负面提示词" placeholder="不想出现的东西，比如：文字、水印、多余的手" minRows={2} />
    <Demo label="自定义脚本" initial="{ invalid json" error="不是合法的 JSON" minRows={2} classNames={{ input: 'font-nomi-mono' }} />
    <Demo label="这一镜要什么" initial="正在生成中，暂时不能改" disabled minRows={2} />
  </div>
)
