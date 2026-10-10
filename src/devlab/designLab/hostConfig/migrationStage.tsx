import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectAssistantCard } from '../../../ui/onboarding/ConnectAssistantCard'
import type { McpInfo, McpMigrationResult } from '../../../desktop/mcpBridgeTypes'
import { holdDesignLabReady } from '../labReadyHold'
import { SETTINGS_CELL_WIDTH } from '../settings/settingsLabKit'

/** 取值：ask / done / partial / unavailable / deferred（每格一个，舞台据此点按钮、回对应结果）。 */
// 宿主名与顺序是真实检测到的形状：三家还写着旧连接方式，WorkBuddy 保持旧方式（不在迁移名单里）。
const HOSTS = [
  { client: 'claude', label: 'Claude Code' },
  { client: 'codex', label: 'Codex' },
  { client: 'cursor', label: 'Cursor' },
] as const

function clientInfo(configPath: string): McpInfo['clients'][string] {
  return {
    installed: true, appInstalled: true, configPath, snippet: '{}', configState: 'current', launcherKind: 'packaged',
    configuredCommand: '/Applications/Nomi.app/Contents/MacOS/Nomi Helper', configuredSettingsDir: null,
  }
}

/** 点「改过去」之后主进程会回的结果（形状同 mcpHostMigration.McpMigrationResult）。 */
function resultsFor(phase: string): McpMigrationResult[] {
  const ok = (client: string): McpMigrationResult => ({ client, ok: true, kind: 'http', backupPath: null })
  if (phase === 'done') return HOSTS.map((h) => ok(h.client))
  if (phase === 'partial') {
    return [ok('claude'), { client: 'codex', ok: false, reason: 'write-failed' }, { client: 'cursor', ok: false, reason: 'backup-failed' }]
  }
  return HOSTS.map((h) => ({ client: h.client, ok: false as const, reason: 'http-unavailable' as const }))
}

/** 生产里的 ConnectAssistantCard，喂它主进程会给的形状；按钮由舞台真点（走真实交互路径），不手摆结果。 */
export function MigrationStage({ phase, locale }: { phase: string; locale: 'zh-CN' | 'en' }): JSX.Element {
  const { i18n } = useTranslation()
  const [localeReady, setLocaleReady] = React.useState(i18n.language === locale)
  React.useEffect(() => {
    if (i18n.language === locale) { setLocaleReady(true); return undefined }
    const release = holdDesignLabReady(`host-config:locale:${locale}`)
    void i18n.changeLanguage(locale).then(() => { setLocaleReady(true); release() })
    return release
  }, [i18n, locale])
  const info: McpInfo = React.useMemo(() => ({
    tokenReady: true,
    rpcRunning: true,
    server: { command: '/Applications/Nomi.app/Contents/MacOS/Nomi Helper', args: [] },
    trustedHosts: ['claude', 'codex'],
    clients: {
      claude: clientInfo('~/.claude.json'),
      codex: clientInfo('~/.codex/config.toml'),
      cursor: clientInfo('~/.cursor/mcp.json'),
    },
  }), [])
  React.useMemo(() => {
    ;(window as unknown as { nomiDesktop: unknown }).nomiDesktop = {
      capability: {
        mcpInfo: () => info,
        // 每格一个版本号：「以后再说」按版本记，格与格之间不串。
        mcpMigrationState: () => Promise.resolve({ hosts: [...HOSTS], appVersion: `lab-${phase}`, consent: `lab-consent-${phase}` }),
        migrateMcpHosts: () => Promise.resolve({ results: resultsFor(phase), retryConsent: phase === 'done' ? null : `lab-retry-${phase}` }),
      },
    }
  }, [info, phase])
  const stageRef = React.useRef<HTMLDivElement>(null)
  // 名单是异步读的：等按钮真出现再点（走真实交互路径），再等结果块 / 询问块消失才放行就绪旗。
  React.useEffect(() => {
    const root = stageRef.current
    if (!localeReady || phase === 'ask' || !root) return undefined
    const release = holdDesignLabReady(`host-config:migration:${phase}`)
    const button = phase === 'deferred' ? '[data-assistant-migration-defer]' : '[data-assistant-migration-confirm]'
    let clicked = false
    const settle = (): void => {
      if (!clicked) {
        const target = root.querySelector<HTMLButtonElement>(button)
        if (!target) return
        clicked = true
        target.click()
        return
      }
      const settled = phase === 'deferred' ? !root.querySelector('[data-assistant-migration]') : Boolean(root.querySelector('[data-assistant-migration="done"]'))
      if (settled) { observer.disconnect(); window.requestAnimationFrame(release) }
    }
    const observer = new MutationObserver(settle)
    observer.observe(root, { childList: true, subtree: true })
    settle()
    return () => { observer.disconnect(); release() }
  }, [localeReady, phase])
  return (
    <div ref={stageRef} style={{ width: SETTINGS_CELL_WIDTH }} data-design-lab-stage="host-config-migration">
      {localeReady ? <ConnectAssistantCard info={info} detailMode onChanged={() => {}} onTrustChange={() => {}} /> : null}
    </div>
  )
}
