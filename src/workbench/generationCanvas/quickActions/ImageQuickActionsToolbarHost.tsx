import type { JSX } from 'react'
import ImageQuickActionsToolbar, { type ImageQuickActionsToolbarProps } from './ImageQuickActionsToolbar'
import { useQuickActionHost } from './useQuickActionHost'

/**
 * 生产里的图片浮条：`ImageQuickActionsToolbar`（纯展示，实验室也用它）+ 一键派生的宿主逻辑。
 * 只在浮条真的显示（选中、有图）时才挂载，所以模型目录 / 效果库的读取不会落到每张卡上。
 */
export function ImageQuickActionsToolbarHost(toolbar: Omit<ImageQuickActionsToolbarProps, 'quickActionBlocked' | 'onQuickAction'>): JSX.Element {
  const { quickActionBlocked, onQuickAction } = useQuickActionHost({
    node: toolbar.node,
    reportFeedback: toolbar.reportFeedback,
  })
  return <ImageQuickActionsToolbar {...toolbar} quickActionBlocked={quickActionBlocked} onQuickAction={onQuickAction} />
}
