import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTelemetryEnvelope } from './telemetryEvents'

const success = { capability: 'image', durationBucket: '1-5s', result: 'success', mode: 'text', modelClass: 'builtin', submitDuration: '1-5s', waitDuration: 'none', upstreamStatus: 'ok' } as const

const roots: string[] = []
afterEach(() => { vi.restoreAllMocks(); const root = roots.pop(); if (root) fs.rmSync(root, { recursive: true, force: true }) })

describe('telemetry outbox', () => {
  it('does not make a network request while disabled', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: false })
    expect(outbox.recordTelemetryEvent({ eventName: 'generation.completed', props: success }, '1.0.0')).toBe(false)
    await outbox.flushTelemetry()
    expect(fetch).not.toHaveBeenCalled()
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })

  it('keeps a local summary and deletes it', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: true })
    const envelope = buildTelemetryEnvelope({ eventName: 'generation.completed', props: success }, 'session', '1.0.0')
    expect(outbox.enqueueTelemetryEvent(envelope)).toBe(true)
    expect(outbox.readTelemetrySummary().pendingCount).toBe(1)
    expect(outbox.deleteTelemetryData().deletedCount).toBe(1)
    expect(outbox.readTelemetrySummary().pendingCount).toBe(0)
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })
  const perfProps = { interactionP75: '100-200', interactionP95: '200-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes: '21-100', imageNodes: '1-20', generating: true, cpuCores: '9-16', memoryGb: '8plus', mainStallMax: 'none', mainStallCount: '0' } as const

  it('关遥测时性能汇总一条都不入队、不发请求', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const fetch = vi.spyOn(globalThis, 'fetch')
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: false })
    expect(outbox.recordTelemetryEvent({ eventName: 'perf.session.summary', props: perfProps }, '1.0.0')).toBe(false)
    await outbox.flushTelemetry()
    expect(fetch).not.toHaveBeenCalled()
    expect(outbox.readTelemetrySummary().pendingCount).toBe(0)
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })

  it('只同意过旧告知范围（盘上没有 scopeVersion）：旧事件照常入队，性能汇总不入队；重新确认后才入队', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    // 旧版本写下的文件：没有 scopeVersion 这一格。
    fs.writeFileSync(settings.telemetrySettingsPath(), JSON.stringify({ schemaVersion: 1, enabled: true, endpointMode: 'aptabase', consentedAt: '2026-09-20T00:00:00.000Z', installSessionId: 'abcdefghijklmnop' }))
    expect(settings.readTelemetrySettings().scopeVersion).toBe(1)
    expect(outbox.recordTelemetryEvent({ eventName: 'generation.completed', props: success }, '1.0.0')).toBe(true)
    expect(outbox.recordTelemetryEvent({ eventName: 'perf.session.summary', props: perfProps }, '1.0.0')).toBe(false)
    expect(outbox.readTelemetrySummary().pending.map((item) => item.eventName)).toEqual(['generation.completed'])
    // 点「同意新增」= 再写一次 enabled:true，主进程把范围升到当前版。
    expect(settings.writeTelemetrySettings({ enabled: true }).scopeVersion).toBe(2)
    expect(outbox.recordTelemetryEvent({ eventName: 'perf.session.summary', props: perfProps }, '1.0.0')).toBe(true)
    // 关掉再打开：范围回到 1 又升回 2（每次打开都是看着当前文案打开的）。
    expect(settings.writeTelemetrySettings({ enabled: false }).scopeVersion).toBe(1)
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })
  it('升级：旧版本排队的事件（没有补丁位 / 删掉的事件 / 写死的尝试次数）读出来就丢，新事件照常入队', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    settings.writeTelemetrySettings({ enabled: true })
    const day = new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z'
    const oldSystem = { locale: 'zh-CN', osFamily: 'macos', appMajor: 0, appMinor: 24 }
    const old = [
      { schemaVersion: 1, timestamp: day, sessionId: 's', eventName: 'feature.used', props: { featureId: 'generation', result: 'success' }, systemProps: oldSystem },
      { schemaVersion: 1, timestamp: day, sessionId: 's', eventName: 'generation.completed', props: { capability: 'image', durationBucket: '<1s', result: 'success', attemptCountBucket: '1' }, systemProps: oldSystem },
      { schemaVersion: 1, timestamp: day, sessionId: 's', eventName: 'agent.turn.completed', props: { result: 'success', toolCallBucket: '1-3', modelClass: 'builtin' }, systemProps: oldSystem },
    ]
    fs.writeFileSync(path.join(root, 'telemetry-outbox.json'), JSON.stringify({ schemaVersion: 1, pending: old, sent: [], failedCount: 0 }))
    expect(outbox.readTelemetrySummary().pendingCount).toBe(0)
    expect(outbox.recordTelemetryEvent({ eventName: 'generation.completed', props: success }, '0.25.0')).toBe(true)
    expect(outbox.readTelemetrySummary().pending.map((item) => item.eventName)).toEqual(['generation.completed'])
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })

  it('已经同意过范围 2 的老用户：新加的格不要求重新确认，开着就照发', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-telemetry-'))
    roots.push(root)
    vi.stubEnv("NOMI_SETTINGS_DIR", root)
    const settings = await import('../telemetry/telemetrySettings')
    const outbox = await import('./telemetryOutbox')
    fs.writeFileSync(settings.telemetrySettingsPath(), JSON.stringify({ schemaVersion: 1, enabled: true, endpointMode: 'nomi', consentedAt: '2026-10-20T00:00:00.000Z', installSessionId: 'abcdefghijklmnop', scopeVersion: 2 }))
    expect(settings.readTelemetrySettings().scopeVersion).toBe(2)
    expect(outbox.recordTelemetryEvent({ eventName: 'app.started', props: { appMajor: 0, appMinor: 25, osFamily: 'macos', locale: 'zh-CN', lastExit: 'renderer-crashed' } }, '0.25.0')).toBe(true)
    expect(outbox.recordTelemetryEvent({ eventName: 'perf.session.summary', props: perfProps }, '0.25.0')).toBe(true)
    expect(outbox.readTelemetrySummary().pendingCount).toBe(2)
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined)
  })
})
