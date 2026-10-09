import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { ConnectAssistantCard } from '../../../ui/onboarding/ConnectAssistantCard'
import type { McpInfo, McpMigrationResult } from '../../../desktop/mcpBridgeTypes'
import { holdDesignLabReady } from '../labReadyHold'
import { SETTINGS_CELL_WIDTH } from '../settings/settingsLabKit'

export type MigrationPhase = 'ask' | 'done' | 'partial' | 'unavailable' | 'deferred'

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
function resultsFor(phase: MigrationPhase): McpMigrationResult[] {
  const ok = (client: string): McpMigrationResult => ({ client, ok: true, kind: 'http', backupPath: null })
  if (phase === 'done') return HOSTS.map((h) => ok(h.client))
  if (phase === 'partial') {
    return [ok('claude'), { client: 'codex', ok: false, reason: 'write-failed' }, { client: 'cursor', ok: false, reason: 'backup-failed' }]
  }
  return HOSTS.map((h) => ({ client: h.client, ok: false as const, reason: 'http-unavailable' as const }))
}

/** 生产里的 ConnectAssistantCard，喂它主进程会给的形状；按钮由舞台真点（走真实交互路径），不手摆结果。 */
export function MigrationStage({ phase, locale }: { phase: MigrationPhase; locale: 'zh-CN' | 'en' }): JSX.Element {
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
        mcpMigrationState: () => ({ hosts: [...HOSTS], appVersion: `lab-${phase}` }),
        migrateMcpHosts: () => resultsFor(phase),
      },
    }
  }, [info, phase])
  const stageRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!localeReady || phase === 'ask') return
    const release = holdDesignLabReady(`host-config:migration:${phase}`)
    const selector = phase === 'deferred' ? '[data-assistant-migration-defer]' : '[data-assistant-migration-confirm]'
    const frame = window.requestAnimationFrame(() => {
      stageRef.current?.querySelector<HTMLButtonElement>(selector)?.click()
      window.requestAnimationFrame(release)
    })
    return () => { window.cancelAnimationFrame(frame); release() }
  }, [localeReady, phase])
  return (
    <div ref={stageRef} style={{ width: SETTINGS_CELL_WIDTH }} data-design-lab-stage="host-config-migration">
      {localeReady ? <ConnectAssistantCard info={info} detailMode onChanged={() => {}} onTrustChange={() => {}} /> : null}
    </div>
  )
}
