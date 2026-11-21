import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { tooltipLines } from './tooltipLines'

const TooltipProvider = TooltipPrimitive.Provider
const Tooltip = TooltipPrimitive.Root
const TooltipTrigger = TooltipPrimitive.Trigger

type TooltipContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>,
  'className' | 'style' | 'asChild' | 'children'
> & {
  /** 只收字：样子（宽度、换行、底色、层级）全由这里定，调用方传不进类名和样式。多段用「\n」隔开。 */
  children: string
}

/**
 * 全软件唯一的悬停提示样子（D-1121-tooltip-multiline-shared）：一句一行，每句不折；
 * 整块最宽到窗口可用宽（Radix 给的 `--radix-tooltip-content-available-width`），只有一句比窗口还宽时才在句子里折。
 * 单行时和以前逐像素一样高（2 + 16 + 2 + 边框 2 = 22，字的位置不变）。
 */
const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, TooltipContentProps>(
  ({ sideOffset = 6, children, ...props }, ref) => (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className="z-popover w-max break-words rounded-nomi-sm border border-nomi-ink-20 bg-nomi-ink px-2 py-0.5 text-caption leading-4 text-nomi-paper shadow-nomi-md select-none"
        style={{ maxWidth: 'var(--radix-tooltip-content-available-width, 100vw)' }}
        {...props}
      >
        {tooltipLines(children).map((line, index) => <span key={index} className="block">{line}</span>)}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  ),
)
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
