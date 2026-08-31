/**
 * 供应商接入卡（apimart / kie 等已知供应商复用，P4 通用第一）。
 *
 * 方案 A：折成一行摘要（FoldableModelCard），点开 body 才露出 key 区 + 模型 chip + 推广。
 * - 待接入：默认展开，body 显 key 输入 + 解锁。
 * - 已连通：默认折叠；展开后 key 区显「已保存 · 更换/断开」，模型 chip 点亮。
 * 填 key → upsertVendorApiKey（后端零改动，模型已 seed）。模型清单从 catalog 派生。
 * 接入地址可就地编辑 → upsertVendor 只改 baseUrlHint（seed 存在即跳过，用户改动不被启动刷回）。
 * 样张：docs/design/mockups/onboarding-panel-A.html
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconKey, IconExternalLink } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { getDesktopBridge } from '../../desktop/bridge'
import { confirmDialog } from '../../design'
import type { KnownVendor } from '../../config/knownVendors'
import { FoldableModelCard } from './FoldableModelCard'
import { ModelChipGroups, type ChipModel } from './ModelChipGroups'
import { VendorBaseUrlField } from './VendorBaseUrlField'
import { useVendorHealth } from './useVendorHealth'
import { vendorConnectionPill } from './vendorConnectionView'
import { VendorConnectionNotice } from './VendorConnectionNotice'
import type { ModelSettingsConnectionFocus } from './modelSettingsNavigation'
import {
  resolveKeyOnlySaveOutcome,
  type KeyOnlyCredentialMode,
} from './keyOnlyConnectionPolicy'

type VendorOnboardCardProps = {
  directory: KnownVendor
  /** catalog 里的供应商显示名（vendor.name）。 */
  vendorName: string
  /** catalog 里的 baseUrlHint（信息展示用）。 */
  baseUrl: string
  /** 该供应商是否已绑定 key（catalog vendor.hasApiKey）。 */
  hasApiKey: boolean
  /** catalog vendor.enabled；direct-key 连接只有 key + enabled 才算可用。 */
  enabled?: boolean
  /** 该供应商的预置模型（从 catalog 派生）。 */
  models: ChipModel[]
  /** 后端 public vendor DTO 派生的凭证流程；缺省认证，避免 renderer 自授权。 */
  credentialMode?: KeyOnlyCredentialMode
  /** 模型启停（选中=进节点模型列表；取消=隐藏）。传入则 chip 可点选。 */
  onToggleModel?: (model: ChipModel, enabled: boolean) => void
  /** key 绑定/清除后刷新外层。 */
  onChanged: () => void
  onOpenDetails?: () => void
  detailMode?: boolean
  onOpenModel?: (model: ChipModel) => void
  focus?: ModelSettingsConnectionFocus
}

