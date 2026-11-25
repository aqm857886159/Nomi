import type { PublicPriceGap } from './vendorPricePreview'

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
/** 'today' starts at local midnight; 7 and 30 are rolling day windows. */
export type ModelUsagePeriod = 'today' | 7 | 30
export type ModelUsagePeriods = Record<ModelUsagePeriod, ModelUsageRow[]>
/** One model's public rate at the reference spec. `credits: null` means no fixed rate: `gap` says why, or null when it could not be read. */
export type ModelUnitPrice = {
  modelKey: string; label: string; kind: 'image' | 'video'; credits: number | null
  basis: 'output-estimate' | null; gap: PublicPriceGap | null
}
