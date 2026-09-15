import React from 'react'
import { useWorkspacePanelFrame } from './WorkspacePanelFrame'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'
import { ASSISTANT_WIDTH_MIN, assistantWidthMaxFor } from './assistantWidthBounds'
import { useWorkbenchStore } from './workbenchStore'

/**
 * All workspaces supply the same unframed mount. AgentPanelV4Panel owns the only visible border.
 *
 * `className` 是**外壳给的落位**，不是装饰：收起态这个 aside 是 `absolute inset-0`，
 * 而它的包含块由宿主决定——作为网格容器的直接子节点、又有确定的网格落位时，
 * `inset-0` 量的就是那一格网格区域（CSS Grid 的绝对定位规则），不是整个工作区。
 * 所以「收起后的坞属于哪一层」这件事归外壳回答（见 GenerationWorkspace 的注释），
 * 这里只负责把宿主给的落位贴上去，不自己猜、也不用 z-index / bottom 偏移兜底。
 */
export function AssistantPane({ dockRef, collapsed = false, className }: {
  dockRef?: React.Ref<HTMLDivElement>; collapsed?: boolean; className?: string
}): JSX.Element {
  const { t } = useTranslation()
  const workspaceFrame = useWorkspacePanelFrame()
  const width = useWorkbenchStore(state => state.editingPanelLayout.assistantWidth)
  const setWidth = useWorkbenchStore(state => state.setAssistantWidth)
  const drag = React.useRef<{ x: number; width: number } | null>(null)
  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <aside data-assistant-pane="true" className={cn(
    collapsed ? 'pointer-events-none absolute inset-0 z-40 overflow-visible' : 'relative h-full min-h-0 min-w-0',
    !collapsed && !workspaceFrame && 'p-4',
    className,
  )}>
    {!collapsed ? <div
      role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={t('generationCommon.workspace.resizeAssistant')}
      aria-valuemin={ASSISTANT_WIDTH_MIN} aria-valuemax={assistantWidthMaxFor(typeof window === 'undefined' ? 0 : window.innerWidth)} aria-valuenow={width}
      className={cn('group absolute z-10 flex w-4 cursor-col-resize touch-none items-center justify-center', workspaceFrame ? 'inset-y-0 -left-4' : 'inset-y-4 left-0')}
      onPointerDown={event => { drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (drag.current) setWidth(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(width + (event.key === 'ArrowLeft' ? 10 : -10)) }
        if (event.key === 'Home') { event.preventDefault(); setWidth(ASSISTANT_WIDTH_MIN) }
        if (event.key === 'End') { event.preventDefault(); setWidth(assistantWidthMaxFor(window.innerWidth)) }
      }}
    ><span className="h-8 w-0.5 rounded-full bg-nomi-line group-hover:bg-nomi-accent" /></div> : null}
    <div ref={dockRef} className="h-full min-h-0 w-full min-w-0" />
  </aside>
}
