export type TelemetryStatus = 'disabled' | 'unconfigured' | 'configured'
export const TELEMETRY_RESULT_VALUES = ['success', 'failure', 'cancel'] as const
export type TelemetryResult = typeof TELEMETRY_RESULT_VALUES[number]
export type TelemetrySettingsView = {
  schemaVersion: 1
  enabled: boolean
  endpointMode: 'aptabase'
  consentedAt: string | null
  installSessionId: string | null
  endpointConfigured: boolean
  status: TelemetryStatus
}
export type TelemetrySummaryItem = { eventName: string; timestamp: string }
export type TelemetrySummary = {
  pending: TelemetrySummaryItem[]
  sent: TelemetrySummaryItem[]
  pendingCount: number
  sentCount: number
  failedCount: number
  endpointConfigured: boolean
}
