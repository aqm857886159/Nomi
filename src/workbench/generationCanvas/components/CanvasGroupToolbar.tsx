import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowsHorizontal,
  IconArrowsVertical,
  IconDownload,
  IconFolderMinus,
  IconLayoutGrid,
  IconPlayerPlay,
  IconStack2,
  IconTimeline,
} from '../../../vendor/tablerIcons'
import { cn } from '../../../utils/cn'
import type { WorkbenchMenuIcon, WorkbenchMenuNode } from '../../../design/menu'
import type { NodeGroup } from '../model/generationCanvasTypes'
import type { GroupArrangeMode } from '../model/groupArrange'
import { GROUP_COLOR_IDS, normalizeGroupColor, groupColorStyle, type GroupColorId } from '../model/groupColor'
import { ToolbarActionMenu } from '../nodes/ToolbarActionMenu'
import { ToolbarButton, ToolbarDivider, ToolbarIconButton, TOOLBAR_ICON } from '../nodes/NodeFloatingToolbar'

export type CanvasGroupToolbarProps = {
  group: NodeGroup
  canvasZoom: number
  memberCount: number
  canGenerate: boolean
  canSendToTimeline: boolean
  canDownload: boolean
  onGenerate: () => void
  onSendToTimeline: () => void
  onDissolve: () => void
  onArrange: (mode: GroupArrangeMode) => void
  onColor: (color: GroupColorId) => void
  onDownload: () => void
}

const iconProps = { size: TOOLBAR_ICON.size, stroke: TOOLBAR_ICON.stroke } as const

/** The color swatch is a menu icon, so the selected group color remains visible at all times. */
function colorMenuIcon(color: GroupColorId): WorkbenchMenuIcon {
  return function GroupColorSwatch(): JSX.Element {
    const style = groupColorStyle(color)
    return (
      <span
        className="size-3 rounded-full border border-nomi-paper shadow-sm"
        style={{ backgroundColor: style.markerColor }}
        aria-hidden="true"
      />
    )
  }
}

export function CanvasGroupToolbar({
  group,
  canvasZoom,
  memberCount,
  canGenerate,
  canSendToTimeline,
  canDownload,
  onGenerate,
  onSendToTimeline,
  onDissolve,
  onArrange,
  onColor,
  onDownload,
}: CanvasGroupToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const selectedColor = normalizeGroupColor(group.color)
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
  const colorStyle = groupColorStyle(selectedColor)

  return (
    <div
      className={cn(
        'generation-canvas-v2__group-toolbar absolute left-1/2 top-[-58px] z-[12] -translate-x-1/2',
        'inline-flex w-max flex-wrap items-center justify-center gap-1 min-h-9 px-1.5 py-1',
        'rounded-nomi border border-nomi-line bg-nomi-paper shadow-nomi-md',
      )}
      data-group-toolbar="true"
      data-group-toolbar-layout="libtv"
      aria-label={t('generationCommon.canvas.group.toolbarAria', { name: group.name })}
      role="toolbar"
      style={{ transform: `translateX(-50%) scale(${1 / (canvasZoom || 1)})`, transformOrigin: 'bottom center' }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className="inline-flex min-h-8 items-center gap-1.5 px-2 text-body-sm font-medium leading-none text-nomi-ink"
        data-group-toolbar-count="true"
      >
        <IconStack2 {...iconProps} aria-hidden="true" />
        <span>{group.name}</span>
        <span className="text-nomi-ink-60 tabular-nums">· {memberCount}</span>
      </span>
      <ToolbarActionMenu
        id="group-color"
        icon={
          <span
            className="size-3.5 rounded-full border-2 border-nomi-paper shadow-sm"
            style={{ backgroundColor: colorStyle.markerColor }}
            aria-hidden="true"
          />
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
      <ToolbarButton
        icon={<IconPlayerPlay {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarGenerate')}
        accent
        disabled={!canGenerate}
        onClick={onGenerate}
      />
      <ToolbarButton
        icon={<IconTimeline {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarTimeline')}
        title={t('generationCommon.canvas.group.toolbarTimeline')}
        disabled={!canSendToTimeline}
        onClick={onSendToTimeline}
      />
      <ToolbarButton
        icon={<IconFolderMinus {...iconProps} />}
        label={t('generationCommon.canvas.group.toolbarDissolve')}
        title={t('generationCommon.canvas.group.toolbarDissolve')}
        onClick={onDissolve}
      />
      <ToolbarDivider />
      <ToolbarIconButton
        icon={<IconDownload {...iconProps} />}
        title={t('generationCommon.canvas.group.toolbarDownload')}
        ariaLabel={t('generationCommon.canvas.group.toolbarDownload')}
        disabled={!canDownload}
        onClick={onDownload}
      />
    </div>
  )
}
