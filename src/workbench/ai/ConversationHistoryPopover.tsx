// 会话历史弹层定位壳(2026-06-14)。窄面板里靠右的「会话」按钮 → 下拉菜单必须
// **右对齐到面板头部右缘**、从按钮正下方落下(标准右侧下拉行为);左对齐会溢出后被死贴
// 视口右缘、又宽又遮挡(真机踩坑)。BodyPortal + fixed 逃出面板 overflow-hidden;向上翻转 + clamp。
import React from 'react'
import { BodyPortal } from '../../design'

const MARGIN = 8
const GAP = 4

export function ConversationHistoryPopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement>
  onClose: () => void
  children: React.ReactNode
}): JSX.Element {
  const popRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null)

  React.useLayoutEffect(() => {
    const anchor = anchorRef.current
    const pop = popRef.current
    if (!anchor) return
    const a = anchor.getBoundingClientRect()
    // 右缘锚到面板头部右缘(窄面板下拉的正确对齐);无 header 兜底用按钮右缘。
    const header = anchor.closest('header')
    const rightEdge = header ? header.getBoundingClientRect().right : a.right
    const w = pop ? pop.offsetWidth : 256
    const h = pop ? pop.offsetHeight : 320
    let left = rightEdge - w
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - w))
    let top = a.bottom + GAP
    if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, a.top - GAP - h)
    setPos({ top, left })
  }, [anchorRef])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (popRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [onClose, anchorRef])

  return (
    <BodyPortal>
      <div
        ref={popRef}
        style={{
          position: 'fixed',
          top: pos?.top ?? -9999,
          left: pos?.left ?? -9999,
          zIndex: 60,
          visibility: pos ? 'visible' : 'hidden',
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </BodyPortal>
  )
}
