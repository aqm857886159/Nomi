import { IconAlertTriangle, IconCheck } from '@tabler/icons-react'
import React from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { DesignSwitch, WorkbenchButton } from '../../design'
import { getDesktopBridge, type AssetTransportChannelView } from '../../desktop/bridge'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { buildProviderHealthView, type SettingsProviderInput } from './settingsAutomationView'
import { listWorkbenchModelCatalogModels, type ModelCatalogModelDto } from '../api/modelCatalogApi'
import { DefaultGenerationModelsSection } from './DefaultGenerationModelsSection'
import { VendorPreferenceOrderSection } from './VendorPreferenceOrderSection'
import { ModelBoxOrderSection } from './ModelBoxOrderSection'
import {
  getGenerationModelDefaults,
  loadGenerationModelDefaults,
  saveGenerationModelDefaults,
  subscribeGenerationModelDefaults,
  type GenerationModelDefaultMap,
} from '../generationCanvas/model/generationModelDefaults'

type Props = {
  settings: AutomationPolicySettings
  onChange: (patch: Partial<AutomationPolicySettings>) => void
  /** 打开模型工作区；带 vendorKey 时直接落到那家的接入页（上传通道卡靠它一步到 KIE 的 Key 框）。 */
  onOpenModelCatalog?: (vendorKey?: string) => void
}

/** 链接有效期的人话。不足 1 小时按分钟报——「0 小时」会让人以为是 bug。 */
function leaseLabel(ttlSeconds: number | null, t: TFunction): string {
  if (ttlSeconds === null) return t('settings.ai.upload.channel.leaseUnknown')
  if (ttlSeconds < 3600) return t('settings.ai.upload.channel.leaseMinutes', { count: Math.max(1, Math.round(ttlSeconds / 60)) })
  return t('settings.ai.upload.channel.leaseHours', { count: Math.round(ttlSeconds / 3600) })
}

/** 托管方显示名：认得的供应商用它的正式名；匿名公共托管报真实主机名（用户要知道是谁收了文件）。 */
function channelHostLabel(
  channel: AssetTransportChannelView,
  vendorNameOf: (vendorKey: string) => string,
  t: TFunction,
): string {
  if (channel.vendorKey) return vendorNameOf(channel.vendorKey)
  if (!channel.host) return t('settings.ai.upload.channel.none')
  return t('settings.ai.upload.channel.publicHost', { host: channel.host })
}

