import React from 'react'
import {
  IconChevronDown,
  IconChevronRight,
  IconCloud,
  IconCode,
  IconPlugConnected,
  IconServerBolt,
} from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import type { Mapping } from '../../../electron/catalog/types'
import { DesignButton, DesignSearchInput, NomiLoadingMark } from '../../design'
import { translateModelDisplayText } from '../../i18n/modelDisplayText'
import { cn } from '../../utils/cn'
import type { ChipModel } from './ModelChipGroups'
import { useVendorHealth } from './useVendorHealth'
import { vendorConnectionPill } from './vendorConnectionView'
import {
  resolveModelHomeStatus,
  summarizeModelHomeConnection,
  type ModelHomeConnectionState,
} from './modelSettingsHomeState'

const CONNECTION_STATUS_TONE = {
  working: 'bg-nomi-accent',
  verified: 'bg-workbench-success',
  attention: 'bg-nomi-warning',
  disabled: 'bg-nomi-ink-20',
} as const

const CONNECTION_STATUS_TEXT_TONE = {
  working: 'text-nomi-accent',
  verified: 'text-nomi-ink-60',
  attention: 'text-nomi-warning',
  disabled: 'text-nomi-ink-40',
} as const

export type ModelSettingsHomeConnection = {
  vendorKey: string
  name: string
  kind: 'api' | 'local' | 'account'
  models: ChipModel[]
  auxiliaryCounts?: { tools: number; routes: number }
  logo?: string
  glyph?: string
  /** 连接健康探测要的两个入参；缺省（本地/会员类连接）则这一行不探。 */
  baseUrl?: string
  hasApiKey?: boolean
  /** direct-script 那类家没有可预检的通用接口，别白探（与卡片侧同一套策略）。 */
  skipHealthProbe?: boolean
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
        <img src={connection.logo} alt="" className="size-full object-contain" />
      ) : (
        <span className="text-caption font-semibold leading-none text-nomi-ink-60">
          {(connection.glyph || translateModelDisplayText(connection.name)).trim().slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  )
}

function SectionHeading({ title, aside }: { title: string; aside?: string }): JSX.Element {
  return (
    <div className="mb-2 flex min-h-5 items-center justify-between gap-3">
      <h3 className="text-caption font-semibold text-nomi-ink-60">{title}</h3>
      {aside ? <span className="text-micro text-nomi-ink-40">{aside}</span> : null}
    </div>
  )
}

function RowGroup({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="overflow-hidden rounded-nomi-sm bg-nomi-ink-05 [&>*+*]:border-t [&>*+*]:border-nomi-line-soft">
      {children}
    </div>
  )
}

