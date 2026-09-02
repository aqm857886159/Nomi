import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowLeft, IconChevronRight, IconLock, IconRobot } from '@tabler/icons-react'

import { DesignSwitch, IconActionButton, NomiSegmented } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { McpClientProfile, McpInfo } from '../../desktop/mcpBridgeTypes'
import { lazyWithChunkBoundary } from '../../ui/chunkBoundary'
import type { AutomationPolicySettings } from '../../../electron/settings/automationPolicyContract'
import { buildAutomationSettingsView } from './settingsAutomationView'

const ConnectAssistantCard = lazyWithChunkBoundary('MCP', () =>
  import('../../ui/onboarding/ConnectAssistantCard').then((module) => ({ default: module.ConnectAssistantCard })),
)
const CustomMcpClientCard = lazyWithChunkBoundary('MCP 自定义客户端', () =>
  import('../../ui/onboarding/CustomMcpClientCard').then((module) => ({ default: module.CustomMcpClientCard })),
)

type Props = {
  settings: AutomationPolicySettings
  onChange: (patch: Partial<AutomationPolicySettings>) => void
}

type McpConnectionSnapshot =
  | { phase: 'ready'; info: McpInfo }
  | { phase: 'unavailable'; info: null }

function readMcpConnectionSnapshot(): McpConnectionSnapshot {
  try {
    const info = getDesktopBridge()?.capability?.mcpInfo?.()
    return info ? { phase: 'ready', info } : { phase: 'unavailable', info: null }
  } catch {
    return { phase: 'unavailable', info: null }
  }
}

