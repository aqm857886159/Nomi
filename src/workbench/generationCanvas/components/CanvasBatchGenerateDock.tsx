import { IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { CanvasBulkModelSelect, type CanvasApplyModelInput } from './CanvasBulkModelSelect'
import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'
import { CanvasProductionConcurrencySelect, CanvasProductionRunButton } from './CanvasProductionControls'

export function CanvasBatchGenerateDock(props: {
  eligibleIds: readonly string[]
  executionGroups: readonly CanvasGenerationExecutionGroup[]
  concurrency: number
  setConcurrency: (value: number) => void
  generate: () => void
  applyModel: (input: CanvasApplyModelInput) => void
  onDismiss: () => void
  timelineCollapsed: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const eligibleCount = props.eligibleIds.length
  return (
    <div
      className={cn(
        'generation-canvas-v2__production-dock',
        'absolute left-1/2 z-[9] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 overflow-x-auto px-2 py-1.5',
        props.timelineCollapsed ? 'bottom-16' : 'bottom-4',
        'rounded-full border border-nomi-line bg-nomi-paper/[0.96] shadow-nomi-md pointer-events-auto',
      )}
      data-batch-dock="true"
      // 常驻底部：选择浮条得让开这一块（量法见 reactFlow/useCanvasBottomDockRects.ts）。
      data-canvas-bottom-dock="true"
      role="toolbar"
      aria-label={t('generationCommon.production.aria')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {props.executionGroups.map((group) => (
        <CanvasBulkModelSelect
          key={`${group.executionKind}:${group.requiredMode}`}
          group={group}
          peerGroups={props.executionGroups}
          onApplyModel={props.applyModel}
        />
      ))}
      <CanvasProductionRunButton scope="all" count={eligibleCount} onClick={props.generate} />
      <CanvasProductionConcurrencySelect value={props.concurrency} onChange={props.setConcurrency} />
      <span className={cn('w-px h-4 bg-nomi-line')} aria-hidden="true" />
      <WorkbenchIconButton
        size="sm"
        className="shrink-0"
        label={t('generationCommon.production.dismiss')}
        icon={<IconX size={16} />}
        onClick={props.onDismiss}
      />
    </div>
  )
}
