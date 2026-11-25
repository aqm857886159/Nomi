import { readCatalog } from '../../catalog/catalogStore'
import { streamProjectEvents } from '../../events/eventLogRepository'
import type { NomiEvent } from '../../events/types'
import { isJsonRecord } from '../../jsonUtils'
import { getWorkspaceRepositoryDeps } from '../../runtimePaths'
import { builtinVendorKeyOfKey } from '../../shared/builtinVendorIdentity'
import type { ModelUnitPrice, ModelUsagePeriod, ModelUsagePeriods, ModelUsageRow } from '../../shared/contracts/modelSettingsAccount'
import type { PublicPriceListing, VendorPriceQuery } from '../../shared/contracts/vendorPricePreview'
import { connectionWireModel } from '../../shared/modelArchetypes/wireModelIdentity'
import { listRegisteredProjectIds } from '../../workspace/workspaceRegistry'

const CALL_TYPES = new Set(['vendor.call.requested', 'vendor.call.completed'])
const DAY = 86_400_000
const PERIODS: readonly ModelUsagePeriod[] = ['today', 7, 30]
/** Board M1-usage reference rows. Each key must be a built-in APIMart catalog row (modelSettingsUsage.test.ts). */
export const UNIT_PRICE_MODEL_KEYS = ['gpt-image-2.6-flare', 'gpt-image-2', 'gemini-nano-banana-2.1', 'doubao-seedance-2.5'] as const

export async function summarizeModelUsage(
  vendor: string, projects: Iterable<AsyncIterable<NomiEvent> | Iterable<NomiEvent>>, now = Date.now(),
): Promise<ModelUsagePeriods> {
  const windows: Record<ModelUsagePeriod, Map<string, ModelUsageRow>> = { today: new Map(), 7: new Map(), 30: new Map() }
  const midnight = new Date(now).setHours(0, 0, 0, 0)
  const within: Record<ModelUsagePeriod, (age: number) => boolean> = {
    today: age => now - age >= midnight, 7: age => age <= 7 * DAY, 30: age => age <= 30 * DAY,
  }
  for (const events of projects) {
    const pending = new Map<string, string>()
    for await (const { type, ts, payload } of events) {
      const id = payload.runId
      if (typeof id !== 'string') continue
      if (type === 'vendor.call.requested') {
        const recipe = payload.recipe
        if (isJsonRecord(recipe) && recipe.vendorKey === vendor && typeof recipe.modelKey === 'string') pending.set(id, recipe.modelKey)
      } else if (type === 'vendor.call.completed') {
        const modelKey = pending.get(id)
        pending.delete(id)
        const age = now - Date.parse(ts)
        if (!modelKey || payload.status !== 'succeeded' || !Number.isFinite(age) || age < 0 || age > 30 * DAY) continue
        const cost = payload.cost
        const credits = isJsonRecord(cost) && cost.unit === 'credits' && typeof cost.amount === 'number' && Number.isFinite(cost.amount) && cost.amount >= 0 ? cost.amount : null
        for (const period of PERIODS) {
          if (!within[period](age)) continue
          const row = windows[period].get(modelKey) ?? { modelKey, runs: 0, credits: 0 }
          row.runs += 1
          row.credits = row.credits !== null && credits !== null ? row.credits + credits : null
          windows[period].set(modelKey, row)
        }
      }
    }
  }
  const sorted = (rows: Map<string, ModelUsageRow>) => [...rows.values()].sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1) || a.modelKey.localeCompare(b.modelKey))
  return { today: sorted(windows.today), 7: sorted(windows[7]), 30: sorted(windows[30]) }
}

export function readModelSettingsUsage(vendor: string) {
  if (typeof vendor !== 'string' || builtinVendorKeyOfKey(vendor) !== 'apimart') return null
  const projects = listRegisteredProjectIds(getWorkspaceRepositoryDeps().settingsRoot)
  return summarizeModelUsage(vendor, projects.map(id => streamProjectEvents(id, CALL_TYPES)))
}

/** Quote the board's reference specs only for models present in this connection's catalog. */
export async function readModelUnitPrices(
  vendor: string,
  readListing: (query: VendorPriceQuery) => Promise<PublicPriceListing>,
): Promise<ModelUnitPrice[]> {
  if (typeof vendor !== 'string' || builtinVendorKeyOfKey(vendor) !== 'apimart') return []
  const models = readCatalog().models.filter(m => m.vendorKey === vendor)
  const rows: ModelUnitPrice[] = []
  for (const id of UNIT_PRICE_MODEL_KEYS) {
    const model = models.find(m => m.modelKey === id || m.modelAlias === id)
    if (!model || (model.kind !== 'image' && model.kind !== 'video')) continue
    const kind = model.kind
    const { quote, gap } = await readListing({ vendorKey: vendor, modelId: connectionWireModel(model), kind,
      resolution: kind === 'video' ? '720p' : '1k', size: '1:1', quality: 'medium', count: 1,
      durationSec: 1, referenceCount: 0, hasAudio: false, hasVideoInput: false })
    rows.push({ modelKey: model.modelKey, label: model.labelZh || model.modelKey, kind,
      credits: quote?.credits ?? null, basis: quote?.basis ?? null, gap: quote ? null : gap })
  }
  return rows
}
