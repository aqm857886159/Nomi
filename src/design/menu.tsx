import React from 'react'
import { createPortal } from 'react-dom'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { IconCheck } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

/**
 * `WorkbenchMenu` —— 全站菜单的**行为内核**（刀 1，2026-09-08）。
 *
 * 为什么买不自研（论证在 `docs/plan/2026-09-07-design-system-component-authority.md` §3.1，
 * 现状清单在 `docs/plan/2026-09-08-menu-primitive-inventory.md`）：全仓 24 个手写菜单里
 * **处理方向键的是 0 个**、点外关闭缺 2 个、菜单该多高各写各的猜测有 6 处。菜单的难点
 * （roving tabindex / typeahead / 边缘避让 / 关闭时的焦点归还）没有一条和 AI 视频有关，
 * 不在护城河上；而外观必须是 Nomi 的，否则等于引进第二套设计语言。
 * 所以：**行为全走 Radix，外观全走 Nomi token + Tabler 图标**。
 *
 * ## 为什么只有「受控 + 点位」这一种打开方式
 *
 * 迁移铁律是**只换实现、不动形态**。现役右键菜单的「什么时候开、开在哪」都是宿主算出来的，
 * 而且那套编排本身带着领域约束，Radix 的 `ContextMenu.Trigger` 复制不了：
 *   · 画布（`generationCanvas/components/useCanvasContextNodeMenu.ts`）在 **pointerup** 才提交，
 *     为的是让右键平移和弦、连线落空先有机会否决；`Trigger` 在 contextmenu 事件就开；
 *   · 时间轴（`workbench/timeline/TimelinePanel.tsx:296`）先从 `event.target` 解出 4 种 target，
 *     解不出就**根本不开**；`Trigger` 一律开。
 * 换成 `ContextMenu` 包 = 改形态。所以这里只提供「宿主给点位、原语负责其余」这一条路：
 * 宿主保留它原本的手势编排一行不动，原语接手定位/避让/键盘/点外关闭/Esc。
 * 这也顺带覆盖了「程序化在某点打开（无触发元素）」那一族（连线落空菜单等，批 2）。
 * 因此 `@radix-ui/react-context-menu` **没有装**：现役 0 个消费者，装了就是提前造
 * （清单 §3.2 的纪律）。真右键触发式菜单出现时再装，届时在这里加第二个 Root。
 *
 * ## 为什么 `modal={false}`
 *
 * Radix `DropdownMenu` 默认 `modal`：给 body 加 `pointer-events:none` 并锁滚动，于是
 * 「点外面」只关菜单、事件到不了底下的画布。而现役菜单全是 `window` 上一个 pointerdown
 * 关闭 —— 那一下**同时**关菜单并落到画布上（开始框选/取消选择）。保住这个 = `modal={false}`。
 *
 * ## 外观为什么可以被调用方覆写
 *
 * 清单 §4.3 记了 C11–C14 四条**现役视觉差异**（宽度 12 种、字号两种、hover 底色三种、
 * 分隔线三种画法）。刀 1 不统一它们（用户 2026-09-08：「我们那个设计是已经之前确定好」），
 * 所以默认皮肤取 2026-08-20 拍板的节点菜单那套，别的调用点用 `className` / `itemClassName` /
 * `shortcutClassName` / `separatorClassName` 把自己现在的样子原样带过来。
 * 要不要收敛成一套，是另一个需要用户拍板的决定，不在本刀。
 */

export type WorkbenchMenuIcon = React.ComponentType<{ className?: string }>

type WorkbenchMenuItemBase = {
  /** React key 与走查锚点（`data-menu-item`）。 */
  id: string
  label: string
  /** 可选：多数画布菜单有图标，时间轴/侧栏/原稿列表现役就是没有（清单 C9）。 */
  icon?: WorkbenchMenuIcon
  /** 右对齐的快捷键提示。文案由调用方给——平台适配各家写法不同（清单 C10）。 */
  shortcut?: string
  /** 项内第二行灰字说明（现役唯一消费者是框菜单的「解散」）。 */
  description?: string
  disabled?: boolean
  /** 为什么不能点。挂 native `title`——Radix 的 Item 不是 `<button disabled>`，挂得上。 */
  disabledReason?: string
  /** 默认 true。false = 选完不关（现役有意如此的是布局菜单的面板开关）。 */
  closeOnSelect?: boolean
}

export type WorkbenchMenuAction = WorkbenchMenuItemBase & {
  kind?: 'action'
  /** 危险项（红字）。 */
  danger?: boolean
  /**
   * 选中。拿到的是 Radix 的原生事件：`event.preventDefault()` 可**阻止关闭**，
   * 用于必须在同一个用户手势里同步调用 `.click()` 的场合（文件选择器那一族）。
   */
  onSelect: (event: Event) => void
}

