import React, { type JSX } from 'react'
import { IconCheck, IconExternalLink } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { KnownVendor } from '../../config/knownVendors'
import { DesignButton, VendorLogoImage } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { cn } from '../../utils/cn'
import { useVendorHealth } from './useVendorHealth'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'
import { groupModelsByKind } from './modelChipGrouping'
import { ModelSettingsPageSurface } from './ModelSettingsPageSurface'
import { VendorBaseUrlField } from './VendorBaseUrlField'
import { resolveCredentialCopy } from './credentialPresentation'

export function KnownVendorKeyConnectPage({
  directory,
  vendorName,
  baseUrl = '',
  models,
  hasApiKey = false,
  credentialMaterialSaved = false,
  credentialVerificationPending = false,
  curatedModelsPublished = false,
  onBack,
  onSaved,
  onContinueVerification,
}: {
  directory: KnownVendor
  vendorName: string
  /** 这家现在的接口地址。填 key 之前就要能改：主域被墙的用户得先换线路，key 才验得出去（2026-09-29）。 */
  baseUrl?: string
  /**
   * 这家**已经预置好**的模型清单（含请求适配），未接入时也是真数据——
   * 页面必须把它摊开给用户看，而不是只报一个数字（2026-09-14 修：此前只传 `.length`，
   * 于是「已有预置地址、模型和请求适配」这句话在界面上从来没有对应的列表）。
   */
  models: readonly ChipModel[]
  /**
   * 该供应商已有保存的 key（存了但尚未验证晋级）。
   * 传 true 时跳过 key 录入步骤，直接进入「已保存·继续验证」状态——
   * 避免用户在 availableKnown 点击卡片后看到一个要他重填 key 的表单。
   */
  hasApiKey?: boolean
  /** Persisted material for display; unlike hasApiKey this does not imply usable or enabled. */
  credentialMaterialSaved?: boolean
  credentialVerificationPending?: boolean
  /**
   * 该供应商的预置模型**此刻**已经在可用列表里（凭据 enabled → vendor 未被 de-publish，
   * 见 electron/catalog/credentialPublication.ts：凭据停用必然连带 vendor 停用，
   * 故「vendor.enabled && hasApiKey」就是「模型已发布」的同一个判据，不是第二份真相）。
   * direct-key 供应商（apimart）填完 key 即到这个状态；certification 供应商要走完认证才到。
   */
  curatedModelsPublished?: boolean
  onBack: () => void
  onSaved: () => void
  onContinueVerification: () => void
}): JSX.Element {
  const { t } = useTranslation()
  // 数字和列表同源：都从这一份 models 派生，不再各传各的（数字真、列表空正是老 bug 的形状）。
  const modelCount = models.length
  const kindGroups = React.useMemo(() => groupModelsByKind([...models]), [models])
  const [allGroupsOpen, setAllGroupsOpen] = React.useState(false)
  // 默认只摊开第一组（多数供应商第一组就是他家主力 kind），其余收在一次点击后面——
  // 33 个 chip 一次全铺会把下面的 Key 输入框挤出首屏。
  const visibleModels = allGroupsOpen ? [...models] : [...(kindGroups[0]?.models ?? [])]
  const hiddenModelCount = modelCount - visibleModels.length
  const [apiKey, setApiKey] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  // 已有 key = 直接进入「已保存」状态（跳过录入，避免要求用户重填已存 key）。
  const [saved, setSaved] = React.useState(credentialMaterialSaved || hasApiKey)
  const [error, setError] = React.useState('')
  const [verificationPending, setVerificationPending] = React.useState(credentialVerificationPending)
  React.useEffect(() => setVerificationPending(credentialVerificationPending), [credentialVerificationPending])
  /**
   * 「点这个按钮会不会花钱」——**问主进程那份唯一的探测策略**，不在这里第二次判
   * （T-MO-10，用户 2026-09-22 拍板）。此前这页只写「保存验证」，而 apimart 那一下是一次
   * 真实生成、扣用户积分（09-11 群反馈）。问不到（旧 preload / 后台没起来）就显示「说不准」，
   * **不许**默认显示「免费验证」——不知道就不许说免费。
   */
  const [probePlan, setProbePlan] = React.useState<{ cost: 'free' | 'paid'; amount: number | null } | null>(null)
  React.useEffect(() => {
    let alive = true
    const read = getDesktopBridge()?.modelCatalog?.credentialProbePlan
    if (!read) { setProbePlan(null); return }
    void Promise.resolve(read(directory.vendorKey))
      .then((plan) => { if (alive && plan) setProbePlan(plan) })
      .catch(() => { if (alive) setProbePlan(null) })
    return () => { alive = false }
  }, [directory.vendorKey])
  const probeCostHint = probePlan === null
    ? t('onboardingProviders.keyOnly.probeCostUnknown')
    : probePlan.cost === 'free'
      ? t('onboardingProviders.keyOnly.probeCostFree')
      : probePlan.amount === null
        ? t('onboardingProviders.keyOnly.probeCostPaidUnpriced')
        : t('onboardingProviders.keyOnly.probeCostPaid', { amount: probePlan.amount })
  const inputRef = React.useRef<HTMLInputElement>(null)
  const errorId = React.useId()
  const { connection } = useVendorHealth(directory.vendorKey, {
    hasApiKey: hasApiKey || verificationPending, skipImplicitProbe: true,
  })
  // The copy resolver owns the pendingTitle/pendingHint branch so saved keys never fall back to “no key”.
  const credentialCopy = resolveCredentialCopy({ credentialMaterialSaved: saved, verificationPending, curatedModelsPublished })
  React.useEffect(() => {
    if (connection?.state === 'reachable') setVerificationPending(false)
  }, [connection?.state])

  const save = React.useCallback(async () => {
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
      const result = await catalog.upsertVendorApiKey(directory.vendorKey, { apiKey: cleanKey, enabled: false }) as { verificationPending?: boolean }
      setVerificationPending(result.verificationPending === true)
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
            {directory.logo ? <VendorLogoImage src={directory.logo} className="size-full" /> : directory.glyph}
          </span>
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-nomi-ink">{vendorName}</div>
            <div className="mt-1 text-caption leading-relaxed text-nomi-ink-40">
              {modelCount > 0
                ? t('onboardingProviders.keyOnly.catalogManaged', { count: modelCount })
                : t('onboardingProviders.keyOnly.catalogManagedNoModels')}
            </div>
          </div>
        </div>

        {modelCount > 0 ? (
          <div className="mt-4 flex flex-col gap-3" data-key-only-models>
            <ModelChipGroups models={visibleModels} connected={false} />
            {/* 只给「展开」不给「收起」：摊开之后再收回去对用户没有价值，而 ModelChipGroups 自己
                还有一条「更多」（放出旧目录模型）——两条纯文字链堆在一起只会互相打架。 */}
            {!allGroupsOpen && hiddenModelCount > 0 ? (
              <button
                type="button"
                data-key-only-models-toggle
                onClick={() => setAllGroupsOpen(true)}
                className="self-start text-caption text-nomi-ink-60 hover:text-nomi-accent"
              >
                {t('onboardingProviders.keyOnly.showAllModels')}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5" data-platform-key-only>
          {/* 地址行与已接入卡片共用同一份实现（VendorBaseUrlField），存法也是同一个入口。 */}
          {baseUrl ? (
            <div className="mb-4">
              <VendorBaseUrlField vendorKey={directory.vendorKey} vendorName={vendorName} baseUrl={baseUrl} disabled={busy} onSaved={onSaved} />
            </div>
          ) : null}
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
          {/* 「这台机器上到底存没存住这把 key」——**从 `saved` 派生**，不是给失败态另写一条文案分支
              （2026-09-17，W-17）。失败时用户读到的是一句错误话，而界面上没有任何地方回答
              他真正在问的那件事：那把 key 进去了没有。 */}
          <p className="mt-1 text-caption text-nomi-ink-40" data-vendor-key-stored={saved ? 'yes' : 'no'}>
            {t(saved ? 'onboardingProviders.keyOnly.storedYes' : 'onboardingProviders.keyOnly.storedNo', { name: vendorName })}
          </p>
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
            <div className="mt-5">
              {/* 按钮上方如实说这一下会发什么、花不花钱（T-MO-10）。文案的料源是主进程的探测策略，
                  不是这里按 vendor 名猜的——两份判断里会漂的那一份正好是钱。 */}
              <p className="text-caption leading-relaxed text-nomi-ink-40" data-credential-probe-cost={probePlan?.cost ?? 'unknown'}>
                {probeCostHint}
              </p>
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <DesignButton variant="light" onClick={onBack}>{t('common.back')}</DesignButton>
                <DesignButton variant="filled" loading={busy} onClick={save}>
                  {t('onboardingProviders.keyOnly.save')}
                </DesignButton>
              </div>
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
                  {t(credentialCopy.titleKey, { name: vendorName })}
                </div>
                <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">
                  {t(credentialCopy.hintKey, { count: modelCount })}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              {/* 已有 key 的情况提供「更换密钥」出口，让用户不被困在此页 */}
              {saved && apiKey === '' ? (
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
