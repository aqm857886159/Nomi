import { TELEMETRY_ERROR_TYPE_PATTERN, TELEMETRY_RESULT_VALUES, type CapabilitySlot, type DurationBucket, type TelemetryResult } from '../shared/contracts/telemetry'

export type { CapabilitySlot, DurationBucket }
export const TELEMETRY_SCHEMA_VERSION = 1 as const
export const TELEMETRY_EVENT_NAMES = ['app.started', 'feature.used', 'generation.completed', 'export.completed', 'update.action', 'agent.turn.completed'] as const
export type TelemetryEventName = typeof TELEMETRY_EVENT_NAMES[number]
export type AttemptCountBucket = '1' | '2-3' | '4+'
export type FeatureId = 'generation' | 'export' | 'storyboard' | 'timeline' | 'asset-import' | 'agent'
export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'unknown'
export type UpdateAction = 'check' | 'download' | 'install'
/** 更新失败的原因类别（只有枚举，没有 message / URL）。开发版与非正式版不算失败，不上报。 */
export type UpdateFailureReason = 'network' | 'parse' | 'other'
/** 一个回合里调了几次工具。分桶而不是原数：原数在小样本上就是指纹。 */
export type ToolCallBucket = '0' | '1-3' | '4+'
/**
 * 「模型种类」—— 用户拍板要收的那一格，但**不能是模型 id**：自建中转的 key 由用户自己的
 * base-url 派生（`src/ui/community/feedbackDiagnostics.ts:41` 已经为反馈面解决过同一个问题），
 * 原样上报等于上报一个私有域名。所以只分三类：
 *   builtin = 我们策展过的供应商（稳定字面量）· custom = 用户自建/中转 · local = 本机跑的（ComfyUI 等）
 * 它回答的是「接自建中转的人回合成功率是不是更低」，而那不需要知道是哪一家。
 */
export type ModelClass = 'builtin' | 'custom' | 'local'

export type TelemetryProps =
  | { eventName: 'app.started'; props: { appMajor: number; appMinor: number; osFamily: 'macos' | 'windows' | 'linux' | 'other'; locale: 'zh-CN' | 'en' } }
  | { eventName: 'feature.used'; props: { featureId: FeatureId; result: TelemetryResult } }
  | { eventName: 'generation.completed'; props: { capability: CapabilitySlot; durationBucket: DurationBucket; result: TelemetryResult; attemptCountBucket: AttemptCountBucket; /** 只在 result='failure' 时带：失败类别码，永远不是原文。 */ errorType?: string } }
  | { eventName: 'export.completed'; props: { format: ExportFormat; durationBucket: DurationBucket; result: TelemetryResult } }
  | { eventName: 'update.action'; props: { action: UpdateAction; result: TelemetryResult; reason?: UpdateFailureReason } }
  | { eventName: 'agent.turn.completed'; props: { result: TelemetryResult; toolCallBucket: ToolCallBucket; modelClass: ModelClass } }

export type TelemetryEnvelope = {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION
  timestamp: string
  sessionId: string
  eventName: TelemetryEventName
  props: TelemetryProps['props']
  systemProps: { locale: 'zh-CN' | 'en'; osFamily: 'macos' | 'windows' | 'linux' | 'other'; appMajor: number; appMinor: number; /** 只在「这个进程是被测试 / 走查启动的」时出现，值恒为 true；真实用户的事件里根本没有这一格。 */ automated?: true }
}

const EVENT_SET = new Set<string>(TELEMETRY_EVENT_NAMES)
const RESULT_SET = new Set<TelemetryResult>(TELEMETRY_RESULT_VALUES)
const DURATION_SET = new Set<DurationBucket>(['<1s', '1-5s', '>5s'])
const ATTEMPT_SET = new Set<AttemptCountBucket>(['1', '2-3', '4+'])
const FEATURE_SET = new Set<FeatureId>(['generation', 'export', 'storyboard', 'timeline', 'asset-import', 'agent'])
const CAPABILITY_SET = new Set<CapabilitySlot>(['text', 'image', 'image-edit', 'video', 'audio', '3d'])
const EXPORT_SET = new Set<ExportFormat>(['mp4', 'webm', 'gif', 'unknown'])
const UPDATE_SET = new Set<UpdateAction>(['check', 'download', 'install'])
const UPDATE_REASON_SET = new Set<UpdateFailureReason>(['network', 'parse', 'other'])
const TOOL_CALL_SET = new Set<ToolCallBucket>(['0', '1-3', '4+'])
const MODEL_CLASS_SET = new Set<ModelClass>(['builtin', 'custom', 'local'])

export function durationBucket(durationMs: number): DurationBucket {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return '<1s'
  if (durationMs <= 5000) return '1-5s'
  return '>5s'
}

