import type { JSX } from 'react'
import { IconCards, IconFolderPlus, IconRoute, IconX } from '../../../vendor/tablerIcons'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../utils/cn'
import { SelectionToolbarFrame } from './SelectionToolbarFrame'
import { ToolbarButton, ToolbarIconButton } from '../nodes/NodeFloatingToolbar'
import { CANVAS_LAYER } from '../reactFlow/canvasLayerOrder'

type CanvasSelectionToolbarProps = {
  selectedCount: number
  transform: string
  maxWidth?: number
  /** 选中的节点里已经出图的张数——不足 2 张就没有联系表可拼，钮直接不出现（不给点了才说不行）。 */
  contactSheetCount: number
  onGroupSelectedNodes: () => void
  onBuildContactSheet: () => void
  onSaveWorkflow: () => void
  onClearSelection: () => void
}

export function CanvasSelectionToolbar({
  selectedCount,
  transform,
  maxWidth,
  contactSheetCount,
  onGroupSelectedNodes,
  onBuildContactSheet,
  onSaveWorkflow,
  onClearSelection,
}: CanvasSelectionToolbarProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <SelectionToolbarFrame
      className="generation-canvas-v2__selection-toolbar absolute max-w-[760px]"
      zIndex={CANVAS_LAYER.selectionToolbar}
      transform={transform}
      maxWidth={maxWidth}
      ariaLabel={t('generationCommon.selection.aria')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className={cn('pl-1.5 pr-1 text-nomi-ink-60 text-body-sm whitespace-nowrap')}>
        {t('generationCommon.selection.count', { count: selectedCount })}
      </span>
      <span className={cn('w-px h-4 bg-nomi-line')} />
      {/* 常用的在前：编组是这条浮条最主要的去处，其次总览图、存流程，取消选择放最后。 */}
      <ToolbarButton
        label={t('generationCommon.selection.shortGroup')}
        title={t('generationCommon.selection.group')}
        ariaLabel={t('generationCommon.selection.group')}
        icon={<IconFolderPlus size={16} />}
        onClick={onGroupSelectedNodes}
      />
      {contactSheetCount >= 2 ? (
        <ToolbarButton
          label={t('generationCommon.contactSheet.shortAction')}
          title={t('generationCommon.contactSheet.action', { count: contactSheetCount })}
          ariaLabel={t('generationCommon.contactSheet.action', { count: contactSheetCount })}
          icon={<IconCards size={16} stroke={1.6} />}
          onClick={onBuildContactSheet}
        />
      ) : null}
      <ToolbarButton
        label={t('generationCommon.selection.shortSaveWorkflow')}
        title={t('generationCommon.selection.saveWorkflow')}
        ariaLabel={t('generationCommon.selection.saveWorkflow')}
        icon={<IconRoute size={16} />}
        onClick={onSaveWorkflow}
      />
      <ToolbarIconButton
        title={t('generationCommon.selection.clear')}
        ariaLabel={t('generationCommon.selection.clear')}
        icon={<IconX size={16} />}
        onClick={onClearSelection}
      />
    </SelectionToolbarFrame>
  )
}
