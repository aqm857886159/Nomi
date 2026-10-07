import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfoCircle, IconCopy } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { toolbarButtonClass } from './toolbarButtonClass'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { NodeLockBadge } from './NodeLockBadge'
import { nextFloatingToolbarPlacement, type FloatingToolbarPlacement } from './floatingToolbarClamp'
import { useViewport } from '@xyflow/react'
import { logRendererCrash } from '../../../desktop/rendererLog'

// 节点浮动工具栏的**单一共享实现**（P1 收口）：图片编辑 / 视频抽帧 / 全景 / 下载三+条以前是三份
// 几乎一字不差的拷贝、且各自带一堆 token 违规（rgba 硬编码 / gap-[7px] / 图标 16/1.8…）。这里一次性
// 做成 token 合规的容器 + 按钮原子，所有浮条改用它。规范见 docs/design/nomi-design-system.md §2/§6。
//
// 几何：浮在节点正上方、反向缩放抵消画布 zoom（恒定屏幕尺寸，缩放也看得清），transform-origin 贴节点底边。

const ICON = { size: 16, stroke: 1.6 } as const

/**
 * 浮条外壳：定位 + 反向缩放 + token 合规容器，外加**锁的唯一家**。
 *
 * `lockNodeId` 必填（不是可选）：浮条有五条（图片编辑 / 视频抽帧 / 全景 / 下载 / 空节点变体）
 * 加一条产物浮条，锁要「一功能一个家」就必须每条都答一次「你这条挂的是不是一个可锁的节点」。
 * 写成可选，下一条浮条忘了传就是静默少一把锁——让编译器拦（R28），别留给走查。
 * `null` 是合法的一档：手艺产物浮条挂的不是生成节点，它没有锁。
 */
export function FloatingToolbarShell(props: { ariaLabel: string; lockNodeId: string | null; children: React.ReactNode }): JSX.Element {
  return (
    <FloatingToolbarBoundary label={props.ariaLabel}>
      <FloatingToolbarFrame {...props} />
    </FloatingToolbarBoundary>
  )
}

/**
 * 浮条的故障隔离：浮条是挂在节点上的附件，它渲染出错只该让这一条浮条消失，不该把整块画布带崩——
 * 画布外层只有「React Flow 画布」那一个 chunk 边界，节点里任何渲染错都会冒到那里，整块画布换成「加载失败」
 * （2026-10-06 浮条测量无限更新就是这样把画布带走的）。不吞：照样写进渲染层崩溃日志，并在原处留
 * `data-floating-toolbar-failed` 记号给走查断言；
 * 浮条只在选中时挂载，取消选中再选中就是一次干净的重试。
 */
class FloatingToolbarBoundary extends React.Component<{ label: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logRendererCrash('floating-toolbar-boundary', error, info.componentStack, { boundary: this.props.label })
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    // 留一个看不见的记号：走查 / 验收能当场认出「浮条被兜底藏了」，而不是只看到「浮条没出现」去猜
    // （2026-10-07 CI 画布验收就是这样被骗了一轮：测量环转到 #185，兜底静默吞掉，验收只报找不到浮条）。
    return <span hidden data-floating-toolbar-failed={this.props.label} />
  }
}

