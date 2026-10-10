// 顶栏图标按钮的外观——与 ShellTopBar 里的 BAR_ICON_BUTTON 同一份样式（生成页「画布 ↔ 列表」切换用；外壳线下次动 ShellTopBar 时让它改引这里，避免两份）。
import { cn } from '../../../utils/cn'

export const BAR_ICON_BUTTON = cn(
  'app-no-drag relative grid size-7 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0',
  'text-nomi-ink-60 transition-[background,color] duration-nomi-fast ease-nomi-fast',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
