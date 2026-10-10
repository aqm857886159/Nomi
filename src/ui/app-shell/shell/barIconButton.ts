// 顶栏图标按钮的外观（顶栏右簇、左栏展开、生成页「画布 ↔ 列表」切换共用一个，UI 统一）。
import { cn } from '../../../utils/cn'

export const BAR_ICON_BUTTON = cn(
  'app-no-drag relative grid size-7 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0',
  'text-nomi-ink-60 transition-[background,color] duration-nomi-fast ease-nomi-fast',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-accent',
  'disabled:cursor-not-allowed disabled:opacity-50',
)
