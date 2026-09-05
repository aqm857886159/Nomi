import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTelemetryEnvelope } from './telemetryEvents'

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); const root = roots.pop(); if (root) fs.rmSync(root, { recursive: true, force: true }) })

describe('telemetry outbox', () => {
  it('does not make a network request while disabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    process.env.NOMI_SETTINGS_DIR = root
    const fetch = vi.spyOn(globalThis, 'fetch')
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: false })
    expect(outbox.recordTelemetryEvent({ eventName: 'feature.used', props: { featureId: 'generation', result: 'success' } }, '1.0.0')).toBe(false)
    await outbox.flushTelemetry()
    expect(fetch).not.toHaveBeenCalled()
    delete process.env.NOMI_SETTINGS_DIR
  })

  it('keeps a local summary and deletes it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    process.env.NOMI_SETTINGS_DIR = root
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: true })
    const envelope = buildTelemetryEnvelope({ eventName: 'feature.used', props: { featureId: 'generation', result: 'success' } }, 'session', '1.0.0')
    expect(outbox.enqueueTelemetryEvent(envelope)).toBe(true)
    expect(outbox.readTelemetrySummary().pendingCount).toBe(1)
    expect(outbox.deleteTelemetryData().deletedCount).toBe(1)
    expect(outbox.readTelemetrySummary().pendingCount).toBe(0)
    delete process.env.NOMI_SETTINGS_DIR
  })
})
