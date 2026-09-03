import type { NomiEvent } from './types'

export type EtaSourceEvent = Pick<NomiEvent, 'type' | 'ts' | 'payload'>

export type GenerationEtaBucket = {
  key: string
  vendorKey: string
  modelKey: string
  kind: 'image' | 'video' | 'audio' | 'model3d' | 'text'
  sampleCount: number
  p50Seconds: number
  p90Seconds: number
}

type PendingCall = { vendorKey: string; modelKey: string; kind: GenerationEtaBucket['kind']; requestedAt: number }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function outputKind(value: unknown): GenerationEtaBucket['kind'] | null {
  const normalized = text(value).toLowerCase().replace(/[- ]/g, '_')
  if (normalized.includes('video')) return 'video'
  if (normalized.includes('audio') || normalized.includes('speech') || normalized.includes('voice')) return 'audio'
  if (normalized.includes('3d') || normalized.includes('mesh')) return 'model3d'
  if (normalized.includes('text')) return 'text'
  if (normalized.includes('image') || normalized.includes('picture')) return 'image'
  return null
}

export function generationEtaBucketKey(vendorKey: string, modelKey: string, kind: GenerationEtaBucket['kind']): string {
  return `${vendorKey}|${modelKey}|${kind}`
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] || 0
}

function requestedCall(event: EtaSourceEvent): PendingCall | null {
  if (event.type !== 'vendor.call.requested') return null
  const runId = text(event.payload.runId)
  const recipe = event.payload.recipe && typeof event.payload.recipe === 'object' && !Array.isArray(event.payload.recipe)
    ? event.payload.recipe as Record<string, unknown>
    : null
  const vendorKey = text(recipe?.vendorKey)
  const modelKey = text(recipe?.modelKey)
  const kind = outputKind(recipe?.kind)
  const requestedAt = Date.parse(event.ts)
  if (!runId || !vendorKey || !modelKey || !kind || !Number.isFinite(requestedAt)) return null
  return { vendorKey, modelKey, kind, requestedAt }
}

export function deriveGenerationEtaStats(events: readonly EtaSourceEvent[]): GenerationEtaBucket[] {
  const pending = new Map<string, PendingCall>()
  const durations = new Map<string, { vendorKey: string; modelKey: string; kind: GenerationEtaBucket['kind']; values: number[] }>()
  for (const event of events) {
    const requested = requestedCall(event)
    if (requested) {
      pending.set(text(event.payload.runId), requested)
      continue
    }
    if (event.type !== 'vendor.call.completed' || text(event.payload.status).toLowerCase() !== 'succeeded') continue
    const runId = text(event.payload.runId)
    const prior = pending.get(runId)
    const completedAt = Date.parse(event.ts)
    if (!prior || !Number.isFinite(completedAt)) continue
    pending.delete(runId)
    const seconds = (completedAt - prior.requestedAt) / 1000
    if (!Number.isFinite(seconds) || seconds <= 0) continue
    const key = generationEtaBucketKey(prior.vendorKey, prior.modelKey, prior.kind)
    const bucket = durations.get(key) || { vendorKey: prior.vendorKey, modelKey: prior.modelKey, kind: prior.kind, values: [] }
    bucket.values.push(seconds)
    durations.set(key, bucket)
  }
  return [...durations.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, bucket]) => ({
    key,
    vendorKey: bucket.vendorKey,
    modelKey: bucket.modelKey,
    kind: bucket.kind,
    sampleCount: bucket.values.length,
    p50Seconds: Math.round(percentile(bucket.values, 0.5)),
    p90Seconds: Math.round(percentile(bucket.values, 0.9)),
  }))
}
