import { app } from 'electron'
import { recordTelemetryEvent } from './telemetryOutbox'
import { getDesktopLocale } from '../desktopLocale'

export function recordAppStarted(): void {
  const [major, minor] = app.getVersion().split('.').map((part) => Number.parseInt(part, 10) || 0)
  const osFamily = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'other'
  const locale = getDesktopLocale()
  recordTelemetryEvent({ eventName: 'app.started', props: { appMajor: major, appMinor: minor, osFamily, locale } }, app.getVersion(), locale)
}
