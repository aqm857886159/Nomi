import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'

import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import type { ModelCatalogStatus } from '../../../config/modelCatalogStatus'
import {
  NomiSelect,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  WorkbenchButton,
  type NomiSelectOption,
} from '../../../design'
import { openApimartConnect } from '../../../ui/onboarding/apimartConnectRoute'
import { cn } from '../../../utils/cn'
import { ParameterOptionGroup, ParameterPanelGroup } from './controls/ParameterControlBody'
import type { DynamicCatalogControl, DynamicModelControl } from './controls/parameterControlModel'
import { NODE_SCROLL_REGION_CLASS_NAME } from './nodeScrollRegionClassName'

export function ComposerFooterConnectButton({ connectTooltip }: { connectTooltip?: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <WorkbenchButton
            variant="primary"
            className="shrink-0 rounded-pill px-3.5 font-semibold"
            data-bar-segment="generate"
            data-board="entry.composer-connect"
            data-composer-connect="true"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              openApimartConnect()
            }}
          >
            {t('onboardingProviders.entries.connectModel')}
          </WorkbenchButton>
        </TooltipTrigger>
        <TooltipContent side="top" align="end" data-composer-connect-tooltip="true">
          {connectTooltip ?? t('onboardingProviders.entries.composerTooltipGeneric')}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function EmptyModelCatalogControl({
  status,
  hideModel,
  wrap,
  options,
  onModelPick,
}: {
  status?: ModelCatalogStatus
  hideModel: boolean
  wrap: boolean
  options: NomiSelectOption[]
  onModelPick: (id: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  if (status === 'loading') {
    return (
      <span
        aria-hidden="true"
        data-model-chip-loading="true"
        className="inline-flex h-7 w-28 items-center rounded-full border border-nomi-line bg-nomi-ink-05 animate-pulse"
      />
    )
  }
  return !hideModel ? (
    <NomiSelect
      ariaLabel={t('generationCommon.parameters.model')}
      placeholder={t('onboardingProviders.entries.modelChipEmpty')}
      triggerMaxWidth={wrap ? 260 : 200}
      className="shrink-0 text-nomi-ink-60"
      value=""
      options={options}
      onChange={onModelPick}
    />
  ) : (
    <WorkbenchButton
      size="sm"
      variant="primary"
      className="shrink-0 rounded-pill px-3 font-semibold"
      data-board="entry.composer-connect"
      data-composer-connect="true"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        openApimartConnect()
      }}
    >
      {t('onboardingProviders.entries.connectModel')}
    </WorkbenchButton>
  )
}

export function ParameterPanelScrollContent({
  maxHeight,
  modeChoices,
  activeModeId,
  modeLabel,
  onModeSelect,
  panelControls,
  controlNotices,
  meta,
  onCatalogControlChange,
  onParameterControlChange,
  hasProvider,
  providerValue,
  providerOptions,
  onProviderPick,
  panelFooter,
}: {
  maxHeight: number | undefined
  modeChoices?: readonly { id: string; label: string; limitTip?: string }[]
  activeModeId: string
  modeLabel?: string
  onModeSelect?: (id: string) => void
  panelControls: DynamicModelControl[]
  controlNotices?: Readonly<Record<string, React.ReactNode>>
  meta: Record<string, unknown>
  onCatalogControlChange: (control: DynamicCatalogControl, value: string) => void
  onParameterControlChange: (control: ModelParameterControl, value: string) => void
  hasProvider: boolean
  providerValue: string
  providerOptions: Array<{ value: string; label: string }>
  onProviderPick: (value: string) => void
  panelFooter?: React.ReactNode
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        NODE_SCROLL_REGION_CLASS_NAME,
        'flex flex-col gap-3 overflow-y-auto overscroll-contain rounded-nomi-lg p-3',
      )}
      style={{ maxHeight }}
    >
      {modeChoices?.length && onModeSelect ? (
        <div className="flex flex-col gap-1.5" data-agent-generation-mode="true">
          <div className="text-micro font-semibold leading-none text-nomi-ink-40">
            {modeLabel || t('generationCommon.parameters.generationMode')}
          </div>
          <ParameterOptionGroup
            ariaLabel={modeLabel || t('generationCommon.parameters.generationMode')}
            value={activeModeId}
            rawOptions={modeChoices.map((choice) => ({
              value: choice.id,
              text: choice.label,
              ...(choice.limitTip ? { hint: choice.limitTip } : {}),
            }))}
            onChange={onModeSelect}
          />
        </div>
      ) : null}
      {panelControls.map((control) => (
        <ParameterPanelGroup
          key={control.key}
          control={control}
          notice={controlNotices?.[control.key]}
          meta={meta}
          onCatalogControlChange={onCatalogControlChange}
          onParameterControlChange={onParameterControlChange}
        />
      ))}
      {hasProvider ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-micro font-semibold leading-none text-nomi-ink-40">
            {t('generationCommon.parameters.provider')}
          </div>
          <ParameterOptionGroup
            ariaLabel={t('generationCommon.parameters.provider')}
            value={providerValue}
            rawOptions={providerOptions.map((o) => ({ value: o.value, text: o.label }))}
            onChange={onProviderPick}
            requestedPurpose="provider"
          />
        </div>
      ) : null}
      {panelFooter ? (
        <div className="border-t border-nomi-line-soft pt-2 text-micro text-nomi-ink-40" data-parameter-panel-footer="true">
          {panelFooter}
        </div>
      ) : null}
    </div>
  )
}
