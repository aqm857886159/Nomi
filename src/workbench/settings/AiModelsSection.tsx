import React from 'react'
import { useTranslation } from 'react-i18next'

import { DesignSwitch, WorkbenchButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import { buildProviderHealthView, type SettingsProviderInput } from './settingsAutomationView'
import { listWorkbenchModelCatalogModels, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import type { ProductionPolicyRequirement } from '../production/productionPolicyRecovery'

type Props = {
  settings: AutomationPolicySettings
  onChange: (patch: Partial<AutomationPolicySettings>) => void
  productionPolicyRequirement?: ProductionPolicyRequirement | null
  focusEnabled?: boolean
  onOpenModelCatalog?: () => void
}

export function AiModelsSection({
  settings,
  onChange,
  productionPolicyRequirement = null,
  focusEnabled = true,
  onOpenModelCatalog,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [providers, setProviders] = React.useState<SettingsProviderInput[]>([])
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  const [catalogLoaded, setCatalogLoaded] = React.useState(false)
  const policySectionRef = React.useRef<HTMLElement>(null)
  const focusedRequirementRef = React.useRef<ProductionPolicyRequirement | null>(null)

  React.useEffect(() => {
    try {
      const values = getDesktopBridge()?.modelCatalog.listVendors() as SettingsProviderInput[] | undefined
      setProviders(Array.isArray(values) ? values : [])
      void listWorkbenchModelCatalogModels({ enabled: true })
        .then((values) => setModels(Array.isArray(values) ? values : []))
        .catch(() => setModels([]))
        .finally(() => setCatalogLoaded(true))
    } catch {
      setProviders([])
      setCatalogLoaded(true)
    }
  }, [])

  const health = buildProviderHealthView(providers)
  const requiredProviderModels = React.useMemo(
    () => productionPolicyRequirement?.requiredProviderModels ?? [],
    [productionPolicyRequirement],
  )
  const requiredProviders = new Set(requiredProviderModels.map((item) => item.provider))
  const isRequiredModel = (model: ModelCatalogModelDto): boolean => requiredProviderModels.some((item) =>
    item.provider === model.vendorKey && item.model === model.modelKey)
  const orderedHealth = [...health].sort((left, right) =>
    Number(requiredProviders.has(right.key)) - Number(requiredProviders.has(left.key)))
  const orderedModels = [...models].sort((left, right) =>
    Number(isRequiredModel(right)) - Number(isRequiredModel(left)))
  const unavailableRequirements = catalogLoaded
    ? requiredProviderModels.filter((item) => {
      const provider = health.find((candidate) => candidate.key === item.provider)
      const model = models.find((candidate) => candidate.vendorKey === item.provider && candidate.modelKey === item.model)
      return !provider || provider.state === 'disabled' || !model
    })
    : []

  React.useEffect(() => {
    if (!focusEnabled || !productionPolicyRequirement || focusedRequirementRef.current === productionPolicyRequirement) return
    let target: HTMLInputElement | undefined
    if (settings.maxSpend === null) {
      target = policySectionRef.current?.querySelector<HTMLInputElement>('[data-settings-field="hard-budget"]') ?? undefined
    } else {
      const missingProvider = requiredProviderModels.find((item) => !settings.allowedProviders.includes(item.provider))?.provider
      if (missingProvider) {
        target = [...(policySectionRef.current?.querySelectorAll<HTMLInputElement>('[data-settings-field="production-provider"]') ?? [])]
          .find((input) => input.dataset.policyKey === missingProvider)
      }
      const missingPair = requiredProviderModels.find((item) => !settings.allowedModels.includes(item.model))
      if (!target && missingPair) {
        target = [...(policySectionRef.current?.querySelectorAll<HTMLInputElement>('[data-settings-field="production-model"]') ?? [])]
          .find((input) => input.dataset.policyKey === `${missingPair.provider}:${missingPair.model}`)
      }
    }
    if (!target) return
    focusedRequirementRef.current = productionPolicyRequirement
    const frame = window.requestAnimationFrame(() => {
      policySectionRef.current?.scrollIntoView({ block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusEnabled, models, productionPolicyRequirement, providers, requiredProviderModels, settings.allowedModels, settings.allowedProviders, settings.maxSpend])

  return (
    <div data-settings-section="ai-models">
      <h2 className="mb-5 text-title font-medium text-nomi-ink">{t('settings.ai.title')}</h2>

      <section className="mb-6" aria-labelledby="settings-model-connections-title">
        <h3 id="settings-model-connections-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.ai.connections')}
        </h3>
        {health.length > 0 ? (
          <div className="divide-y divide-nomi-line">
            {health.map((provider) => (
              <div key={provider.key} className="flex min-h-12 items-center justify-between gap-4 py-2">
                <div className="min-w-0 truncate text-body-sm text-nomi-ink">{provider.name}</div>
                <span
                  className={provider.state === 'connected' || provider.state === 'local'
                    ? 'shrink-0 text-caption text-nomi-success'
                    : 'shrink-0 text-caption text-nomi-ink-40'}
                >
                  {t(`settings.ai.health.${provider.state}`)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-3 text-caption leading-relaxed text-nomi-ink-60">
            {t('settings.ai.empty')}
          </div>
        )}
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-upload-title">
        <h3 id="settings-upload-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
          {t('settings.ai.upload.title')}
        </h3>
        <div className="flex min-h-12 items-center justify-between gap-4 py-2">
          <div className="min-w-0">
            <div className="text-body-sm text-nomi-ink">{t('settings.ai.upload.minimize')}</div>
            <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.upload.minimizeHint')}</div>
          </div>
          <DesignSwitch
            checked={settings.minimizeUploads}
            onChange={(event) => onChange({ minimizeUploads: event.currentTarget.checked })}
            aria-label={t('settings.ai.upload.minimize')}
          />
        </div>
      </section>

      <section
        ref={policySectionRef}
        data-settings-section="production-policy"
        className="border-t border-nomi-line pt-4"
        aria-labelledby="settings-model-policy-title"
      >
        <h3 id="settings-model-policy-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.ai.policy.title')}
        </h3>
        {requiredProviderModels.length ? (
          <div data-production-policy-context className="mb-3 border-l-2 border-nomi-accent pl-3">
            <div className="text-caption font-medium text-nomi-ink">{t('settings.ai.policy.currentRunNeeds')}</div>
            <div className="mt-1 grid gap-0.5">
              {requiredProviderModels.map((item) => (
                <div key={`${item.provider}:${item.model}`} className="truncate text-caption text-nomi-ink-60">
                  {item.provider} · {item.model}
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {unavailableRequirements.length ? (
          <div
            data-production-policy-unavailable
            className="mb-3 flex items-start justify-between gap-3 border-l-2 border-nomi-warning pl-3"
          >
            <div className="min-w-0">
              <div className="text-caption font-medium text-nomi-ink">{t('settings.ai.policy.requiredUnavailable')}</div>
              <div className="mt-0.5 truncate text-micro text-nomi-ink-60">
                {unavailableRequirements.map((item) => `${item.provider} · ${item.model}`).join(', ')}
              </div>
            </div>
            {onOpenModelCatalog ? (
              <WorkbenchButton size="sm" className="shrink-0" onClick={onOpenModelCatalog}>
                {t('settings.ai.policy.openModelCatalog')}
              </WorkbenchButton>
            ) : null}
          </div>
        ) : null}
        <div className="py-2">
          <div className="text-body-sm text-nomi-ink">{t('settings.ai.policy.text')}</div>
          <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.policy.textHint')}</div>
        </div>
        <div className="py-2">
          <div className="text-body-sm text-nomi-ink">{t('settings.ai.policy.media')}</div>
          <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.policy.mediaHint')}</div>
        </div>
        <div className="mt-3 grid gap-3 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-3">
          <label htmlFor="settings-hard-budget" className="grid gap-1.5">
            <span className="text-caption font-medium text-nomi-ink-80">{t('settings.ai.policy.hardBudget')}</span>
            <span className="text-micro text-nomi-ink-40">{t('settings.ai.policy.hardBudgetHint')}</span>
            <input
              data-settings-field="hard-budget"
              id="settings-hard-budget"
              type="number"
              min={0}
              step="0.01"
              value={settings.maxSpend ?? ''}
              onChange={(event) => onChange({ maxSpend: event.currentTarget.value === '' ? null : Math.max(0, Number(event.currentTarget.value)) })}
              aria-label={t('settings.ai.policy.hardBudget')}
              className="h-8 w-40 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink outline-none focus:border-nomi-accent"
            />
          </label>
          <div className="grid gap-1.5">
            <span className="text-caption font-medium text-nomi-ink-80">{t('settings.ai.policy.providers')}</span>
            <span className="text-micro text-nomi-ink-40">{t('settings.ai.policy.providersHint')}</span>
            <div className="grid gap-1 sm:grid-cols-2">
              {orderedHealth.map((provider) => {
                const required = requiredProviders.has(provider.key)
                return (
                <label
                  key={provider.key}
                  data-production-policy-required={required ? 'provider' : undefined}
                  className="inline-flex min-w-0 items-center gap-2 text-caption text-nomi-ink-80"
                >
                  <input
                    data-settings-field="production-provider"
                    data-policy-key={provider.key}
                    type="checkbox"
                    checked={settings.allowedProviders.includes(provider.key)}
                    disabled={provider.state === 'disabled'}
                    onChange={(event) => {
                      const next = new Set(settings.allowedProviders)
                      if (event.currentTarget.checked) next.add(provider.key)
                      else next.delete(provider.key)
                      onChange({ allowedProviders: [...next] })
                    }}
                  />
                  <span className="truncate">{provider.name}</span>
                  {required ? <span className="shrink-0 text-micro text-nomi-accent">{t('settings.ai.policy.requiredForRun')}</span> : null}
                </label>
                )
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-caption font-medium text-nomi-ink-80">{t('settings.ai.policy.models')}</span>
            <span className="text-micro text-nomi-ink-40">{t('settings.ai.policy.modelsHint')}</span>
            <div className="grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2">
              {orderedModels.map((model) => {
                const required = isRequiredModel(model)
                const providerName = health.find((provider) => provider.key === model.vendorKey)?.name || model.vendorKey
                return (
                <label
                  key={`${model.vendorKey}:${model.modelKey}`}
                  data-production-policy-required={required ? 'model' : undefined}
                  className="inline-flex min-w-0 items-center gap-2 text-caption text-nomi-ink-80"
                >
                  <input
                    data-settings-field="production-model"
                    data-policy-key={`${model.vendorKey}:${model.modelKey}`}
                    type="checkbox"
                    checked={settings.allowedModels.includes(model.modelKey)}
                    onChange={(event) => {
                      const next = new Set(settings.allowedModels)
                      if (event.currentTarget.checked) next.add(model.modelKey)
                      else next.delete(model.modelKey)
                      onChange({ allowedModels: [...next] })
                    }}
                  />
                  <span className="min-w-0 truncate">{model.labelZh || model.modelKey} · {providerName}</span>
                  {required ? <span className="shrink-0 text-micro text-nomi-accent">{t('settings.ai.policy.requiredForRun')}</span> : null}
                </label>
                )
              })}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
