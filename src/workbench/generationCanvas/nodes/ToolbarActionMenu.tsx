import React, { type JSX } from 'react'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../../design/menu'
import { ToolbarMenuTrigger } from './NodeFloatingToolbar'

/**
 * 节点浮条上的分组下拉，壳走 `WorkbenchMenu`（Radix）——**向上**展开、Portal 到 body。
 *
 * 它取代了 NodeFloatingToolbar 里手写的 `ToolbarMenu`（设计卡 §5 删除清单）：快捷动作的菜单要有名字的分段、
 * 灰掉的项说原因，手写下拉再长这些就是第 25 个手写菜单；原语还顺带解决了手写版「贴顶被裁、贴左被截」的老毛病。
 *
 * 开合：
 *   · 触发钮自己点开 / 点关。Radix 在触发钮按下那一刻会先判「点在菜单外」把它关掉，
 *     紧接着的 click 又会把它打开——所以按下时记一笔「刚才是开着的」，那一下 click 不再翻转。
 *   · 浮条外壳 `onPointerDown` 会 stopPropagation（防画布平移），Radix 挂在 document 上的
 *     「点外面」收不到浮条上别的按钮——捕获阶段自己听一次。
 */
export type ToolbarActionMenuProps = {
  /** 走查锚点与互斥用的名字（同一条浮条里唯一）。 */
  id: string
  icon: React.ReactNode
  label: string
  /** 菜单本身的无障碍名（比触发钮的字长一点，说清这一组是干什么的）。 */
  menuLabel: string
  items: readonly WorkbenchMenuNode[]
  disabled?: boolean
  /** 只画图标 + ▾，不写字（title / aria-label 用 `menuLabel`）。 */
  iconOnly?: boolean
  /**
   * 分体按钮：左块是 `split` 给的主按钮，右块是只有 ▾ 的小按钮（约 24px），中间 1px 竖线，合起来像一个按钮；
   * 菜单锚在整个分体按钮的左缘，向上展开。
   */
  split?: React.ReactNode
}

export function ToolbarActionMenu({ id, icon, label, menuLabel, items, disabled, iconOnly, split }: ToolbarActionMenuProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const [point, setPoint] = React.useState({ x: 0, y: 0 })
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const groupRef = React.useRef<HTMLSpanElement>(null)
  const wasOpenAtPointerDown = React.useRef(false)
  const contentTestId = `toolbar-action-menu-${id}`

  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (document.querySelector(`[data-testid="${contentTestId}"]`)?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [contentTestId, open])

  const toggle = (): void => {
    if (wasOpenAtPointerDown.current) {
      wasOpenAtPointerDown.current = false
      setOpen(false)
      return
    }
    const rect = (split ? groupRef.current : triggerRef.current)?.getBoundingClientRect()
    // 菜单底边贴触发钮上沿再留 6px（与手写版 `bottom-[calc(100%+6px)]` 同一个缝）。
    if (rect) setPoint({ x: rect.left, y: rect.top - 6 })
    setOpen(true)
  }

  const trigger = (
    <ToolbarMenuTrigger
      ref={triggerRef}
      icon={icon}
      label={label}
      iconOnly={iconOnly}
      title={iconOnly ? menuLabel : undefined}
      className={split ? 'w-6 min-w-0 rounded-l-none rounded-r-nomi px-0' : undefined}
      open={open}
      disabled={disabled}
      onPointerDown={() => { wasOpenAtPointerDown.current = open }}
      onClick={toggle}
      dataAttributes={{ 'data-toolbar-action-menu': id }}
    />
  )
  return (
    <>
      {split ? (
        <span ref={groupRef} data-toolbar-split="true" className="inline-flex items-center">
          {split}
          <span className="h-4 w-px shrink-0 bg-nomi-line" aria-hidden />
          {trigger}
        </span>
      ) : trigger}
      <WorkbenchMenu
        open={open}
        onOpenChange={(next) => { if (!next) setOpen(false) }}
        point={point}
        side="top"
        items={items}
        ariaLabel={menuLabel}
        onPointerDown={(event) => event.stopPropagation()}
        data-testid={contentTestId}
      />
    </>
  )
}
