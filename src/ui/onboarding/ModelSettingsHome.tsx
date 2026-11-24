import React, { type JSX } from 'react'
import { IconChevronRight, IconServerBolt } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import type { DesktopHttpCertificationRun } from '../../desktop/onboardingBridgeTypes'
import { getDesktopBridge } from '../../desktop/bridge'
import { builtinVendorKeyOfKey } from '../../../electron/shared/builtinVendorIdentity'
import { confirmDialog, DesignButton, DesignSearchInput, NomiLoadingMark, StatusBadge, VendorLogoImage, WORKBENCH_BUTTON_PRIMARY_CLASS } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import type { ModelCatalogReadOnlyDto } from '../../workbench/api/modelCatalogApi'
import { AiAssistedOnboardingSection } from './AiAssistedOnboardingSection'
import { openApimartConnect } from './apimartConnectRoute'
import { ModelAccountCard } from './ModelAccountCard'
import { CatalogStatusNotices } from './ModelCatalogNotices'
import type { ChipModel } from './ModelChipGroups'
import { ModelStatusMark } from './ModelStatusMark'
import { connectionHomeStatus } from './modelSettingsHomeState'
import { QuotedUiNames } from './QuotedUiNames'

export type ModelSettingsHomeConnection = {
  vendorKey: string
  name: string
  kind: 'api' | 'local' | 'account'
  models: ChipModel[]
  auxiliaryCounts?: { tools: number; routes: number }
  logo?: string
  glyph?: string
  /** 这家要 key 而没有（本地 / 会员 / 不需要 key 的家不给）——连接级「待接入」只认这一条事实。 */
  keyMissing?: boolean
  onOpen: () => void
}

