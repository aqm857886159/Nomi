import { app, ipcMain } from 'electron'
import type { TelemetrySettingsView } from '../shared/contracts/telemetry'
import { assertTrustedSender } from '../ipcSenderGuard'
import { deleteTelemetryData, flushTelemetry, readTelemetrySummary, recordTelemetryEvent } from '../telemetry/telemetryOutbox'
import { isTelemetryProps, type TelemetryEventName, type TelemetryProps } from '../telemetry/telemetryEvents'
import { clearTelemetrySession, readTelemetrySettings, writeTelemetrySettings } from '../telemetry/telemetrySettings'
import { intakeConfigured } from '../telemetry/intakeClient'
import { modelClassOfVendor } from '../telemetry/agentToolFailureTelemetry'
import { takeMainStallTelemetryWindow } from '../diagnostics/stallMonitor'
import { mainStallCountBucket, mainStallMaxBucket } from '../shared/contracts/telemetry'

export type { TelemetrySettingsView } from '../shared/contracts/telemetry'

function view(settings = readTelemetrySettings()): TelemetrySettingsView {
  return { ...settings, endpointConfigured: intakeConfigured(), status: settings.enabled ? (intakeConfigured() ? 'configured' : 'unconfigured') : 'disabled' }
}

export function registerTelemetryIpc(): void {
  ipcMain.handle('nomi:settings:telemetry-get', (event) => {
    assertTrustedSender(event)
    return view()
  })
  ipcMain.handle('nomi:settings:telemetry-set', async (event, payload: unknown) => {
    assertTrustedSender(event)
    const next = writeTelemetrySettings(payload)
    if (!next.enabled) {
      clearTelemetrySession()
      deleteTelemetryData()
    } else {
      await flushTelemetry()
    }
    return view(next)
  })
  ipcMain.handle('nomi:settings:telemetry-summary', (event) => {
    assertTrustedSender(event)
    return readTelemetrySummary()
  })
  ipcMain.handle('nomi:settings:telemetry-delete', (event) => {
    assertTrustedSender(event)
    clearTelemetrySession()
    return deleteTelemetryData()
  })
  ipcMain.handle('nomi:telemetry:track', (event, payload: unknown) => {
    assertTrustedSender(event)
    if (!payload || typeof payload !== 'object') return { queued: false }
    const raw = payload as { eventName?: unknown; props?: unknown; locale?: unknown; vendorKey?: unknown }
    const eventName = raw.eventName as TelemetryEventName
    const props = withMainProcessFacts(eventName, raw.props, raw.vendorKey)
    if (!isTelemetryProps(props, eventName)) return { queued: false }
    return { queued: recordTelemetryEvent({ eventName, props } as TelemetryProps, app.getVersion(), raw.locale === 'en' ? 'en' : 'zh-CN') }
  })
}

/**
 * 渲染层交来的事件里，有两格只有主进程说了算（2026-11-13）：
 *   · generation.completed 的 `modelClass`：渲染层只带 vendorKey 过 IPC，这里按内置种子表归成三类，vendorKey 本身不进事件；
 *   · perf.session.summary 的主进程停顿两格：取主进程卡顿监视器的内存计数（上次取数以来）。
 * 只读内存，不读盘（设计卡 ★7）。渲染层自己填的同名格一律被覆盖。
 */
export function withMainProcessFacts(eventName: TelemetryEventName, props: unknown, vendorKey: unknown): unknown {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return props
  if (eventName === 'generation.completed') return { ...props, modelClass: modelClassOfVendor(typeof vendorKey === 'string' ? vendorKey : undefined) }
  if (eventName === 'perf.session.summary') {
    const stall = takeMainStallTelemetryWindow()
    return { ...props, mainStallMax: mainStallMaxBucket(stall?.maxMs ?? null), mainStallCount: mainStallCountBucket(stall?.count ?? null) }
  }
  return props
}
