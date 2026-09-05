import { TELEMETRY_RESULT_VALUES, type TelemetryResult } from '../shared/contracts/telemetry'

export const TELEMETRY_SCHEMA_VERSION = 1 as const
export const TELEMETRY_EVENT_NAMES = ['app.started', 'feature.used', 'generation.completed', 'export.completed', 'update.action'] as const
export type TelemetryEventName = typeof TELEMETRY_EVENT_NAMES[number]
export type DurationBucket = '<1s' | '1-5s' | '>5s'
export type AttemptCountBucket = '1' | '2-3' | '4+'
export type FeatureId = 'generation' | 'export' | 'storyboard' | 'timeline' | 'asset-import'
export type CapabilitySlot = 'text' | 'image' | 'image-edit' | 'video' | 'audio' | '3d'
export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'unknown'
export type UpdateAction = 'check' | 'download' | 'install'

export type TelemetryProps =
  | { eventName: 'app.started'; props: { appMajor: number; appMinor: number; osFamily: 'macos' | 'windows' | 'linux' | 'other'; locale: 'zh-CN' | 'en' } }
  | { eventName: 'feature.used'; props: { featureId: FeatureId; result: TelemetryResult } }
  | { eventName: 'generation.completed'; props: { capability: CapabilitySlot; durationBucket: DurationBucket; result: TelemetryResult; attemptCountBucket: AttemptCountBucket } }
  | { eventName: 'export.completed'; props: { format: ExportFormat; durationBucket: DurationBucket; result: TelemetryResult } }
  | { eventName: 'update.action'; props: { action: UpdateAction; result: TelemetryResult } }

export type TelemetryEnvelope = {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION
  timestamp: string
  sessionId: string
  eventName: TelemetryEventName
  props: TelemetryProps['props']
  systemProps: { locale: 'zh-CN' | 'en'; osFamily: 'macos' | 'windows' | 'linux' | 'other'; appMajor: number; appMinor: number }
}

const EVENT_SET = new Set<string>(TELEMETRY_EVENT_NAMES)
const RESULT_SET = new Set<TelemetryResult>(TELEMETRY_RESULT_VALUES)
const DURATION_SET = new Set<DurationBucket>(['<1s', '1-5s', '>5s'])
const ATTEMPT_SET = new Set<AttemptCountBucket>(['1', '2-3', '4+'])
const FEATURE_SET = new Set<FeatureId>(['generation', 'export', 'storyboard', 'timeline', 'asset-import'])
const CAPABILITY_SET = new Set<CapabilitySlot>(['text', 'image', 'image-edit', 'video', 'audio', '3d'])
const EXPORT_SET = new Set<ExportFormat>(['mp4', 'webm', 'gif', 'unknown'])
const UPDATE_SET = new Set<UpdateAction>(['check', 'download', 'install'])

export function durationBucket(durationMs: number): DurationBucket {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return '<1s'
  if (durationMs <= 5000) return '1-5s'
  return '>5s'
}

export function attemptCountBucket(attempts: number): AttemptCountBucket {
  if (!Number.isFinite(attempts) || attempts <= 1) return '1'
  if (attempts <= 3) return '2-3'
  return '4+'
}

export function osFamily(platform = process.platform): 'macos' | 'windows' | 'linux' | 'other' {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  return 'other'
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index])
}

export function isTelemetryProps(value: unknown, eventName: TelemetryEventName): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const props = value as Record<string, unknown>
  if (Object.values(props).some((item) => !isPrimitive(item))) return false
  if (eventName === 'app.started') return hasExactKeys(props, ['appMajor', 'appMinor', 'osFamily', 'locale']) && Number.isInteger(props.appMajor) && Number.isInteger(props.appMinor) && ['macos', 'windows', 'linux', 'other'].includes(String(props.osFamily)) && ['zh-CN', 'en'].includes(String(props.locale))
  if (eventName === 'feature.used') return hasExactKeys(props, ['featureId', 'result']) && FEATURE_SET.has(props.featureId as FeatureId) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'generation.completed') return hasExactKeys(props, ['capability', 'durationBucket', 'result', 'attemptCountBucket']) && CAPABILITY_SET.has(props.capability as CapabilitySlot) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult) && ATTEMPT_SET.has(props.attemptCountBucket as AttemptCountBucket)
  if (eventName === 'export.completed') return hasExactKeys(props, ['format', 'durationBucket', 'result']) && EXPORT_SET.has(props.format as ExportFormat) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'update.action') return hasExactKeys(props, ['action', 'result']) && UPDATE_SET.has(props.action as UpdateAction) && RESULT_SET.has(props.result as TelemetryResult)
  return false
}

export function buildTelemetryEnvelope(input: TelemetryProps, sessionId: string, appVersion: string, locale: 'zh-CN' | 'en' = 'zh-CN', platform = process.platform): TelemetryEnvelope {
  const [major, minor] = String(appVersion || '0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const now = new Date()
  const timestamp = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
  return { schemaVersion: TELEMETRY_SCHEMA_VERSION, timestamp, sessionId, eventName: input.eventName, props: input.props, systemProps: { locale, osFamily: osFamily(platform), appMajor: major, appMinor: minor } } as TelemetryEnvelope
}

export function isTelemetryEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const system = envelope.systemProps as Record<string, unknown> | null
  const validSystem = Boolean(system && !Array.isArray(system) && hasExactKeys(system, ['locale', 'osFamily', 'appMajor', 'appMinor']) && ['zh-CN', 'en'].includes(String(system.locale)) && ['macos', 'windows', 'linux', 'other'].includes(String(system.osFamily)) && Number.isInteger(system.appMajor) && Number.isInteger(system.appMinor))
  return envelope.schemaVersion === TELEMETRY_SCHEMA_VERSION && typeof envelope.timestamp === 'string' && typeof envelope.sessionId === 'string' && EVENT_SET.has(String(envelope.eventName)) && validSystem && isTelemetryProps(envelope.props, envelope.eventName as TelemetryEventName)
}
