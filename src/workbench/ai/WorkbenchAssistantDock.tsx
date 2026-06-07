import React from 'react'
import { cn } from '../../utils/cn'
import { NomiAILabel, WorkbenchButton } from '../../design'
import { useWorkbenchStore } from '../workbenchStore'
import CreationAiPanel from '../creation/CreationAiPanel'
import CanvasAssistantPanel from '../generationCanvasV2/components/CanvasAssistantPanel'

/**
 * Single app-level assistant (C-2). One persistent dock whose body follows the
 * active workspace — creation → 文本工具, generation → 画布工具 — instead of two
 * separate per-workspace panels. Collapses to one launcher; preview has none.
 * Backend runtime/session is already shared (workbenchSessionKey), so this is a
 * front-of-house unification: predictable position, consistent collapse.
 */
export function WorkbenchAssistantDock(): JSX.Element | null {
  const workspaceMode = useWorkbenchStore((s) => s.workspaceMode)
  const collapsed = useWorkbenchStore((s) => s.assistantCollapsed)
  const setCollapsed = useWorkbenchStore((s) => s.setAssistantCollapsed)

  // Preview/timeline has no assistant tools yet.
  if (workspaceMode === 'preview') return null

  const suffix = workspaceMode === 'creation' ? '创作' : '生成'

  if (collapsed) {
    return (
      <div className={cn('fixed right-4 bottom-4 z-[80]')}>
        <WorkbenchButton
          className={cn(
            'inline-flex items-center gap-2 h-9 pl-[10px] pr-[14px]',
            'border border-nomi-line rounded-full bg-nomi-paper text-nomi-ink',
            'text-[13px] font-medium shadow-nomi-md cursor-pointer',
            'hover:shadow-nomi-lg hover:-translate-y-px',
          )}
          onClick={() => setCollapsed(false)}
          aria-label="打开助手"
        >
          <NomiAILabel markSize={18} wordSize={13} suffix={suffix} />
        </WorkbenchButton>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'fixed right-4 z-[80] w-[344px]',
        'top-[calc(var(--workbench-topbar-height)+16px)] bottom-4',
        'overflow-hidden border border-nomi-line rounded-nomi bg-nomi-paper shadow-nomi-lg',
      )}
    >
      {workspaceMode === 'creation' ? (
        <CreationAiPanel embedded onCollapse={() => setCollapsed(true)} />
      ) : (
        <CanvasAssistantPanel embedded onCollapse={() => setCollapsed(true)} />
      )}
    </div>
  )
}
