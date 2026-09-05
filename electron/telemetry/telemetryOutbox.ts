import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from '../settings/settingsRoot'
import { sendAptabaseBatch } from './aptabaseAdapter'
import { buildTelemetryEnvelope, isTelemetryEnvelope, type TelemetryEnvelope, type TelemetryProps } from './telemetryEvents'
import { getTelemetrySessionId, readTelemetrySettings, telemetryEndpointConfigured } from './telemetrySettings'
import type { TelemetrySummary } from '../shared/contracts/telemetry'

const OUTBOX_FILE = 'telemetry-outbox.json'
const MAX_PENDING = 100
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SENT = 100
type SentSummary = { eventName: TelemetryEnvelope['eventName']; timestamp: string }
type OutboxStore = { schemaVersion: 1; pending: TelemetryEnvelope[]; sent: SentSummary[]; failedCount: number }
export type { TelemetrySummary } from '../shared/contracts/telemetry'

function outboxPath(): string { return path.join(getSettingsRoot(), OUTBOX_FILE) }
function emptyStore(): OutboxStore { return { schemaVersion: 1, pending: [], sent: [], failedCount: 0 } }
function readStore(): OutboxStore {
  try {
    const raw = readJsonFile(outboxPath()) as Partial<OutboxStore>
    const pending = Array.isArray(raw.pending) ? raw.pending.filter(isTelemetryEnvelope) : []
    const sent = Array.isArray(raw.sent) ? raw.sent.filter((item): item is SentSummary => Boolean(item && typeof item === 'object' && typeof (item as SentSummary).eventName === 'string' && typeof (item as SentSummary).timestamp === 'string')).slice(-MAX_SENT) : []
    return { schemaVersion: 1, pending, sent, failedCount: Number.isInteger(raw.failedCount) && Number(raw.failedCount) >= 0 ? Number(raw.failedCount) : 0 }
  } catch { return emptyStore() }
}
function writeStore(store: OutboxStore): void { writeJsonFileAtomic(outboxPath(), store) }
function prune(store: OutboxStore, now = Date.now()): void {
  store.pending = store.pending.filter((item) => now - Date.parse(item.timestamp) <= MAX_AGE_MS).slice(-MAX_PENDING)
}

export function enqueueTelemetryEvent(event: TelemetryEnvelope): boolean {
  const settings = readTelemetrySettings()
  if (!settings.enabled || !isTelemetryEnvelope(event)) return false
  const store = readStore()
  prune(store)
  store.pending.push(event)
  prune(store)
  writeStore(store)
  return true
}

export function readTelemetrySummary(): TelemetrySummary {
  const store = readStore()
  prune(store)
  return {
    pending: store.pending.map(({ eventName, timestamp }) => ({ eventName, timestamp })),
    sent: store.sent.slice(-MAX_SENT),
    pendingCount: store.pending.length,
    sentCount: store.sent.length,
    failedCount: store.failedCount,
    endpointConfigured: telemetryEndpointConfigured(),
  }
}

export function deleteTelemetryData(): { deletedCount: number } {
  let deletedCount = 0
  try {
    const store = readStore()
    deletedCount = store.pending.length + store.sent.length
    fs.rmSync(outboxPath(), { force: true })
  } catch { /* deleting local diagnostics is best effort */ }
  return { deletedCount }
}

let flushPromise: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
export function flushTelemetry(): Promise<void> {
  if (flushPromise) return flushPromise
  flushPromise = (async () => {
    const settings = readTelemetrySettings()
    if (!settings.enabled || !telemetryEndpointConfigured()) return
    const store = readStore()
    prune(store)
    const batch = store.pending.slice(0, 25)
    if (batch.length === 0) return
    try {
      await sendAptabaseBatch(batch)
      const sentAt = batch.map(({ eventName, timestamp }) => ({ eventName, timestamp }))
      store.pending = store.pending.slice(batch.length)
      store.sent = [...store.sent, ...sentAt].slice(-MAX_SENT)
      writeStore(store)
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    } catch {
      store.failedCount += 1
      writeStore(store)
      if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; void flushTelemetry() }, 30_000)
    }
  })().finally(() => { flushPromise = null })
  return flushPromise
}

export function recordTelemetryEvent(input: TelemetryProps, appVersion: string, locale: 'zh-CN' | 'en' = 'zh-CN'): boolean {
  const settings = readTelemetrySettings()
  if (!settings.enabled) return false
  const sessionId = getTelemetrySessionId()
  const event = buildTelemetryEnvelope(input, sessionId, appVersion, locale)
  const queued = enqueueTelemetryEvent(event)
  if (queued) void flushTelemetry()
  return queued
}
