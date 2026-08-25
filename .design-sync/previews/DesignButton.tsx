// DesignButton —— 设置/表单页的通用按钮（Mantine Button 的 Nomi 封装，h-8 / rounded-nomi-sm）。
// 工作区画布内的紧凑动作用 WorkbenchButton，不用这个。
// 组合取自真实调用点：模型接入向导（再加一个 / 完成）、能力编辑器（保存 / 清除自定义契约）、
// 素材库（导入所选到画布）。
import { IconPlus, IconDeviceFloppy } from '@tabler/icons-react'
import { DesignButton } from 'nomi'

/** 变体轴：Mantine 变体在 Nomi 主题下的真实观感。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignButton variant="filled">完成</DesignButton>
    <DesignButton variant="light">添加一个模式</DesignButton>
    <DesignButton variant="subtle">再接一个模型</DesignButton>
    <DesignButton variant="outline">重新编辑</DesignButton>
  </div>
)

/** 真实向导页脚：次要动作在左、主动作在右。 */
export const WizardFooter = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 8,
      width: 420,
      padding: 12,
      borderRadius: 'var(--nomi-radius-lg)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <DesignButton variant="subtle">再接一个模型</DesignButton>
    <DesignButton variant="filled" leftSection={<IconDeviceFloppy size={15} />}>
      保存并完成
    </DesignButton>
  </div>
)

/** size 轴：xs 用于能力编辑器里「加一项」这类行内动作，默认 sm 用于页脚。 */
export const Sizes = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignButton variant="subtle" size="xs" leftSection={<IconPlus size={13} />}>
      加一个参数
    </DesignButton>
    <DesignButton variant="light" size="sm">
      导入所选到画布
    </DesignButton>
    <DesignButton variant="filled" size="md">
      开始生成
    </DesignButton>
  </div>
)

/** 状态：loading 换成品牌 N 转圈并自动禁用；上限用尽时 disabled。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <DesignButton variant="filled" loading>
      正在保存
    </DesignButton>
    <DesignButton variant="light" disabled>
      模式已达上限
    </DesignButton>
  </div>
)
