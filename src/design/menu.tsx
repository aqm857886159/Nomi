import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { IconCheck } from '@tabler/icons-react'
import { cn } from '../utils/cn'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

/**
 * `WorkbenchMenu` / `WorkbenchContextMenu` —— 全站菜单的**唯一的家**（刀 1，2026-09-08；两条入口 2026-11-23）。
 *
 * 为什么买不自研（论证在 `docs/plan/2026-09-07-design-system-component-authority.md` §3.1，
 * 现状清单在 `docs/plan/2026-09-08-menu-primitive-inventory.md`）：全仓 24 个手写菜单里
 * **处理方向键的是 0 个**、点外关闭缺 2 个、菜单该多高各写各的猜测有 6 处。菜单的难点
 * （roving tabindex / typeahead / 边缘避让 / 关闭时的焦点归还）没有一条和 AI 视频有关，
 * 不在护城河上；而外观必须是 Nomi 的，否则等于引进第二套设计语言。
 * 所以：**行为全走 Radix，外观全走 Nomi token + Tabler 图标**。
 *
 * ## 两条入口，共用一份菜单项渲染与皮肤
 *
 * 判据只有一个：**被右键 / 被点开的那个元素是谁**
 * （`docs/engineering/direction-checks/2026-11-23-workbench-menu-trigger-contract.md`）。
 *
 *   · **真触发器入口**——有这个元素就把它交给 Radix：
 *       - 行右键：`<WorkbenchContextMenu items={…}>{行}</WorkbenchContextMenu>`（`ContextMenu.Trigger asChild`）；
 *       - 按钮下拉：`<WorkbenchMenu trigger={按钮} items={…} />`（`DropdownMenu.Trigger asChild`）。
 *     Radix 原生把 `data-state="open"`（按钮还有 `aria-expanded`）写在真实元素上、量真实元素做锚点、
 *     关菜单把焦点还给它。调用方只叠一处 `WORKBENCH_MENU_TRIGGER_OPEN_CLASS` 就有打开态高亮——
 *     不再借 `:hover` / `:focus-within` 冒充（菜单一开焦点就进菜单、指针被菜单盖住，那两个都会失效：compare-01）。
 *   · **受控点位入口（`point` / `anchorRect`）**——没有单一触发元素、或手势编排带领域约束的才用：
 *       - 画布（`generationCanvas/components/useCanvasContextNodeMenu.ts`）在 **pointerup** 才提交，
 *         为的是让右键平移和弦、连线落空先有机会否决；`Trigger` 在 contextmenu 事件就开；
 *       - 时间轴（`workbench/timeline/TimelinePanel.tsx:296`）先从 `event.target` 解出 4 种 target，
 *         解不出就**根本不开**；`Trigger` 一律开；
 *       - 连线拖到空白松手（`NodeDeriveMenu`）：根本没有触发元素。
 *     宿主保留它原本的手势编排一行不动，原语接手定位/避让/键盘/点外关闭/Esc。给 `point` 的文件由
 *     `menu.structure.test.ts` 登记（只这 3 个 + 1 个冻结存量）；`anchorRect` 是还没迁到 `trigger` 的按钮下拉。
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
  /** 透传到菜单项节点上的 data-* 走查/语义钩子（如 `data-resource-action`）。 */
  dataAttributes?: Readonly<Record<`data-${string}`, string | undefined>>
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

/**
 * 菜单项：直接给一组，或给一个工厂。工厂只在菜单**真打开时**才调——分类树 200 行、每行挂一个右键菜单，
 * 闭合态零构建、零 i18n 拼接；也让「打开那一刻的播放头时间」这类值在打开时才读。
 */
export type WorkbenchMenuItems = readonly WorkbenchMenuNode[] | (() => readonly WorkbenchMenuNode[])

/**
 * 右键目标行 / 下拉触发钮在菜单开着时的**唯一**视觉态。由 Radix 原生写在真实触发元素上的 `data-state="open"` 驱动，
 * 只有真触发器入口（`WorkbenchContextMenu`、`WorkbenchMenu trigger`）会写它。
 *
 * 约定：只叠在**非选中态**上——`active ? '选中底' : cn('悬停底', WORKBENCH_MENU_TRIGGER_OPEN_CLASS)`，
 * 选中行的底色（accent-soft / ink-10）永远不被打开态盖掉。
 */
