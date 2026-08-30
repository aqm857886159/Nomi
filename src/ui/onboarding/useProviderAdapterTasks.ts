import React from 'react'
import type { DesktopHttpCertificationRun } from '../../desktop/onboardingBridgeTypes'
import { getDesktopBridge } from '../../desktop/bridge'
import { isAdapterRunTerminal } from './adapterVerificationViewModel'
import { mergeAdapterRuns, visibleAdapterRuns } from './adapterTaskVisibility'
import { CertificationIntentKey } from './certificationIntentKey'
import { CertificationUiError } from './certificationFailureMessage'

export function useProviderAdapterTasks(): {
  runs: DesktopHttpCertificationRun[]
  visibleRuns: DesktopHttpCertificationRun[]
  recordRun: (run: DesktopHttpCertificationRun) => void
  cancelRun: (run: DesktopHttpCertificationRun) => Promise<void>
  retryRun: (run: DesktopHttpCertificationRun, modelKey?: string) => Promise<DesktopHttpCertificationRun>
} {
  const [runs, setRuns] = React.useState<DesktopHttpCertificationRun[]>([])
  const retryIntentKey = React.useRef(new CertificationIntentKey())

  const recordRun = React.useCallback((run: DesktopHttpCertificationRun) => {
    setRuns((current) => mergeAdapterRuns(current, [run]))
  }, [])

  const loadRuns = React.useCallback(async () => {
    const list = getDesktopBridge()?.onboarding?.certificationList
    if (!list) return
    // Active work must never disappear behind newer history. The store caps this
    // query at 200; visibleAdapterRuns applies the small limit only to terminal rows.
    const result = await list({ limit: 200 }).catch(() => null)
    if (result?.ok && result.runs) setRuns((current) => mergeAdapterRuns(current, result.runs ?? []))
  }, [])

  const hasActiveRun = runs.some((run) => !isAdapterRunTerminal(run.stage))
  React.useEffect(() => {
    void loadRuns()
    if (!hasActiveRun) return
    const timer = window.setInterval(() => { void loadRuns() }, 900)
    return () => window.clearInterval(timer)
  }, [hasActiveRun, loadRuns])

  const cancelRun = React.useCallback(async (run: DesktopHttpCertificationRun) => {
    const cancel = getDesktopBridge()?.onboarding?.certificationCancel
    if (!cancel || isAdapterRunTerminal(run.stage)) return
    const result = await cancel({ runId: run.id }).catch(() => null)
    if (result?.ok && result.run) recordRun(result.run)
  }, [recordRun])

  const retryRun = React.useCallback(async (run: DesktopHttpCertificationRun, modelKey?: string) => {
    const retryCertification = getDesktopBridge()?.onboarding?.httpCertificationRetry
    if (!retryCertification) throw new CertificationUiError('START_FAILED')
    if (!isAdapterRunTerminal(run.stage)) throw new CertificationUiError('RUN_ACTIVE')
    const result = await retryCertification({
      runId: run.id,
      ...(modelKey ? { modelKey } : {}),
      idempotencyKey: retryIntentKey.current.for({ action: 'retry', runId: run.id, modelKey }),
    })
    if (!result.ok) {
      retryIntentKey.current.rotate()
      throw new CertificationUiError(result.code)
    }
    retryIntentKey.current.rotate()
    recordRun(result.run)
    return result.run
  }, [recordRun])

  return {
    runs,
    visibleRuns: visibleAdapterRuns(runs),
    recordRun,
    cancelRun,
    retryRun,
  }
}
