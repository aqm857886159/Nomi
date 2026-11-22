// 顶栏图标钮一族的外观（拍板稿 .ib：28px 方块、圆角 6）：顶栏右簇、左簇的「展开左栏」、生成页「画布 ↔ 列表」切换、Nomi 入口都引这一份。
// 图标档位由这一族自己定（条档 18 / 1.8），里面的图标不传 size / stroke。
import { ICON_TIER_CLASSES } from '../../../design'
import { cn } from '../../../utils/cn'

export const BAR_ICON_BUTTON = cn(
  'app-no-drag relative grid size-7 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent p-0',
  'text-nomi-ink-60 transition-[background,color] duration-nomi-fast ease-nomi-fast',
  'hover:bg-nomi-ink-05 hover:text-nomi-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-nomi-ink',
  'disabled:cursor-not-allowed disabled:opacity-50',
  ICON_TIER_CLASSES.bar,
)
