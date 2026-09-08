import React from 'react'
import { cn } from '../utils/cn'

/**
 * 面板级空态：居中 icon + 标题 + 说明 + 可选行动。
 * icon 由调用方传好尺寸/色（如 <IconPhoto size={34} className="text-nomi-ink-30" />），组件只管布局与排版。
 *
 * **收口范围（2026-09-07 实测，别再写成「全仓统一」）**：已收口的是**库页/面板族**的 9 个消费者
 * （项目库 / 提示词库 / 技能库 / 工作流库 / 素材库 / 素材拾取浮层 / 预览源面板 / 分镜工作区 / Agent 面板 v4）。
 * **画布节点族没有收口**，那边另有 3 份并行结构：
 *   · `generationCanvas/nodes/render/NodeEmptyState.tsx`（节点自成一套，`render/CardCommon.tsx:55`
 *     的 `EmptyStateLauncher` 在它外面再包一层）
 *   · `generationCanvas/nodes/NodeDeconstructionPanel.tsx:326` 的 `DeconstructionEmptyState`
 *   · `generationCanvas/components/CanvasEmptyState.tsx`
 * 它们没并进来不全是欠账：节点空态要在 ~180px 的卡片里排版、且本身是可点的投放区，
 * 与「面板正中一大块」不是同一个形态。**要合并得先定形态，不是直接套这个组件。**
 *
 * ⚠️ 只用于**面板级居中空态**；列表行 / popover 里 `text-micro` 一行的内联提示不归它。
 */
export type DesignEmptyStateProps = {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** 可选行动（按钮等），置于说明下方。 */
  action?: React.ReactNode
  /** 垂直密度：'panel'（py-20，独立面板空态）｜'inline'（py-12，过滤/内嵌空态）。默认 panel。 */
  density?: 'panel' | 'inline'
  className?: string
}

export function DesignEmptyState({
  icon,
  title,
  description,
  action,
  density = 'panel',
  className,
}: DesignEmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 px-6 text-center',
        density === 'inline' ? 'py-12' : 'py-20',
        className,
      )}
    >
      {icon}
      <div className="text-body font-medium text-nomi-ink">{title}</div>
      {description ? <div className="text-caption text-nomi-ink-40 leading-relaxed max-w-[320px]">{description}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
