import React, { type JSX, type ReactNode } from 'react'
import { Modal, useProps, type ModalProps } from '@mantine/core'
import { cn } from '../utils/cn'
import { useModalInputLayer } from './modalInputLayer'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

/**
 * 还能经 `frozenAnchors` 挂在对话框本体上的存量锚点（封闭的字面量联合，只减不增）。
 * 冻结名单与读它的人在 `dialogAnchorFreeze.test.ts`；这里和名单多一个少一个，那份测试的类型核对 typecheck 红。
 */
export type FrozenDialogAnchor =
  | 'data-nomi-prompt-extraction-settings-dialog'
  | 'data-selection-prompt-ui'
  | 'data-settings-dialog'
  | 'data-settings-overlay'
  | 'data-spend-confirm-dialog'

export type DesignModalProps = Omit<ModalProps, 'title' | 'stackId' | '__staticSelector'> & {
  /**
   * 对话框的名字，只是一句字（读屏念的就是它，Playwright 也按它找：`getByRole('dialog', { name })`）。
   * 外壳把它放进 Mantine 的 `Modal.Title`，对话框的 aria-labelledby 由库指过去。图标、副标、封面、链接不进名字，走 `header`。
   */
  title: string
  /**
   * 标题栏插槽：标题栏里除了名字还有别的东西（图标、副标、封面、来源链接）时用。外壳把名字元素（`Modal.Title`）交给它，
   * 它把名字和这些东西摆在一起返回；返回的东西放在 `Modal.Header` 里、关闭键前面。名字元素必须原样放进去。
   * 不传 = 标题栏里只有名字。
   */
  header?: (title: ReactNode) => ReactNode
  /** 给测试找这张卡用（落在对话框本体上的 `data-testid`）。先用角色 + 名字找；名字会变、同名卡并存时才用它。 */
  testId?: string
  /**
   * 存量锚点（冻结名单 `dialogAnchorFreeze.test.ts`，只减不增）：照旧挂在对话框本体（带 `role="dialog"` 的那一层）上。
   * 新代码不许加——找弹窗用角色 + 名字或 `testId`。
   */
  frozenAnchors?: Partial<Record<FrozenDialogAnchor, string>>
  /**
   * 决定栏（设计系统 §3.5「弹窗的高度与滚动」）：放 `DecisionBar` 一类的那一排决定。它住在中间内容区之外，
   * 不随内容滚动——窗口多矮、文案多长，它都完整可见。不传 = 这个弹窗没有决定栏。
   */
  actions?: ReactNode
  /**
   * 打开时焦点落在哪：`'first-control'`（默认，Mantine 的做法：第一个可聚焦控件或 `[data-autofocus]`）；
   * `'dialog'` = 落在对话框本体上（读屏先念标题，回车也不会顺手按掉某颗按钮——花钱确认要这样）。
   */
  initialFocus?: 'first-control' | 'dialog'
  /**
   * 中间区的高度交给内容分（§3.5）：中间区成一列，内容根写 `flex min-h-0 flex-col`、里面那段长清单写
   * `min-h-0 overflow-y-auto`——清单先缩、单独滚，清单下面的东西（留言框、说明行）一直看得见。
   * 不传 = 中间区超高时整块滚（内容里自带滚动的段落保持原高，不会被压扁）。
   */
  innerScroll?: boolean
}

type ClassNamesObject = Partial<Record<'root' | 'overlay' | 'inner' | 'content' | 'header' | 'title' | 'close' | 'body', string>>

/** Mantine `Modal` 自己的默认（Modal.mjs 的 defaultProps 里 Root 不重复给的那两项）；其余默认 Root 与 Modal 相同。 */
const MODAL_ONLY_DEFAULTS = { withOverlay: true, withCloseButton: true }

/**
 * 全产品弹窗的外壳，用 Mantine 的组合组件（Modal.Root / Overlay / Content / Header / Title / CloseButton / Body）搭。
 * 名字归库：`title` 进 `Modal.Title`，对话框的 aria-labelledby 由库接；名字以外的标题栏内容走 `header` 插槽，摆在名字旁边。
 * 可用高度和滚动归属只在这里定（§3.5）：弹窗最高 = 窗口内容区减上下留白（Mantine 的 `--modal-content-max-height`，一处）；
 * 标题栏和决定栏（`actions`）不滚，中间内容区自己滚。弹窗自己不写高度上限、不在外层再套滚动。
 */
