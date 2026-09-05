import type { ChipModel } from './ModelChipGroups'
import { readCustomCallScriptDrafts } from './customCallScriptModes'

const ADAPTER_STATES = new Set<NonNullable<ChipModel['adapterState']>>([
  'unverified',
  'testing',
  'verified',
  'partial',
  'failed',
])

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function adapterFields(meta: unknown): Pick<ChipModel, 'adapterState' | 'adapterRunId'> {
  const adapter = asRecord(asRecord(meta)?.adapter)
  const rawState = typeof adapter?.state === 'string' ? adapter.state.trim() : ''
  const adapterState = ADAPTER_STATES.has(rawState as NonNullable<ChipModel['adapterState']>)
    ? rawState as NonNullable<ChipModel['adapterState']>
    : undefined
  const adapterRunId = typeof adapter?.runId === 'string' && adapter.runId.trim()
    ? adapter.runId.trim()
    : undefined
  return { adapterState, adapterRunId }
}

export function projectModelSettingsCatalog(source: Array<Record<string, unknown>>): {
  models: ChipModel[]
  fallbackScripts: Map<string, string>
} {
  const fallbackScripts = new Map<string, string>()
  const identities = new Set<string>()
  const models = source.flatMap((value): ChipModel[] => {
    const row = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
    const modelKey = typeof row.modelKey === 'string' ? row.modelKey.trim() : ''
    const vendorKey = typeof row.vendorKey === 'string' ? row.vendorKey.trim() : ''
    // Catalog rows without a stable identity cannot be edited or addressed. Ignore the damaged
    // row instead of manufacturing an "undefined/undefined" route that later crashes Settings.
    if (!modelKey || !vendorKey) return []
    const identity = `${vendorKey}\0${modelKey}`
    if (identities.has(identity)) return []
    identities.add(identity)
    const meta = asRecord(row.meta)
    const customCall = readCustomCallScriptDrafts({
      vendorKey,
      modelKey,
      meta,
      customCall: row.customCall,
    }, '')
    if (customCall.fallback.trim()) fallbackScripts.set(`${vendorKey}/${modelKey}`, customCall.fallback)
    const label = typeof row.labelZh === 'string' && row.labelZh.trim() ? row.labelZh.trim() : modelKey
    const kind = typeof row.kind === 'string' && row.kind.trim() ? row.kind.trim() : 'text'
    const adapter = adapterFields(meta)
    return [{
      modelKey,
      vendorKey,
      labelZh: label,
      kind: kind as ChipModel['kind'],
      // enabled is absent in older catalog snapshots and remains opt-out.
      enabled: row.enabled !== false,
      published: row.published === true,
      meta,
      ...adapter,
      hasCustomCall: Boolean(customCall.fallback.trim() || Object.keys(customCall.modes).length > 0),
      customCallDraft: Boolean(meta?.customCallDraft),
      canRetype: asRecord(row.onboarding)?.addedVia === 'manual',
    }]
  })
  return { models, fallbackScripts }
}