function FloatingToolbarFrame({ ariaLabel, lockNodeId, children }: { ariaLabel: string; lockNodeId: string | null; children: React.ReactNode }): JSX.Element {
  // 反向缩放用的必须是**此刻贴在 DOM 上的那个缩放**——React Flow 的 transform（唯一真相，见 canvasViewportScale）。
  // 不许读 workbenchStore 里「记住的视角」：那份只在手势 / 动画结束时才写，打开项目摆全貌那一刻还停在 1，
  // 和屏幕上的 2.1 倍差出一倍多，下面的测量环就是被它带进无限更新的（React #185，整块画布崩）。
  // 订的是**整个视口**（平移 + 缩放，框架自带 useViewport 按 x/y/zoom 浅比较），不只是缩放：浮条的屏幕位置随平移变，
  // 平移完不重渲就不重量，贴边时会停在旧位置被舞台裁掉（2026-10-07 CI 画布验收「节点贴左边」抓到；
  // 旧代码靠订 categoryViewports 整个对象、平移结束换新对象才顺带重渲，是碰巧的）。浮条只在单选时挂一条，每帧多量一次可以接受。
  const { zoom: canvasZoom } = useViewport()
  const shellRef = React.useRef<HTMLDivElement>(null)
  // 浮条整条留在可见画布里（上下左右夹住，让开右侧面板 / 顶栏）；舞台太窄就限宽折行。
  // 位移与宽度只由测量环决定，规则与收敛性归 nextFloatingToolbarPlacement（一次测量就是不动点）。
  const [placement, setPlacement] = React.useState<FloatingToolbarPlacement>({ shiftX: 0, shiftY: 0, maxWidth: undefined })
  // 窗口 / 面板拖宽拖窄时舞台尺寸变了，但 React 不一定重渲：舞台一变就推一次渲染，让下面那次测量重新跑。
  const [, setStageTick] = React.useState(0)
  React.useEffect(() => {
    const stage = shellRef.current?.closest<HTMLElement>('.generation-canvas-v2__stage')
    if (!stage || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setStageTick((tick) => tick + 1))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])
  // 刻意不写依赖：画布平移、缩放、节点落位、窗口缩放都会改浮条的屏幕位置，每次渲染后量一次最省心
  // （平移 / 缩放由上面的 useViewport 推渲染，舞台尺寸由 ResizeObserver 推，节点落位由节点自己重渲推）；
  // nextFloatingToolbarPlacement 返回 null 就是已收敛——同一帧至多三次提交。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const shell = shellRef.current
    const stage = shell?.closest<HTMLElement>('.generation-canvas-v2__stage')
    if (!shell || !stage) return
    const next = nextFloatingToolbarPlacement({
      rect: shell.getBoundingClientRect(),
      // 带小数的布局宽（border-box，不含 transform）：offsetWidth 取整，净缩放会带噪声。
      layoutWidth: Number.parseFloat(getComputedStyle(shell).width),
      stage: stage.getBoundingClientRect(),
      applied: placement,
    })
    if (next) setPlacement(next)
  })
  const zoom = canvasZoom || 1
  return (
    <div
      ref={shellRef}
      className={cn(
        'absolute left-1/2 bottom-[calc(100%+40px)] group-has-[[data-node-inline-status]_[data-generation-status]]/node:bottom-[calc(100%+72px)] z-[12]',
        'inline-flex w-max flex-wrap items-center justify-center gap-1 min-h-9 px-1.5 py-1',
        'border border-nomi-line rounded-nomi',
        'bg-nomi-paper shadow-nomi-md',
        // 画布上**任何**节点被拖动时隐身（用户 2026-08-08 提、08-09 扩到全画布）：工具条跟着飞、
        // 或杵在原地看着别人被拖走，都脏。用 visibility 不卸载——松手要原样回来，也不丢按钮忙态。
        // 状态源见 canvasDraggingFlag（stage 上的 data-dragging）。
        'group-data-[dragging=true]/canvas:invisible',
      )}
      data-node-floating-toolbar="true"
      style={{ maxWidth: placement.maxWidth, transform: `translate(${placement.shiftX / zoom}px, ${placement.shiftY / zoom}px) translateX(-50%) scale(${1 / zoom})`, transformOrigin: 'bottom center' }}
      role="toolbar"
      aria-label={ariaLabel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {lockNodeId ? (
        <>
          <NodeLockBadge nodeId={lockNodeId} />
          <ToolbarDivider />
        </>
      ) : null}
      {children}
    </div>
  )
}

type ToolbarButtonProps = {
  icon: React.ReactNode
  label?: string
  accent?: boolean
  disabled?: boolean
  ariaBusy?: boolean
  title?: string
  ariaLabel?: string
  className?: string
  /** 走查 / 单测按它找这颗钮（`data-toolbar-action`），不靠文案。 */
  actionId?: string
  onClick?: (event: React.MouseEvent) => void
}