export function DesignModal(designProps: DesignModalProps): JSX.Element {
  // 主题里给 Modal 的默认（nomiTheme 的 components.Modal：阴影等）照旧生效：组合组件各自只读自己的默认，所以按 Modal 的名字取一次。
  const {
    className,
    classNames,
    radius,
    zIndex,
    title,
    header,
    testId,
    frozenAnchors,
    withOverlay,
    overlayProps,
    withCloseButton,
    closeButtonProps,
    actions,
    initialFocus = 'first-control',
    innerScroll = false,
    children,
    ...rootProps
  } = useProps('Modal', MODAL_ONLY_DEFAULTS, {
    ...designProps,
    radius: designProps.radius ?? 'sm',
    zIndex: designProps.zIndex ?? NOMI_OVERLAY_Z_INDEX.dialog,
  })
  // 所有走 DesignModal 的弹层在这里一次登记：开着时工作区面不接键盘、粘贴、指针手势。
  useModalInputLayer(Boolean(rootProps.opened))
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const rootClassName = cn('font-nomi-sans text-nomi-ink', className)
  const callerClassNames = (typeof classNames === 'object' && classNames ? classNames : {}) as ClassNamesObject
  const mergedClassNames: ClassNamesObject = {
    ...callerClassNames,
    // 纵向三段：标题栏（不缩）· 中间（吃掉剩下的高度）· 决定栏（不缩）。整块不滚，滚动只在中间那块。
    content: cn('flex flex-col overflow-hidden', callerClassNames.content),
    header: cn('shrink-0', callerClassNames.header),
    body: cn('flex min-h-0 flex-1 flex-col overflow-hidden', callerClassNames.body),
  }

  // Mantine 的焦点陷阱打开时把焦点放到第一个控件上；要落在对话框本体的，等它放完再挪一次（父级效果晚于子级，再隔一拍更稳）。
  React.useEffect(() => {
    if (!rootProps.opened || initialFocus !== 'dialog') return
    let inner = 0
    const outer = window.setTimeout(() => {
      inner = window.setTimeout(() => {
        scrollRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
      }, 0)
    }, 0)
    return () => {
      window.clearTimeout(outer)
      window.clearTimeout(inner)
    }
  }, [rootProps.opened, initialFocus])

  const titleElement = title ? <Modal.Title>{title}</Modal.Title> : null
  return (
    <Modal.Root {...rootProps} className={rootClassName} classNames={mergedClassNames} radius={radius} zIndex={zIndex}>
      {withOverlay ? <Modal.Overlay {...overlayProps} /> : null}
      <Modal.Content radius={radius} data-testid={testId} {...frozenAnchors}>
        {title || withCloseButton ? (
          <Modal.Header>
            {header ? header(titleElement) : titleElement}
            {withCloseButton ? <Modal.CloseButton {...closeButtonProps} /> : null}
          </Modal.Header>
        ) : null}
        <Modal.Body>
          {/* 中间内容区：左右撑到弹窗边（滚动条贴边、输入框的焦点环不被裁），内边距照旧由 --mb-padding 给。
              innerScroll 时它本身也是一列：弹窗只有 max-height、高度不确定，内容里写 max-h-full 解析不出来，
              只能靠 flex 列把高度分下去。默认不成列——成列后内容里自带滚动的段落（如花钱确认的勾选清单）会被压扁。 */}
          <div
            ref={scrollRef}
            data-design-modal-scroll={innerScroll ? 'inner' : 'block'}
            className={cn(
              '-mx-[var(--mb-padding,var(--mantine-spacing-md))] min-h-0 flex-1 overflow-y-auto overscroll-contain px-[var(--mb-padding,var(--mantine-spacing-md))]',
              innerScroll && 'flex flex-col',
            )}
          >
            {children}
          </div>
          {actions ? <div data-design-modal-actions className="shrink-0 pt-3">{actions}</div> : null}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  )
}
