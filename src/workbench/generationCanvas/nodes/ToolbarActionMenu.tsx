import React, { type JSX } from 'react'
import { IconChevronDown } from '@tabler/icons-react'
import { AnchoredPopover } from '../../../design'
import { WorkbenchMenu, type WorkbenchMenuAnchorRect, type WorkbenchMenuNode } from '../../../design/menu'
import { cn } from '../../../utils/cn'
import { ToolbarButton } from './NodeFloatingToolbar'
import { toolbarButtonClass } from './toolbarButtonClass'

/**
 * 节点浮条上**每一个带 ▾ 的按钮**的唯一实现：触发钮长什么样、点开的东西放在哪、怎么开合，都只在这里
 * （2026-10-06 收口；结构测试 `ToolbarActionMenu.structure.test.ts` 拦别处再写一份）。
 *
 * 点开的东西有两种，按**里面放的是什么**分（同 `AnchoredPopover.tsx` 头注的判据）：
 *   · `items`：一列动作 → `WorkbenchMenu`（Radix）；
 *   · `panel`：要移上去看、点一下定的富内容（宫格点阵）→ `AnchoredPopover`。
 * 两种都**先向上开**（浮条在节点上方，往下开就压在这张图上，§1.5.3），头顶放不下才开到下面。
 *
 * ## 不变量：点开的东西不压自己的触发钮，也不压它所在的那一排
 *
 * 2026-10-06 用户截图：节点靠画布上沿，「改图 ▾」的菜单翻下来压住了浮条那一排、盖住「宫格」。
 * 直接原因是旧版把菜单贴在「触发钮上沿往上 6px」那个**点**上：头顶放不下时 Radix 翻到下面，
 * 翻的是一个 0×0 的点，菜单上沿于是落在按钮上方，整块压回浮条。
 * 现在交给两种浮层的是一块**矩形**——横向是触发钮（分体按钮是整个胶囊），纵向是整条浮条（折两行时两行都算）——
 * 两套定位都保证不与这块矩形相交（放不下就收高度滚动）。设计实验室的弹层几何普查
 * （`tests/ux/design-lab/popupGeometry.mjs`）对所有打开的浮层量这一条。
 *
 * ## 分体按钮（`primary`）
 *
 * 「多机位九宫格 ▾」：点字直接做，点 ▾ 开更多效果。两块各自是一颗按钮、悬停各自高亮，但**中间不画竖线**
 * （用户 2026-10-06：和「宫格 ▾」一个样子），看上去是一颗胶囊。
 *
 * ## 开合
 *
 *   · 触发钮自己点开 / 点关。Radix 在触发钮按下那一刻会先判「点在菜单外」把它关掉，
 *     紧接着的 click 又会把它打开——所以按下时记一笔「刚才是开着的」，那一下 click 不再翻转。
 *   · 浮条外壳 `onPointerDown` 会 stopPropagation（防画布平移），Radix 挂在 document 上的
 *     「点外面」收不到浮条上别的按钮——捕获阶段自己听一次。
 */

type ToolbarMenuContent =
  | { items: readonly WorkbenchMenuNode[]; panel?: never }
  | {
    /** 富内容。拿到一个 `close`，选完自己关。 */
    panel: (close: () => void) => React.ReactNode
    items?: never
  }

export type ToolbarActionMenuProps = ToolbarMenuContent & {
  /** 走查锚点与互斥用的名字（同一条浮条里唯一），落在触发钮的 `data-toolbar-action-menu` 上。 */
  id: string
  icon: React.ReactNode
  label: string
  /** 点开的东西的无障碍名（比触发钮的字长一点，说清这一组是干什么的）。 */
  menuLabel: string
  disabled?: boolean
  /** 菜单**打开的那一刻**（不含关闭）。菜单项要写出「此刻的事实」（例：截帧菜单里的播放头时间码）时，在这里取一次。 */
  onOpen?: () => void
  /** 只画图标 + ▾，不写字（title / aria-label 用 `menuLabel`）。 */
  iconOnly?: boolean
  /** 分体按钮的主体：点它直接做这件事；▾ 只开菜单。 */
  primary?: Readonly<{
    icon: React.ReactNode
    label: string
    title?: string
    disabled?: boolean
    onClick: () => void
  }>
}

/** 菜单与锚点之间的缝。 */
const GAP = 6

