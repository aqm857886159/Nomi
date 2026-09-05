import crypto from 'node:crypto'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from '../settings/settingsRoot'

export type TelemetrySettings = { schemaVersion: 1; enabled: boolean; endpointMode: 'aptabase'; consentedAt: string | null; installSessionId: string | null }
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = { schemaVersion: 1, enabled: false, endpointMode: 'aptabase', consentedAt: null, installSessionId: null }
const FILE = 'telemetry-settings.json'
let processSessionId: string | null = null
export function telemetrySettingsPath(): string { return path.join(getSettingsRoot(), FILE) }
function validSession(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value) }
export function readTelemetrySettings(): TelemetrySettings {
  try {
    const raw = readJsonFile(telemetrySettingsPath()) as Partial<TelemetrySettings>
    return { schemaVersion: 1, enabled: raw.enabled === true, endpointMode: 'aptabase', consentedAt: typeof raw.consentedAt === 'string' ? raw.consentedAt : null, installSessionId: validSession(raw.installSessionId) ? raw.installSessionId : null }
  } catch { return { ...DEFAULT_TELEMETRY_SETTINGS } }
}
export function writeTelemetrySettings(input: unknown): TelemetrySettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<TelemetrySettings>
  const enabled = raw.enabled === true
  const next: TelemetrySettings = { schemaVersion: 1, enabled, endpointMode: 'aptabase', consentedAt: enabled ? (typeof raw.consentedAt === 'string' ? raw.consentedAt : new Date().toISOString()) : null, installSessionId: enabled ? (validSession(raw.installSessionId) ? raw.installSessionId : crypto.randomBytes(12).toString('base64url')) : null }
  processSessionId = enabled ? next.installSessionId : null
  writeJsonFileAtomic(telemetrySettingsPath(), next)
  return next
}
export function getTelemetrySessionId(): string {
  const current = readTelemetrySettings()
  if (!current.enabled) return ''
  if (!processSessionId) {
    processSessionId = crypto.randomBytes(12).toString('base64url')
    writeJsonFileAtomic(telemetrySettingsPath(), { ...current, installSessionId: processSessionId })
  }
  return processSessionId
}
export function clearTelemetrySession(): void { processSessionId = null }

export function telemetryAppKey(): string {
  return String(process.env.NOMI_APTABASE_APP_KEY || '').trim()
}

export function telemetryEndpoint(): string | null {
  const configured = String(process.env.NOMI_APTABASE_ENDPOINT || '').trim().replace(/\/$/, '')
  if (configured) return /^https:\/\//i.test(configured) ? `${configured}/api/v0/events` : null
  const appKey = telemetryAppKey()
  if (/^A-EU-/i.test(appKey)) return 'https://eu.aptabase.com/api/v0/events'
  if (/^A-US-/i.test(appKey)) return 'https://us.aptabase.com/api/v0/events'
  return null
}

export function telemetryEndpointConfigured(): boolean {
  return telemetryEndpoint() !== null && telemetryAppKey().length > 0
}
