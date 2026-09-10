/**
 * [INPUT]: 依赖 react、../../../../../design（BodyPortal / NOMI_OVERLAY_Z_INDEX）、../../../../../utils/cn
 * [OUTPUT]: 对外提供 TimelineMenuItem 类型与 TimelineContextMenu（按指针位置定位的右键菜单；外点 / Esc 关闭）
 * [POS]: director/timeline 的右键菜单原语（清单 §5.2 轨道右键/加号菜单）：走 body 传送门 + fixed 定位、贴窗口边缘回折——
 *        时间轴折得很矮时菜单不能被自己的容器裁掉；菜单项由 DirectorTimeline 按上下文拼。挂 data-nomi-escape-layer 让编辑器的 Esc 归属链先关它。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { BodyPortal, NOMI_OVERLAY_Z_INDEX } from '../../../../../design'
import { cn } from '../../../../../utils/cn'

export type TimelineMenuItem =
  | { id: string; label: string; disabled?: boolean; title?: string; danger?: boolean; onSelect: () => void }
  | { id: string; separator: true }

const EDGE_PAD = 6

export function TimelineContextMenu({ x, y, items, onClose }: { x: number; y: number; items: TimelineMenuItem[]; onClose: () => void }): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [offset, setOffset] = React.useState({ x, y })

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [onClose])

  // 贴着窗口右/下边缘时往回折，避免菜单被裁
  React.useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const maxX = window.innerWidth - element.offsetWidth - EDGE_PAD
    const maxY = window.innerHeight - element.offsetHeight - EDGE_PAD
    setOffset({ x: Math.max(EDGE_PAD, Math.min(x, maxX)), y: Math.max(EDGE_PAD, Math.min(y, maxY)) })
  }, [x, y, items.length])

  return (
    <BodyPortal>
      <div
        ref={rootRef}
        role="menu"
        data-nomi-escape-layer="director-timeline-menu"
        className="fixed min-w-[200px] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-1 text-body-sm text-nomi-ink shadow-nomi-lg"
        style={{ left: offset.x, top: offset.y, zIndex: NOMI_OVERLAY_Z_INDEX.popover }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item) =>
          'separator' in item ? (
            <div key={item.id} role="separator" className="my-1 h-px bg-nomi-line-soft" />
          ) : (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              className={cn(
                'flex w-full items-center rounded-nomi-sm px-2 py-1 text-left text-caption',
                item.disabled ? 'cursor-not-allowed text-nomi-ink-30' : 'hover:bg-nomi-ink-05',
                item.danger && !item.disabled ? 'text-nomi-danger' : '',
              )}
              onClick={() => {
                if (item.disabled) return
                item.onSelect()
                onClose()
              }}
            >
              {item.label}
            </button>
          ),
        )}
      </div>
    </BodyPortal>
  )
}