// 品牌标：有 logo 显图，无 logo 显首字母徽标。两者共用同一个「白底描边框」——
// 关键（2026-09-01 用户反馈「logo 参差」）：旧版徽标底色 = bg-nomi-ink-05，与整组行背景同色，
// 框子隐形、只剩两个悬空灰字，和带白框的 logo 排在一起明显不齐。统一成同一框即对齐。
function ConnectionMark({ connection }: { connection: ModelSettingsHomeConnection }): JSX.Element {
  return (
    <span
      data-connection-mark={connection.logo ? 'logo' : 'monogram'}
      className="grid size-7 shrink-0 place-items-center overflow-hidden rounded-nomi-sm border border-nomi-line bg-nomi-paper"
    >
      {connection.logo ? (
        <VendorLogoImage src={connection.logo} className="size-full" />
      ) : (
        <span className="text-caption font-semibold leading-none text-nomi-ink-60">
          {(connection.glyph || translateModelDisplayText(connection.name)).trim().slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  )
}

const BANNER_SEEN = 'nomi:model-settings:legacy-notice:v1'

type Props = {
  accounts: ModelSettingsHomeConnection[]
  previous: ModelSettingsHomeConnection[]
  connections: ModelSettingsHomeConnection[]
  loaded: boolean
  bridgeMissing: boolean
  loadError: string | null
  readOnly: ModelCatalogReadOnlyDto | null
  taskCount: number
  adapterRuns: readonly DesktopHttpCertificationRun[]
  taskContent?: React.ReactNode
  onAddress: (vendor: string) => void
  onUsage: (vendor: string) => void
  onWays: () => void
  onChanged: () => void
  onReload: () => void
}

export function ModelSettingsHome({ accounts, previous, connections, loaded, bridgeMissing, loadError, readOnly,
  taskCount, adapterRuns, taskContent, onAddress, onUsage, onWays, onChanged, onReload }: Props): JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = React.useState('')
  const [seen, setSeen] = React.useState(() => {
    try { return localStorage.getItem(BANNER_SEEN) === '1' } catch { return false }
  })
  const [error, setError] = React.useState('')
  const dismiss = () => {
    setSeen(true)
    try { localStorage.setItem(BANNER_SEEN, '1') } catch { /* Session dismissal still applies. */ }
  }
  const disconnect = async (c: ModelSettingsHomeConnection) => {
    const ok = await confirmDialog({ title: t('onboardingProviders.vendorCard.disconnectTitle'),
      message: t('onboardingProviders.vendorCard.disconnectMessage', { name: c.name }),
      confirmLabel: t('onboardingProviders.vendorCard.disconnect'), danger: true })
    if (!ok) return
    try {
      getDesktopBridge()!.modelCatalog.clearVendorApiKey(c.vendorKey)
      setError('')
      onChanged()
    } catch (e) { setError(t('onboardingProviders.vendorCard.disconnectFailed', { message: String(e) })) }
  }
  const showSearch = previous.length > 4
  const query = showSearch ? search.trim().toLocaleLowerCase() : ''
  const filtered = previous.filter(c => [c.name, translateModelDisplayText(c.name), ...c.models.flatMap(m => [m.modelKey, m.labelZh])]
    .some(value => value.toLocaleLowerCase().includes(query)))
  const models = accounts.flatMap(c => c.models).filter(m => m.availability?.usable)
  const counts = Object.fromEntries(['image', 'video', 'audio', 'text'].map(kind => [kind, models.filter(m => m.kind === kind).length]))
  const subtitle = [previous.length ? t('settings.modelsHome.legacyCount', { count: previous.length }) : '',
    accounts.length ? 'APIMart ' + t('settings.modelsHome.connected') : t('settings.modelsHome.disconnected'),
    accounts.length ? t('settings.modelsHome.counts', counts) : ''].filter(Boolean).join(' · ')
  return <div className="min-h-0 overflow-y-auto" data-model-settings-page="home">
    <header className="border-b border-nomi-line px-4 py-2.5 pr-14">
      <h2 className="text-body font-semibold">{t('onboardingProviders.drawer.home.title')}</h2>
      {loaded && !loadError && <p className="text-micro text-nomi-ink-60">{subtitle}</p>}
    </header>
    <div className="grid gap-3 p-4">
      <CatalogStatusNotices readOnly={readOnly} loadError={loadError} onRetry={onReload} />
      {bridgeMissing ? <div role="alert">{t('onboardingProviders.drawer.bridgeMissingTitle')} <DesignButton onClick={onReload}>{t('common.reload')}</DesignButton></div>
        : !loaded ? <NomiLoadingMark size={16} /> : <>
          {accounts.map(c => <ModelAccountCard key={c.vendorKey} vendor={c.vendorKey} name={c.name}
            onAddress={() => onAddress(c.vendorKey)} onManage={c.onOpen} onDisconnect={() => { void disconnect(c) }}
            readOnly={Boolean(readOnly)} onUsage={() => onUsage(c.vendorKey)} />)}
          {!accounts.length && !loadError && !readOnly && <button type="button" data-model-home-available="apimart"
            onClick={openApimartConnect} className="flex w-full items-center gap-3 rounded-nomi-sm border border-nomi-line p-3 text-left hover:bg-nomi-ink-05">
            <span className="min-w-0 flex-1">
              <strong className="block text-body-sm">{t('settings.modelsHome.platform')}</strong>
              <span className="text-caption text-nomi-ink-60">{t('settings.modelsHome.intro')}</span>
            </span>
            <span className={WORKBENCH_BUTTON_PRIMARY_CLASS + ' shrink-0 rounded-pill px-3 py-1 text-caption font-semibold'}>{t('settings.modelsHome.connect')}</span>
          </button>}
          {error && <p role="alert" className="text-caption text-workbench-danger">{error}</p>}
          {previous.length > 0 && <>
            {!seen && <div data-legacy-notice className="rounded-nomi-sm bg-nomi-info-soft p-3 text-caption text-nomi-info-ink">
              <p>{t('settings.modelsHome.banner')}</p><button className="mt-1 font-semibold" onClick={dismiss}>{t('settings.modelsHome.dismiss')}</button>
            </div>}
            <section data-model-home-connected>
              <h3 className="mb-2 flex items-baseline gap-2 text-caption font-semibold">{t('settings.modelsHome.legacy')}
                <span className="text-micro font-normal text-nomi-ink-60">{t('settings.modelsHome.connections', { count: previous.length })}</span>
              </h3>
              {showSearch && <DesignSearchInput className="mb-2 w-full" value={search} onChange={setSearch}
                placeholder={t('onboardingProviders.drawer.home.search')} ariaLabel={t('onboardingProviders.drawer.home.search')} />}
              <div className="divide-y divide-nomi-line-soft rounded-nomi-sm border border-nomi-line">
                {filtered.map(c => <button key={c.vendorKey} type="button" data-model-home-connection={c.vendorKey} onClick={c.onOpen}
                  className="flex min-h-11 w-full items-center gap-2 px-2 text-left hover:bg-nomi-ink-05">
                  <ConnectionMark connection={c} /><span className="min-w-0 flex-1 truncate text-caption" title={c.name}>{translateModelDisplayText(c.name)}</span>
                  <StatusBadge tone={builtinVendorKeyOfKey(c.vendorKey) === 'kie' ? 'success' : 'warning'} className="normal-case">
                    <QuotedUiNames text={t(builtinVendorKeyOfKey(c.vendorKey) === 'kie' ? 'settings.modelsHome.kie' : 'settings.modelsHome.maintenance')} />
                  </StatusBadge>
                  <ModelStatusMark status={connectionHomeStatus(c)} variant="row" /><IconChevronRight size={13} />
                </button>)}
                {!filtered.length && <p className="p-3 text-caption">{t('onboardingProviders.drawer.home.noResults')}</p>}
              </div>
            </section>
          </>}
          {taskCount > 0 && <section data-model-home-task-strip>{taskContent}</section>}
          <h3 className="text-caption font-semibold">{t('settings.modelsHome.others')}</h3>
          <AiAssistedOnboardingSection connections={connections} runs={adapterRuns} />
          <button data-model-home-action="other-ways" className="flex items-center gap-3 rounded-nomi-sm border border-nomi-line p-3 text-left hover:bg-nomi-ink-05" onClick={onWays}>
            <IconServerBolt size={18} /><span className="min-w-0 flex-1"><strong className="block text-caption">{t('settings.modelsHome.ways')}</strong>
              <span className="text-micro text-nomi-ink-60">{t('settings.modelsHome.waysHint')}</span></span><IconChevronRight size={14} />
          </button>
        </>}
    </div>
  </div>
}
