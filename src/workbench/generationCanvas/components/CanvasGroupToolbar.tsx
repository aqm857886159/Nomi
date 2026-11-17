import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconDownload,
  IconFolderMinus,
  IconLayersSubtract,
  IconLayoutGrid,
  IconPencil,
  IconPlayerPlay,
  IconStack2,
  IconTimeline,
  IconTrash,
} from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { WorkbenchMenuIcon, WorkbenchMenuNode } from '../../../design/menu'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { GroupArrangeMode } from '../model/groupArrange'
import { GROUP_COLOR_IDS, resolveGroupColor, groupColorClass, type GroupColorId } from '../model/groupColor'
import { resolveGroupToolbarShiftX, type GroupToolbarPlacement } from './groupToolbarPlacement'
import { ToolbarActionMenu } from '../nodes/ToolbarActionMenu'
import { ToolbarButton, ToolbarDivider, ToolbarIconButton, TOOLBAR_ICON } from '../nodes/NodeFloatingToolbar'
import { CANVAS_LAYER } from '../reactFlow/canvasLayerOrder'
import { groupFrameLabel, isStoryboardGroup } from './groupFrameLabel'

export type CanvasGroupToolbarProps = {
  group: NodeGroup
  canvasZoom: number
  /** 放在组框的哪一侧（上 / 下 / 框内贴顶），由 groupToolbarPlacement 按组在舞台里的位置算出。 */
  placement: GroupToolbarPlacement
  /** 组框在舞台里的水平位置：工具条要靠它把自己拉回舞台内（组框比视口宽、贴边时中线会在舞台外）。 */
  horizontal: GroupToolbarHorizontal
  memberCount: number
  canGenerate: boolean
  /** 「生成整组」置灰时说清为什么（C1 / C4）；可生成时不给。 */
  generateDisabledReason?: string
  canSendToTimeline: boolean
  canDownload: boolean
  onGenerate: () => void
  onSendToTimeline: () => void
  onDissolve: () => void
  onArrange: (mode: GroupArrangeMode) => void
  onColor: (color: GroupColorId) => void
  onDownload: () => void
  /** 改名 / 说明、折叠成卡、删除：直接摆图标，与框边右键菜单同一个执行口。 */
  onEdit: () => void
  onCollapse: () => void
  onDelete: () => void
}

export type GroupToolbarHorizontal = { frameLeft: number; frameWidth: number; offsetX: number; stageWidth: number }

/** 调用方（hook）给的版本：还没有组框位置，placement 由投影层按框的位置补上。 */
export type CanvasGroupToolbarModel = Omit<CanvasGroupToolbarProps, 'placement' | 'horizontal'> & { canvasOffsetX: number; canvasOffsetY: number; stageWidth: number; stageHeight: number }

const iconProps = { size: TOOLBAR_ICON.size, stroke: TOOLBAR_ICON.stroke } as const

/** The color swatch is a menu icon, so the selected group color remains visible at all times. */
function colorMenuIcon(color: GroupColorId): WorkbenchMenuIcon {
  return function GroupColorSwatch(): JSX.Element {
    return <span className={cn('size-3 rounded-full', groupColorClass(color).dot)} aria-hidden="true" />
  }
}

