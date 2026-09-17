import React from 'react'
import { PasswordInput } from '@mantine/core'
import { IconCode } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { DesignButton, DesignSwitch, DesignTextInput, NomiSelect } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { CustomCallDraftIdentity } from '../../desktop/modelCatalogBridgeTypes'
import { Field } from './onboardingWizardSupport'

type ModelKind = CustomCallDraftIdentity['kind']
const KINDS: ModelKind[] = ['image', 'video', 'audio', 'model3d', 'text']

export function DirectScriptDraftEntry({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div data-direct-script-entry className="flex flex-col gap-3 border-y border-nomi-line-soft py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <IconCode size={18} stroke={1.7} className="mt-0.5 shrink-0 text-nomi-ink-40" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.customCall.directDraft.entryTitle')}</div>
          <div className="mt-0.5 text-caption text-nomi-ink-60">{t('onboardingProviders.customCall.directDraft.entryHint')}</div>
        </div>
      </div>
      <DesignButton className="w-full sm:w-auto" variant="light" onClick={onOpen}>{t('onboardingProviders.customCall.directDraft.entryAction')}</DesignButton>
    </div>
  )
}

export function DirectScriptDraftForm({
  onBack,
  onCreated,
}: {
  onBack: () => void
  onCreated: (identity: CustomCallDraftIdentity) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [vendorName, setVendorName] = React.useState('')
  const [baseUrl, setBaseUrl] = React.useState('')
  const [apiKey, setApiKey] = React.useState('')
  const [noApiKey, setNoApiKey] = React.useState(false)
  const [modelKey, setModelKey] = React.useState('')
  const [kind, setKind] = React.useState<ModelKind>('image')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState('')
  const baseUrlValid = !baseUrl.trim() || /^https?:\/\//i.test(baseUrl.trim())
  /**
   * 还差哪些格。**要的是清单，不是一个布尔**（2026-09-17，W-07）：
   * 原来这里只算出一个 `ready`，按钮 `disabled={!ready}`，用户点下去 60 秒界面一个字都不多，
   * 也不说缺什么——「不让点」是最省事的闸，也是最不说话的那种。
   * 现在按钮照常可点，点了就把还差的东西**逐条说出来**。
   */
  const missingFields = [
    vendorName.trim() ? '' : t('onboardingProviders.customCall.directDraft.vendorName'),
    modelKey.trim() ? '' : t('onboardingProviders.customCall.directDraft.modelId'),
    noApiKey || apiKey.trim() ? '' : t('onboardingProviders.customCall.directDraft.apiKey'),
    baseUrlValid ? '' : t('onboardingProviders.customCall.directDraft.baseUrl'),
  ].filter(Boolean)

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (missingFields.length > 0) {
      setError(t('onboardingProviders.customCall.directDraft.missingFields', {
        fields: missingFields.join(t('assetLibrary.listSeparator')),
      }))
      return
    }
    const create = getDesktopBridge()?.modelCatalog.customCallDraftCreate
    if (!create) {
      setError(t('onboardingProviders.customCall.directDraft.unavailable'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = create({
        vendorName: vendorName.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: noApiKey ? '' : apiKey.trim(),
        authType: noApiKey ? 'none' : 'bearer',
        modelKey: modelKey.trim(),
        kind,
      })
      if (!result.ok) throw new Error(result.error)
      onCreated(result.identity)
    } catch (cause) {
      setError(t('onboardingProviders.customCall.directDraft.createFailed', {
        message: cause instanceof Error ? cause.message : String(cause),
      }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form data-direct-script-draft-form onSubmit={submit} className="mx-auto flex w-full max-w-[680px] flex-col gap-4 px-1">
      <div>
        <h3 className="text-body font-semibold text-nomi-ink">{t('onboardingProviders.customCall.directDraft.title')}</h3>
        <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">{t('onboardingProviders.customCall.directDraft.subtitle')}</p>
      </div>
      <Field label={t('onboardingProviders.customCall.directDraft.vendorName')}>
        <DesignTextInput value={vendorName} onChange={(event) => setVendorName(event.currentTarget.value)} placeholder={t('onboardingProviders.customCall.directDraft.vendorNamePlaceholder')} autoFocus />
      </Field>
      <Field label={t('onboardingProviders.customCall.directDraft.baseUrl')} hint={t('onboardingProviders.customCall.directDraft.baseUrlHint')}>
        <DesignTextInput
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.currentTarget.value)}
          placeholder={t('onboardingProviders.customCall.directDraft.baseUrlPlaceholder')}
          error={!baseUrlValid ? t('onboardingProviders.customCall.directDraft.invalidUrl') : undefined}
        />
      </Field>
      <DesignSwitch
        checked={noApiKey}
        onChange={(event) => setNoApiKey(event.currentTarget.checked)}
        label={t('onboardingProviders.customCall.directDraft.noApiKey')}
        description={t('onboardingProviders.customCall.directDraft.noApiKeyHint')}
      />
      {!noApiKey ? (
        <Field label={t('onboardingProviders.customCall.directDraft.apiKey')} hint={t('onboardingProviders.customCall.directDraft.apiKeyHint')}>
          <PasswordInput value={apiKey} onChange={(event) => setApiKey(event.currentTarget.value)} placeholder={t('onboardingProviders.customCall.directDraft.apiKeyPlaceholder')} />
        </Field>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label={t('onboardingProviders.customCall.directDraft.modelId')} hint={t('onboardingProviders.customCall.directDraft.modelIdHint')}>
          <DesignTextInput value={modelKey} onChange={(event) => setModelKey(event.currentTarget.value)} placeholder={t('onboardingProviders.customCall.directDraft.modelIdPlaceholder')} />
        </Field>
        <Field label={t('onboardingProviders.customCall.directDraft.modelKind')}>
          <NomiSelect
            value={kind}
            options={KINDS.map((value) => ({ value, label: t(`modelSetup.kinds.${value}`) }))}
            onChange={(value) => setKind(value as ModelKind)}
            ariaLabel={t('onboardingProviders.customCall.directDraft.modelKind')}
          />
        </Field>
      </div>
      <p className="border-l-2 border-nomi-accent bg-nomi-accent-soft px-3 py-2 text-caption leading-relaxed text-nomi-ink-60">
        {t('onboardingProviders.customCall.directDraft.draftNote')}
      </p>
      {error ? <div role="alert" className="text-caption text-workbench-danger">{error}</div> : null}
      <div className="flex items-center justify-end gap-2 border-t border-nomi-line-soft pt-3">
        <DesignButton type="button" variant="subtle" onClick={onBack}>{t('common.back')}</DesignButton>
        {/* 不再 `disabled`：闸还在（submit 里），但它现在会说话。 */}
        <DesignButton type="submit" variant="filled" loading={saving} data-direct-script-draft-continue>
          {t('onboardingProviders.customCall.directDraft.continue')}
        </DesignButton>
      </div>
    </form>
  )
}
