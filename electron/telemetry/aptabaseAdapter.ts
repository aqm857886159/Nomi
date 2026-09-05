import { appFetch } from '../appFetch'
import { telemetryAppKey, telemetryEndpoint } from './telemetrySettings'
import { isTelemetryEnvelope, type TelemetryEnvelope } from './telemetryEvents'

export type TelemetryFetch = typeof globalThis.fetch

export async function sendAptabaseBatch(
  events: readonly TelemetryEnvelope[],
  deps: { fetch?: TelemetryFetch; appKey?: string; endpoint?: string | null; timeoutMs?: number } = {},
): Promise<void> {
  if (events.length === 0 || events.length > 25 || events.some((event) => !isTelemetryEnvelope(event))) {
    throw new Error('Invalid telemetry batch')
  }
  const appKey = deps.appKey ?? telemetryAppKey()
  const endpoint = deps.endpoint === undefined ? telemetryEndpoint() : deps.endpoint
  if (!appKey || !endpoint) throw new Error('Telemetry endpoint is not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 8_000)
  try {
    const response = await (deps.fetch ?? appFetch)(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'App-Key': appKey },
      credentials: 'omit',
      body: JSON.stringify(events),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`)
  } finally {
    clearTimeout(timer)
  }
}