export function CanvasGroupToolbar({
  group,
  canvasZoom,
  placement,
  horizontal,
  memberCount,
  canGenerate,
  generateDisabledReason,
  canSendToTimeline,
  canDownload,
  onGenerate,
  onSendToTimeline,
  onDissolve,
  onArrange,
  onColor,
  onDownload,
  onEdit,
  onCollapse,
  onDelete,
}: CanvasGroupToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const groupLabel = groupFrameLabel(t, { name: group.name, storyboard: isStoryboardGroup(group), memberCount, previewCount: null })
  const [toolbarWidth, setToolbarWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const measure = () => setToolbarWidth(element.offsetWidth)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  const shiftX = resolveGroupToolbarShiftX({ ...horizontal, zoom: canvasZoom, toolbarWidth })
  const selectedColor = resolveGroupColor(group.colorToken)
  const colorItems: WorkbenchMenuNode[] = [
    {
      kind: 'radio',
      id: 'group-colors',
      value: selectedColor,
      onValueChange: (value) => {
        if ((GROUP_COLOR_IDS as readonly string[]).includes(value)) onColor(value as GroupColorId)
      },
      options: GROUP_COLOR_IDS.map((color) => ({
        id: `group-color-${color}`,
        value: color,
        label: t(
          `generationCommon.canvas.group.color${color[0].toUpperCase()}${color.slice(1)}` as 'generationCommon.canvas.group.colorOcean',
        ),
        icon: colorMenuIcon(color),
      })),
    },
  ]
  const arrangeItems: WorkbenchMenuNode[] = [
    {
      id: 'group-arrange-grid',
      icon: IconLayoutGrid,
      label: t('generationCommon.canvas.group.toolbarArrangeGrid'),
      onSelect: () => onArrange('grid'),
    },
    {
      id: 'group-arrange-horizontal',
      icon: IconArrowsHorizontal,
      label: t('generationCommon.canvas.group.toolbarArrangeHorizontal'),
      onSelect: () => onArrange('horizontal'),
    },
    {
      id: 'group-arrange-vertical',
      icon: IconArrowsVertical,
      label: t('generationCommon.canvas.group.toolbarArrangeVertical'),
      onSelect: () => onArrange('vertical'),
    },
  ]
  const colorClass = groupColorClass(selectedColor)

  return (
    <div
      ref={rootRef}
      className={cn(
        'generation-canvas-v2__group-toolbar absolute left-1/2 -translate-x-1/2',
        'inline-flex w-max flex-wrap items-center justify-center gap-1 min-h-9 px-1.5 py-1',
        'rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md',
      )}
      data-group-toolbar="true"
      aria-label={t('generationCommon.canvas.group.toolbarAria', { name: group.name })}
      role="toolbar"
      data-group-toolbar-side={placement.side}
      style={{
        zIndex: CANVAS_LAYER.groupToolbar,
        left: `calc(50% + ${shiftX}px)`,
        transform: `translateX(-50%) scale(${1 / (canvasZoom || 1)})`,
        // 外壳（投影层里和组框同大的锚点）：above 从框上沿往上抬，below 从框下沿往下放，inside 从框上沿往下放。
        ...(placement.side === 'above'
          ? { bottom: `calc(100% + ${placement.offset}px)`, transformOrigin: 'bottom center' }
          : placement.side === 'below'
            ? { top: `calc(100% + ${placement.offset}px)`, transformOrigin: 'top center' }
            : { top: placement.offset, transformOrigin: 'top center' }),
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className="inline-flex min-h-8 items-center gap-1.5 px-2 text-body-sm font-medium leading-none text-nomi-ink"
        data-group-toolbar-count="true"
      >
        <IconStack2 {...iconProps} aria-hidden="true" />
        {/* 与框头同一显示函数：分镜组「分镜 · 名 · N 镜」，普通组「名 · N 个」。 */}
        <span>{groupLabel.title}</span>
        <span className="text-nomi-ink-60 tabular-nums">· {groupLabel.count}</span>
      </span>
      <ToolbarActionMenu
        id="group-color"
        icon={
          <span className={cn('size-3.5 rounded-full', colorClass.dot)} aria-hidden="true" />
        }
        label={t('generationCommon.canvas.group.toolbarColor')}
        menuLabel={t('generationCommon.canvas.group.toolbarColor')}
        items={colorItems}
      />
      <ToolbarActionMenu
        id="group-arrange"
        icon={<IconLayoutGrid {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarArrange')}
        menuLabel={t('generationCommon.canvas.group.toolbarArrange')}
        items={arrangeItems}
      />
      <ToolbarDivider />
      {/* 禁用的 <button> 自己不触发 title（浏览器行为）→ 外层包一层承载原因（§1.6 C1）。 */}
      <span title={canGenerate ? undefined : generateDisabledReason} className="contents" data-group-generate-reason={canGenerate ? undefined : 'true'}>
        <ToolbarButton
          icon={<IconPlayerPlay {...iconProps} />}
          label={t('generationCommon.canvas.group.toolbarGenerate')}
          accent
          disabled={!canGenerate}
          onClick={onGenerate}
        />
      </span>
      <ToolbarButton
        icon={<IconTimeline {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarTimeline')}
        title={t('generationCommon.canvas.group.toolbarTimeline')}
        disabled={!canSendToTimeline}
        onClick={onSendToTimeline}
      />
      <ToolbarIconButton
        icon={<IconDownload {...iconProps} />}
        title={t('generationCommon.canvas.group.toolbarDownload')}
        ariaLabel={t('generationCommon.canvas.group.toolbarDownload')}
        disabled={!canDownload}
        onClick={onDownload}
      />
      <ToolbarIconButton
        icon={<IconPencil {...iconProps} />}
        title={t('generationCommon.canvas.group.menuEdit')}
        ariaLabel={t('generationCommon.canvas.group.menuEdit')}
        actionId="group-edit"
        onClick={onEdit}
      />
      <ToolbarIconButton
        icon={<IconLayersSubtract {...iconProps} />}
        title={t('generationCommon.canvas.group.menuCollapse')}
        ariaLabel={t('generationCommon.canvas.group.menuCollapse')}
        actionId="group-collapse"
        onClick={onCollapse}
      />
      {/* 解散、删除是这一排里最「重」的动作：常用的在前，它们放最右并用分隔线隔开，免得手滑。 */}
      <ToolbarDivider />
      <ToolbarButton
        icon={<IconFolderMinus {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarDissolve')}
        title={t('generationCommon.canvas.group.toolbarDissolve')}
        onClick={onDissolve}
      />
      <ToolbarIconButton
        icon={<IconTrash {...iconProps} />}
        title={t('generationCommon.canvas.group.menuDelete')}
        ariaLabel={t('generationCommon.canvas.group.menuDelete')}
        actionId="group-delete"
        onClick={onDelete}
      />
    </div>
  )
}
