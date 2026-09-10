/**
 * [INPUT]: 依赖 react、../../../../../design 的 BodyPortal / NOMI_OVERLAY_Z_INDEX、../../../../../utils/cn
 * [OUTPUT]: 对外提供 Popover（锚定在触发器上方/下方/右侧的浮层：body 传送门 + fixed 定位、外点关闭、捕获期 Esc 关闭、标记 data-nomi-escape-layer 让编辑器的 Esc 让路）、PopoverItem
 * [POS]: director/panels 的浮层原语（设计系统无 popover 原语）；创建栏下拉、群众矩阵、画幅设置、产出物面板都用它。
 *        面板不挂在触发器所在的分栏里：分栏之间各自是层叠上下文（isolate / overflow-hidden），时间轴头部的浮层往上弹会被视口底栏盖住
 *        （2026-09-03 Electron 真机走查：矮窗口里「发送到画布」点不到）→ 与时间轴右键菜单同一手法，portal 到 body、按触发器矩形 fixed 定位、
 *        z 用设计系统全局浮层层级 NOMI_OVERLAY_Z_INDEX.popover；外点判定同时看触发器与面板。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { BodyPortal, NOMI_OVERLAY_Z_INDEX } from '../../../../../design'
import { cn } from '../../../../../utils/cn'

export type PopoverProps = {
  open: boolean
  onClose: () => void
  trigger: React.ReactNode
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  panelClassName?: string
}

const GAP = 8

type PanelPosition = { top?: number; bottom?: number; left?: number; right?: number; transform?: string }

function positionFor(rect: DOMRect, side: 'top' | 'bottom' | 'right', align: 'start' | 'center' | 'end'): PanelPosition {
  // 右弹（左缘竖向创建栏用）：面板贴在触发器右侧，纵向按 align 对齐触发器
  if (side === 'right') {
    const left = rect.right + GAP
    if (align === 'start') return { top: rect.top, left }
    if (align === 'end') return { bottom: window.innerHeight - rect.bottom, left }
    return { top: rect.top + rect.height / 2, left, transform: 'translateY(-50%)' }
  }
  const vertical: PanelPosition = side === 'top' ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }
  if (align === 'start') return { ...vertical, left: rect.left }
  if (align === 'end') return { ...vertical, right: window.innerWidth - rect.right }
  return { ...vertical, left: rect.left + rect.width / 2, transform: 'translateX(-50%)' }
}

export function Popover({ open, onClose, trigger, children, side = 'top', align = 'center', className, panelClassName }: PopoverProps): JSX.Element {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = React.useState<PanelPosition | null>(null)

  // 打开时按触发器矩形定位；窗口变化时重算（分栏拖动会改触发器位置，但浮层开着时用户不会同时拖分栏）
  React.useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return undefined
    }
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect) setPosition(positionFor(rect, side, align))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [align, open, side])

  // 放不下就翻面 / 夹回窗口：面板尺寸只有挂上去才知道，所以定位分两拍——先按声明的 side 放，再量一次修正。
  // 修正后的位置也会再进一次这个 effect，那时已经放得下就不再改，不会来回翻。
  React.useLayoutEffect(() => {
    const panel = panelRef.current
    const rect = rootRef.current?.getBoundingClientRect()
    if (!open || !position || !panel || !rect) return
    const box = panel.getBoundingClientRect()
    let next: PanelPosition | null = null
    if (box.bottom > window.innerHeight && position.top !== undefined && rect.top - GAP >= box.height) next = positionFor(rect, 'top', align)
    else if (box.top < 0 && position.bottom !== undefined && window.innerHeight - rect.bottom - GAP >= box.height) next = positionFor(rect, 'bottom', align)
    const base = next ?? position
    if (box.right > window.innerWidth) next = { ...base, left: Math.max(GAP, window.innerWidth - box.width - GAP), right: undefined, transform: undefined }
    else if (box.left < 0) next = { ...base, left: GAP, right: undefined, transform: undefined }
    if (next) setPosition(next)
  }, [align, open, position])

  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [onClose, open])

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      {trigger}
      {open && position
        ? (
          <BodyPortal>
            <div
              ref={panelRef}
              role="dialog"
              data-nomi-escape-layer="director-popover"
              className={cn(
                'fixed min-w-[180px] rounded-nomi-lg border border-nomi-line bg-nomi-paper p-2 text-body-sm text-nomi-ink shadow-nomi-lg',
                panelClassName,
              )}
              // 高度封顶 + 内滚：14 项机位预设在矮视口里会顶出视口被顶栏盖住（走查时点到了顶栏的「选择」）
              style={{ ...position, zIndex: NOMI_OVERLAY_Z_INDEX.popover, maxHeight: 'min(60vh, 420px)', overflowY: 'auto' }}
              onPointerDown={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
              onWheel={(event) => event.stopPropagation()}
            >
              {children}
            </div>
          </BodyPortal>
        )
        : null}
    </div>
  )
}

export function PopoverItem({ children, onClick, disabled, active, title }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; active?: boolean; title?: string }): JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-nomi-sm px-2 py-1.5 text-left text-body-sm text-nomi-ink hover:bg-workbench-hover disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'bg-nomi-accent-soft text-nomi-accent' : '',
      )}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}
