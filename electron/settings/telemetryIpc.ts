import { app, ipcMain } from 'electron'
import type { TelemetrySettingsView } from '../shared/contracts/telemetry'
import { assertTrustedSender } from '../ipcSenderGuard'
import { deleteTelemetryData, flushTelemetry, readTelemetrySummary, recordTelemetryEvent } from '../telemetry/telemetryOutbox'
import { isTelemetryProps, type TelemetryEventName, type TelemetryProps } from '../telemetry/telemetryEvents'
import { clearTelemetrySession, readTelemetrySettings, telemetryEndpointConfigured, writeTelemetrySettings, type TelemetrySettings } from '../telemetry/telemetrySettings'

export type { TelemetrySettingsView } from '../shared/contracts/telemetry'

function view(settings = readTelemetrySettings()): TelemetrySettingsView {
  return { ...settings, endpointConfigured: telemetryEndpointConfigured(), status: settings.enabled ? (telemetryEndpointConfigured() ? 'configured' : 'unconfigured') : 'disabled' }
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
    const raw = payload as { eventName?: unknown; props?: unknown; locale?: unknown }
    const eventName = raw.eventName as TelemetryEventName
    if (!isTelemetryProps(raw.props, eventName)) return { queued: false }
    return { queued: recordTelemetryEvent({ eventName, props: raw.props } as TelemetryProps, app.getVersion(), raw.locale === 'en' ? 'en' : 'zh-CN') }
  })
}
