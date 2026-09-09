import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from './bridge'
import type { AgentTraceOpenResult } from '../../electron/shared/contracts/agentTrace'

/** Both navigation entries share failure handling; no raw native errors reach the UI. */
export function useAgentTraceDirectory() {
  const { t } = useTranslation()
  const api = getDesktopBridge()?.settings?.diagnostics?.openTraceDirectory
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AgentTraceOpenResult | null>(null)
  const message = result && !result.ok
    ? t(result.reason === 'no-project' ? 'settings.general.trace.noProject'
      : result.reason === 'project-changed' ? 'settings.general.trace.projectChanged'
        : 'settings.general.trace.failed')
    : null

  const open = async (laneName?: string): Promise<void> => {
    if (!api || pending.current) return
    pending.current = true
    setBusy(true)
    setResult(null)
    try { setResult(await api(laneName)) }
    catch { setResult({ ok: false, reason: 'open-failed' }) }
    finally { pending.current = false; setBusy(false) }
  }
  return { available: Boolean(api), busy, message, result, open }
}