export const WORKBENCH_MENU_TRIGGER_OPEN_CLASS = 'data-[state=open]:bg-nomi-ink-05'

/** 视口坐标系里的一块矩形（`getBoundingClientRect()` 的子集）。 */
export type WorkbenchMenuAnchorRect = Readonly<{ left: number; top: number; width: number; height: number }>

/** 两条入口共用的菜单内容与皮肤。 */
type WorkbenchMenuSkinProps = {
  items: WorkbenchMenuItems
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
  /** 挂到菜单面板上的 `data-nomi-escape-layer`，供宿主键盘/Esc 归属链先让路给菜单。 */
  escapeLayer?: string
  /** 透传到菜单面板上的额外 `data-*` 属性（如 `data-creation-resource-menu`）。 */
  contentData?: Readonly<Record<`data-${string}`, string | undefined>>
}

type WorkbenchMenuPlacement = {
  /**
   * 往哪边展开。默认 `bottom`（右键菜单：左上角贴点位）。`top` = 菜单**底边**贴锚点往上长——
   * 节点浮条的下拉要用它：浮条浮在节点上方，往下开就盖住了这张图本身（§1.5.3 动作不许压在内容上）。
   * 放不下时仍由 Radix 按真实尺寸翻边，不是写死。
   */
  side?: 'top' | 'bottom'
  /**
   * 菜单与锚点哪条边对齐。默认 `start`（左边对齐）。`end` = 右边对齐——锚点贴着容器右端的按钮
   * （工具条收起后的「⋯」）往左展开，不越过它所在的那块面板（2026-11-07 窄窗拍板 N4-creation-menu）。
   */
  align?: 'start' | 'end'
  /** 菜单与触发钮 / `anchorRect` 之间的缝（只对按钮点开的菜单有意义；点位菜单贴点）。默认 6。 */
  gap?: number
}

/**
 * 菜单贴哪儿——三种来源，三选一（类型上互斥）：
 *
 *   · `trigger`：**由一颗按钮点开**的菜单，把按钮元素本身交进来（`DropdownMenu.Trigger asChild`）。
 *     Radix 量真按钮、开合自管（非受控）、按钮上原生 `data-state` / `aria-expanded`、关后焦点回按钮。新代码只用这个。
 *   · `anchorRect`：按钮下拉的旧写法——宿主自己量「菜单不许盖住的那块」传进来（浮条下拉连同它所在的那一排，
 *     `ToolbarActionMenu` 算好再传）。还没迁到 `trigger` 的 9 处在用，迁一处删一处。
 *   · `point`：**没有单一触发元素**的菜单（画布 pointerup 和弦、连线落空、剪辑时间轴四目标命中）。菜单角贴在这个点上。
 *     行右键不许用它——用 `WorkbenchContextMenu`。登记表在 `menu.structure.test.ts`。
 *
 * 为什么不能拿 `point` 冒充按钮（2026-10-06 用户截图那一类）：按钮点开时把点算在「按钮上沿往上 6px」、
 * 再说 `side="top"`。头顶放得下时没事；节点靠画布上沿、头顶放不下时 Radix 翻到下面——可它翻的是
 * 一个 0×0 的点，于是菜单的**上沿**落在按钮上沿之上 6px，整块压回按钮和浮条那一排（「改图」盖住「宫格」）。
 * 给真实的元素 / 矩形，翻边就以它的另一条边为起点，永远不会跨过它；两边都放不下时，菜单收高度、里面滚动，
 * 也不跨过它（见下面 CONTENT 的 max-height）。
 */
type WorkbenchMenuAnchor =
  | {
      trigger: React.ReactElement
      point?: never
      anchorRect?: never
      open?: never
      /** 开合由 Radix 自管；需要知道开没开（如联动高亮）时挂这个。 */
      onOpenChange?: (open: boolean) => void
    }
  | {
      point: { x: number; y: number }
      anchorRect?: never
      trigger?: never
      /** 受控开合。宿主自己决定什么时候开——原语不抢这个决定。 */
      open: boolean
      onOpenChange: (open: boolean) => void
    }
  | {
      anchorRect: WorkbenchMenuAnchorRect
      point?: never
      trigger?: never
      open: boolean
      onOpenChange: (open: boolean) => void
    }

export type WorkbenchMenuProps = WorkbenchMenuAnchor & WorkbenchMenuPlacement & WorkbenchMenuSkinProps

