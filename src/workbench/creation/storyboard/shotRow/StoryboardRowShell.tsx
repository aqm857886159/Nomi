import React from 'react'
import { cn } from '../../../../utils/cn'

/**
 * 行解剖的**唯一实现**（合同 v6 §2.2/§2.3）：`[14px grip | 136px 画面格 | 200px 参考列 | 1fr 提示词块]`。
 *
 * 为什么要单独一层：v6 要求"锚区展开态和镜头行**完全同一套解剖**"。v5 里这两处是两个各画各的组件
 * （`StoryboardAnchorCard` vs `StoryboardShotRow`），于是同一个几何被写了两遍——改一处漏一处是迟早的事，
 * 也正是 R14.1 说的"同一语义两份定义"。把网格提到这里之后，两边共用一份：列宽、gap、内边距、
 * 落点线、拖拽区都只有一个 owner。
 *
 * 阅读顺序固定：**画面格（要生成的）→ 参考列（拿来参考的）→ 提示词块（怎么描述）**。
 */

type Props = {
  /** 行首 14px 竖条：拖拽把手 / ⋯ 菜单 / 本次跳过复选框。锚行没有 → 传 null，格子空着但列宽不变。 */
  grip?: React.ReactNode
  frame: React.ReactNode
  references: React.ReactNode
  prompt: React.ReactNode
  /** 整行下方跨列的附加区（台词展开、变体抽屉…）；缺省 = 不占位。 */
  footer?: React.ReactNode
  /** 拖拽落点线（蓝色 2px，落在行上沿）。 */
  dropIndicator?: boolean
  className?: string
  dataAttributes?: Record<string, string | number | undefined>
} & Pick<
  React.HTMLAttributes<HTMLDivElement>,
  'onClick' | 'onKeyDown' | 'onDragOver' | 'onDrop' | 'tabIndex'
>

export default function StoryboardRowShell({
  grip,
  frame,
  references,
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
      className={cn(
        'relative grid grid-cols-[14px_136px_200px_minmax(0,1fr)] items-start gap-3 bg-nomi-paper py-3 pl-1.5 pr-3',
        className,
      )}
    >
      {dropIndicator ? <div className="absolute inset-x-1.5 top-0 h-0.5 rounded-full bg-nomi-accent" aria-hidden /> : null}
      <div className="relative self-start justify-self-center text-nomi-ink-20">{grip}</div>
      <div className="min-w-0">{frame}</div>
      {references}
      <div className="flex min-h-[135px] min-w-0 flex-col gap-1.5">{prompt}</div>
      {footer ? <div className="col-start-2 col-span-3">{footer}</div> : null}
    </div>
  )
}