/** 带文字的工具栏按钮（定妆 / 裁剪 / 下载 / 抽首帧…）。 */
export function ToolbarButton({ icon, label, accent, disabled, ariaBusy, title, ariaLabel, className, actionId, onClick }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      data-toolbar-action={actionId}
      className={cn(toolbarButtonClass(accent), 'gap-1.5 px-3', accent && 'font-medium', className)}
      title={title}
      aria-label={ariaLabel ?? label}
      aria-busy={ariaBusy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

/** 仅图标的工具栏按钮（方形）。 */
export function ToolbarIconButton({ icon, disabled, title, ariaLabel, actionId, onClick }: Omit<ToolbarButtonProps, 'label' | 'accent'>): JSX.Element {
  return (
    <button
      type="button"
      data-toolbar-action={actionId}
      className={cn(toolbarButtonClass(false), 'w-8')}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  )
}

/** 竖分隔线。 */
export function ToolbarDivider(): JSX.Element {
  return <span className="w-px h-5 bg-nomi-line" aria-hidden />
}

/**
 * 「生成记录」按钮。原先住在卡片右上角，是 `bg-nomi-paper/[0.82]` 半透明**常驻**盖在图上的
 * （条件是 hasResult，跟选中/hover 无关）——设计系统 §1.5：动作不许压在内容上。
 * 2026-08-04 迁进浮动工具栏的「看和拿」组：工具栏浮在卡片**上方**，不遮画面。
 *
 * ⚠️ 这条工具栏是「**选中**才出」，不是「hover 才出」——门是
 * `selected && !isMultiSelectActive && !readOnly`（见 BaseGenerationNode）。
 * 光把鼠标移上去不出现，得单击选中节点。最初这里写的是「hover 浮条」，
 * 2026-08-04 对着渲染条件复核时改正——注释写错会让下一个人按错的前提做判断。
 *
 * 它是 ProvenancePanel 的**唯一入口**，所以只能搬不能删。一份定义、**四处**复用：
 * 图片与图编辑（同一条 ImageQuickActionsToolbar）/ 视频（NodeVideoFrameToolbar）/
 * 全景（BaseGenerationNode）/ 其余结果（NodeResultDownloadButton）。不留近似拷贝（P1）。
 */
export function ToolbarProvenanceButton({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <ToolbarIconButton
      icon={<IconInfoCircle size={ICON.size} stroke={ICON.stroke} />}
      title={t('generationCommon.provenance.actionTitle')}
      ariaLabel={t('generationCommon.provenance.view')}
      onClick={onOpen}
    />
  )
}

export function ToolbarDuplicateVariantButton({ nodeId }: { nodeId: string }): JSX.Element {
  const { t } = useTranslation()
  const duplicateAsVariant = useGenerationCanvasStore((state) => state.duplicateNodeForRegeneration)
  return (
    <ToolbarIconButton
      icon={<IconCopy size={ICON.size} stroke={ICON.stroke} />}
      title={t('generationCommon.node.duplicateVariant')}
      ariaLabel={t('generationCommon.node.duplicateVariant')}
      // 副本落在屏外时由画布边缘提示指路；不再替用户把画布挪过去（2026-09-25「程序不再主动平移画布」）。
      onClick={() => { duplicateAsVariant(nodeId) }}
    />
  )
}

// 「重拍这镜」按钮 2026-10-06 按用户拍板删除：对成功的镜头它和节点 ↑「再出一版」是同一件事，两个按钮分不清；
// 失败镜头的「重试」（NodeErrorReport → useProductionNodeRetry）走的仍是 reworkProductionShot，停下的批次照样能接着跑。

export function ToolbarVariantProvenanceActions({ nodeId, onOpenProvenance }: { nodeId: string; onOpenProvenance: () => void }): JSX.Element {
  return (
    <>
      <ToolbarDuplicateVariantButton nodeId={nodeId} />
      <ToolbarProvenanceButton onOpen={onOpenProvenance} />
    </>
  )
}

export function EmptyNodeVariantToolbar({ nodeId, visible }: { nodeId: string; visible: boolean }): JSX.Element | null {
  const { t } = useTranslation()
  if (!visible) return null
  return (
    <FloatingToolbarShell ariaLabel={t('generationCommon.node.duplicateVariant')} lockNodeId={nodeId}>
      <ToolbarDuplicateVariantButton nodeId={nodeId} />
    </FloatingToolbarShell>
  )
}

/** 工具栏内统一图标尺寸（§6 节点浮动工具栏：16/1.6）。 */
export const TOOLBAR_ICON = ICON
