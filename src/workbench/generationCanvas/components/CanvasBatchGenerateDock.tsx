import { IconPlayerPlay, IconX } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchIconButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { formatGenerationCredits, type GenerationCostEstimate } from '../spend/generationCost'

const CONCURRENCY_OPTIONS = [1, 2, 4, 6, 8].map((value) => ({ value: String(value), label: String(value) }))

export function CanvasBatchGenerateDock(props: {
  eligibleIds: readonly string[]
  concurrency: number
  setConcurrency: (value: number) => void
  generate: () => void
  onDismiss: () => void
  timelineCollapsed: boolean
  costEstimate?: GenerationCostEstimate | null
}): JSX.Element {
  const { t } = useTranslation()
  const eligibleCount = props.eligibleIds.length
  const generateLabel = t('generationCommon.production.generateAll', { count: eligibleCount })
  return (
    <div
      className={cn(
        'generation-canvas-v2__production-dock',
        'absolute left-1/2 z-[9] flex -translate-x-1/2 items-center gap-2 px-2 py-1.5',
        props.timelineCollapsed ? 'bottom-16' : 'bottom-4',
        'rounded-full border border-nomi-line bg-nomi-paper/[0.96] shadow-nomi-md pointer-events-auto',
      )}
      data-batch-dock="true"
      role="toolbar"
      aria-label={t('generationCommon.production.aria')}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        data-storyboard-run-all="true"
        data-batch-scope="all"
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border-0 px-4 text-body font-medium',
          'bg-nomi-ink text-nomi-paper transition-colors duration-[var(--nomi-transition-fast)]',
          eligibleCount > 0 ? 'cursor-pointer hover:bg-nomi-accent' : 'cursor-not-allowed opacity-45',
        )}
        disabled={eligibleCount === 0}
        title={eligibleCount === 0 ? t('generationCommon.production.noPending') : generateLabel}
        onClick={props.generate}
      >
        <IconPlayerPlay size={16} stroke={1.6} aria-hidden />
        {generateLabel}
      </button>
      {props.costEstimate ? (
        <span className={cn('shrink-0 text-caption font-medium text-nomi-ink-60')} data-batch-cost-estimate="true">
          {t('generationCommon.production.estimateCredits', { credits: formatGenerationCredits(props.costEstimate.amount) })}
        </span>
      ) : null}
      <NomiSelect
        ariaLabel={t('generationCommon.production.concurrency')}
        leadingLabel={t('generationCommon.production.concurrency')}
        value={String(props.concurrency)}
        options={CONCURRENCY_OPTIONS}
        size="xs"
        onChange={(value) => props.setConcurrency(Number(value))}
      />
      <span className={cn('w-px h-4 bg-nomi-line')} aria-hidden="true" />
      <WorkbenchIconButton
        label={t('generationCommon.production.dismiss')}
        icon={<IconX size={16} />}
        onClick={props.onDismiss}
      />
    </div>
  )
}
