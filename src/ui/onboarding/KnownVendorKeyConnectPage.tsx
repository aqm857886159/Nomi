import React from 'react'
import { IconCheck, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { KnownVendor } from '../../config/knownVendors'
import { DesignButton } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'
import { ModelSettingsPageSurface } from './ModelSettingsPageSurface'

export function KnownVendorKeyConnectPage({
  directory,
  vendorName,
  modelCount,
  hasApiKey = false,
  onBack,
  onSaved,
  onContinueVerification,
}: {
  directory: KnownVendor
  vendorName: string
  modelCount: number
  /**
   * 该供应商已有保存的 key（存了但尚未验证晋级）。
   * 传 true 时跳过 key 录入步骤，直接进入「已保存·继续验证」状态——
   * 避免用户在 availableKnown 点击卡片后看到一个要他重填 key 的表单。
   */
  hasApiKey?: boolean
  onBack: () => void
  onSaved: () => void
  onContinueVerification: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [apiKey, setApiKey] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // 已有 key = 直接进入「已保存」状态（跳过录入，避免要求用户重填已存 key）。
  const [saved, setSaved] = React.useState(hasApiKey)
  const [error, setError] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const errorId = React.useId()

  const save = React.useCallback(() => {
    const cleanKey = apiKey.trim()
    if (!cleanKey) {
      setError(t('onboardingProviders.keyOnly.keyRequired'))
      inputRef.current?.focus()
      return
    }
    const catalog = getDesktopBridge()?.modelCatalog
    if (!catalog) {
      setError(t('onboardingProviders.keyOnly.unavailable'))
      return
    }
    setBusy(true)
    setError('')
    try {
      // A credential edit invalidates the active certification. Keep the
      // seeded vendor disabled until the canonical run promotes verified modes.
      catalog.upsertVendor({ key: directory.vendorKey, enabled: false })
      catalog.upsertVendorApiKey(directory.vendorKey, { apiKey: cleanKey, enabled: false })
      setSaved(true)
      setApiKey('')
      onSaved()
    } catch (reason) {
      setError(t('onboardingProviders.keyOnly.saveFailed', {
        message: reason instanceof Error ? reason.message : String(reason),
      }))
    } finally {
      setBusy(false)
    }
  }, [apiKey, directory.vendorKey, onSaved, t])

  const openRegistration = React.useCallback(() => {
    if (directory.promo) window.open(directory.promo.url, '_blank', 'noopener')
  }, [directory.promo])

  return (
    <ModelSettingsPageSurface
      page="platformConnect"
      title={(
        <div className="min-w-0">
          <h2 className="truncate text-body font-semibold text-nomi-ink">
            {t('onboardingProviders.keyOnly.title', { name: vendorName })}
          </h2>
          <p className="truncate text-micro text-nomi-ink-40">{t('onboardingProviders.keyOnly.subtitle')}</p>
        </div>
      )}
      backLabel={t('common.back')}
      onBack={onBack}
    >
      <div className="mx-auto w-full max-w-[520px]" data-key-only-vendor={directory.vendorKey}>
        <div className="flex items-center gap-3 py-1">
          <span className={cn(
            'grid size-10 shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper',
            !directory.logo && 'bg-nomi-ink-05 text-caption font-semibold text-nomi-ink-60',
          )}>
            {directory.logo ? <img src={directory.logo} alt="" className="size-full object-contain" /> : directory.glyph}
          </span>
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{vendorName}</div>
            <div className="mt-1 text-caption leading-relaxed text-nomi-ink-40">
              {t('onboardingProviders.keyOnly.catalogManaged', { count: modelCount })}
            </div>
          </div>
        </div>

        <div className="mt-5" data-platform-key-only>
          <label htmlFor={`key-only-${directory.vendorKey}`} className="text-caption font-medium text-nomi-ink-80">
            {t('onboardingProviders.keyOnly.keyLabel', { name: vendorName })}
          </label>
          <input
            ref={inputRef}
            id={`key-only-${directory.vendorKey}`}
            type="password"
            value={saved ? 'saved-key' : apiKey}
            autoFocus={!saved}
            // 光有 autoFocus 不够：页面级焦点管理在 rAF 里会把焦点收回「返回」键，晚于它执行。
            // 这个标记就是告诉那一层「这页有更该聚焦的东西」（见 useModelSettingsPageFocus）。
            data-model-settings-autofocus={saved ? undefined : ''}
            disabled={busy || saved}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            placeholder={directory.credentialPlaceholder ?? t('onboardingProviders.keyOnly.keyPlaceholder')}
            onChange={(event) => {
              setApiKey(event.currentTarget.value)
              if (error) setError('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !saved) save()
            }}
            className={cn(
              'mt-2 h-10 w-full rounded-nomi-sm border bg-nomi-paper px-3 text-body-sm text-nomi-ink outline-none',
              'placeholder:text-nomi-ink-40 focus:border-nomi-accent disabled:text-nomi-ink-40 disabled:opacity-100',
              error ? 'border-workbench-danger' : 'border-nomi-line',
            )}
          />
          {error ? <p id={errorId} className="mt-1 text-caption text-workbench-danger">{error}</p> : null}
          <p className="mt-3 text-caption leading-relaxed text-nomi-ink-40">
            {t('onboardingProviders.keyOnly.managedHint')}
          </p>
          {directory.promo ? (
            <button
              type="button"
              onClick={openRegistration}
              className="mt-2 inline-flex items-center gap-1 text-caption text-nomi-ink-60 hover:text-nomi-accent"
            >
              {directory.promo.ctaLabel}
              <IconExternalLink size={13} stroke={1.7} aria-hidden="true" />
            </button>
          ) : null}
          {!saved ? (
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <DesignButton variant="light" onClick={onBack}>{t('common.back')}</DesignButton>
              <DesignButton variant="filled" loading={busy} onClick={save}>
                {t('onboardingProviders.keyOnly.save')}
              </DesignButton>
            </div>
          ) : null}
        </div>

        {saved ? (
          <div className="mt-5" data-key-only-success role="status">
            <div className="flex items-start gap-3 rounded-nomi-sm bg-nomi-ink-05 p-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-accent-soft text-nomi-accent">
                <IconCheck size={16} stroke={2} aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-body-sm font-semibold text-nomi-ink">
                  {hasApiKey && apiKey === ''
                    ? t('onboardingProviders.keyOnly.pendingTitle', { name: vendorName })
                    : t('onboardingProviders.keyOnly.savedTitle', { name: vendorName })}
                </div>
                <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">
                  {hasApiKey && apiKey === ''
                    ? t('onboardingProviders.keyOnly.pendingHint')
                    : t('onboardingProviders.keyOnly.savedHint')}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              {/* 已有 key 的情况提供「更换密钥」出口，让用户不被困在此页 */}
              {hasApiKey && apiKey === '' ? (
                <button
                  type="button"
                  onClick={() => setSaved(false)}
                  className="text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
                >
                  {t('onboardingProviders.keyOnly.replaceKey')}
                </button>
              ) : <span />}
              <DesignButton variant="filled" onClick={onContinueVerification}>
                {t('onboardingProviders.keyOnly.continueVerification')}
              </DesignButton>
            </div>
          </div>
        ) : null}
      </div>
    </ModelSettingsPageSurface>
  )
}
