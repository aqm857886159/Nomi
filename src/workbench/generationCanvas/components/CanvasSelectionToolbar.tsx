import type { JSX } from 'react'
import { IconCards, IconFolderMinus, IconFolderPlus, IconRoute, IconX } from '../../../vendor/tablerIcons'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasBulkModelSelect, type CanvasApplyModelInput } from './CanvasBulkModelSelect'
import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'
import { CanvasProductionConcurrencySelect, CanvasProductionRunButton } from './CanvasProductionControls'
import { SelectionToolbarFrame } from './SelectionToolbarFrame'
import { ToolbarButton } from '../nodes/NodeFloatingToolbar'

type CanvasSelectionToolbarProps = {
  selectedCount: number
  selectedGroupCount: number
  transform: string
  maxWidth?: number
  eligibleCount: number
  executionGroups: CanvasGenerationExecutionGroup[]
  concurrency: number
  /** 选中的节点里已经出图的张数——不足 2 张就没有联系表可拼，钮直接不出现（不给点了才说不行）。 */
  contactSheetCount: number
  onConcurrencyChange: (value: number) => void
  onGenerate: () => void
  onApplyModel: (input: CanvasApplyModelInput) => void
  onGroupSelectedNodes: () => void
  onUngroupSelectedNodes: () => void
  onBuildContactSheet: () => void
  onSaveWorkflow: () => void
  onClearSelection: () => void
}

export function CanvasSelectionToolbar({
  selectedCount,
  selectedGroupCount,
  transform,
  maxWidth,
  eligibleCount,
  executionGroups,
  concurrency,
  contactSheetCount,
  onConcurrencyChange,
  onGenerate,
  onApplyModel,
  onGroupSelectedNodes,
  onUngroupSelectedNodes,
  onBuildContactSheet,
  onSaveWorkflow,
  onClearSelection,
}: CanvasSelectionToolbarProps): JSX.Element {
  const { t } = useTranslation()
  const groupSelected = selectedGroupCount > 0
  return (
    <SelectionToolbarFrame
      className="generation-canvas-v2__selection-toolbar absolute z-[11] max-w-[760px]"
      transform={transform}
      maxWidth={maxWidth}
      ariaLabel={t('generationCommon.selection.aria')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className={cn('pl-1.5 pr-1 text-nomi-ink-60 text-body-sm whitespace-nowrap')}>
        {t('generationCommon.selection.count', { count: selectedCount })}
      </span>
      {!groupSelected ? executionGroups.map((group) => (
        <CanvasBulkModelSelect
          key={`${group.executionKind}:${group.requiredMode}`}
          group={group}
          peerGroups={executionGroups}
          onApplyModel={onApplyModel}
        />
      )) : null}
      {!groupSelected ? <CanvasProductionRunButton scope="selection" count={eligibleCount} onClick={onGenerate} /> : null}
      {!groupSelected ? <CanvasProductionConcurrencySelect value={concurrency} onChange={onConcurrencyChange} /> : null}
      <span className={cn('w-px h-4 bg-nomi-line')} />
      {contactSheetCount >= 2 ? (
        <ToolbarButton
          dataContactSheet="true"
          label={t('generationCommon.contactSheet.shortAction')}
          title={t('generationCommon.contactSheet.action', { count: contactSheetCount })}
          ariaLabel={t('generationCommon.contactSheet.action', { count: contactSheetCount })}
          icon={<IconCards size={16} stroke={1.6} />}
          onClick={onBuildContactSheet}
        />
      ) : null}
      {selectedGroupCount > 0 ? (
        <ToolbarButton
          label={t('generationCommon.selection.shortUngroup')}
          title={t('generationCommon.selection.ungroup')}
          ariaLabel={t('generationCommon.selection.ungroup')}
          icon={<IconFolderMinus size={16} />}
          onClick={onUngroupSelectedNodes}
        />
      ) : (
        <ToolbarButton
          label={t('generationCommon.selection.shortGroup')}
          title={t('generationCommon.selection.group')}
          ariaLabel={t('generationCommon.selection.group')}
          icon={<IconFolderPlus size={16} />}
          onClick={onGroupSelectedNodes}
        />
      )}
      <ToolbarButton
        label={t('generationCommon.selection.shortSaveWorkflow')}
        title={t('generationCommon.selection.saveWorkflow')}
        ariaLabel={t('generationCommon.selection.saveWorkflow')}
        icon={<IconRoute size={16} />}
        onClick={onSaveWorkflow}
      />
      <WorkbenchIconButton
        size="sm"
        className="shrink-0"
        label={t('generationCommon.selection.clear')}
        icon={<IconX size={16} />}
        onClick={onClearSelection}
      />
    </SelectionToolbarFrame>
  )
}
