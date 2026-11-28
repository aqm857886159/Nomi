import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ModelUsagePeriods, ModelUsageRow } from '../../../electron/shared/contracts/modelSettingsAccount'

export function useModelUsage(vendor: string) {
  const [periods, setPeriods] = React.useState<ModelUsagePeriods | null>()
  const [revision, refresh] = React.useReducer(n => n + 1, 0)
  React.useEffect(() => {
    let active = true
    void Promise.resolve(getDesktopBridge()?.onboarding?.modelUsage?.(vendor)).then(
      rows => { if (active) setPeriods(rows ?? null) },
      () => { if (active) setPeriods(null) },
    )
    return () => { active = false }
  }, [vendor, revision])
  return { periods, refresh }
}

export function usageTotal(rows: ModelUsageRow[]) {
  return rows.reduce<{ runs: number; credits: number | null }>((sum, row) => ({
    runs: sum.runs + row.runs,
    credits: sum.credits === null || row.credits === null ? null : sum.credits + row.credits,
  }), { runs: 0, credits: 0 })
}
