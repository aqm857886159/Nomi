import React, { type JSX } from 'react'
import { cn } from '../../../../utils/cn'
import { useElementWidth } from './useElementWidth'
import { StoryboardRowNarrowContext, storyboardRowIsNarrow } from './storyboardRowDensity'

/**
 * 行解剖的**唯一实现**（镜头行与参考卡共用）：`[行首 14 | 视觉列 | 内容列 1fr]`，从左往右读——
 * **长什么样 → 说什么 → 怎么生成**（2026-10-06 第二轮，版面由协调会话定）。
 *
 *   · 行首：勾选 / 拖动 / ⋯（参考卡是类型图标 / ⋯）；
 *   · 视觉列：预览框（全表同一只，整片默认画幅的框）+ 结果动作 + 参考缩略图条，列宽 = 预览框宽；
 *   · 内容列：提示词 + 底栏，**撑满整行高度**，于是底栏（和最右的「生成」）永远在内容列右下角、每行同一位置。
 * 行高取两列较高的那一列；内边距统一 12；行间 1px 分隔线由外层负责。
 *
 * 这一层还量自己有多宽，定宽 / 窄档（`storyboardRowDensity`）：视觉列宽跟着档位缩，档位经 context 递给
 * 画面格和参考条——列宽与框必须同一帧一起换，分两处判就会出现「列缩了框没缩」。
 */

type Props = {
  /** 行首 14px 竖条。 */
  grip?: React.ReactNode
  /** 视觉列（预览框 + 结果动作 + 参考条）。 */
  visual: React.ReactNode
  /** 视觉列宽（宽档值，`visualColumnWidth`；窄档由这里按 176/240 缩）。 */
  visualWidth: number
  /**
   * 内容列撑满行高（默认）：底栏与「生成」逐行同一位置。整片竖版时传 false——提示词与底栏贴在一起、
   * 空白留在框外（2026-10-06 用户选 A，接受「生成」纵向位置跟着内容走）。
   */
  contentStretch?: boolean
  prompt: React.ReactNode
  /** 整行下方跨列的附加区（变体抽屉…）；缺省 = 不占位。 */
  footer?: React.ReactNode
  /** 拖拽落点线（蓝色 2px，落在行上沿）。 */
  dropIndicator?: boolean
  className?: string
  dataAttributes?: Record<string, string | number | undefined>
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  'onClick' | 'onKeyDown' | 'onDragOver' | 'onDrop' | 'tabIndex'
>

const ROW_GRIP_WIDTH = 14
const NARROW_SCALE = 176 / 240

export default function StoryboardRowShell({
  grip,
  visual,
  visualWidth,
  contentStretch = true,
  prompt,
  footer,
  dropIndicator,
  className,
  dataAttributes,
  ...handlers
}: Props): JSX.Element {
  const rowRef = React.useRef<HTMLDivElement | null>(null)
  // 量外框（宽度由编辑器那条 grid 给），不量内容——改列模板不会反过来改它，没有测量—布局回环。
  const narrow = storyboardRowIsNarrow(useElementWidth(rowRef))
  const columnWidth = narrow ? Math.round(visualWidth * NARROW_SCALE) : visualWidth
  return (
    <StoryboardRowNarrowContext.Provider value={narrow}>
      <div
        {...handlers}
        {...dataAttributes}
        ref={rowRef}
        data-storyboard-row-density={narrow ? 'narrow' : 'wide'}
        className={cn('relative grid items-stretch gap-3 bg-nomi-paper p-3', className)}
        style={{ gridTemplateColumns: `${ROW_GRIP_WIDTH}px ${columnWidth}px minmax(0,1fr)` }}
      >
        {dropIndicator ? <div className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-nomi-accent" aria-hidden /> : null}
        <div className="relative self-start justify-self-center text-nomi-ink-20">{grip}</div>
        <div className="min-w-0 self-start" data-storyboard-visual-column="true">{visual}</div>
        <div className={cn('flex min-w-0 flex-col gap-1.5', !contentStretch && 'self-start')} data-storyboard-content-column="true">{prompt}</div>
        {footer ? <div className="col-start-2 col-span-2">{footer}</div> : null}
      </div>
    </StoryboardRowNarrowContext.Provider>
  )
}