function ActionRow({
  icon,
  title,
  hint,
  end,
  badge,
  onClick,
  expanded,
  dataMarker,
  directScript = false,
}: {
  icon: React.ReactNode
  title: string
  hint: string
  end?: string
  badge?: string
  onClick: () => void
  expanded?: boolean
  dataMarker?: string
  directScript?: boolean
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      data-model-home-action={dataMarker}
      data-model-home-direct-script={directScript ? '' : undefined}
      className="group flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-nomi-ink-10"
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-nomi-sm bg-nomi-ink-05 text-nomi-ink-60">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-caption font-semibold text-nomi-ink">{title}</span>
          {badge ? (
            <span className="rounded-full bg-nomi-accent-soft px-2 py-0.5 text-micro font-semibold text-nomi-accent">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-micro leading-relaxed text-nomi-ink-40">{hint}</span>
      </span>
      {end ? <span className="shrink-0 text-micro text-nomi-ink-40">{end}</span> : null}
      {expanded === undefined ? (
        <IconChevronRight size={15} stroke={1.7} className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent" aria-hidden="true" />
      ) : (
        <IconChevronDown
          size={15}
          stroke={1.7}
          className={cn('shrink-0 text-nomi-ink-30 transition-transform', expanded && 'rotate-180')}
          aria-hidden="true"
        />
      )}
    </button>
  )
}

function AvailableConnectionRow({
  connection,
  title,
  hint,
  badge,
  end,
}: {
  connection: ModelSettingsHomeConnection
  title?: string
  hint: string
  badge?: string
  end?: string
}): JSX.Element {
  const displayName = translateModelDisplayText(connection.name)
  return (
    <button
      type="button"
      onClick={connection.onOpen}
      data-model-home-available={connection.vendorKey}
      className="group flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-nomi-ink-10"
    >
      <ConnectionMark connection={connection} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-caption font-semibold text-nomi-ink">{title ?? displayName}</span>
          {badge ? (
            <span className="rounded-full bg-nomi-accent-soft px-2 py-0.5 text-micro font-semibold text-nomi-accent">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-micro leading-relaxed text-nomi-ink-40">{hint}</span>
      </span>
      {end ? <span className="shrink-0 text-micro text-nomi-ink-40">{end}</span> : null}
      <IconChevronRight size={15} stroke={1.7} className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent" aria-hidden="true" />
    </button>
  )
}

/**
 * 已连入的一行。**单独成组件是为了能调 useVendorHealth**（hook 不能在 map 回调里调）——
 * 复用卡片侧那个现成 hook，不另写一套探测（P1）；主进程自带新鲜期缓存与并发去重，
 * 同一家在首页行与详情卡之间共享同一份结果，不会探两遍。
 *
 * 为什么这一行非要显示连接健康（2026-08-18）：此前它只算 summarizeModelHomeConnection（模型能力，
 * 不看网络），于是一家 401 的中转站在**用户扫视的这一屏**上写着灰色「24 个可使用」——
 * 群里「翻了半天没找到改 api url 的地方」，一半原因是他压根不知道该点哪一行。
 * 连不上压倒模型统计（与 CustomVendorCard 的胶囊同一套语义）。
 */
function ConnectedRow({
  connection,
  mappings,
  onHealthChange,
}: {
  connection: ModelSettingsHomeConnection
  mappings: readonly Mapping[]
  /** 把「这家连不上」报给区块标题，免得标题写「24 个可使用」而底下那行写「连不上」。 */
  onHealthChange: (vendorKey: string, unreachable: boolean) => void
}): JSX.Element {
  const { t } = useTranslation()
  const displayName = translateModelDisplayText(connection.name)
  const { connection: health } = useVendorHealth(connection.vendorKey, {
    hasApiKey: connection.hasApiKey ?? false,
    baseUrl: connection.baseUrl ?? '',
    disableProbe: connection.skipHealthProbe ?? false,
  })
  const summary = summarizeModelHomeConnection(connection.models, mappings)
  const pill = health ? vendorConnectionPill(health) : null
  const unreachable = pill?.status === 'error'

  React.useEffect(() => {
    onHealthChange(connection.vendorKey, unreachable)
  }, [connection.vendorKey, unreachable, onHealthChange])
  const state: ModelHomeConnectionState = unreachable ? 'attention' : summary.state
  const statusLabel = unreachable && pill
    ? t(pill.labelKey)
    : summary.state === 'attention'
      ? t('onboardingProviders.drawer.home.needsSetupCount', { count: summary.needsSetup })
      : summary.state === 'working'
        ? t('onboardingProviders.drawer.home.workingCount', { count: summary.working })
        : summary.state === 'disabled'
          ? t('onboardingProviders.drawer.home.disabledCount', { count: summary.disabled })
          : t('onboardingProviders.drawer.home.readyCount', { count: summary.ready })

  return (
    <button
      type="button"
      onClick={connection.onOpen}
      data-model-home-connection={connection.vendorKey}
      data-model-home-unreachable={unreachable ? '' : undefined}
      className="group flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-nomi-ink-10"
    >
      <ConnectionMark connection={connection} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-caption font-semibold text-nomi-ink">{displayName}</span>
        <span className="mt-0.5 block text-micro leading-relaxed text-nomi-ink-40">
          {connection.auxiliaryCounts
            ? t('antigravity.catalogSummary', { count: connection.models.length, ...connection.auxiliaryCounts })
            : t('onboardingProviders.drawer.home.connectionSummary', { count: connection.models.length })}
        </span>
      </span>
      <span className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-micro',
        unreachable ? 'text-workbench-danger' : CONNECTION_STATUS_TEXT_TONE[state],
      )}>
        <span className={cn(
          'size-1.5 rounded-full',
          unreachable ? 'bg-workbench-danger' : CONNECTION_STATUS_TONE[state],
        )} />
        {statusLabel}
      </span>
      <IconChevronRight size={15} stroke={1.7} className="shrink-0 text-nomi-ink-30 group-hover:text-nomi-accent" aria-hidden="true" />
    </button>
  )
}

function ConnectedRows({
  connections,
  mappings,
  search,
  onHealthChange,
}: {
  connections: ModelSettingsHomeConnection[]
  mappings: readonly Mapping[]
  search: string
  onHealthChange: (vendorKey: string, unreachable: boolean) => void
}): JSX.Element | null {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filtered = connections.filter((connection) => {
    if (!normalizedSearch) return true
    return `${connection.name} ${translateModelDisplayText(connection.name)}`.toLocaleLowerCase().includes(normalizedSearch) || connection.models.some((model) => (
      `${model.labelZh} ${model.modelKey}`.toLocaleLowerCase().includes(normalizedSearch)
    ))
  })
  if (filtered.length === 0) return null

  return (
    <RowGroup>
      {filtered.map((connection) => (
        <ConnectedRow
          key={connection.vendorKey}
          connection={connection}
          mappings={mappings}
          onHealthChange={onHealthChange}
        />
      ))}
    </RowGroup>
  )
}

function availableHint(connection: ModelSettingsHomeConnection, t: ReturnType<typeof useTranslation>['t']): string {
  if (connection.vendorKey === 'apimart') return t('onboardingProviders.drawer.home.apimartHint')
  if (connection.vendorKey === 'kie') return t('onboardingProviders.drawer.home.kieHint')
  if (connection.vendorKey.startsWith('comfyui')) return t('onboardingProviders.drawer.home.comfyuiHint')
  if (connection.vendorKey === 'dreamina-member') return t('onboardingProviders.drawer.home.dreaminaHint')
  if (connection.vendorKey === 'codex-local') return t('onboardingProviders.drawer.home.codexImageHint')
  if (connection.vendorKey === 'antigravity-cli') return t('antigravity.subtitle')
  return t('onboardingProviders.drawer.home.adaptedHint', { name: translateModelDisplayText(connection.name) })
}

export function ModelSettingsHome({
  connections,
  availableConnections,
  mappings,
  loaded,
  bridgeMissing,
  taskCount,
  taskContent,
  diagnostic,
  networkContent,
  dataSourceContent,
  availableFooter,
  onReload,
  onCustomApi,
  onDirectScript,
}: {
  connections: ModelSettingsHomeConnection[]
  availableConnections: ModelSettingsHomeConnection[]
  mappings: readonly Mapping[]
  loaded: boolean
  bridgeMissing: boolean
  taskCount: number
  taskContent?: React.ReactNode
  diagnostic?: React.ReactNode
  networkContent?: React.ReactNode
  /** 数据源 connector（BYO-key，产出的是「素材数据」不是「可调用模型」，故独立成组、不混进模型家清单）。 */
  dataSourceContent?: React.ReactNode
  availableFooter?: React.ReactNode
  onReload: () => void
  onCustomApi: () => void
  onDirectScript: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [search, setSearch] = React.useState('')
  const [morePlatformsOpen, setMorePlatformsOpen] = React.useState(false)
  const [otherWaysOpen, setOtherWaysOpen] = React.useState(false)
  // 各行探完把结果报上来（探测本身仍归每行的 useVendorHealth，这里只收结论，不第二次探）。
  const [unreachableKeys, setUnreachableKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const handleHealthChange = React.useCallback((vendorKey: string, unreachable: boolean) => {
    setUnreachableKeys((prev) => {
      if (prev.has(vendorKey) === unreachable) return prev
      const next = new Set(prev)
      if (unreachable) next.add(vendorKey)
      else next.delete(vendorKey)
      return next
    })
  }, [])
  const allModels = connections.flatMap((connection) => connection.models)
  const statuses = allModels.map((model) => resolveModelHomeStatus(model, mappings))
  const needsSetupCount = statuses.filter((status) => status === 'needsSetup' || status === 'failed').length
  const hasConnections = connections.length > 0
  const showSearch = hasConnections && (connections.length >= 4 || allModels.length >= 8)
  const hasAttention = taskCount > 0 || needsSetupCount > 0

  const adaptedAvailable = availableConnections.filter((connection) => connection.kind === 'api')
  const primaryPlatforms = ['apimart', 'kie']
    .map((vendorKey) => adaptedAvailable.find((connection) => connection.vendorKey === vendorKey))
    .filter((connection): connection is ModelSettingsHomeConnection => Boolean(connection))
  const otherAdapted = adaptedAvailable.filter((connection) => !['apimart', 'kie'].includes(connection.vendorKey))
  const otherAvailable = availableConnections.filter((connection) => connection.kind !== 'api')

  const titleAside = hasConnections
    ? t('onboardingProviders.drawer.home.subtitle', { connections: connections.length, models: allModels.length })
    : t('onboardingProviders.drawer.home.emptySubtitle')

  // 「连不上」压倒模型统计：一家都通不了的时候，标题写「24 个可使用」是在骗人（与行内红字打架）。
  const unreachableAside = unreachableKeys.size > 0
    ? t('onboardingProviders.drawer.home.unreachableCount', { count: unreachableKeys.size })
    : null
  const connectedSection = hasConnections ? (
    <section className="mt-5" data-model-home-connected>
      <SectionHeading
        title={t('onboardingProviders.drawer.home.connected')}
        aside={unreachableAside ?? (hasAttention
          ? t('onboardingProviders.drawer.home.connectedAttention', { ready: allModels.length - needsSetupCount, pending: needsSetupCount })
          : t('onboardingProviders.drawer.home.readyCount', { count: allModels.length }))}
      />
      <ConnectedRows
        connections={connections}
        mappings={mappings}
        search={search}
        onHealthChange={handleHealthChange}
      />
    </section>
  ) : null

  const adaptedSection = primaryPlatforms.length > 0 || otherAdapted.length > 0 ? (
    <section className="mt-5" data-model-home-adapted-platforms>
      <SectionHeading
        title={hasConnections ? t('onboardingProviders.drawer.home.addServices') : t('onboardingProviders.drawer.home.adaptedPlatforms')}
        aside={primaryPlatforms.length > 0 ? t('onboardingProviders.drawer.home.firstTwoKeyOnly') : undefined}
      />
      <RowGroup>
        {primaryPlatforms.map((connection) => (
          <AvailableConnectionRow
            key={connection.vendorKey}
            connection={connection}
            title={hasConnections ? t('onboardingProviders.drawer.home.connectPlatform', { name: translateModelDisplayText(connection.name) }) : undefined}
            hint={availableHint(connection, t)}
            badge={connection.vendorKey === 'apimart' ? t('onboardingProviders.drawer.home.recommended') : undefined}
            end={t('onboardingProviders.drawer.home.fillKey')}
          />
        ))}
        {otherAdapted.length > 0 ? (
          <>
            <ActionRow
              icon={<IconCloud size={16} stroke={1.7} aria-hidden="true" />}
              title={t('onboardingProviders.drawer.home.moreAdapted')}
              hint={t('onboardingProviders.drawer.home.moreAdaptedHint')}
              end={t('onboardingProviders.drawer.home.viewAll')}
              expanded={morePlatformsOpen}
              onClick={() => setMorePlatformsOpen((value) => !value)}
              dataMarker="more-adapted"
            />
            {morePlatformsOpen ? otherAdapted.map((connection) => (
              <AvailableConnectionRow
                key={connection.vendorKey}
                connection={connection}
                hint={availableHint(connection, t)}
              />
            )) : null}
          </>
        ) : null}
      </RowGroup>
    </section>
  ) : null

  const customApiRow = (
    <ActionRow
      icon={<IconPlugConnected size={16} stroke={1.7} aria-hidden="true" />}
      title={t('onboardingProviders.drawer.home.customApi')}
      hint={t('onboardingProviders.drawer.home.customApiHint')}
      onClick={onCustomApi}
      dataMarker="custom-api"
    />
  )

  const alternateRows = otherAvailable.map((connection) => (
    <AvailableConnectionRow
      key={connection.vendorKey}
      connection={connection}
      hint={availableHint(connection, t)}
    />
  ))

  const otherMethodsSection = !hasConnections ? (
    <section className="mt-5" data-model-home-other-methods>
      <SectionHeading title={t('onboardingProviders.drawer.home.otherMethods')} />
      <RowGroup>
        {customApiRow}
        {alternateRows}
        {availableFooter ? <div className="p-2">{availableFooter}</div> : null}
      </RowGroup>
    </section>
  ) : (
    <>
      <section className="mt-5" data-model-home-other-methods>
        <SectionHeading title={t('onboardingProviders.drawer.home.otherMethods')} />
        <RowGroup>{customApiRow}</RowGroup>
      </section>
      {otherAvailable.length > 0 || availableFooter ? (
        <section className="mt-5" data-model-home-other-ways>
          <SectionHeading title={t('onboardingProviders.drawer.home.otherWays')} />
          <RowGroup>
            <ActionRow
              icon={<IconServerBolt size={16} stroke={1.7} aria-hidden="true" />}
              title={t('onboardingProviders.drawer.home.localAndMembership')}
              hint={t('onboardingProviders.drawer.home.localAndMembershipHint')}
              end={t('onboardingProviders.drawer.home.methodCount', { count: otherAvailable.length })}
              expanded={otherWaysOpen}
              onClick={() => setOtherWaysOpen((value) => !value)}
              dataMarker="other-ways"
            />
            {otherWaysOpen ? (
              <>
                {alternateRows}
                {availableFooter ? <div className="p-2">{availableFooter}</div> : null}
              </>
            ) : null}
          </RowGroup>
        </section>
      ) : null}
    </>
  )

  return (
    <div className="flex h-full min-h-0 flex-col" data-model-settings-page="home">
      <header className="flex min-h-14 shrink-0 items-center border-b border-nomi-line px-4 py-2 pr-14">
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-nomi-ink">{t('onboardingProviders.drawer.home.title')}</h2>
          <p className="mt-0.5 truncate text-micro text-nomi-ink-40">{titleAside}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5">
        {showSearch ? (
          <div className="sticky top-0 z-[5] bg-nomi-paper pb-2 pt-3">
            <DesignSearchInput
              value={search}
              onChange={setSearch}
              placeholder={t('onboardingProviders.drawer.home.search')}
              ariaLabel={t('onboardingProviders.drawer.home.search')}
              className="w-full"
            />
          </div>
        ) : null}

        {bridgeMissing ? (
          <div className="mt-4 border-l-2 border-nomi-warning bg-nomi-ink-05 px-3 py-3">
            <div className="text-body-sm font-semibold text-nomi-ink">{t('onboardingProviders.drawer.bridgeMissingTitle')}</div>
            <p className="mt-1 text-caption leading-relaxed text-nomi-ink-60">{t('onboardingProviders.drawer.bridgeMissingBody')}</p>
            <DesignButton className="mt-2" variant="light" onClick={onReload}>{t('common.reload')}</DesignButton>
          </div>
        ) : !loaded ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-caption text-nomi-ink-40">
            <NomiLoadingMark size={16} />
            {t('onboardingProviders.drawer.loading')}
          </div>
        ) : (
          <>
            {taskCount > 0 && taskContent ? (
              <section className="mt-4" data-model-home-task-strip>
                <SectionHeading
                  title={t('onboardingProviders.drawer.home.needsAttention')}
                  aside={t('onboardingProviders.drawer.home.tasks', { count: taskCount })}
                />
                {taskContent}
              </section>
            ) : null}

            {diagnostic ? <div className="mt-4">{diagnostic}</div> : null}

            {connectedSection}
            {adaptedSection}
            {otherMethodsSection}

            {/* 数据源：抖音/TikTok 分享链接 → 无水印素材（BYO-key connector）。独立成组因为它产出的是
                「素材数据」不是「可调用模型」——归进模型家清单会错配（P4）。这是它在设置区的唯一家。 */}
            {dataSourceContent ? (
              <section className="mt-5" data-model-home-data-sources>
                <SectionHeading title={t('onboardingProviders.drawer.home.dataSources')} />
                {dataSourceContent}
              </section>
            ) : null}

            <section className="mt-6 border-t border-nomi-line pt-4" data-model-home-advanced>
              <SectionHeading title={t('onboardingProviders.drawer.home.advanced')} />
              <RowGroup>
                <ActionRow
                  icon={<IconCode size={16} stroke={1.7} aria-hidden="true" />}
                  title={t('onboardingProviders.drawer.home.directScript')}
                  hint={t('onboardingProviders.drawer.home.directScriptHint')}
                  badge={t('onboardingProviders.drawer.home.advancedBadge')}
                  onClick={onDirectScript}
                  dataMarker="direct-script"
                  directScript
                />
                {networkContent ? <div className="px-3 py-1">{networkContent}</div> : null}
              </RowGroup>
            </section>

            {showSearch && search.trim() && !connections.some((connection) => (
              connection.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ||
              connection.models.some((model) => `${model.labelZh} ${model.modelKey}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
            )) ? (
              <div className="py-8 text-center text-caption text-nomi-ink-40">{t('onboardingProviders.drawer.home.noResults')}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
