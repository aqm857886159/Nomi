import React, { type JSX } from 'react'
import { cn } from '../../../../utils/cn'
import { FRAME_COLUMN_WIDTH } from './shotFrameGeometry'

/**
 * 行解剖的**唯一实现**：`[14px grip | 画面格 | 1fr 提示词框]`。镜头行与参考卡（锚）展开态共用这一份网格——
 * 列宽、gap、内边距、落点线、拖拽区只有一个 owner（v6 §2.2：两种行完全同一套解剖）。
 *
 * 2026-10-06 起中间那条 200px 参考列没有了：参考图搬进提示词框、在提示词上面（画布节点浮框同一个位置），
 * 省下的宽度全给提示词。也因此不再有「宽档 / 窄档」两套列模板——那一套是给参考列让位用的，
 * 参考列不在了，它也没有存在的理由（同 commit 删除 `storyboardRowDensity`）。
 *
 * 阅读顺序：**画面格（要生成的）→ 提示词框（拿什么参考、怎么描述、用什么参数）**。
 */

type Props = {
  /** 行首 14px 竖条：拖拽把手 / ⋯ 菜单 / 本次跳过复选框。 */
  grip?: React.ReactNode
  frame: React.ReactNode
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

export default function StoryboardRowShell({
  grip,
  frame,
  prompt,
  footer,
  dropIndicator,
  className,
  dataAttributes,
  ...handlers
}: Props): JSX.Element {
  return (
    <div
      {...handlers}
      {...dataAttributes}
      className={cn('relative grid items-start gap-3 bg-nomi-paper py-3 pl-1.5 pr-3', className)}
      style={{ gridTemplateColumns: `${ROW_GRIP_WIDTH}px ${FRAME_COLUMN_WIDTH}px minmax(0,1fr)` }}
    >
      {dropIndicator ? <div className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-nomi-accent" aria-hidden /> : null}
      <div className="relative self-start justify-self-center text-nomi-ink-20">{grip}</div>
      <div className="min-w-0">{frame}</div>
      <div className="flex min-w-0 flex-col gap-1.5">{prompt}</div>
      {footer ? <div className="col-start-2 col-span-2">{footer}</div> : null}
    </div>
  )
}
