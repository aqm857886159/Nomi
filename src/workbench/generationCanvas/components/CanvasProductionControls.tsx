import { IconPlayerPlay } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton } from '../../../design'

const CONCURRENCY_OPTIONS = [1, 2, 4, 6, 8].map((value) => ({ value: String(value), label: String(value) }))

/** Shared production controls used by both the selection toolbar and batch dock. */
export function CanvasProductionRunButton({
  scope,
  count,
  onClick,
}: {
  scope: 'selection' | 'all'
  count: number
  onClick: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const label = scope === 'selection'
    ? t('generationCommon.production.generateSelected', { count })
    : t('generationCommon.production.generateAll', { count })
  const disabled = count === 0
  const hint = disabled
    ? t('generationCommon.production.noPending')
    : scope === 'selection'
      ? t('generationCommon.selection.generateHint')
      : label

  return (
    <span className="inline-flex shrink-0" title={disabled ? hint : undefined}>
      <WorkbenchButton
        variant="primary"
        size="md"
        data-storyboard-run-all="true"
        data-batch-scope={scope}
        className="shrink-0"
        disabled={disabled}
        title={disabled ? undefined : hint}
        onClick={onClick}
      >
        <IconPlayerPlay size={16} stroke={1.6} aria-hidden />
        {label}
      </WorkbenchButton>
    </span>
  )
}

export function CanvasProductionConcurrencySelect({
  value,
  onChange,
}: {
  value: number
  onChange: (value: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <NomiSelect
      ariaLabel={t('generationCommon.production.concurrency')}
      leadingLabel={t('generationCommon.production.concurrency')}
      value={String(value)}
      options={CONCURRENCY_OPTIONS}
      size="sm"
      className="shrink-0"
      onChange={(next) => onChange(Number(next))}
    />
  )
}
