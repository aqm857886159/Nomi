import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from '../settings/settingsRoot'
import { installAgeBucketFromElapsedMs, type InstallAgeBucket } from '../shared/contracts/telemetry'
import { TELEMETRY_SCOPE_VERSION, type TelemetryScopeVersion } from './telemetryEvents'

// 只管**用户同意了没有**：合同、同意时间、匿名会话 id。
// 「东西往哪发」（端点 / 令牌 / 超时）住在 `intakeClient.ts`——换域名不该碰同意合同，
// 改同意语义不该碰 HTTP，两件事各自独立变化。
//
// `endpointMode` 2026-09-15 从 'aptabase' 改成 'nomi'（自建接收端）。
// `readTelemetrySettings` 把这一格**硬写**成 'nomi' 而不是读盘上的值：
// 老 profile 里存的是 'aptabase'，照读会得到一个已经不存在的模式，而这一格从来不是
// 用户的选择（他选的只有开/关），所以归一比迁移诚实——没有第二种模式可迁。

export type TelemetrySettings = { schemaVersion: 1; enabled: boolean; endpointMode: 'nomi'; consentedAt: string | null; installSessionId: string | null; /** 用户同意的是哪一版告知范围。盘上没有这一格 = 1（旧版本同意的）。 */ scopeVersion: TelemetryScopeVersion }
type PersistedTelemetrySettings = TelemetrySettings & { /** 仅本机保存的首次配置时刻，用于粗算 installAgeBucket，精确时间永不出站。 */ firstSeenAt?: string }
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = { schemaVersion: 1, enabled: false, endpointMode: 'nomi', consentedAt: null, installSessionId: null, scopeVersion: 1 }
const FILE = 'telemetry-settings.json'
let processSessionId: string | null = null
export function telemetrySettingsPath(): string { return path.join(getSettingsRoot(), FILE) }
function validSession(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(value) }
function validIsoTimestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }

function readPersistedRaw(): Partial<PersistedTelemetrySettings> {
  try {
    return (readJsonFile(telemetrySettingsPath()) ?? {}) as Partial<PersistedTelemetrySettings>
  } catch {
    return {}
  }
}

function statAnchorMs(targetPath: string): number | null {
  try {
    const stat = fs.statSync(targetPath)
    const birth = Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs
    return Number.isFinite(birth) && birth > 0 ? birth : null
  } catch {
    return null
  }
}

export function readTelemetrySettings(): TelemetrySettings {
  const raw = readPersistedRaw()
  if (!raw || Object.keys(raw).length === 0) return { ...DEFAULT_TELEMETRY_SETTINGS }
  return { schemaVersion: 1, enabled: raw.enabled === true, endpointMode: 'nomi', consentedAt: typeof raw.consentedAt === 'string' ? raw.consentedAt : null, installSessionId: validSession(raw.installSessionId) ? raw.installSessionId : null, scopeVersion: raw.scopeVersion === TELEMETRY_SCOPE_VERSION ? TELEMETRY_SCOPE_VERSION : 1 }
}

export function writeTelemetrySettings(input: unknown): TelemetrySettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<PersistedTelemetrySettings>
  const existing = readPersistedRaw()
  const enabled = raw.enabled === true
  const nowIso = new Date().toISOString()
  const firstSeenAt = validIsoTimestamp(raw.firstSeenAt)
    ? raw.firstSeenAt
    : validIsoTimestamp(existing.firstSeenAt)
      ? existing.firstSeenAt
      : validIsoTimestamp(existing.consentedAt)
        ? existing.consentedAt
        : nowIso
  const next: TelemetrySettings = { schemaVersion: 1, enabled, endpointMode: 'nomi', consentedAt: enabled ? (typeof raw.consentedAt === 'string' ? raw.consentedAt : nowIso) : null, installSessionId: enabled ? (validSession(raw.installSessionId) ? raw.installSessionId : crypto.randomBytes(12).toString('base64url')) : null, /* 打开 / 确认这一下，用户面前就是当前这版告知文字；关掉则回到 1，下次打开再重新确认。 */ scopeVersion: enabled ? TELEMETRY_SCOPE_VERSION : 1 }
  processSessionId = enabled ? next.installSessionId : null
  writeJsonFileAtomic(telemetrySettingsPath(), { ...next, firstSeenAt })
  return next
}

/** 基于本机首次记录时间或设置目录创建时间粗算账龄分档；精确时间戳永远留在盘上不出站。 */
export function readInstallAgeBucket(nowMs = Date.now()): InstallAgeBucket {
  const raw = readPersistedRaw()
  const isoCandidate = validIsoTimestamp(raw.firstSeenAt) ? Date.parse(raw.firstSeenAt) : validIsoTimestamp(raw.consentedAt) ? Date.parse(raw.consentedAt) : null
  const anchorMs = isoCandidate ?? statAnchorMs(telemetrySettingsPath()) ?? statAnchorMs(getSettingsRoot())
  if (anchorMs === null) return 'd0'
  return installAgeBucketFromElapsedMs(Math.max(0, nowMs - anchorMs))
}

export function getTelemetrySessionId(): string {
  const raw = readPersistedRaw()
  const current = readTelemetrySettings()
  if (!current.enabled) return ''
  if (!processSessionId) {
    processSessionId = crypto.randomBytes(12).toString('base64url')
    const firstSeenAt = validIsoTimestamp(raw.firstSeenAt) ? raw.firstSeenAt : (validIsoTimestamp(current.consentedAt) ? current.consentedAt : new Date().toISOString())
    writeJsonFileAtomic(telemetrySettingsPath(), { ...current, installSessionId: processSessionId, firstSeenAt })
  }
  return processSessionId
}
export function clearTelemetrySession(): void { processSessionId = null }