export function VendorOnboardCard({
  directory,
  vendorName,
  baseUrl,
  hasApiKey,
  enabled = true,
  models,
  credentialMode = 'certification',
  onToggleModel,
  onChanged,
  onOpenDetails,
  detailMode = false,
  onOpenModel,
  focus,
}: VendorOnboardCardProps): JSX.Element {
  const { t } = useTranslation()
  // Certification rows preserve their historical staged-key presentation;
  // direct-key rows additionally require the backend's enabled bit. This
  // keeps a denied APIMart promotion editable after the outer catalog refresh.
  const usableKey = hasApiKey && (credentialMode !== 'direct-key' || enabled)
  // 已连通默认折叠 key 输入（显「已保存」）；点「更换」展开输入。
  const [editing, setEditing] = React.useState(!usableKey)
  // 多段凭证（如火山语音 App ID + Access Token）的草稿，按字段 key 存；单段家只有一个字段。
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const credentialInputRef = React.useRef<HTMLInputElement>(null)
  const handledFocusRequestRef = React.useRef<number | null>(null)
  // 连接状态的唯一来源（主进程自取凭证探测）。地址一改 fingerprint 就变，effect 自动重探；
  // 换 key 不改地址，所以解锁后要显式 recheck()。
  const { connection, recheck } = useVendorHealth(directory.vendorKey, { hasApiKey: usableKey, baseUrl })

  React.useEffect(() => {
    setEditing(!usableKey)
  }, [usableKey])

  // 只管 apiKey 那一路；baseUrl 的聚焦请求由 VendorBaseUrlField 自己认（它持有那个 input）。
  React.useEffect(() => {
    if (!focus || focus.target !== 'apiKey' || handledFocusRequestRef.current === focus.requestId) return
    handledFocusRequestRef.current = focus.requestId
    setEditing(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        credentialInputRef.current?.focus({ preventScroll: false })
        credentialInputRef.current?.scrollIntoView({ block: 'center' })
      })
    })
  }, [focus])

  const total = models.length

  // 凭证字段：档案声明了 credentialFields 就按声明渲染多框；否则退化成单框（沿用 credentialPlaceholder）。
  const fields = React.useMemo(
    () =>
      directory.credentialFields ?? [
        {
          key: 'apiKey',
          label: '',
          placeholder: directory.credentialPlaceholder ?? t('onboardingProviders.vendorCard.defaultKeyPlaceholder'),
          secret: true,
        },
      ],
    [directory.credentialFields, directory.credentialPlaceholder, t],
  )
  const isMulti = fields.length > 1

  const setDraft = React.useCallback((key: string, value: string) => {
    setDrafts((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleUnlock = React.useCallback(() => {
    const parts = fields.map((field) => (drafts[field.key] ?? '').trim())
    if (parts.some((part) => !part)) {
      setError(
        isMulti
          ? t('onboardingProviders.vendorCard.fillAllCredentials')
          : t('onboardingProviders.vendorCard.pasteApiKeyFirst'),
      )
      return
    }
    // 多段拼成单串存进唯一 key 槽（火山语音 → APP_ID:ACCESS_KEY）；后端按同一分隔符拆。
    const apiKey = parts.join(directory.credentialJoin ?? ':')
    const bridge = getDesktopBridge()
    if (!bridge) return
    setBusy(true)
    setError('')
    try {
      // Ask the main-process policy to activate this connection. Certification
      // rows stay disabled while a key is staged; only a code-owned direct-key
      // contract is pre-enabled so the backend can evaluate its promotion bit.
      bridge.modelCatalog.upsertVendor({ key: directory.vendorKey, enabled: credentialMode === 'direct-key' })
      const saved = bridge.modelCatalog.upsertVendorApiKey(directory.vendorKey, { apiKey, enabled: true }) as {
        enabled?: boolean
      }
      // Even if an older backend echoes enabled=true, certification mode must
      // remain fail-closed in the renderer.
      const enabled = credentialMode === 'direct-key' && saved?.enabled === true
      const outcome = resolveKeyOnlySaveOutcome(credentialMode, enabled)
      bridge.modelCatalog.upsertVendor({ key: directory.vendorKey, enabled })
      if (outcome === 'rejected') {
        setError(t('onboardingProviders.keyOnly.directKeyUnavailable'))
        onChanged()
        return
      }
      setDrafts({})
      setEditing(false)
      onChanged()
      // 保存是本地同步写入，永不被网络阻塞。连通性交给旁路的 useVendorHealth——
      // 换 key 不改地址（fingerprint 不变），所以这里显式重探一次。
      recheck()
    } catch (e) {
      if (credentialMode === 'direct-key') {
        try { bridge?.modelCatalog.upsertVendor({ key: directory.vendorKey, enabled: false }) } catch { /* best effort rollback */ }
      }
      setError(
        t('onboardingProviders.vendorCard.unlockFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    } finally {
      setBusy(false)
    }
  }, [fields, drafts, isMulti, credentialMode, directory.vendorKey, directory.credentialJoin, onChanged, recheck, t])

  const handleDisconnect = React.useCallback(async () => {
    const bridge = getDesktopBridge()
    if (!bridge) return
    const ok = await confirmDialog({
      title: t('onboardingProviders.vendorCard.disconnectTitle'),
      message: t('onboardingProviders.vendorCard.disconnectMessage', { name: vendorName }),
      confirmLabel: t('onboardingProviders.vendorCard.disconnect'),
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    setError('')
    try {
      bridge.modelCatalog.clearVendorApiKey(directory.vendorKey)
      onChanged()
    } catch (e) {
      setError(
        t('onboardingProviders.vendorCard.disconnectFailed', { message: e instanceof Error ? e.message : String(e) }),
      )
    } finally {
      setBusy(false)
    }
  }, [directory.vendorKey, vendorName, onChanged, t])

  const openPromo = React.useCallback(() => {
    if (directory.promo) window.open(directory.promo.url, '_blank', 'noopener')
  }, [directory.promo])

  const pill = connection ? vendorConnectionPill(connection) : null

  return (
    <FoldableModelCard
      glyph={
        directory.logo ? <img src={directory.logo} alt="" className="w-full h-full object-contain" /> : directory.glyph
      }
      glyphTone={directory.logo ? 'logo' : 'ink'}
      name={vendorName}
      subtitle={usableKey ? t('onboardingProviders.vendorCard.modelsAvailable', { count: total }) : directory.tagline}
      status={pill?.status ?? 'todo'}
      statusLabel={pill ? t(pill.labelKey) : undefined}
      badge={
        !usableKey && directory.recommended ? (
          <span className="text-micro font-semibold text-nomi-accent bg-nomi-accent-soft rounded-full px-2 py-[2px] whitespace-nowrap">
            {t('onboardingProviders.vendorCard.recommended')}
          </span>
        ) : undefined
      }
      defaultExpanded={false}
      onOpenDetails={onOpenDetails}
      detailMode={detailMode}
    >
      {/* key 区 */}
      {editing ? (
        <div className="flex flex-col gap-2">
          {isMulti ? (
            // 多段凭证：每段一个标注好的独立框，别让用户自己拼（D1）。
            <div className="flex flex-col gap-2.5">
              {fields.map((field) => (
                <div key={field.key} className="flex flex-col gap-1">
                  <label
                    htmlFor={`${directory.vendorKey}-${field.key}`}
                    className="text-caption font-medium text-nomi-ink-80"
                  >
                    {field.label}
                  </label>
                  <input
                    ref={field === fields[0] ? credentialInputRef : undefined}
                    data-model-connection-field="apiKey"
                    id={`${directory.vendorKey}-${field.key}`}
                    type={field.secret ? 'password' : 'text'}
                    aria-label={`${vendorName} ${field.label}`}
                    placeholder={field.placeholder}
                    value={drafts[field.key] ?? ''}
                    onChange={(e) => setDraft(field.key, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleUnlock()
                    }}
                    disabled={busy}
                    className={cn(
                      'h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                      'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40',
                      'outline-none focus:border-nomi-accent',
                    )}
                  />
                  {field.hint ? <div className="text-micro text-nomi-ink-40">{field.hint}</div> : null}
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleUnlock}
                  disabled={busy}
                  className={cn(
                    'shrink-0 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                    'text-body-sm font-semibold inline-flex items-center gap-1.5',
                    'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <IconKey size={14} stroke={1.6} />
                  {t('onboardingProviders.vendorCard.unlock')}
                </button>
                {usableKey ? (
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    disabled={busy}
                    className="text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
                  >
                    {t('common.cancel')}
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            // 单段凭证：输入框 + 解锁按钮同排（绝大多数家）。
            <>
              <div className="flex gap-2">
                <input
                  ref={credentialInputRef}
                  data-model-connection-field="apiKey"
                  type={fields[0].secret ? 'password' : 'text'}
                  aria-label={t('onboardingProviders.vendorCard.apiKeyAria', { name: vendorName })}
                  placeholder={fields[0].placeholder}
                  value={drafts[fields[0].key] ?? ''}
                  onChange={(e) => setDraft(fields[0].key, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUnlock()
                  }}
                  disabled={busy}
                  className={cn(
                    'flex-1 min-w-0 h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2.5',
                    'text-body-sm text-nomi-ink placeholder:text-nomi-ink-40',
                    'outline-none focus:border-nomi-accent',
                  )}
                />
                <button
                  type="button"
                  onClick={handleUnlock}
                  disabled={busy}
                  className={cn(
                    'shrink-0 h-8 px-3 rounded-nomi-sm bg-nomi-ink text-nomi-paper',
                    'text-body-sm font-semibold inline-flex items-center gap-1.5',
                    'hover:bg-nomi-accent disabled:opacity-50 disabled:cursor-not-allowed',
                  )}
                >
                  <IconKey size={14} stroke={1.6} />
                  {t('onboardingProviders.vendorCard.unlock')}
                </button>
              </div>
              {usableKey ? (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={busy}
                  className="self-start text-caption text-nomi-ink-40 hover:text-nomi-ink-60"
                >
                  {t('common.cancel')}
                </button>
              ) : null}
            </>
          )}
          <div className="text-caption text-nomi-ink-40">
            {directory.credentialHint ?? t('onboardingProviders.vendorCard.credentialHint')}
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-nomi-ink-60">{t('onboardingProviders.vendorCard.credentialSaved')}</span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              data-model-connection-edit="apiKey"
              disabled={busy}
              className="text-caption text-nomi-ink-60 border border-nomi-line rounded-full px-2.5 py-[3px] hover:border-nomi-ink-20"
            >
              {t('onboardingProviders.vendorCard.replace')}
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy}
              className="text-caption text-nomi-ink-40 px-1 hover:text-workbench-danger"
            >
              {t('onboardingProviders.vendorCard.disconnect')}
            </button>
          </div>
        </div>
      )}

      {error ? <div className="text-caption text-workbench-danger">{error}</div> : null}

      {/* 连接状态说明：紧挨地址行，用户看完原因就能就地改地址。 */}
      <VendorConnectionNotice connection={connection} onRecheck={recheck} disabled={busy} />

      {/* 地址行与自定义中转家卡共用同一份实现（P1：此前两边各写了一份一模一样的）。 */}
      <VendorBaseUrlField
        vendorKey={directory.vendorKey}
        vendorName={vendorName}
        baseUrl={baseUrl}
        disabled={busy}
        onSaved={onChanged}
        hideWhenEmpty
        focus={focus}
      />

      <ModelChipGroups
        models={models}
        connected={usableKey}
        onToggle={usableKey ? onToggleModel : undefined}
        onOpenModel={onOpenModel}
      />

      {/* 推广位：移到 body 末尾，折叠态不显（减噪）；软话术、不营销 */}
      {directory.promo ? (
        <div className="flex items-center gap-2 border-t border-nomi-line-soft pt-3">
          <span className="flex-1 min-w-0 text-caption text-nomi-ink-40 leading-snug">{directory.promo.text}</span>
          <button
            type="button"
            onClick={openPromo}
            className="shrink-0 inline-flex items-center gap-1 text-caption text-nomi-ink-60 hover:text-nomi-accent"
          >
            {directory.promo.ctaLabel}
            <IconExternalLink size={13} stroke={1.6} />
          </button>
        </div>
      ) : null}
    </FoldableModelCard>
  )
}
