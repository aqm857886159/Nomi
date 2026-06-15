import { cn } from '../../../utils/cn'

// 生成钮（底栏深色圆形主行动钮）的样式——真实底栏（NodeGenerationComposer）与离屏测量副本
// （NodeComposerWidthMeasurer）共用同一份，否则测出的卡宽与实际不符（R1 单一真相）。
// 放独立非组件模块：避免两个组件互相 import 造成循环引用，也不触发 react-refresh 警告。
export const GENERATE_BUTTON_CLASS = cn(
  'inline-flex items-center justify-center shrink-0 w-[30px] h-[30px] p-0',
  'border-0 rounded-full bg-nomi-ink text-nomi-paper text-body leading-none cursor-pointer',
  'transition-colors hover:enabled:bg-nomi-accent',
  'disabled:bg-nomi-ink-20 disabled:text-nomi-ink-40 disabled:cursor-not-allowed',
)

// 卡片左右 padding 合计（p-[12px]×2），加在测出的底栏内容宽上 = 卡宽。
export const CARD_HORIZONTAL_PADDING = 24