export type WorkbenchContextMenuProps = WorkbenchMenuSkinProps & {
  /** 被右键的那个真实元素（行）。Radix 把 `data-state` 与 contextmenu 处理并到它身上，所以它必须能收 ref 与 props。 */
  children: React.ReactElement
  /** 行内改名等态下关掉：右键回到浏览器原生菜单（复制 / 粘贴）。 */
  disabled?: boolean
  onOpenChange?: (open: boolean) => void
}

/** 面板与项的默认皮肤 = 2026-08-20 用户拍板的节点右键菜单那一套。 */
// max-height 用 Radix 量出来的「这一边还剩多高」：两边都放不下时菜单收高度、里面滚动，而不是被推回去压住锚点。
// 用 popper 层的变量名——DropdownMenu 与 ContextMenu 各自的别名都映射到它，一处兼容两个 Root。
const CONTENT_CLASS =
  'grid gap-0.5 p-[6px] border border-workbench-border rounded-nomi bg-nomi-paper shadow-workbench-pop max-h-[var(--radix-popper-available-height,100vh)] overflow-y-auto'
const ITEM_CLASS = cn(
  'inline-flex items-center justify-between gap-2 w-full min-h-8 px-2 rounded-nomi',
  'font-[inherit] text-caption text-workbench-ink outline-none select-none cursor-pointer',
  'data-[highlighted]:bg-nomi-ink-05',
  'data-[disabled]:text-nomi-ink-40 data-[disabled]:cursor-not-allowed data-[disabled]:bg-transparent',
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.8] [&_svg]:text-nomi-ink-60',
  'data-[disabled]:[&_svg]:text-nomi-ink-30',
)
// 用 data-[danger] 提升选择器权重到 (0,2,0)，确保调用方 itemClassName 传文字色（如 text-nomi-ink-80）不会按 CSS 声明顺序盖掉危险红；
// disabled 态不挂 data-danger，由 data-[disabled] 正常走灰字。
const DANGER_ITEM_CLASS = 'data-[danger]:text-workbench-danger data-[danger]:[&_svg]:text-workbench-danger'
const SHORTCUT_CLASS = 'text-nomi-ink-40 tabular-nums'
const SEPARATOR_CLASS = 'h-px my-1 mx-2 bg-nomi-line'
const GROUP_LABEL_CLASS = 'px-2 py-1 text-micro text-workbench-muted select-none'
/**
 * 分段与单选组的盒子也要是一列 grid，和面板本身同一个间距。项是 `inline-flex`：直接挂在面板（grid）下
 * 时各占一行，但包进一个普通块级 div 之后会**横着排成一行**——面板的 max-content 宽于是等于所有项宽之和
 * （2026-10-04 快捷动作「改图▾」两段十项，面板被撑到 500+ px 宽）。
 */
const GROUP_CLASS = 'grid gap-0.5'

/**
 * 菜单项原语字典。两个 Root 的项原语签名一致，但各读各的 scope（DropdownMenu 的项塞进 ContextMenu 的面板会找不到上下文），
 * 所以同一份 `renderNodes` 按入口换一套字典，不复制渲染逻辑。
 */
const DROPDOWN_PRIMITIVES = {
  Item: DropdownMenuPrimitive.Item,
  CheckboxItem: DropdownMenuPrimitive.CheckboxItem,
  RadioGroup: DropdownMenuPrimitive.RadioGroup,
  RadioItem: DropdownMenuPrimitive.RadioItem,
  ItemIndicator: DropdownMenuPrimitive.ItemIndicator,
  Group: DropdownMenuPrimitive.Group,
  Label: DropdownMenuPrimitive.Label,
  Separator: DropdownMenuPrimitive.Separator,
}
type MenuPrimitives = typeof DROPDOWN_PRIMITIVES
const CONTEXT_PRIMITIVES: MenuPrimitives = {
  Item: ContextMenuPrimitive.Item,
  CheckboxItem: ContextMenuPrimitive.CheckboxItem,
  RadioGroup: ContextMenuPrimitive.RadioGroup,
  RadioItem: ContextMenuPrimitive.RadioItem,
  ItemIndicator: ContextMenuPrimitive.ItemIndicator,
  Group: ContextMenuPrimitive.Group,
  Label: ContextMenuPrimitive.Label,
  Separator: ContextMenuPrimitive.Separator,
}

