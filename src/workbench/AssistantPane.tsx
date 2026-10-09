import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../utils/cn'
import { ASSISTANT_PANE_GUTTER, ASSISTANT_WIDTH_MIN, assistantWidthMaxFor } from './assistantWidthBounds'
import { useWorkbenchStore } from './workbenchStore'

/**
 * Agent 停靠栏（10-08 外壳重设计：停靠是三形态之一，另两种是小球 / 浮窗，见 ShellAgentHost）。
 * 所有工作区给同一个无框落点；可见的那圈框归 AgentPanelV4Panel 自己画。
 *
 * 停靠栏左边是工作面之间那条 8px 缝，宽度把手就画在缝里（拍板稿 .wgrip：4×36 的竖条）。
 * 小球 / 浮窗时（collapsed）这一格让出来、什么都不挂——面板摆到哪由外壳决定。
 *
 * `className` 是**外壳给的落位**，不是装饰：落在哪一格网格由宿主写明（见 GenerationWorkspace 的注释）。
 */
export function AssistantPane({ dockRef, collapsed = false, className }: {
  dockRef?: React.Ref<HTMLDivElement>; collapsed?: boolean; className?: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const width = useWorkbenchStore(state => state.editingPanelLayout.assistantWidth)
  const setWidth = useWorkbenchStore(state => state.setAssistantWidth)
  const drag = React.useRef<{ x: number; width: number } | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const finish = (event: React.PointerEvent<HTMLDivElement>): void => {
    drag.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  if (collapsed) return null
  return <aside data-assistant-pane="true" className={cn('relative h-full min-h-0 min-w-0', className)} style={{ paddingLeft: ASSISTANT_PANE_GUTTER }}>
    <div
      role="separator" tabIndex={0} aria-orientation="vertical"
      aria-label={t('generationCommon.workspace.resizeAssistant')}
      aria-valuemin={ASSISTANT_WIDTH_MIN} aria-valuemax={assistantWidthMaxFor(typeof window === 'undefined' ? 0 : window.innerWidth)} aria-valuenow={width}
      className="group absolute inset-y-0 left-0 z-10 flex cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
      style={{ width: ASSISTANT_PANE_GUTTER }}
      onPointerDown={event => { drag.current = { x: event.clientX, width }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId) }}
      onPointerMove={event => { if (drag.current) setWidth(drag.current.width + drag.current.x - event.clientX) }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; setDragging(false) }}
      onKeyDown={event => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(width + (event.key === 'ArrowLeft' ? 10 : -10)) }
        if (event.key === 'Home') { event.preventDefault(); setWidth(ASSISTANT_WIDTH_MIN) }
        if (event.key === 'End') { event.preventDefault(); setWidth(assistantWidthMaxFor(window.innerWidth)) }
      }}
      data-assistant-resize
    ><span className={cn('h-9 w-1 rounded-full transition-colors', dragging ? 'bg-nomi-accent' : 'bg-nomi-ink-20 group-hover:bg-nomi-ink-30 group-focus-visible:bg-nomi-accent')} /></div>
    <div ref={dockRef} className="h-full min-h-0 w-full min-w-0" />
  </aside>
}
