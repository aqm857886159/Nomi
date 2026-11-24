import { readCatalog } from '../../catalog/catalogStore'
import { streamProjectEvents } from '../../events/eventLogRepository'
import type { NomiEvent } from '../../events/types'
import { isJsonRecord } from '../../jsonUtils'
import { getWorkspaceRepositoryDeps } from '../../runtimePaths'
import { builtinVendorKeyOfKey } from '../../shared/builtinVendorIdentity'
import type { ModelUnitPrice, ModelUsagePeriods, ModelUsageRow } from '../../shared/contracts/modelSettingsAccount'
import type { VendorPricePreview, VendorPriceQuery } from '../../shared/contracts/vendorPricePreview'
import { connectionWireModel } from '../../shared/modelArchetypes/wireModelIdentity'
import { listRegisteredProjectIds } from '../../workspace/workspaceRegistry'

const CALL_TYPES = new Set(['vendor.call.requested', 'vendor.call.completed'])
const DAY = 86_400_000

export async function summarizeModelUsage(
  vendor: string, projects: Iterable<AsyncIterable<NomiEvent> | Iterable<NomiEvent>>, now = Date.now(),
): Promise<ModelUsagePeriods> {
  const windows = { 7: new Map<string, ModelUsageRow>(), 30: new Map<string, ModelUsageRow>() }
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
        for (const days of [7, 30] as const) {
          if (age > days * DAY) continue
          const row = windows[days].get(modelKey) ?? { modelKey, runs: 0, credits: 0 }
          row.runs += 1
          row.credits = row.credits !== null && credits !== null ? row.credits + credits : null
          windows[days].set(modelKey, row)
        }
      }
    }
  }
  const sorted = (rows: Map<string, ModelUsageRow>) => [...rows.values()].sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1) || a.modelKey.localeCompare(b.modelKey))
  return { 7: sorted(windows[7]), 30: sorted(windows[30]) }
}

export function readModelSettingsUsage(vendor: string) {
  if (typeof vendor !== 'string' || builtinVendorKeyOfKey(vendor) !== 'apimart') return null
  const projects = listRegisteredProjectIds(getWorkspaceRepositoryDeps().settingsRoot)
  return summarizeModelUsage(vendor, projects.map(id => streamProjectEvents(id, CALL_TYPES)))
}

/** Quote the board's reference specs only for models present in this connection's catalog. */
export async function readModelUnitPrices(
  vendor: string,
  quotePrice: (query: VendorPriceQuery) => Promise<VendorPricePreview | null>,
): Promise<ModelUnitPrice[]> {
  if (typeof vendor !== 'string' || builtinVendorKeyOfKey(vendor) !== 'apimart') return []
  const keys = ['gpt-image-2.6-flare', 'gpt-image-2', 'gemini-nano-banana-2.1', 'midjourney', 'doubao-seedance-2.5', 'doubao-seedance-2.0-fast']
  const models = readCatalog().models.filter(m => m.vendorKey === vendor)
  const rows: ModelUnitPrice[] = []
  for (const id of keys) {
    const model = models.find(m => m.modelKey === id || m.modelAlias === id)
    if (!model || (model.kind !== 'image' && model.kind !== 'video')) continue
    const kind = model.kind
    const quote = await quotePrice({ vendorKey: vendor, modelId: connectionWireModel(model), kind,
      resolution: kind === 'video' ? '720p' : '1k', size: '1:1', quality: 'medium', count: 1,
      durationSec: 1, referenceCount: 0, hasAudio: false, hasVideoInput: false })
    rows.push({ modelKey: model.modelKey, label: model.labelZh || model.modelKey, kind, credits: quote?.credits ?? null })
  }
  return rows
}