export type WorkbenchMenuCheckbox = WorkbenchMenuItemBase & {
  kind: 'checkbox'
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

export type WorkbenchMenuRadioGroup = {
  kind: 'radio'
  id: string
  /** 分组标题（可选）。 */
  label?: string
  value: string
  onValueChange: (value: string) => void
  options: readonly (WorkbenchMenuItemBase & { value: string })[]
}

export type WorkbenchMenuSeparator = { kind: 'separator'; id: string }

/** 有名字的一段（现役靠 `role="group"` + 一行标题实现，如画布「添加节点」的三段）。 */
export type WorkbenchMenuGroup = {
  kind: 'group'
  id: string
  label?: string
  items: readonly WorkbenchMenuNode[]
}

export type WorkbenchMenuNode =
  | WorkbenchMenuAction
  | WorkbenchMenuCheckbox
  | WorkbenchMenuRadioGroup
  | WorkbenchMenuSeparator
  | WorkbenchMenuGroup

export type WorkbenchMenuProps = {
  /** 受控开合。宿主自己决定什么时候开——原语不抢这个决定。 */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 视口坐标（`event.clientX/clientY`）。菜单左上角贴这里，越界由 Radix 真实测量后避让。 */
  point: { x: number; y: number }
  items: readonly WorkbenchMenuNode[]
  /** 菜单本身的无障碍名。现役 6 个菜单没有（清单 C15），迁一个补一个。 */
  ariaLabel?: string
  /** 菜单面板附加类（宽度这类调用点差异，见头注）。 */
  className?: string
  /** 每一项的附加类（字号/行高/hover 底色这类调用点差异）。 */
  itemClassName?: string
  /** 快捷键列的附加类。 */
  shortcutClassName?: string
  /** 分隔线的附加类。 */
  separatorClassName?: string
  /**
   * 菜单面板上的 pointerdown。留这个口子是因为菜单 Portal 到 body 之后就落在 `window` 的
   * 冒泡路径上，而有的宿主在 window 上挂着「点外面就关」——不 stopPropagation，
   * 点自己的菜单项会先把菜单关掉（画布就是这么写的，迁移前那句话挂在菜单根上）。
   */
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void
  /** 走查/样式钩子，落在菜单面板上。 */
  'data-testid'?: string
}

/** 面板与项的默认皮肤 = 2026-08-20 用户拍板的节点右键菜单那一套。 */
const CONTENT_CLASS =
  'grid gap-0.5 p-[6px] border border-workbench-border rounded-nomi bg-nomi-paper shadow-workbench-pop'
const ITEM_CLASS = cn(
  'inline-flex items-center justify-between gap-2 w-full min-h-8 px-2 rounded-nomi',
  'font-[inherit] text-caption text-workbench-ink outline-none select-none cursor-pointer',
  'data-[highlighted]:bg-nomi-ink-05',
  'data-[disabled]:text-nomi-ink-40 data-[disabled]:cursor-not-allowed data-[disabled]:bg-transparent',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.8] [&_svg]:text-nomi-ink-60',
  'data-[disabled]:[&_svg]:text-nomi-ink-30',
)
const DANGER_ITEM_CLASS = 'text-workbench-danger [&_svg]:text-workbench-danger'
const SHORTCUT_CLASS = 'text-nomi-ink-40 tabular-nums'
const SEPARATOR_CLASS = 'h-px my-1 mx-2 bg-nomi-line'
const GROUP_LABEL_CLASS = 'px-2 py-1 text-micro text-workbench-muted select-none'

/**
 * 一项的内容（[勾选槽 +] 图标 + 文案 [+ 第二行灰字]，右侧快捷键）。三种项形态共用，免得画三遍。
 * `withIndicator` 只在 checkbox / radio 项上为真：勾不勾都占住那 16px，否则同一组里
 * 勾上的那行会比没勾的往右挪一格。
 */
function MenuItemBody({
  item,
  shortcutClassName,
  withIndicator = false,
}: {
  item: WorkbenchMenuItemBase
  shortcutClassName?: string
  withIndicator?: boolean
}): JSX.Element {
  const Icon = item.icon
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {withIndicator ? (
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
              <IconCheck />
            </DropdownMenuPrimitive.ItemIndicator>
          </span>
        ) : null}
        {Icon ? <Icon /> : null}
        <span className="inline-flex min-w-0 flex-col items-start">
          <span data-menu-label-text className="truncate">{item.label}</span>
          {item.description ? (
            <span data-menu-description className="text-micro text-nomi-ink-40">{item.description}</span>
          ) : null}
        </span>
      </span>
      {item.shortcut ? (
        <span data-menu-shortcut className={cn(SHORTCUT_CLASS, shortcutClassName)}>{item.shortcut}</span>
      ) : null}
    </>
  )
}

type RenderContext = Pick<WorkbenchMenuProps, 'itemClassName' | 'shortcutClassName' | 'separatorClassName'>

/** 选中项的收尾：`closeOnSelect === false` 就把关闭拦下来（Radix 默认选完即关）。 */
function selectHandler(item: WorkbenchMenuItemBase, run?: (event: Event) => void) {
  return (event: Event) => {
    if (item.closeOnSelect === false) event.preventDefault()
    run?.(event)
  }
}