function SettingRow({
  title,
  hint,
  section,
  children,
}: {
  title: string
  hint: string
  section?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div data-settings-section={section} className="flex min-h-12 items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <div className="text-body-sm text-nomi-ink">{title}</div>
        <div className="mt-0.5 text-caption leading-relaxed text-nomi-ink-40">{hint}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function LockedRule({ title, hint }: { title: string; hint: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <SettingRow title={title} hint={hint}>
      <span className="inline-flex items-center gap-1 rounded-full bg-nomi-ink-05 px-2 py-1 text-micro text-nomi-ink-60">
        <IconLock size={12} stroke={1.7} aria-hidden="true" />
        {t('settings.automation.always')}
      </span>
    </SettingRow>
  )
}

export function AutomationPermissionsSection({ settings, onChange }: Props): JSX.Element {
  const { t } = useTranslation()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const mcpBackButtonRef = React.useRef<HTMLButtonElement>(null)
  const mcpEntryButtonRef = React.useRef<HTMLButtonElement>(null)
  const [page, setPage] = React.useState<'main' | 'mcp'>('main')
  const [focusCursorHost, setFocusCursorHost] = React.useState(false)
  const [focusMcpEntry, setFocusMcpEntry] = React.useState(false)
  const [mcpSnapshot, setMcpSnapshot] = React.useState<McpConnectionSnapshot>(readMcpConnectionSnapshot)
  const view = buildAutomationSettingsView(settings)
  const [profiles, setProfiles] = React.useState<McpClientProfile[]>([])
  const refreshProfiles = React.useCallback(async () => {
    const list = await getDesktopBridge()?.capability?.listCustomMcpProfiles?.()
    setProfiles(list ?? [])
  }, [])
  const refreshMcpInfo = React.useCallback(() => {
    setMcpSnapshot(readMcpConnectionSnapshot())
    void refreshProfiles()
  }, [refreshProfiles])
  // 进入 MCP 页读一次 + 实时刷新（订阅 watch 广播 + 定时轮询兜底——检测在外部进程写文件，跨进程 watch 不可靠，
  // 轮询保证「WorkBuddy 一连就出现」）。用 refreshMcpInfo 而非 refreshProfiles：installed 状态读自 info.clients。
  React.useEffect(() => {
    if (page !== 'mcp') return
    refreshMcpInfo()
    const unsub = getDesktopBridge()?.capability?.onMcpProfilesChanged?.(refreshMcpInfo)
    const timer = window.setInterval(refreshMcpInfo, 2000)
    return () => {
      unsub?.()
      window.clearInterval(timer)
    }
  }, [page, refreshMcpInfo])
  const toggleHost = (host: string, enabled: boolean): void => {
    if (host === 'nomi') return
    const next = new Set(settings.trustedHosts)
    if (enabled) next.add(host)
    else next.delete(host)
    onChange({ trustedHosts: ['nomi', ...[...next].filter((item) => item !== 'nomi')] })
  }

  React.useEffect(() => {
    if (page !== 'mcp') return
    const frame = window.requestAnimationFrame(() => mcpBackButtonRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [page])

  React.useEffect(() => {
    if (page !== 'main' || !focusMcpEntry) return
    const frame = window.requestAnimationFrame(() => {
      mcpEntryButtonRef.current?.focus({ preventScroll: true })
      setFocusMcpEntry(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusMcpEntry, page])

  React.useEffect(() => {
    if (page !== 'main' || !focusCursorHost) return
    const frame = window.requestAnimationFrame(() => {
      const section = rootRef.current?.querySelector<HTMLElement>('[data-settings-section="cursor-host"]')
      section?.scrollIntoView({ block: 'center' })
      section?.querySelector<HTMLElement>('button, input, [tabindex]')?.focus({ preventScroll: true })
      setFocusCursorHost(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusCursorHost, page])

  if (page === 'mcp') {
    return (
      <div
        ref={rootRef}
        data-settings-section="mcp-assistant-connections"
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          event.stopPropagation()
          setFocusMcpEntry(true)
          setPage('main')
        }}
      >
        <header className="mb-5 flex min-h-8 items-center gap-2 pr-10">
          <IconActionButton
            ref={mcpBackButtonRef}
            onClick={() => {
              setFocusMcpEntry(true)
              setPage('main')
            }}
            aria-label={t('settings.automation.mcp.back')}
            title={t('settings.automation.mcp.back')}
            className="size-11 shrink-0 text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink sm:size-8"
            icon={<IconArrowLeft size={16} stroke={1.8} aria-hidden="true" />}
          />
          <h2 className="min-w-0 text-title font-medium text-nomi-ink">{t('settings.automation.mcp.title')}</h2>
        </header>

        {mcpSnapshot.phase === 'ready' ? (
          <React.Suspense
            fallback={(
              <div role="status" className="rounded-nomi bg-nomi-ink-05 px-3 py-3 text-caption text-nomi-ink-40">
                {t('settings.automation.mcp.loading')}
              </div>
            )}
          >
            <ConnectAssistantCard
              info={mcpSnapshot.info}
              onChanged={refreshMcpInfo}
              onOpenAutomationPermissions={() => {
                setFocusCursorHost(true)
                setPage('main')
              }}
              detailMode
            />
            <CustomMcpClientCard
              info={mcpSnapshot.info}
              profiles={profiles}
              trustedHosts={settings.trustedHosts}
              onToggleTrust={toggleHost}
              onChanged={refreshMcpInfo}
            />
          </React.Suspense>
        ) : (
          <div role="status" className="rounded-nomi bg-nomi-ink-05 px-3 py-3 text-caption leading-relaxed text-nomi-ink-60">
            {t('settings.automation.mcp.unavailable')}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} data-settings-section="automation">
      <h2 className="mb-5 text-title font-medium text-nomi-ink">{t('settings.automation.title')}</h2>

      <section className="mb-6" aria-labelledby="settings-mode-title">
        <h3 id="settings-mode-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.mode.title')}
        </h3>
        <NomiSegmented
          value={view.mode}
          ariaLabel={t('settings.automation.mode.title')}
          onChange={(value) => onChange({ mode: value as AutomationPolicySettings['mode'] })}
          options={[
            { value: 'guided', label: t('settings.automation.mode.guided') },
            { value: 'balanced', label: t('settings.automation.mode.balanced') },
            { value: 'policy-auto', label: t('settings.automation.mode.policyAuto') },
          ]}
        />
        <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">
          {t(`settings.automation.mode.hint.${view.mode}`)}
        </div>
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-risk-title">
        <h3 id="settings-risk-title" className="text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.risk.title')}
        </h3>
        <LockedRule title={t('settings.automation.risk.firstSpend')} hint={t('settings.automation.risk.firstSpendHint')} />
        <SettingRow title={t('settings.automation.risk.continue')} hint={t('settings.automation.risk.continueHint')}>
          <DesignSwitch
            checked={settings.autoContinueWithinBudget}
            onChange={(event) => onChange({ autoContinueWithinBudget: event.currentTarget.checked })}
            aria-label={t('settings.automation.risk.continue')}
          />
        </SettingRow>
        <LockedRule title={t('settings.automation.risk.irreversible')} hint={t('settings.automation.risk.irreversibleHint')} />
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-mcp-title">
        <h3 id="settings-mcp-title" className="mb-2 text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.mcp.title')}
        </h3>
        <button
          ref={mcpEntryButtonRef}
          type="button"
          data-settings-action="manage-mcp-connections"
          className="flex min-h-12 w-full items-center gap-2.5 rounded-nomi-sm border-0 bg-nomi-ink-05 px-3 py-2 text-left cursor-pointer transition-colors hover:bg-nomi-ink-10"
          onClick={() => {
            refreshMcpInfo()
            setPage('mcp')
          }}
        >
          <IconRobot size={18} stroke={1.6} className="shrink-0 text-nomi-accent" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-body-sm text-nomi-ink">{t('settings.automation.mcp.clients')}</span>
            <span className="block text-micro leading-relaxed text-nomi-ink-40">{t('settings.automation.mcp.hint')}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-caption text-nomi-ink-60">
            <span className="hidden sm:inline">{t('settings.automation.mcp.manage')}</span>
            <IconChevronRight size={16} stroke={1.8} className="text-nomi-ink-40" aria-hidden="true" />
          </span>
        </button>
        <div className="mt-2 text-caption leading-relaxed text-nomi-ink-40">
          {t('settings.automation.mcp.separationHint')}
        </div>
      </section>

      <section className="mb-6 border-t border-nomi-line pt-4" aria-labelledby="settings-hosts-title">
        <h3 id="settings-hosts-title" className="mb-1 text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.hosts.title')}
        </h3>
        {view.hosts.map((host) => (
          <SettingRow
            key={host.key}
            section={host.key === 'cursor' ? 'cursor-host' : undefined}
            title={t(`settings.automation.hosts.${host.key}.name`)}
            hint={t(`settings.automation.hosts.${host.key}.hint`)}
          >
            {host.locked ? (
              <span className="text-caption text-nomi-success">{t('settings.automation.hosts.local')}</span>
            ) : (
              <DesignSwitch
                checked={host.enabled}
                onChange={(event) => toggleHost(host.key, event.currentTarget.checked)}
                aria-label={t(`settings.automation.hosts.${host.key}.name`)}
              />
            )}
          </SettingRow>
        ))}
      </section>

      <section className="border-t border-nomi-line pt-4" aria-labelledby="settings-notifications-title">
        <h3 id="settings-notifications-title" className="text-caption font-medium text-nomi-ink-60">
          {t('settings.automation.notifications.title')}
        </h3>
        <SettingRow title={t('settings.automation.notifications.system')} hint={t('settings.automation.notifications.systemHint')}>
          <DesignSwitch
            checked={settings.systemNotifications}
            onChange={(event) => onChange({ systemNotifications: event.currentTarget.checked })}
            aria-label={t('settings.automation.notifications.system')}
          />
        </SettingRow>
        <SettingRow title={t('settings.automation.notifications.sound')} hint={t('settings.automation.notifications.soundHint')}>
          <DesignSwitch
            checked={settings.notificationSound}
            onChange={(event) => onChange({ notificationSound: event.currentTarget.checked })}
            aria-label={t('settings.automation.notifications.sound')}
          />
        </SettingRow>
      </section>
    </div>
  )
}