/**
 * 一项的内容（[勾选槽 +] 图标 + 文案 [+ 第二行灰字]，右侧快捷键）。三种项形态共用，免得画三遍。
 * `withIndicator` 只在 checkbox / radio 项上为真：勾不勾都占住那 16px，否则同一组里
 * 勾上的那行会比没勾的往右挪一格。
 */
function MenuItemBody({
  item,
  shortcutClassName,
  primitives,
  withIndicator = false,
}: {
  item: WorkbenchMenuItemBase
  shortcutClassName?: string
  primitives: MenuPrimitives
  withIndicator?: boolean
}): JSX.Element {
  const Icon = item.icon
  return (
    <>
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {withIndicator ? (
          <span className="inline-flex size-4 shrink-0 items-center justify-center">
            <primitives.ItemIndicator>
              <IconCheck />
            </primitives.ItemIndicator>
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

type RenderContext = Pick<WorkbenchMenuSkinProps, 'itemClassName' | 'shortcutClassName' | 'separatorClassName'> & {
  primitives: MenuPrimitives
}

/** 选中项的收尾：`closeOnSelect === false` 就把关闭拦下来（Radix 默认选完即关）。 */
function selectHandler(item: WorkbenchMenuItemBase, run?: (event: Event) => void) {
  return (event: Event) => {
    if (item.closeOnSelect === false) event.preventDefault()
    run?.(event)
  }
}

function resolveItems(items: WorkbenchMenuItems): readonly WorkbenchMenuNode[] {
  return typeof items === 'function' ? items() : items
}

function renderNodes(nodes: readonly WorkbenchMenuNode[], ctx: RenderContext): React.ReactNode {
  const p = ctx.primitives
  return nodes.map((node) => {
    if (node.kind === 'separator') {
      return (
        <p.Separator
          key={node.id}
          className={cn(SEPARATOR_CLASS, ctx.separatorClassName)}
        />
      )
    }
    if (node.kind === 'group') {
      return (
        <p.Group key={node.id} className={GROUP_CLASS}>
          {node.label ? (
            <p.Label data-menu-label className={GROUP_LABEL_CLASS}>{node.label}</p.Label>
          ) : null}
          {renderNodes(node.items, ctx)}
        </p.Group>
      )
    }
    if (node.kind === 'radio') {
      return (
        <p.RadioGroup key={node.id} className={GROUP_CLASS} value={node.value} onValueChange={node.onValueChange}>
          {node.label ? (
            <p.Label data-menu-label className={GROUP_LABEL_CLASS}>{node.label}</p.Label>
          ) : null}
          {node.options.map((option) => (
            <p.RadioItem
              key={option.id}
              value={option.value}
              disabled={option.disabled}
              title={option.disabled ? option.disabledReason : undefined}
              data-menu-item={option.id}
              {...option.dataAttributes}
              className={cn(ITEM_CLASS, ctx.itemClassName)}
              onSelect={selectHandler(option)}
            >
              <MenuItemBody item={option} shortcutClassName={ctx.shortcutClassName} primitives={p} withIndicator />
            </p.RadioItem>
          ))}
        </p.RadioGroup>
      )
    }
    if (node.kind === 'checkbox') {
      return (
        <p.CheckboxItem
          key={node.id}
          checked={node.checked}
          onCheckedChange={node.onCheckedChange}
          disabled={node.disabled}
          title={node.disabled ? node.disabledReason : undefined}
          data-menu-item={node.id}
          {...node.dataAttributes}
          className={cn(ITEM_CLASS, ctx.itemClassName)}
          onSelect={selectHandler(node)}
        >
          <MenuItemBody item={node} shortcutClassName={ctx.shortcutClassName} primitives={p} withIndicator />
        </p.CheckboxItem>
      )
    }
    return (
      <p.Item
        key={node.id}
        disabled={node.disabled}
        title={node.disabled ? node.disabledReason : undefined}
        data-menu-item={node.id}
        data-danger={node.danger && !node.disabled ? 'true' : undefined}
        {...node.dataAttributes}
        className={cn(ITEM_CLASS, ctx.itemClassName, node.danger && DANGER_ITEM_CLASS)}
        onSelect={selectHandler(node, node.onSelect)}
      >
        <MenuItemBody item={node} shortcutClassName={ctx.shortcutClassName} primitives={p} />
      </p.Item>
    )
  })
}

/** 两个 Root 的面板共用的属性：皮肤、走查钩子、层级、边缘避让、面板上再右键不弹浏览器菜单。 */
function surfaceProps(skin: WorkbenchMenuSkinProps) {
  return {
    // 8 = 现役画布菜单手写的 MENU_EDGE_GAP。差别在于避让用的是**真实测量的盒子**，
    // 不再是各处各猜一个「菜单多高」的常数（清单 §3.3）。
    collisionPadding: 8,
    'aria-label': skin.ariaLabel,
    'data-testid': skin['data-testid'],
    'data-nomi-escape-layer': skin.escapeLayer,
    ...skin.contentData,
    onPointerDown: skin.onPointerDown,
    // 右键菜单上再右键，现役是 preventDefault（不弹浏览器原生菜单）。照抄。
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
    style: { zIndex: NOMI_OVERLAY_Z_INDEX.popover },
    className: cn(CONTENT_CLASS, skin.className),
  }
}

/** 这一下 Esc 已由本菜单消费，阻断继续冒到 window（避免同一下 Esc 把底层抽屉如 ShellRail 一并关掉）。 */
const consumeEscape = (event: KeyboardEvent) => event.stopPropagation()

/**
 * 真触发器入口关菜单时的焦点：默认交给 Radix（下拉回触发钮、右键回打开前聚焦的元素）；
 * 但选中的那一项已经把焦点安排去别处（行内改名的输入框、弹窗……）时不抢回来。
 */
function keepFocusMovedByItem(contentRef: React.RefObject<HTMLDivElement | null>) {
  return (event: Event) => {
    const active = document.activeElement
    if (active && active !== document.body && !contentRef.current?.contains(active)) event.preventDefault()
  }
}

/** 打开前聚焦的那个元素还在页面上、看得见、没禁用，才值得还；否则什么都不做（保持菜单关后焦点留在原处的老行为）。 */
function isRestorableOpener(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement) || el === document.body || !el.isConnected) return false
  if ((el as HTMLButtonElement).disabled) return false
  return el.getClientRects().length > 0
}

/**
 * 行右键（真触发器入口）。`children` 就是那一行：Radix 把 `data-state="open"|"closed"` 与 contextmenu 处理并到它身上，
 * 行只需在非选中态叠 `WORKBENCH_MENU_TRIGGER_OPEN_CLASS`。左键、拖拽、双击全不碰（鼠标只认 contextmenu）。
 *
 * 菜单靠在指针右侧 2px（Radix ContextMenu 写死 side=right / sideOffset=2 / align=start），所以这里不暴露 side / align / gap。
 * 开合非受控：面板与项只在开着时才构建（`items` 可传工厂）。
 */
export function WorkbenchContextMenu({
  children,
  disabled = false,
  onOpenChange,
  ...skin
}: WorkbenchContextMenuProps): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <ContextMenuPrimitive.Root
      modal={false}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
    >
      {/* 右键已由这一行认领：不再冒到外层行 / 容器（嵌套触发区不会一下开两个菜单）。 */}
      <ContextMenuPrimitive.Trigger asChild disabled={disabled} onContextMenu={(event) => { if (!disabled) event.stopPropagation() }}>
        {children}
      </ContextMenuPrimitive.Trigger>
      {open ? (
        <ContextMenuPrimitive.Portal>
          <ContextMenuPrimitive.Content
            ref={contentRef}
            {...surfaceProps(skin)}
            onEscapeKeyDown={consumeEscape}
            onCloseAutoFocus={keepFocusMovedByItem(contentRef)}
          >
            {renderNodes(resolveItems(skin.items), { ...skin, primitives: CONTEXT_PRIMITIVES })}
          </ContextMenuPrimitive.Content>
        </ContextMenuPrimitive.Portal>
      ) : null}
    </ContextMenuPrimitive.Root>
  )
}

