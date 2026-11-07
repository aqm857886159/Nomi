import React, { type JSX } from 'react'
import { createOverflowManager, type OverflowManager } from '@fluentui/priority-overflow'
import { IconDots } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { WorkbenchMenu, type WorkbenchMenuAction, type WorkbenchMenuAnchorRect, type WorkbenchMenuNode } from './menu'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'

/**
 * 一排按钮放不下时，从右往左逐个收进「⋯」（2026-11-07 窄窗拍板 WindowNarrow / creation.toolbar-overflow）。
 *
 * 量「放不放得下」不自己写：用 Fluent UI 的 `@fluentui/priority-overflow`（Fluent `Overflow` / `Toolbar` 收起的底层，
 * 纯 DOM、不带外观）。它对这一排挂 ResizeObserver，按项的 offsetWidth 累加、和容器 clientWidth 比，放不下就按
 * 「同优先级时文档顺序靠后的先收」逐个收——这正是拍板的「从右往左」。我们只用它的测量，外观全是自己的：
 * 项收起 = 它在项上打 `data-overflowing`，这里用 className 藏；「⋯」与菜单是设计系统现有的按钮皮肤 + `WorkbenchMenu`。
 *
 * 规矩（拍板约束，改之前先看清单）：
 *   · 只有一个阈值——「量出来放不下」。不按窗口宽写断点（`narrow.one-threshold`）。
 *   · 永不让位的东西（撤销 / 重做这类）不放进这一排，放在调用方的行尾；这一排只装「可以收」的。
 *   · 菜单按项原来的分组画分隔线，右边对齐「⋯」。
 *
 * 宽度怎么算：这一排不用 `gap`（它只累加项、组分隔、「⋯」三者的 offsetWidth，间距不算在内），
 * 项自己带右边 4px、组分隔线自己带两侧留白，宽时和原来的 `gap-1` + `mx-1` 排出来一样。
 */

export type NomiOverflowRowItem = Readonly<{
  id: string
  /** 平时画在这一排上的那颗按钮。 */
  node: React.ReactNode
  /** 收进「⋯」后在菜单里的那一项（图标 + 名字）。 */
  menuItem: Omit<WorkbenchMenuAction, 'id' | 'kind'>
}>

export type NomiOverflowRowGroup = Readonly<{ id: string; items: readonly NomiOverflowRowItem[] }>

export type NomiOverflowRowProps = {
  groups: readonly NomiOverflowRowGroup[]
  /** 「⋯」的无障碍名与悬停提示。 */
  overflowLabel: string
  /** 「⋯」按钮的附加类（尺寸跟同一排的按钮走）。 */
  overflowButtonClassName?: string
  className?: string
}

const DATA_OVERFLOWING = 'data-overflowing'
// 组分隔线：左 4（加上前一项自带的右 4 = 8）+ 1px 线 + 右 8 —— 与原来 gap-1 + mx-1 两侧各 8 一致。
const DIVIDER_CLASS = 'inline-flex shrink-0 items-center pl-1 pr-2 data-[overflowing]:hidden'
const DIVIDER_LINE = <span className="h-[18px] w-px bg-workbench-border" />

const OverflowManagerContext = React.createContext<OverflowManager | null>(null)

function useOverflowManager(): OverflowManager {
  const manager = React.useContext(OverflowManagerContext)
  if (!manager) throw new Error('NomiOverflowRow: item rendered outside its row')
  return manager
}

function OverflowItem({ id, groupId, children }: { id: string; groupId: string; children: React.ReactNode }): JSX.Element {
  const manager = useOverflowManager()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    manager.addItem({ element, id, groupId, priority: 0 })
    return () => {
      element.removeAttribute(DATA_OVERFLOWING)
      manager.removeItem(id)
    }
  }, [manager, id, groupId])
  return (
    <div ref={ref} data-overflow-item={id} className="inline-flex shrink-0 pr-1 data-[overflowing]:hidden">
      {children}
    </div>
  )
}

function OverflowDivider({ groupId }: { groupId: string }): JSX.Element {
  const manager = useOverflowManager()
  const ref = React.useRef<HTMLDivElement>(null)
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    manager.addDivider({ element, groupId })
    return () => manager.removeDivider(groupId)
  }, [manager, groupId])
  return <div ref={ref} aria-hidden="true" className={DIVIDER_CLASS}>{DIVIDER_LINE}</div>
}

