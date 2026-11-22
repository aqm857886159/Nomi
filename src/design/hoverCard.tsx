import * as React from 'react'
import * as HoverCardPrimitive from '@radix-ui/react-hover-card'

/**
 * 悬停卡：带画面或可滚动的预览（技能库、提示词预设、Agent 输入框里的技能 chip）。
 * 纯文字的短说明不用它，用 `tooltip.tsx` 的墨色提示（分工见 docs/design/nomi-design-system.md）。
 *
 * 开合、放哪边、碰窗口边翻面、鼠标移进卡里不收（卡里能滚）都归 Radix HoverCard；
 * Radix 把它定为只给看得见的人用的预览，不在读屏里再放一份隐藏副本（墨色提示会放，那份对图文卡是白渲染一遍）。
 */
function HoverCard({ openDelay = 180, closeDelay = 100, ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>): React.JSX.Element {
  return <HoverCardPrimitive.Root openDelay={openDelay} closeDelay={closeDelay} {...props} />
}

const HoverCardTrigger = HoverCardPrimitive.Trigger

/** 卡里放什么调用方定；卡本身的样子（纸色底、宽、边框、阴影、层级）只在这里，调用方传不进类名和样式。 */
type HoverCardContentProps = Omit<React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>, 'className' | 'style' | 'asChild'>

// 样子取这两张卡搬过来之前已经在屏上的那一份（技能库行右侧预览、Agent 技能 chip 预览）。
const HoverCardContent = React.forwardRef<React.ElementRef<typeof HoverCardPrimitive.Content>, HoverCardContentProps>(
  ({ sideOffset = 6, ...props }, ref) => (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className="z-popover w-80 max-w-[80vw] select-none whitespace-normal rounded-nomi-sm border border-nomi-ink-20 bg-nomi-paper p-3 text-caption leading-none text-nomi-ink shadow-nomi-lg"
        {...props}
      />
    </HoverCardPrimitive.Portal>
  ),
)
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardContent, HoverCardTrigger }
