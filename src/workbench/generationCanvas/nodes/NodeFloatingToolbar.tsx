import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconInfoCircle, IconChevronDown, IconCopy } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { FOCUS_GENERATION_NODE_EVENT } from './nodeSizing'

// 节点浮动工具栏的**单一共享实现**（P1 收口）：图片编辑 / 视频抽帧 / 全景 / 下载三+条以前是三份
// 几乎一字不差的拷贝、且各自带一堆 token 违规（rgba 硬编码 / gap-[7px] / 图标 16/1.8…）。这里一次性
// 做成 token 合规的容器 + 按钮原子，所有浮条改用它。规范见 docs/design/nomi-design-system.md §2/§6。
//
// 几何：浮在节点正上方、反向缩放抵消画布 zoom（恒定屏幕尺寸，缩放也看得清），transform-origin 贴节点底边。

const ICON = { size: 16, stroke: 1.6 } as const

/** 浮条外壳：定位 + 反向缩放 + token 合规容器。 */
export function FloatingToolbarShell({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }): JSX.Element {
  const canvasZoom = useGenerationCanvasStore((state) => state.canvasZoom)
  return (
    <div
      className={cn(
        'absolute left-1/2 bottom-[calc(100%+16px)] z-[12]',
        'inline-flex items-center gap-1 min-h-9 px-1.5 py-1',
        'border border-nomi-line rounded-nomi',
        'bg-nomi-paper shadow-nomi-md',
        // 画布上**任何**节点被拖动时隐身（用户 2026-08-08 提、08-09 扩到全画布）：工具条跟着飞、
        // 或杵在原地看着别人被拖走，都脏。用 visibility 不卸载——松手要原样回来，也不丢按钮忙态。
        // 状态源见 canvasDraggingFlag（stage 上的 data-dragging）。
        'group-data-[dragging=true]/canvas:invisible',
      )}
      data-node-floating-toolbar="true"
      style={{ transform: `translateX(-50%) scale(${1 / (canvasZoom || 1)})`, transformOrigin: 'bottom center' }}
      role="toolbar"
      aria-label={ariaLabel}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}

const buttonBase = cn(
  'inline-flex items-center justify-center min-h-8 rounded-nomi-sm border-0 cursor-pointer',
  'text-body-sm leading-none whitespace-nowrap',
  'transition-colors duration-[var(--nomi-transition-fast)]',
  'disabled:opacity-45 disabled:cursor-wait',
)
const variantClass = (accent?: boolean) =>
  accent ? 'text-nomi-accent hover:bg-nomi-accent-soft' : 'bg-transparent text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink'

type ToolbarButtonProps = {
  icon: React.ReactNode
  label?: string
  accent?: boolean
  disabled?: boolean
  ariaBusy?: boolean
  title?: string
  ariaLabel?: string
  onClick?: (event: React.MouseEvent) => void
}

/** 带文字的工具栏按钮（定妆 / 裁剪 / 下载 / 抽首帧…）。 */
export function ToolbarButton({ icon, label, accent, disabled, ariaBusy, title, ariaLabel, onClick }: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={cn(buttonBase, 'gap-1.5 px-3', accent && 'font-medium', variantClass(accent))}
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
export function ToolbarIconButton({ icon, disabled, title, ariaLabel, onClick }: Omit<ToolbarButtonProps, 'label' | 'accent'>): JSX.Element {
  return (
    <button
      type="button"
      className={cn(buttonBase, 'w-8', variantClass(false))}
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

export type ToolbarMenuItem = {
  icon: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}

/** 分组下拉（切图▾ / 变换▾）：把低频同类动作收一处。向上展开（工具栏在节点上方，不挡节点），自带点外关闭。 */
export function ToolbarMenu({ icon, label, items, disabled }: { icon: React.ReactNode; label: string; items: ToolbarMenuItem[]; disabled?: boolean }): JSX.Element {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!open) return undefined
    const onDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    // 捕获阶段：浮条外壳 onPointerDown stopPropagation（防画布平移）会截断冒泡，导致点另一个菜单按钮时
    // 本菜单的「点外关闭」收不到事件 → 两个下拉同时开、互相遮挡。捕获在 stopPropagation 之前触发，绕过它。
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])
  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        className={cn(buttonBase, 'gap-1 px-3', variantClass(false), open && 'bg-nomi-ink-05 text-nomi-ink')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        <span>{label}</span>
        <IconChevronDown size={13} stroke={1.6} aria-hidden />
      </button>
      {open ? (
        <div
          className={cn(
            // 向下展开：工具栏浮在节点上方，向下就是节点本体（空间充足），避开「靠画布顶部时向上被视口裁掉」。
            'absolute left-1/2 -translate-x-1/2 top-[calc(100%+6px)] z-[13]',
            'inline-flex flex-col gap-0.5 min-w-max p-1',
            'border border-nomi-line rounded-nomi bg-nomi-paper shadow-nomi-md',
          )}
          role="menu"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={cn(buttonBase, 'gap-2 px-2.5 justify-start w-full', variantClass(false))}
              disabled={item.disabled}
              onClick={() => { item.onClick(); setOpen(false) }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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
 * 图片与图编辑（同一条 NodeImageEditToolbar）/ 视频（NodeVideoFrameToolbar）/
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
      onClick={() => {
        const duplicate = duplicateAsVariant(nodeId)
        if (duplicate && typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent(FOCUS_GENERATION_NODE_EVENT, { detail: { nodeId: duplicate.id } }))
        }
      }}
    />
  )
}

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
    <FloatingToolbarShell ariaLabel={t('generationCommon.node.duplicateVariant')}>
      <ToolbarDuplicateVariantButton nodeId={nodeId} />
    </FloatingToolbarShell>
  )
}

/** 工具栏内统一图标尺寸（§6 节点浮动工具栏：16/1.6）。 */
export const TOOLBAR_ICON = ICON
