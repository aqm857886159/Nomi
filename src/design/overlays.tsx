import React, { type JSX, type ReactNode } from 'react'
import { Modal, type ModalProps } from '@mantine/core'
import { cn } from '../utils/cn'
import { useModalInputLayer } from './modalInputLayer'
import { NOMI_OVERLAY_Z_INDEX } from './overlayLayers'

export type DesignModalProps = ModalProps & {
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
   * 挂在对话框本体（带 `role="dialog"` 的那一层）上的 `data-*` 锚点，给走查和工具认这张卡用。
   * Mantine 运行时经 `attributes.content` 支持，但 Modal 的类型把 `attributes` 关掉了，所以由外壳这一处转交。
   */
  contentAttributes?: Readonly<Record<`data-${string}`, string>>
  /**
   * 中间区的高度交给内容分（§3.5）：中间区成一列，内容根写 `flex min-h-0 flex-col`、里面那段长清单写
   * `min-h-0 overflow-y-auto`——清单先缩、单独滚，清单下面的东西（留言框、说明行）一直看得见。
   * 不传 = 中间区超高时整块滚（内容里自带滚动的段落保持原高，不会被压扁）。
   */
  innerScroll?: boolean
}

type ClassNamesObject = Partial<Record<'root' | 'overlay' | 'inner' | 'content' | 'header' | 'title' | 'close' | 'body', string>>

/**
 * 全产品弹窗的外壳。可用高度和滚动归属只在这里定（§3.5）：
 * 弹窗最高 = 窗口内容区减上下留白（Mantine 的 `--modal-content-max-height`，一处）；
 * 标题栏和决定栏（`actions`）不滚，中间内容区自己滚。弹窗自己不写高度上限、不在外层再套滚动。
 */
export function DesignModal({
  className,
  classNames,
  radius = 'sm',
  zIndex = NOMI_OVERLAY_Z_INDEX.dialog,
  actions,
  initialFocus = 'first-control',
  contentAttributes,
  innerScroll = false,
  children,
  ...props
}: DesignModalProps): JSX.Element {
  // 所有走 DesignModal 的弹层在这里一次登记：开着时工作区面不接键盘、粘贴、指针手势。
  useModalInputLayer(Boolean(props.opened))
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
    if (!props.opened || initialFocus !== 'dialog') return
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
  }, [props.opened, initialFocus])

  return (
    <Modal
      {...props}
      className={rootClassName}
      classNames={mergedClassNames}
      radius={radius}
      zIndex={zIndex}
      {...(contentAttributes ? { attributes: { content: contentAttributes } } as Record<string, unknown> : {})}
    >
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
    </Modal>
  )
}
