import { IconFolderMinus, IconFolderPlus, IconLayoutGrid, IconRoute, IconX } from '../../../vendor/tablerIcons'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasBulkModelSelect, type CanvasApplyModelInput } from './CanvasBulkModelSelect'
import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'
import { CanvasProductionConcurrencySelect, CanvasProductionRunButton } from './CanvasProductionControls'
import { SelectionToolbarFrame } from './SelectionToolbarFrame'

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
      {executionGroups.map((group) => (
        <CanvasBulkModelSelect
          key={`${group.executionKind}:${group.requiredMode}`}
          group={group}
          peerGroups={executionGroups}
          onApplyModel={onApplyModel}
        />
      ))}
      <CanvasProductionRunButton scope="selection" count={eligibleCount} onClick={onGenerate} />
      <CanvasProductionConcurrencySelect value={concurrency} onChange={onConcurrencyChange} />
      <span className={cn('w-px h-4 bg-nomi-line')} />
      {contactSheetCount >= 2 ? (
        <WorkbenchIconButton
          data-contact-sheet="true"
          size="sm"
          className="shrink-0"
          label={t('generationCommon.contactSheet.action', { count: contactSheetCount })}
          icon={<IconLayoutGrid size={16} />}
          onClick={onBuildContactSheet}
        />
      ) : null}
      {selectedGroupCount > 0 ? (
        <WorkbenchIconButton
          size="sm"
          className="shrink-0"
          label={t('generationCommon.selection.ungroup')}
          icon={<IconFolderMinus size={16} />}
          onClick={onUngroupSelectedNodes}
        />
      ) : (
        <WorkbenchIconButton
          size="sm"
          className="shrink-0"
          label={t('generationCommon.selection.group')}
          icon={<IconFolderPlus size={16} />}
          onClick={onGroupSelectedNodes}
        />
      )}
      <WorkbenchIconButton
        size="sm"
        className="shrink-0"
        label={t('generationCommon.selection.saveWorkflow')}
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
