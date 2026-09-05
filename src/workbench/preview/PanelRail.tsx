import React from 'react'
import { cn } from '../../utils/cn'

/**
 * 面板收起后的 32px 图标条（合同 §2.1）：图标 + 竖排微字，点击展开。
 * 单独成文件而不是挂在 PreviewWorkspace 上——素材栏与属性栏都要用它，
 * 挂在工作区上会让子面板反向 import 父组件、形成静态环（R26）。
 */
export function PanelRail({
  icon,
  label,
  title,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  title: string
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'workbench-panel-rail',
        'flex h-full w-full flex-col items-center gap-1.5 border-0 bg-[var(--workbench-surface)] pt-3',
        'cursor-pointer text-[var(--workbench-muted)] hover:bg-[var(--workbench-hover)] hover:text-[var(--workbench-ink)]',
      )}
      aria-label={title}
      title={title}
      onClick={onClick}
    >
      {icon}
      <span className="text-micro leading-none [writing-mode:vertical-rl]">{label}</span>
    </button>
  )
}

export default PanelRail
