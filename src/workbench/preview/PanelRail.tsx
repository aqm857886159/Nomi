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
  statusDotClassName,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  title: string
  /**
   * 收起后仍要看得见「它有没有在动」的面板（现在只有 Nomi）传这一格 token 类名，
   * 图标下方画一颗状态点。不传就不画——素材/属性没有运行态，不该凭空多一颗点。
   */
  statusDotClassName?: string
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
      {statusDotClassName ? <span className={cn('size-1.5 shrink-0 rounded-pill', statusDotClassName)} data-panel-rail-status="true" aria-hidden="true" /> : null}
      <span className="text-micro leading-none [writing-mode:vertical-rl]">{label}</span>
    </button>
  )
}

export default PanelRail
