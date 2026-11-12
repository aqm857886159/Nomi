import { app } from 'electron'
import { recordTelemetryEvent } from './telemetryOutbox'
import { getDesktopLocale } from '../desktopLocale'
import { setOutboundRefusalReporter } from '../networkOutboundPolicy'

export function recordAppStarted(): void {
  const [major, minor] = app.getVersion().split('.').map((part) => Number.parseInt(part, 10) || 0)
  const osFamily = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform === 'linux' ? 'linux' : 'other'
  const locale = getDesktopLocale()
  recordTelemetryEvent({ eventName: 'app.started', props: { appMajor: major, appMinor: minor, osFamily, locale } }, app.getVersion(), locale)
  // 出站策略是纯判据（不认得 electron），拒绝的子码在启动这一刻接到遥测；同意与否、范围版本由 outbox 门口判。
  setOutboundRefusalReporter((facts) => {
    recordTelemetryEvent({ eventName: 'network.outbound.refused', props: facts }, app.getVersion(), getDesktopLocale())
  })
}