/** 不许盖住的那块：横向 = 触发区（分体按钮是整颗胶囊），纵向 = 它所在的整条浮条。 */
function toolbarMenuAnchorRect(zone: HTMLElement): DOMRect {
  const own = zone.getBoundingClientRect()
  const row = zone.closest('[data-node-floating-toolbar]')?.getBoundingClientRect()
  if (!row) return own
  const top = Math.min(own.top, row.top)
  const bottom = Math.max(own.bottom, row.bottom)
  return new DOMRect(own.left, top, own.width, bottom - top)
}

const toMenuRect = (rect: DOMRect): WorkbenchMenuAnchorRect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })

export function ToolbarActionMenu(props: ToolbarActionMenuProps): JSX.Element {
  const { id, icon, label, menuLabel, disabled, iconOnly, primary } = props
  const [open, setOpen] = React.useState(false)
  const [anchorRect, setAnchorRect] = React.useState<WorkbenchMenuAnchorRect>({ left: 0, top: 0, width: 0, height: 0 })
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const groupRef = React.useRef<HTMLSpanElement>(null)
  const wasOpenAtPointerDown = React.useRef(false)
  const contentTestId = `toolbar-action-menu-${id}`
  const isPanel = Boolean(props.panel)
  const zone = (): HTMLElement | null => (primary ? groupRef.current : triggerRef.current)
  const close = React.useCallback(() => setOpen(false), [])
  const panelAnchorRect = React.useCallback(() => {
    const element = primary ? groupRef.current : triggerRef.current
    return element ? toolbarMenuAnchorRect(element) : new DOMRect()
  }, [primary])

  React.useEffect(() => {
    // 富内容浮层（AnchoredPopover）自己管「点外面就关」；这里只替菜单那一种补捕获阶段的监听。
    if (!open || isPanel) return undefined
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (!target) return
      if (triggerRef.current?.contains(target)) return
      if (document.querySelector(`[data-testid="${contentTestId}"]`)?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [contentTestId, isPanel, open])

  const toggle = (): void => {
    if (wasOpenAtPointerDown.current || (isPanel && open)) {
      wasOpenAtPointerDown.current = false
      setOpen(false)
      return
    }
    const element = zone()
    if (element) setAnchorRect(toMenuRect(toolbarMenuAnchorRect(element)))
    props.onOpen?.()
    setOpen(true)
  }

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={cn(
        toolbarButtonClass(false),
        'gap-1',
        primary ? 'rounded-l-none pl-0.5 pr-2.5' : iconOnly ? 'px-2' : 'px-3',
        open && 'bg-nomi-ink-05 text-nomi-ink',
      )}
      aria-haspopup={isPanel ? 'dialog' : 'menu'}
      aria-expanded={open}
      aria-label={primary || iconOnly ? menuLabel : label}
      title={primary || iconOnly ? menuLabel : undefined}
      disabled={disabled}
      onClick={toggle}
      onPointerDown={() => { wasOpenAtPointerDown.current = open && !isPanel }}
      data-toolbar-action-menu={id}
    >
      {primary ? null : icon}
      {primary || iconOnly ? null : <span>{label}</span>}
      <IconChevronDown size={13} stroke={1.6} aria-hidden />
    </button>
  )

  return (
    <>
      {primary ? (
        <span ref={groupRef} data-toolbar-split="true" className="inline-flex items-center">
          <ToolbarButton
            icon={primary.icon}
            label={primary.label}
            title={primary.title}
            disabled={primary.disabled}
            className="rounded-r-none pl-3 pr-1"
            onClick={primary.onClick}
          />
          {trigger}
        </span>
      ) : trigger}
      {props.panel ? (
        open ? (
          <AnchoredPopover anchorRef={primary ? groupRef : triggerRef} anchorRect={panelAnchorRect} side="top" gap={GAP} onClose={close}>
            <div data-testid={contentTestId}>{props.panel(close)}</div>
          </AnchoredPopover>
        ) : null
      ) : (
        <WorkbenchMenu
          open={open}
          onOpenChange={(next) => { if (!next) setOpen(false) }}
          anchorRect={anchorRect}
          gap={GAP}
          side="top"
          items={props.items ?? []}
          ariaLabel={menuLabel}
          onPointerDown={(event) => event.stopPropagation()}
          data-testid={contentTestId}
        />
      )}
    </>
  )
}
