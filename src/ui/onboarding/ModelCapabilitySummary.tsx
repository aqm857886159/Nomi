import React from 'react'
import { IconChevronRight } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Mapping } from '../../../electron/catalog/types'
import { parseCustomCapabilityContract } from '../../config/modelArchetypes'
import type { ChipModel } from './ModelChipGroups'
import { projectModelCapability } from './modelCapabilityProjection'

function SummaryRow({
  title,
  value,
  onOpen,
  ariaLabel,
}: {
  title: string
  value: string
  onOpen?: () => void
  ariaLabel: string
}): JSX.Element {
  const content = (
    <>
      <span className="min-w-0 text-left text-body-sm font-medium text-nomi-ink">{title}</span>
      <span className="min-w-0 flex-1 break-words text-right text-caption text-nomi-ink-60">{value}</span>
      {onOpen ? <IconChevronRight size={15} stroke={1.8} className="shrink-0 text-nomi-ink-30" aria-hidden="true" /> : null}
    </>
  )
  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 border-b border-nomi-line py-3 text-left last:border-b-0 hover:text-nomi-accent"
    >
      {content}
    </button>
  ) : (
    <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-3 border-b border-nomi-line py-3 last:border-b-0">
      {content}
    </div>
  )
}

export function ModelCapabilitySummary({
  model,
  mappings,
  canUseScript,
  onEdit,
  onEditRequest,
}: {
  model: ChipModel
  mappings: readonly Mapping[]
  canUseScript: boolean
  onEdit?: () => void
  onEditRequest?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const projection = React.useMemo(
    () => projectModelCapability({ model, mappings }),
    [model, mappings],
  )
  const hasCustomContract = Boolean(parseCustomCapabilityContract(model.meta))
  const canEditInput = (model.kind !== 'text' || hasCustomContract) && Boolean(onEdit)
  const inputSummary = model.kind === 'text'
    ? t('onboardingProviders.workspace.capability.inputText')
    : projection.inputContract === 'known'
      ? t('onboardingProviders.workspace.capability.inputKnown', { count: projection.modes.length })
      : t('onboardingProviders.workspace.capability.inputUnknown')
  const requestSummary = projection.customCall.enabled
    ? t('onboardingProviders.workspace.capability.requestCustom')
    : projection.transport.mappings.length > 0
      ? t('onboardingProviders.workspace.capability.requestKnown', { count: projection.transport.mappings.length })
      : model.kind === 'text'
        ? t('onboardingProviders.workspace.capability.requestDefaultText')
        : t('onboardingProviders.workspace.capability.requestUnknown')

  return (
    <section aria-label={t('onboardingProviders.workspace.capability.summaryAria')} className="border-y border-nomi-line">
      <SummaryRow
        title={t('onboardingProviders.workspace.capability.inputSummaryTitle')}
        value={inputSummary}
        onOpen={canEditInput ? onEdit : undefined}
        ariaLabel={t('onboardingProviders.workspace.capability.openInput', { name: model.labelZh })}
      />
      <SummaryRow
        title={t('onboardingProviders.workspace.capability.requestSummaryTitle')}
        value={requestSummary}
        onOpen={canUseScript ? onEditRequest : undefined}
        ariaLabel={t('onboardingProviders.workspace.capability.openRequest', { name: model.labelZh })}
      />
    </section>
  )
}
