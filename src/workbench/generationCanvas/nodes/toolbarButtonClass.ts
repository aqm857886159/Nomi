import { cn } from '../../../utils/cn'

// 节点浮条按钮的外观（底 + 文字 + 悬停）：NodeFloatingToolbar 的按钮原子和 ToolbarActionMenu 的 ▾ 触发钮共用这一份，钮只长一个样。
// 单独一个文件：组件文件同时导出非组件会破坏 Fast Refresh。
const buttonBase = cn(
  'inline-flex items-center justify-center min-h-8 rounded-nomi-sm border-0 cursor-pointer',
  'text-body-sm leading-none whitespace-nowrap',
  'transition-colors duration-nomi-fast ease-nomi-fast',
  'disabled:opacity-45 disabled:cursor-wait',
)

const variantClass = (accent?: boolean): string =>
  accent ? 'text-nomi-accent hover:bg-nomi-accent-soft' : 'bg-transparent text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink'

export const toolbarButtonClass = (accent?: boolean): string => cn(buttonBase, variantClass(accent))