/** 按钮下拉（真触发器入口）：Radix 量真按钮、写 `data-state` / `aria-expanded`、关后焦点回按钮。 */
function TriggerDropdownMenu({
  trigger,
  onOpenChange,
  side = 'bottom',
  align = 'start',
  gap = 6,
  ...skin
}: WorkbenchMenuPlacement & WorkbenchMenuSkinProps & { trigger: React.ReactElement; onOpenChange?: (open: boolean) => void }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  return (
    <DropdownMenuPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        onOpenChange?.(next)
      }}
      modal={false}
    >
      <DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          ref={contentRef}
          side={side}
          align={align}
          sideOffset={gap}
          alignOffset={0}
          {...surfaceProps(skin)}
          onEscapeKeyDown={consumeEscape}
          onCloseAutoFocus={keepFocusMovedByItem(contentRef)}
        >
          {open ? renderNodes(resolveItems(skin.items), { ...skin, primitives: DROPDOWN_PRIMITIVES }) : null}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

type PointDropdownMenuProps = WorkbenchMenuPlacement & WorkbenchMenuSkinProps & {
  open: boolean
  onOpenChange: (open: boolean) => void
} & ({ point: { x: number; y: number }; anchorRect?: never } | { anchorRect: WorkbenchMenuAnchorRect; point?: never })

