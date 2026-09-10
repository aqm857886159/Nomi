import { IconPlayerPlay } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton } from '../../../design'


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
  count,
  onChange,
}: {
  value: number | undefined
  count: number
  onChange: (value: number | undefined) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <NomiSelect
      ariaLabel={t('generationCommon.production.concurrency')}
      leadingLabel={t('generationCommon.production.concurrency')}
      value={value === undefined || count === 0 ? 'auto' : String(Math.min(value, count))}
      options={[{ value: 'auto', label: t('generationCommon.parameters.auto') }, ...Array.from({ length: count }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))]}
      size="sm"
      className="shrink-0"
      onChange={(next) => onChange(next === 'auto' ? undefined : Number(next))}
    />
  )
}