export function AiModelsSection({
  settings,
  onChange,
  onOpenModelCatalog,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [providers, setProviders] = React.useState<SettingsProviderInput[]>([])
  // 模型清单只喂「新建卡片默认模型」四个下拉（权限白名单 2026-09-14 已删）。
  const [models, setModels] = React.useState<ModelCatalogModelDto[]>([])
  // 「现在走哪条通道」问 main 的真解析器，渲染层不重算优先级（重算 = 第二个真相源，会和真实行为漂移）。
  const [channels, setChannels] = React.useState<AssetTransportChannelView[]>([])
  const [relayEndpoint, setRelayEndpoint] = React.useState('')
  const [relayToken, setRelayToken] = React.useState('')
  const [relayHasToken, setRelayHasToken] = React.useState(false)
  const [relayEnabled, setRelayEnabled] = React.useState(false)
  const [relaySaving, setRelaySaving] = React.useState(false)
  const [relayMessage, setRelayMessage] = React.useState('')

  React.useEffect(() => {
    try {
      const bridge = getDesktopBridge()
      const described = bridge?.assetTransport?.describeChannels()
      setChannels(Array.isArray(described) ? described : [])
      const values = bridge?.modelCatalog.listVendors() as SettingsProviderInput[] | undefined
      setProviders(Array.isArray(values) ? values : [])
      const relayApi = bridge?.settings?.assetRelay
      if (relayApi) {
        void relayApi.get()
          .then((value) => {
            if (!value) return
            setRelayEndpoint(value.endpoint || '')
            setRelayEnabled(Boolean(value.enabled))
            setRelayHasToken(Boolean(value.hasToken))
          })
          .catch(() => undefined)
      }
      void listWorkbenchModelCatalogModels({ enabled: true })
        .then((values) => setModels(Array.isArray(values) ? values : []))
        .catch(() => setModels([]))
    } catch {
      setProviders([])
    }
  }, [])

  const generationDefaults = React.useSyncExternalStore(
    subscribeGenerationModelDefaults,
    getGenerationModelDefaults,
    getGenerationModelDefaults,
  )
  React.useEffect(() => {
    void loadGenerationModelDefaults()
  }, [])
  const handleDefaultsChange = React.useCallback((next: GenerationModelDefaultMap) => {
    void saveGenerationModelDefaults(next)
  }, [])

  const saveRelay = React.useCallback(async (): Promise<void> => {
    const api = getDesktopBridge()?.settings?.assetRelay
    if (!api) return
    setRelaySaving(true)
    setRelayMessage('')
    try {
      const value = await api.set({
        enabled: Boolean(relayEndpoint.trim()),
        endpoint: relayEndpoint.trim(),
        ...(relayToken.trim() ? { token: relayToken.trim() } : {}),
      })
      setRelayEndpoint(value.endpoint || '')
      setRelayEnabled(Boolean(value.enabled))
      setRelayHasToken(Boolean(value.hasToken))
      setRelayToken('')
      setRelayMessage(t('settings.ai.upload.customRelay.saved'))
    } catch {
      setRelayMessage(t('settings.ai.upload.customRelay.failed'))
    } finally {
      setRelaySaving(false)
    }
  }, [relayEndpoint, relayToken, t])

  const clearRelay = React.useCallback(async (): Promise<void> => {
    const api = getDesktopBridge()?.settings?.assetRelay
    if (!api) return
    setRelaySaving(true)
    setRelayMessage('')
    try {
      await api.set({ enabled: false, endpoint: '', clearToken: true })
      setRelayEndpoint('')
      setRelayToken('')
      setRelayEnabled(false)
      setRelayHasToken(false)
      setRelayMessage(t('settings.ai.upload.customRelay.cleared'))
    } catch {
      setRelayMessage(t('settings.ai.upload.customRelay.failed'))
    } finally {
      setRelaySaving(false)
    }
  }, [t])

  const health = buildProviderHealthView(providers)
  // 「已接入」按**它是否真的在收文件**判，不按「key 存不存在」判——否则徽章说已接入、下面两行却写着
  // 走公共图床，用户不知道该信哪个。
  const kieConnected = channels.some((channel) => channel.vendorKey === 'kie')
  const vendorNameOf = React.useCallback(
    (vendorKey: string) => health.find((provider) => provider.key === vendorKey)?.name || vendorKey,
    [health],
  )
  // 「已配置」= 现在真的能调（`needs-key` / `disabled` 都不算）。排一个调不动的家没有意义，
  // 排了还会让人以为排完就能用。判据跟着 buildProviderHealthView 走，不在这里另立一套。
  const configuredVendorEntries = React.useMemo(
    () => health
      .filter((provider) => provider.state !== 'needs-key' && provider.state !== 'disabled')
      .map((provider) => ({ vendorKey: provider.key, name: translateModelDisplayText(provider.name) })),
    [health],
  )
  return (
    <div data-settings-section="ai-models">
      <h2 className="mb-5 text-title font-medium text-nomi-ink">{t('settings.ai.title')}</h2>

      <DefaultGenerationModelsSection
        models={models}
        vendorNameOf={vendorNameOf}
        defaults={generationDefaults}
        onChange={handleDefaultsChange}
      />

      {/* 「默认走哪个模型」的紧邻兄弟：「默认走哪家供应商」。两块都是「已接好的东西怎么用」，
          住一起才不会出现第二个「默认用什么」的家（设计系统 §1.5.2 / §1.7.2）。 */}
      <VendorPreferenceOrderSection entries={configuredVendorEntries} />

      {/* 「默认走哪家」定的是每一行里高亮哪个标签；这一块定的是**有哪几行、什么顺序**。
          两块必须紧挨着：用户心里它们是同一件事（「模型框里我看到什么」），分屏放就会去两个
          地方找同一件事（§1.5.2 一功能一个家）。 */}
      <ModelBoxOrderSection />

      {/* 2026-08-12 删掉顶部那段只读「模型连接」列表：模型的家搬去「模型」tab 之后，
          它就是第二个家；而且下面「默认模型策略」的勾选框本来就逐个列了 provider 且带状态，
          纯重复（P1 加新必删旧）。health 仍被策略区用来排序/取显示名，故变量保留。 */}
      <section className="mb-6" aria-labelledby="settings-upload-title">
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
        <div className="mt-2 grid gap-3 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 p-3" data-settings-upload-guidance>
          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-body-sm font-medium text-nomi-ink">{t('settings.ai.upload.channel.title')}</div>
              </div>
              {kieConnected ? (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-nomi-sm bg-[color-mix(in_oklch,var(--workbench-success)_12%,var(--nomi-paper))] px-2 py-1 text-caption text-[color:var(--workbench-success-ink)]">
                  <IconCheck size={13} stroke={2} aria-hidden="true" />
                  {t('settings.ai.upload.channel.kieConnected')}
                </span>
              ) : onOpenModelCatalog ? (
                <WorkbenchButton size="sm" className="shrink-0" onClick={() => onOpenModelCatalog('kie')}>
                  {t('settings.ai.upload.channel.configure')}
                </WorkbenchButton>
              ) : null}
            </div>
            <div className="mt-2 grid gap-1.5" data-settings-upload-channels>
              {channels.map((channel) => (
                <div
                  key={channel.kind}
                  data-upload-channel={channel.kind}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption"
                >
                  <span className="w-8 shrink-0 text-nomi-ink-60">{t(`settings.ai.upload.channel.kind.${channel.kind}`)}</span>
                  <span className="min-w-28 text-nomi-ink">{channelHostLabel(channel, vendorNameOf, t)}</span>
                  {channel.visibility === 'public-anonymous' || channel.visibility === 'public-provider' ? (
                    <span className="inline-flex items-center gap-1 rounded-nomi-sm bg-[color-mix(in_oklch,var(--nomi-warning)_12%,var(--nomi-paper))] px-1.5 py-0.5 text-[color:var(--nomi-warning)]">
                      <IconAlertTriangle size={12} stroke={2} aria-hidden="true" />
                      {t('settings.ai.upload.channel.publicLease', { lease: leaseLabel(channel.ttlSeconds, t) })}
                    </span>
                  ) : (
                    <span className="text-nomi-ink-40">
                      {t('settings.ai.upload.channel.privateLease', { lease: leaseLabel(channel.ttlSeconds, t) })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
          <details className="border-t border-nomi-line-soft pt-2" data-settings-custom-relay>
            <summary className="cursor-pointer text-caption font-medium text-nomi-ink-80">
              {t('settings.ai.upload.customRelay.title')}
            </summary>
            <div className="mt-2 grid gap-2">
              <div className="text-micro leading-relaxed text-nomi-ink-40">
                {t(kieConnected ? 'settings.ai.upload.channel.settled' : 'settings.ai.upload.channel.upsell')}
              </div>
              <div className="text-micro leading-relaxed text-nomi-ink-40">
                {t('settings.ai.upload.customRelay.hint')}
              </div>
              <label className="grid gap-1">
                <span className="text-micro text-nomi-ink-60">{t('settings.ai.upload.customRelay.endpoint')}</span>
                <input
                  data-settings-field="asset-relay-endpoint"
                  type="url"
                  value={relayEndpoint}
                  onChange={(event) => setRelayEndpoint(event.currentTarget.value)}
                  placeholder={t('settings.ai.upload.customRelay.endpointPlaceholder')}
                  aria-label={t('settings.ai.upload.customRelay.endpoint')}
                  className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink outline-none focus:border-nomi-accent"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-micro text-nomi-ink-60">{t('settings.ai.upload.customRelay.token')}</span>
                <input
                  data-settings-field="asset-relay-token"
                  type="password"
                  value={relayToken}
                  onChange={(event) => setRelayToken(event.currentTarget.value)}
                  placeholder={relayHasToken ? t('settings.ai.upload.customRelay.tokenSaved') : t('settings.ai.upload.customRelay.tokenPlaceholder')}
                  aria-label={t('settings.ai.upload.customRelay.token')}
                  className="h-8 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 text-caption text-nomi-ink outline-none focus:border-nomi-accent"
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <WorkbenchButton size="sm" disabled={relaySaving || !relayEndpoint.trim()} onClick={() => { void saveRelay() }}>
                  {t('settings.ai.upload.customRelay.save')}
                </WorkbenchButton>
                <WorkbenchButton size="sm" disabled={relaySaving || (!relayEnabled && !relayHasToken)} onClick={() => { void clearRelay() }}>
                  {t('settings.ai.upload.customRelay.clear')}
                </WorkbenchButton>
                {relayMessage ? <span className="text-micro text-nomi-ink-60" role="status">{relayMessage}</span> : null}
              </div>
            </div>
          </details>
          <div className="flex min-h-10 items-center justify-between gap-4 border-t border-nomi-line-soft pt-2">
            <div className="min-w-0">
              <div className="text-body-sm text-nomi-ink">{t('settings.ai.upload.anonymousPrompt')}</div>
              <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{t('settings.ai.upload.anonymousPromptHint')}</div>
            </div>
            <DesignSwitch
              checked={settings.anonymousAssetHosting === 'ask'}
              onChange={(event) => onChange({ anonymousAssetHosting: event.currentTarget.checked ? 'ask' : 'allow' })}
              aria-label={t('settings.ai.upload.anonymousPrompt')}
            />
          </div>
        </div>
      </section>
      {/* 2026-09-14 删掉了「默认模型策略」整栏（审计 §⑥ 4/7）：两段纯说明文字与 161 个「允许的供应商 /
          允许的模型」复选框。全局白名单不再存在——已接入的供应商/模型默认放行，每次提交在付费确认卡上
          定这次用哪家/哪个模型（`electron/productionRun/connectedModelScope.ts`）。 */}
    </div>
  )
}