/** 受控点位入口：没有单一触发元素的菜单（`point`），以及还没迁到 `trigger` 的按钮下拉（`anchorRect`）。 */
function PointDropdownMenu({
  open,
  onOpenChange,
  point,
  anchorRect,
  side = 'bottom',
  align = 'start',
  gap = 6,
  ...skin
}: PointDropdownMenuProps): JSX.Element {
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  const openerRef = React.useRef<Element | null>(null)
  const keyboardCloseRef = React.useRef(false)
  // 打开的那一刻记下谁有焦点：layout effect 早于菜单内容挂载后的 passive effect（Radix 在那里才把焦点移进菜单），读到的还是触发按钮。
  React.useLayoutEffect(() => {
    if (!open) return
    // 只认「键盘到达」的焦点（:focus-visible）：鼠标点开的按钮不进来，鼠标开的菜单保持今天的行为（关后焦点不动）。
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active.matches(':focus-visible') ? active : null
    keyboardCloseRef.current = false
  }, [open])
  // 虚拟锚点：点位菜单是 0×0 的点；按钮点开的菜单是那块不许盖住的矩形（不接指针事件——它就叠在真按钮上）。
  const anchorStyle: React.CSSProperties = anchorRect
    ? { left: anchorRect.left, top: anchorRect.top, width: anchorRect.width, height: anchorRect.height, pointerEvents: 'none' }
    : { left: point.x, top: point.y }
  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/*
        虚拟锚点与内容同样 Portal 到 body；否则画布 transform 会把 fixed 视口坐标再变换一次。
        `tabIndex={-1}` 是必需的——它不可见，留在 Tab 序里就是一个摸不着的停靠点。
      */}
      {typeof document !== 'undefined' && createPortal(
        <DropdownMenuPrimitive.Trigger
        tabIndex={-1}
        aria-label={skin.ariaLabel}
        className="fixed size-0 border-0 bg-transparent p-0"
        style={anchorStyle}
      />,
        document.body,
      )}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          side={side}
          align={align}
          sideOffset={anchorRect ? gap : 0}
          alignOffset={0}
          {...surfaceProps(skin)}
          // 焦点：菜单是宿主受控开的，真正的触发按钮（或右键前聚焦的元素）Radix 不认识，它只认那个 0×0 的虚拟锚点。
          // 所以打开的那一刻（上面的 layout effect）自己记下谁有焦点，用键盘关掉（Esc / 键盘选一项）时还给它。
          // 仍然 preventDefault：Radix 默认会把焦点塞给虚拟锚点，那是一个看不见的元素。
          ref={contentRef}
          onKeyDownCapture={() => { keyboardCloseRef.current = true }}
          onEscapeKeyDown={(event) => {
            keyboardCloseRef.current = true
            consumeEscape(event)
          }}
          onPointerDownCapture={() => { keyboardCloseRef.current = false }}
          onPointerDownOutside={() => { keyboardCloseRef.current = false }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const opener = openerRef.current
            const byKeyboard = keyboardCloseRef.current
            openerRef.current = null
            keyboardCloseRef.current = false
            if (!byKeyboard || !isRestorableOpener(opener)) return
            // 选中的那一项已经把焦点安排去别处（输入框、弹窗……）就不抢回来：只在焦点掉到 body 或还留在菜单里时才还。
            const active = document.activeElement
            if (active && active !== document.body && !contentRef.current?.contains(active)) return
            opener.focus({ preventScroll: true })
          }}
        >
          {open ? renderNodes(resolveItems(skin.items), { ...skin, primitives: DROPDOWN_PRIMITIVES }) : null}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

export function WorkbenchMenu(props: WorkbenchMenuProps): JSX.Element {
  if (props.trigger) return <TriggerDropdownMenu {...props} trigger={props.trigger} />
  return <PointDropdownMenu {...props} />
}