function OverflowMenuButton({
  hiddenGroups,
  label,
  buttonClassName,
  withDivider,
}: {
  hiddenGroups: readonly NomiOverflowRowGroup[]
  label: string
  buttonClassName?: string
  withDivider: boolean
}): JSX.Element {
  const manager = useOverflowManager()
  const ref = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const [open, setOpen] = React.useState(false)
  const [rect, setRect] = React.useState<WorkbenchMenuAnchorRect>({ left: 0, top: 0, width: 0, height: 0 })
  // 「⋯」只在真有项收起时才挂；挂上的那一刻登记给测量器，它会立刻按「⋯」占的宽再收一轮（Fluent 同款时序）。
  React.useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    manager.addOverflowMenu(element)
    return () => manager.removeOverflowMenu()
  }, [manager])
  const items: WorkbenchMenuNode[] = hiddenGroups.flatMap((group, index) => [
    ...(index > 0 ? [{ kind: 'separator' as const, id: `sep-${group.id}` }] : []),
    ...group.items.map((item) => ({ ...item.menuItem, id: item.id })),
  ])
  return (
    <div ref={ref} data-overflow-menu className="inline-flex shrink-0 items-center">
      {withDivider ? <span aria-hidden="true" className={DIVIDER_CLASS}>{DIVIDER_LINE}</span> : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={buttonRef}
            type="button"
            aria-label={label}
            aria-haspopup="menu"
            aria-expanded={open}
            data-overflow-trigger
            data-active={open ? 'true' : 'false'}
            // 不抢编辑器焦点：和同一排的格式钮一样，选区留在原处，菜单项执行时再还焦点。
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const box = buttonRef.current?.getBoundingClientRect()
              if (box) setRect({ left: box.left, top: box.top, width: box.width, height: box.height })
              setOpen((value) => !value)
            }}
            className={cn(
              'inline-grid place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-60 cursor-pointer',
              'transition-colors duration-nomi-fast ease-nomi-fast hover:bg-nomi-ink-05 hover:text-nomi-ink',
              'data-[active=true]:bg-workbench-pressed data-[active=true]:text-nomi-ink',
              buttonClassName,
            )}
          >
            <IconDots size={16} stroke={2} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <WorkbenchMenu
        open={open}
        onOpenChange={setOpen}
        anchorRect={rect}
        align="end"
        items={items}
        ariaLabel={label}
        className="min-w-[160px]"
        data-testid="nomi-overflow-menu"
      />
    </div>
  )
}

export function NomiOverflowRow({ groups, overflowLabel, overflowButtonClassName, className }: NomiOverflowRowProps): JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [manager] = React.useState(() => createOverflowManager())
  const snapshot = React.useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot)
  // 项与分隔线在子组件的 layout effect 里登记，先于这里；observe 时把已登记的项一并收进队列并立刻量一次。
  React.useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    manager.observe(container, {
      overflowAxis: 'horizontal',
      overflowDirection: 'end',
      padding: 0,
      minimumVisible: 0,
      onUpdateItemVisibility: ({ item, visible }) => {
        if (visible) item.element.removeAttribute(DATA_OVERFLOWING)
        else item.element.setAttribute(DATA_OVERFLOWING, '')
      },
      forceUpdate: true,
    })
    return () => manager.disconnect()
  }, [manager])

  const hiddenGroups = groups
    .map((group) => ({ id: group.id, items: group.items.filter((item) => snapshot.itemVisibility[item.id] === false) }))
    .filter((group) => group.items.length > 0)
  const firstGroupId = groups[0]?.id
  const firstGroupGone = firstGroupId !== undefined && snapshot.groupVisibility[firstGroupId] === 'hidden'

  return (
    <OverflowManagerContext.Provider value={manager}>
      <div ref={containerRef} data-nomi-overflow-row className={cn('flex min-w-0 flex-1 items-center', className)}>
        {groups.map((group, index) => (
          <React.Fragment key={group.id}>
            {index > 0 ? <OverflowDivider groupId={group.id} /> : null}
            {group.items.map((item) => (
              <OverflowItem key={item.id} id={item.id} groupId={group.id}>{item.node}</OverflowItem>
            ))}
          </React.Fragment>
        ))}
        {snapshot.invisibleItemCount > 0 ? (
          <OverflowMenuButton
            hiddenGroups={hiddenGroups}
            label={overflowLabel}
            buttonClassName={overflowButtonClassName}
            withDivider={!firstGroupGone}
          />
        ) : null}
      </div>
    </OverflowManagerContext.Provider>
  )
}