function renderNodes(nodes: readonly WorkbenchMenuNode[], ctx: RenderContext): React.ReactNode {
  return nodes.map((node) => {
    if (node.kind === 'separator') {
      return (
        <DropdownMenuPrimitive.Separator
          key={node.id}
          className={cn(SEPARATOR_CLASS, ctx.separatorClassName)}
        />
      )
    }
    if (node.kind === 'group') {
      return (
        <DropdownMenuPrimitive.Group key={node.id}>
          {node.label ? (
            <DropdownMenuPrimitive.Label data-menu-label className={GROUP_LABEL_CLASS}>{node.label}</DropdownMenuPrimitive.Label>
          ) : null}
          {renderNodes(node.items, ctx)}
        </DropdownMenuPrimitive.Group>
      )
    }
    if (node.kind === 'radio') {
      return (
        <DropdownMenuPrimitive.RadioGroup key={node.id} value={node.value} onValueChange={node.onValueChange}>
          {node.label ? (
            <DropdownMenuPrimitive.Label data-menu-label className={GROUP_LABEL_CLASS}>{node.label}</DropdownMenuPrimitive.Label>
          ) : null}
          {node.options.map((option) => (
            <DropdownMenuPrimitive.RadioItem
              key={option.id}
              value={option.value}
              disabled={option.disabled}
              title={option.disabled ? option.disabledReason : undefined}
              data-menu-item={option.id}
              className={cn(ITEM_CLASS, ctx.itemClassName)}
              onSelect={selectHandler(option)}
            >
              <MenuItemBody item={option} shortcutClassName={ctx.shortcutClassName} withIndicator />
            </DropdownMenuPrimitive.RadioItem>
          ))}
        </DropdownMenuPrimitive.RadioGroup>
      )
    }
    if (node.kind === 'checkbox') {
      return (
        <DropdownMenuPrimitive.CheckboxItem
          key={node.id}
          checked={node.checked}
          onCheckedChange={node.onCheckedChange}
          disabled={node.disabled}
          title={node.disabled ? node.disabledReason : undefined}
          data-menu-item={node.id}
          className={cn(ITEM_CLASS, ctx.itemClassName)}
          onSelect={selectHandler(node)}
        >
          <MenuItemBody item={node} shortcutClassName={ctx.shortcutClassName} withIndicator />
        </DropdownMenuPrimitive.CheckboxItem>
      )
    }
    return (
      <DropdownMenuPrimitive.Item
        key={node.id}
        disabled={node.disabled}
        title={node.disabled ? node.disabledReason : undefined}
        data-menu-item={node.id}
        className={cn(ITEM_CLASS, node.danger && DANGER_ITEM_CLASS, ctx.itemClassName)}
        onSelect={selectHandler(node, node.onSelect)}
      >
        <MenuItemBody item={node} shortcutClassName={ctx.shortcutClassName} />
      </DropdownMenuPrimitive.Item>
    )
  })
}

export function WorkbenchMenu({
  open,
  onOpenChange,
  point,
  items,
  ariaLabel,
  className,
  itemClassName,
  shortcutClassName,
  separatorClassName,
  onPointerDown,
  'data-testid': testId,
}: WorkbenchMenuProps): JSX.Element {
  const ctx: RenderContext = { itemClassName, shortcutClassName, separatorClassName }
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/*
        虚拟锚点与内容同样 Portal 到 body；否则画布 transform 会把 fixed 视口坐标再变换一次。
        `tabIndex={-1}` 是必需的——它不可见，留在 Tab 序里就是一个摸不着的停靠点。
      */}
      {typeof document !== 'undefined' && createPortal(
        <DropdownMenuPrimitive.Trigger
        tabIndex={-1}
        aria-label={ariaLabel}
        className="fixed size-0 border-0 bg-transparent p-0"
        style={{ left: point.x, top: point.y }}
      />,
        document.body,
      )}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side="bottom"
          align="start"
          sideOffset={0}
          alignOffset={0}
          // 8 = 现役画布菜单手写的 MENU_EDGE_GAP。差别在于避让用的是**真实测量的盒子**，
          // 不再是各处各猜一个「菜单多高」的常数（清单 §3.3）。
          collisionPadding={8}
          aria-label={ariaLabel}
          data-testid={testId}
          // 右键菜单上再右键，现役是 preventDefault（不弹浏览器原生菜单）。照抄。
          onPointerDown={onPointerDown}
          onContextMenu={(event) => event.preventDefault()}
          // 关闭时不把焦点还给那个 0×0 的虚拟锚点：现役菜单关掉后焦点本就留在原处，
          // 归还给一个看不见的元素是新增行为，不是「只换实现」。
          onCloseAutoFocus={(event) => event.preventDefault()}
          style={{ zIndex: NOMI_OVERLAY_Z_INDEX.popover }}
          className={cn(CONTENT_CLASS, className)}
        >
          {renderNodes(items, ctx)}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}
