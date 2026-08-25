// IconActionButton —— 表单/设置页里的图标动作按钮（Mantine ActionIcon 的 Nomi 封装）。
// 与 WorkbenchIconButton 的分工：这个用在**设置/表单**语境（能力编辑器行尾的删除、任务行的取消），
// 走 Mantine 的 variant 体系并内建 loading；WorkbenchIconButton 用在**画布/时间轴**工具条。
// icon 是必填 prop（不是 children）。
// 组合取自真实调用点：能力编辑器「删除这个模式/槽位/参数」、任务列表「取消这个任务」。
import { IconTrash, IconX, IconChevronLeft, IconPencil } from '@tabler/icons-react'
import { IconActionButton } from 'nomi'

/** 能力编辑器的真实行尾：一行标签 + 末尾删除。 */
export const RowAction = (): JSX.Element => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      width: 360,
      padding: '8px 10px',
      borderRadius: 'var(--nomi-radius-sm)',
      border: '1px solid var(--nomi-line)',
      background: 'var(--nomi-paper)',
    }}
  >
    <span style={{ flex: 1, font: '400 13px var(--nomi-font-sans)', color: 'var(--nomi-ink)' }}>
      文生图 · 分辨率
    </span>
    <IconActionButton icon={<IconPencil size={16} />} aria-label="编辑这个参数" title="编辑这个参数" />
    <IconActionButton
      icon={<IconTrash size={16} />}
      aria-label="删除这个参数"
      title="删除这个参数"
      className="text-nomi-ink-40 hover:text-workbench-danger"
    />
  </div>
)

/** 变体轴：subtle（默认，幽灵）/ light / filled / outline。 */
export const Variants = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <IconActionButton variant="subtle" icon={<IconX size={16} />} aria-label="取消这个任务" />
    <IconActionButton variant="light" icon={<IconX size={16} />} aria-label="取消这个任务" />
    <IconActionButton variant="filled" icon={<IconX size={16} />} aria-label="取消这个任务" />
    <IconActionButton variant="outline" icon={<IconChevronLeft size={16} />} aria-label="返回上一步" />
  </div>
)

/** 状态：loading 换成品牌 N 转圈并自动禁用；最后一个模式不允许删时 disabled。 */
export const States = (): JSX.Element => (
  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
    <IconActionButton icon={<IconX size={16} />} aria-label="正在取消" loading />
    <IconActionButton icon={<IconTrash size={16} />} aria-label="删除这个模式（至少保留一个）" disabled />
  </div>
)