export function toolCallBucket(calls: number): ToolCallBucket {
  if (!Number.isFinite(calls) || calls <= 0) return '0'
  return calls <= 3 ? '1-3' : '4+'
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

/** errorType 是可选的第 5 格：只许出现在失败事件上，且必须是类别码形状。 */
function hasGenerationKeys(props: Record<string, unknown>): boolean {
  const base = ['capability', 'durationBucket', 'result', 'attemptCountBucket']
  if (!('errorType' in props)) return hasExactKeys(props, base)
  return hasExactKeys(props, [...base, 'errorType']) && props.result === 'failure' && typeof props.errorType === 'string' && TELEMETRY_ERROR_TYPE_PATTERN.test(props.errorType)
}

/** reason 是可选的第 3 格：只许出现在失败事件上，且必须在白名单里（旧队列里没有 reason 的事件照旧合法）。 */
function hasUpdateKeys(props: Record<string, unknown>): boolean {
  if (!('reason' in props)) return hasExactKeys(props, ['action', 'result'])
  return hasExactKeys(props, ['action', 'result', 'reason']) && props.result === 'failure' && UPDATE_REASON_SET.has(props.reason as UpdateFailureReason)
}

/**
 * 「这个进程是谁启动的」——以启动事实为准，不靠猜：tests/ux/_launchApp.mjs 是走查 / 评测唯一的
 * 启动器，它钉死 NOMI_E2E=1（真实资料副本跑的付费测试也走它）。普通用户的 App 不会有这个变量。
 */
export function isAutomatedLaunch(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NOMI_E2E === '1'
}

export function isTelemetryProps(value: unknown, eventName: TelemetryEventName): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const props = value as Record<string, unknown>
  if (Object.values(props).some((item) => !isPrimitive(item))) return false
  if (eventName === 'app.started') return hasExactKeys(props, ['appMajor', 'appMinor', 'osFamily', 'locale']) && Number.isInteger(props.appMajor) && Number.isInteger(props.appMinor) && ['macos', 'windows', 'linux', 'other'].includes(String(props.osFamily)) && ['zh-CN', 'en'].includes(String(props.locale))
  if (eventName === 'feature.used') return hasExactKeys(props, ['featureId', 'result']) && FEATURE_SET.has(props.featureId as FeatureId) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'generation.completed') return hasGenerationKeys(props) && CAPABILITY_SET.has(props.capability as CapabilitySlot) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult) && ATTEMPT_SET.has(props.attemptCountBucket as AttemptCountBucket)
  if (eventName === 'export.completed') return hasExactKeys(props, ['format', 'durationBucket', 'result']) && EXPORT_SET.has(props.format as ExportFormat) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'update.action') return hasUpdateKeys(props) && UPDATE_SET.has(props.action as UpdateAction) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'agent.turn.completed') return hasExactKeys(props, ['result', 'toolCallBucket', 'modelClass']) && RESULT_SET.has(props.result as TelemetryResult) && TOOL_CALL_SET.has(props.toolCallBucket as ToolCallBucket) && MODEL_CLASS_SET.has(props.modelClass as ModelClass)
  return false
}

export function buildTelemetryEnvelope(input: TelemetryProps, sessionId: string, appVersion: string, locale: 'zh-CN' | 'en' = 'zh-CN', platform = process.platform, automated = isAutomatedLaunch()): TelemetryEnvelope {
  const [major, minor] = String(appVersion || '0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const now = new Date()
  const timestamp = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
  return { schemaVersion: TELEMETRY_SCHEMA_VERSION, timestamp, sessionId, eventName: input.eventName, props: input.props, systemProps: { locale, osFamily: osFamily(platform), appMajor: major, appMinor: minor, ...(automated ? { automated: true as const } : {}) } } as TelemetryEnvelope
}

export function isTelemetryEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const system = envelope.systemProps as Record<string, unknown> | null
  const systemKeys = system && 'automated' in system ? ['locale', 'osFamily', 'appMajor', 'appMinor', 'automated'] : ['locale', 'osFamily', 'appMajor', 'appMinor']
  const validSystem = Boolean(system && !Array.isArray(system) && hasExactKeys(system, systemKeys) && (!('automated' in system) || system.automated === true) && ['zh-CN', 'en'].includes(String(system.locale)) && ['macos', 'windows', 'linux', 'other'].includes(String(system.osFamily)) && Number.isInteger(system.appMajor) && Number.isInteger(system.appMinor))
  return envelope.schemaVersion === TELEMETRY_SCHEMA_VERSION && typeof envelope.timestamp === 'string' && typeof envelope.sessionId === 'string' && EVENT_SET.has(String(envelope.eventName)) && validSystem && isTelemetryProps(envelope.props, envelope.eventName as TelemetryEventName)
}
