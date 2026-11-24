export type ModelAccountBalance = {
  keySuffix: string
  accountCredits: number | null
  keyCredits: number | null
  unlimited: boolean
  accountStaleSince: number | null
  quotaStaleSince: number | null
  observedAt: number
}

export type ModelUsageRow = { modelKey: string; runs: number; credits: number | null }
export type ModelUsagePeriods = Record<7 | 30, ModelUsageRow[]>
export type ModelUnitPrice = { modelKey: string; label: string; kind: 'image' | 'video'; credits: number | null }
