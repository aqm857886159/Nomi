import type { ModelUnitPrice } from '../../../electron/shared/contracts/modelSettingsAccount'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { getDesktopBridge } from '../../desktop/bridge'
import { CatalogPackageActions } from './ModelCatalogNotices'
import type { ModelSettingsHomeConnection } from './ModelSettingsHome'
import { usageTotal, useModelUsage } from './useModelUsage'
import React, { type JSX } from 'react'
import { IconArrowLeft, IconChevronRight, IconCheck, IconChevronDown, IconPlus, IconTrash } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { Mapping } from '../../../electron/catalog/types'
import { DesignButton, DesignSwitch, IconActionButton, NomiSegmented, NomiSelect } from '../../design'
import type { ChipModel } from './ModelChipGroups'
import { ModelCapabilitySummary } from './ModelCapabilitySummary'
import { ModelAdapterStatusSection } from './ModelAdapterStatusSection'
import { formatMissing } from './modelAdapterDetailState'
import { MODEL_CHIP_KINDS } from './modelChipGrouping'
import { projectModelCapability } from './modelCapabilityProjection'

export class ModelSettingsDetailBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render(): React.ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function ModelSettingsPageHeader({
  title,
  subtitle,
  backLabel,
  onBack,
  actions,
  backAutoFocus = false,
}: {
  title: string
  subtitle?: string
  backLabel: string
  onBack: () => void
  actions?: React.ReactNode
  backAutoFocus?: boolean
}): JSX.Element {
  return (
    <header className="sticky top-0 z-10 flex min-h-14 items-center gap-2 border-b border-nomi-line bg-nomi-paper px-3 py-2 sm:px-4">
      <IconActionButton
        data-model-settings-back
        autoFocus={backAutoFocus}
        onClick={onBack}
        aria-label={backLabel}
        title={backLabel}
        className="size-11 shrink-0 text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink sm:size-8"
        icon={<IconArrowLeft size={16} stroke={1.8} aria-hidden="true" />}
      />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-body-sm font-semibold text-nomi-ink" title={title}>{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-micro text-nomi-ink-60" title={subtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function ConnectionWorkspacePage({
  vendorKey,
  title,
  details,
  canAddModels,
  onAddModels,
  onBack,
  handoff,
}: {
  vendorKey: string
  title: string
  details: React.ReactNode
  canAddModels: boolean
  onAddModels: () => void
  onBack: () => void
  handoff?: {
    total: number
    ready: number
    pending: number
    onContinue?: () => void
  }
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-model-settings-page="connection" data-model-settings-vendor={vendorKey}>
      <ModelSettingsPageHeader
        title={title}
        subtitle={t('onboardingProviders.workspace.connectionSubtitle')}
        backLabel={t('common.back')}
        onBack={onBack}
        actions={canAddModels ? (
          <DesignButton
            variant={handoff ? 'light' : 'filled'}
            onClick={onAddModels}
            aria-label={t('onboardingProviders.workspace.addOtherModels')}
            title={t('onboardingProviders.workspace.addOtherModels')}
            size="md"
            leftSection={<IconPlus size={16} stroke={1.8} aria-hidden="true" />}
          >
            <span className="hidden sm:inline">{t('onboardingProviders.workspace.addOtherModels')}</span>
          </DesignButton>
        ) : null}
      />
      <div className="mx-auto w-full max-w-[920px] flex-1 p-4 sm:p-5">
        {handoff ? (
          <section
            className="mb-4 flex flex-col gap-3 border-y border-nomi-line bg-nomi-ink-05 px-3 py-3 sm:flex-row sm:items-center"
            data-model-registration-handoff
            role="status"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-workbench-success-soft text-workbench-success">
              <IconCheck size={18} stroke={2} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-body-sm font-semibold text-nomi-ink">
                {t('onboardingProviders.workspace.handoff.saved', { count: handoff.total })}
              </h3>
              <p className="mt-0.5 text-caption text-nomi-ink-60">
                {t('onboardingProviders.workspace.handoff.summary', {
                  ready: handoff.ready,
                  pending: handoff.pending,
                })}
              </p>
            </div>
            {handoff.pending > 0 && handoff.onContinue ? (
              <DesignButton variant="filled" onClick={handoff.onContinue} className="shrink-0">
                {t('onboardingProviders.workspace.handoff.continue', { count: handoff.pending })}
              </DesignButton>
            ) : null}
          </section>
        ) : null}
        {details ?? (
          <div className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2 text-caption text-nomi-ink-60">
            {t('onboardingProviders.workspace.connectionMissing')}
          </div>
        )}
      </div>
    </div>
  )
}

export function ModelWorkspaceRecovery({
  vendorName,
  modelKey,
  onBack,
}: {
  vendorName: string
  modelKey: string
  onBack: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-model-settings-page="model"
      data-model-settings-model={modelKey}
      data-model-settings-recovery
    >
      <ModelSettingsPageHeader
        title={modelKey}
        subtitle={vendorName}
        backLabel={t('common.back')}
        onBack={onBack}
        backAutoFocus
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div role="status" className="border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
          {t('onboardingProviders.workspace.modelMissing')}
        </div>
      </div>
    </div>
  )
}

export type ModelWorkspaceConnection = {
  status: React.ReactNode
  fields?: React.ReactNode
  title?: string
  enabledLocked: boolean
  enabledHint: string
  onSetEnabled: (enabled: boolean) => void
  inputSummary?: string
  requestSummary: string
}

export function ModelWorkspacePage({
  model,
  vendorName,
  modelKey,
  canUseScript,
  canAutoAdapt,
  hasActiveRun,
  hasTask,
  adaptStarting,
  enabledLocked,
  mappings,
  onOpenScript,
  onStartAdapt,
  onOpenTask,
  onOpenCapability,
  onSetEnabled,
  onRetype,
  onDelete,
  onBack,
  connection,
}: {
  model?: ChipModel
  vendorName: string
  modelKey: string
  canUseScript: boolean
  canAutoAdapt: boolean
  hasActiveRun: boolean
  hasTask: boolean
  adaptStarting: boolean
  enabledLocked?: boolean
  mappings: readonly Mapping[]
  onOpenScript: () => void
  onStartAdapt: () => void
  onOpenTask: () => void
  onOpenCapability: () => void
  onSetEnabled: (enabled: boolean) => void
  onRetype: (kind: string) => void
  onDelete: () => void
  onBack: () => void
  connection?: ModelWorkspaceConnection
}): JSX.Element {
  const { t } = useTranslation()
  if (!model) {
    return <ModelWorkspaceRecovery vendorName={vendorName} modelKey={modelKey} onBack={onBack} />
  }
  const capability = projectModelCapability({ model, mappings })
  const capabilityKnown = model.kind === 'text' || capability.inputContract === 'known'
  // 缺不缺请求格式只读可用性主人（formatMissing），不在这里拿映射再算一遍。
  const missingFormat = formatMissing(model.availability)
  const switchLocked = connection?.enabledLocked ?? Boolean(enabledLocked || missingFormat)
  return (
    <div className="flex h-full min-h-0 flex-col" data-model-settings-page="model" data-model-settings-model={modelKey}>
      <ModelSettingsPageHeader
        title={connection?.title || model.labelZh || modelKey}
        subtitle={t('onboardingProviders.workspace.modelIdentity', { vendor: vendorName, model: modelKey })}
        backLabel={t('common.back')}
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto w-full max-w-[720px]">
          <div className="flex flex-col gap-5">
            {connection?.status ?? <ModelAdapterStatusSection
              model={model}
              canAutoAdapt={canAutoAdapt}
              canUseScript={canUseScript}
              hasActiveRun={hasActiveRun}
              hasTask={hasTask}
              capabilityKnown={capabilityKnown}
              starting={adaptStarting}
              onStartAdapt={onStartAdapt}
              onOpenTask={onOpenTask}
              onOpenScript={onOpenScript}
              onEditCapability={onOpenCapability}
            />}
            <section>
              <h3 className="mb-1 text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.workspace.basicSettings')}</h3>
              <div className="border-y border-nomi-line">
                <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-nomi-line py-2.5">
                  <div className="min-w-0">
                    <div className="text-body-sm font-medium text-nomi-ink">{t('onboardingProviders.workspace.enabled')}</div>
                    <div className="mt-0.5 text-caption text-nomi-ink-40">
                      {connection?.enabledHint ?? t(missingFormat
                        ? 'onboardingProviders.workspace.adapter.notReadyEnabledHint'
                        : enabledLocked
                        ? hasActiveRun
                          ? 'onboardingProviders.workspace.adapter.enabledLockedHint'
                          : 'onboardingProviders.customCall.directDraft.enableHint'
                        : 'onboardingProviders.workspace.enabledHint')}
                    </div>
                  </div>
                  <DesignSwitch disabled={switchLocked} checked={model.enabled} onChange={(event) => (connection?.onSetEnabled ?? onSetEnabled)(event.currentTarget.checked)} />
                </div>
                {connection?.fields}
                <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-body-sm font-medium text-nomi-ink">{t('onboardingProviders.workspace.modelKind')}</div>
                    <div className="mt-0.5 text-caption text-nomi-ink-40">{t('onboardingProviders.workspace.modelKindHint')}</div>
                  </div>
                  {model.canRetype ? (
                    <NomiSelect
                      value={model.kind}
                      options={MODEL_CHIP_KINDS.map((kind) => ({
                        value: kind,
                        label: t(`onboardingProviders.modelControls.kind.${kind}` as 'onboardingProviders.modelControls.kind.text'),
                      }))}
                      onChange={onRetype}
                      ariaLabel={t('onboardingProviders.modelControls.retypeAria', { name: model.labelZh })}
                      size="sm"
                    />
                  ) : (
                    <span className="text-caption text-nomi-ink-60">
                      {t(`onboardingProviders.modelControls.kind.${model.kind}` as 'onboardingProviders.modelControls.kind.text')}
                    </span>
                  )}
                </div>
              </div>
            </section>

            <ModelCapabilitySummary
              model={model}
              mappings={mappings}
              canUseScript={canUseScript}
              onEdit={onOpenCapability}
              onEditRequest={canUseScript ? onOpenScript : undefined}
              inputSummaryOverride={connection?.inputSummary}
              requestSummaryOverride={connection?.requestSummary}
            />

            {!connection ? <details className="group border-t border-nomi-line pt-1">
              <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-caption font-semibold text-nomi-ink-60 hover:text-nomi-ink [&::-webkit-details-marker]:hidden">
                {t('onboardingProviders.workspace.moreActions')}
                <IconChevronDown size={16} stroke={1.6} className="transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="flex flex-col border-t border-nomi-line-soft">
                <button
                  type="button"
                  onClick={onDelete}
                  className="flex min-h-11 items-center gap-2 text-left text-caption text-workbench-danger hover:underline"
                >
                  <IconTrash size={14} stroke={1.8} aria-hidden="true" />
                  {t('onboardingProviders.drawer.deleteModel')}
                </button>
              </div>
            </details> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export function OtherConnectionWays({ local, onBack, onCustomApi, onDirectScript, onImported, dataSource, network, footer, section }: {
  local: ModelSettingsHomeConnection[]; onBack: () => void; onCustomApi: () => void; onDirectScript: () => void; onImported: () => void
  dataSource: React.ReactNode; network: React.ReactNode; footer: React.ReactNode; section?: 'data' | 'network'
}): JSX.Element {
  const { t } = useTranslation()
  const networkRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => { if (section === 'network') networkRef.current?.scrollIntoView({ block: 'start' }) }, [section])
  const row = 'flex min-h-10 w-full items-center border-b border-nomi-line-soft text-left text-caption hover:text-nomi-accent'
  return <div className="min-h-0 overflow-y-auto" data-model-settings-page="otherWays">
    <ModelSettingsPageHeader title={t('settings.modelsHome.ways')} backLabel={t('common.back')} onBack={onBack} />
    <div className="space-y-4 p-4">
      <section><h3 className="text-caption font-semibold">{t('settings.modelsHome.local')}</h3>
        {local.map(c => <button className={row} key={c.vendorKey} onClick={c.onOpen} data-local-connection={c.vendorKey}>
          {translateModelDisplayText(c.name)} <IconChevronRight size={14} /></button>)}{footer}</section>
      <button type="button" className={row} data-model-home-action="custom-api" onClick={onCustomApi}>{t('onboardingProviders.drawer.home.customApi')} <IconChevronRight size={14} /></button>
      <section data-model-home-data-sources><h3 className="text-caption font-semibold">{t('onboardingProviders.drawer.home.dataSources')}</h3>{dataSource}</section>
      <div ref={networkRef} data-model-home-advanced>{network}<CatalogPackageActions onImported={onImported} />
        <button type="button" className={row} data-model-home-direct-script onClick={onDirectScript}>{t('onboardingProviders.drawer.home.directScript')} <IconChevronRight size={14} /></button>
      </div>
    </div>
  </div>
}

export function ModelUsagePage({ vendor, name, onBack }: { vendor: string; name: string; onBack: () => void }): JSX.Element {
  const { t, i18n } = useTranslation()
  const [days, setDays] = React.useState<7 | 30>(7)
  const { periods, refresh } = useModelUsage(vendor)
  const [prices, setPrices] = React.useState<ModelUnitPrice[] | null>()
  const [attempt, retryPrices] = React.useReducer(n => n + 1, 0)
  React.useEffect(() => {
    let active = true
    void Promise.resolve(getDesktopBridge()?.onboarding?.modelUnitPrices?.(vendor)).then(
      value => { if (active) setPrices(value ?? null) }, () => { if (active) setPrices(null) })
    return () => { active = false }
  }, [vendor, attempt])
  const rows = periods?.[days]
  const total = rows && usageTotal(rows)
  const number = (v: number) => v.toLocaleString(i18n.language, { maximumFractionDigits: 5 })
  const amount = (v: number | null) => v === null ? t('settings.modelsHome.pending') : t('settings.modelsHome.credits', { amount: number(v) })
  const row = 'grid grid-cols-[minmax(0,1fr)_auto_4rem] items-center gap-2 border-b border-nomi-line-soft px-2 py-1.5 text-caption'
  return <div className="min-h-0 overflow-y-auto" data-model-settings-page="usage">
    <ModelSettingsPageHeader title={t('settings.modelsHome.usage')} subtitle={name} backLabel={t('common.back')} onBack={onBack} />
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-3"><h3 className="text-caption font-semibold">{t('settings.modelsHome.spent')}</h3>
        <NomiSegmented ariaLabel={t('settings.modelsHome.spent')} density="compact" fit="content" value={String(days)}
          options={[7, 30].map(count => ({ value: String(count), label: t('settings.modelsHome.days', { count }) }))}
          onChange={value => setDays(value === '30' ? 30 : 7)} /></div>
      <div className="rounded-nomi-sm border border-nomi-line">
        {rows ? rows.map(r => <div key={r.modelKey} data-usage-model={r.modelKey} className={row}>
          <span title={r.modelKey} className="truncate">{prices?.find(p => p.modelKey === r.modelKey)?.label || r.modelKey}</span>
          <span>{amount(r.credits)}</span><span className="text-right">{t('settings.modelsHome.runs', { count: r.runs })}</span></div>)
          : <p className="p-2 text-caption">{periods === undefined ? t('onboardingProviders.drawer.loading') : <>
            <span>{t('settings.modelsHome.unavailable')}</span> · <button type="button" className="text-nomi-accent hover:underline" onClick={refresh}>{t('settings.modelsHome.retry')}</button>
          </>}</p>}
        {rows?.length === 0 && <p className="p-2 text-caption">{t('settings.modelsHome.empty')}</p>}
        {total && <div className={row + ' bg-nomi-ink-05 font-semibold'}><span>{t('settings.modelsHome.total')}</span><span>{amount(total.credits)}</span><span className="text-right">{t('settings.modelsHome.runs', { count: total.runs })}</span></div>}
      </div>
      <p className="text-micro text-nomi-ink-60">{t('settings.modelsHome.receipt')}</p>
      <h3 className="text-caption font-semibold">{t('settings.modelsHome.rates')}</h3>
      <div className="divide-y divide-nomi-line-soft rounded-nomi-sm border border-nomi-line">
        {prices?.map(p => <div key={p.modelKey} data-unit-price={p.modelKey} className="flex gap-2 px-2 py-1.5 text-caption"><span className="min-w-0 flex-1">{translateModelDisplayText(p.label)}</span>
          <span>{p.credits === null ? t('settings.modelsHome.unavailable') : t(p.kind === 'video' ? 'settings.modelsHome.videoUnit' : 'settings.modelsHome.imageUnit', { amount: number(p.credits) })}</span></div>)}
        {prices === undefined ? <p className="p-2 text-caption">{t('onboardingProviders.drawer.loading')}</p> : !prices?.length && <p className="p-2 text-caption">
          <span>{t('settings.modelsHome.noRates')}</span> · <button type="button" className="text-nomi-accent hover:underline" onClick={retryPrices}>{t('settings.modelsHome.retry')}</button>
        </p>}
      </div><p className="text-micro text-nomi-ink-60">{t('settings.modelsHome.rateHint')}</p>
    </div>
  </div>
}
