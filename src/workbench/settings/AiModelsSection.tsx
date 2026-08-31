import React from 'react'
import { useTranslation } from 'react-i18next'

import { DesignSwitch } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import { buildProviderHealthView, type SettingsProviderInput } from './settingsAutomationView'
import { listWorkbenchModelCatalogModels, type ModelCatalogModelDto } from '../api/modelCatalogApi'

type Props = {
  settings: AutomationPolicySettings
  onChange: (patch: Partial<AutomationPolicySettings>) => void
}

export function AiModelsSection({ settings, onChange }: Props): JSX.Element {
  const { t } = useTranslation()
  const [providers, setProviders] = React.useState<SettingsProviderInput[]>([])
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])

  React.useEffect(() => {
    try {
      const values = getDesktopBridge()?.modelCatalog.listVendors() as SettingsProviderInput[] | undefined
      setProviders(Array.isArray(values) ? values : [])
      void listWorkbenchModelCatalogModels({ enabled: true }).then((values) => setModels(Array.isArray(values) ? values : [])).catch(() => setModels([]))
    } catch {
      setProviders([])
    }
  }, [])

  const health = buildProviderHealthView(providers)
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

      <section className="border-t border-nomi-line pt-4" aria-labelledby="settings-model-policy-title">
        <h3 id="settings-model-policy-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.ai.policy.title')}
        </h3>
        <div className="py-2">
          <div className="text-body-sm text-nomi-ink">{t('settings.ai.policy.text')}</div>
          <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.policy.textHint')}</div>
        </div>
        <div className="py-2">
          <div className="text-body-sm text-nomi-ink">{t('settings.ai.policy.media')}</div>
          <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.policy.mediaHint')}</div>
        </div>
        <div className="mt-3 grid gap-3 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-3">
          <label className="grid gap-1.5">
            <span className="text-caption font-medium text-nomi-ink-80">{t('settings.ai.policy.hardBudget')}</span>
            <span className="text-micro text-nomi-ink-40">{t('settings.ai.policy.hardBudgetHint')}</span>
            <input
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
              {health.map((provider) => (
                <label key={provider.key} className="inline-flex items-center gap-2 text-caption text-nomi-ink-80">
                  <input
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
                </label>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <span className="text-caption font-medium text-nomi-ink-80">{t('settings.ai.policy.models')}</span>
            <span className="text-micro text-nomi-ink-40">{t('settings.ai.policy.modelsHint')}</span>
            <div className="grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2">
              {models.map((model) => (
                <label key={`${model.vendorKey}:${model.modelKey}`} className="inline-flex items-center gap-2 text-caption text-nomi-ink-80">
                  <input
                    type="checkbox"
                    checked={settings.allowedModels.includes(model.modelKey)}
                    onChange={(event) => {
                      const next = new Set(settings.allowedModels)
                      if (event.currentTarget.checked) next.add(model.modelKey)
                      else next.delete(model.modelKey)
                      onChange({ allowedModels: [...next] })
                    }}
                  />
                  <span className="truncate">{model.labelZh || model.modelKey}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
