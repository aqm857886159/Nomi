import { isPerfSummaryProps, type PerfSummaryProps } from '../shared/contracts/perfTelemetry'
import {
  GENERATION_FAILURE_STAGES, GENERATION_LOCAL_REFUSALS, GENERATION_MODES, GENERATION_STAGE_DURATIONS, GENERATION_UPSTREAM_STATUSES,
  LAST_EXIT_VALUES, MAIN_STALL_COUNT_VALUES, MAIN_STALL_MAX_VALUES, MODEL_CLASS_VALUES,
  TELEMETRY_ERROR_TYPE_PATTERN, TELEMETRY_RESULT_VALUES,
  type CapabilitySlot, type DurationBucket, type GenerationFailureStage, type GenerationLocalRefusal, type GenerationMode, type GenerationStageDuration,
  type GenerationUpstreamStatus, type LastExit, type MainStallCount, type MainStallMax, type ModelClass, type TelemetryResult,
} from '../shared/contracts/telemetry'
import { isGenerationProblemCode, type GenerationProblemCode } from '../shared/generationProblem'

export type { CapabilitySlot, DurationBucket, ModelClass }
export const TELEMETRY_SCHEMA_VERSION = 1 as const
export const TELEMETRY_EVENT_NAMES = ['app.started', 'generation.completed', 'export.completed', 'update.action', 'agent.tool.failed', 'perf.session.summary'] as const
export type TelemetryEventName = typeof TELEMETRY_EVENT_NAMES[number]
/**
 * 告知范围的版本号。用户在设置页 / 同意卡上看到并同意的是哪一版文字，就记哪一版。
 *   1 = 功能使用、耗时区间、成败、失败类别、Agent 工具失败
 *   2 = 在 1 之上加「界面流畅度分档数字 + 粗略场景与设备档位」（perf.session.summary）
 * 加新**一类**数据 = 改告知文字 + 这里 +1 + 在下面的表里给新事件标上它需要的版本。
 * 给已有事件补一格、且这一格落在它已有的类里，不升档、不对已开启的人重新确认（用户 2026-11-13「已经开了 说明他愿意做数据反馈」）。
 * 2026-11-13 补的几格各落在哪一类：生成的阶段 / 上游状态类别 / 本机拒绝码 / 方式 / 模型种类 / 分段耗时 = 范围 1 的
 * 「耗时区间、成败、失败类别」；上次怎么退出 = 范围 1 的「成败」；补丁号 = 原有的版本号；主进程停顿 = 范围 2 的「流畅度分档」。
 * 告知文字照样要改成属实：设置页说明与事件表的对账在 telemetryClaims.test.ts。
 */
export const TELEMETRY_SCOPE_VERSION = 2 as const
export type TelemetryScopeVersion = 1 | 2
/** 每个事件至少要用户同意过哪一版告知范围才能入队。Record 是穷举的：新增事件名不标版本就编译不过。 */
export const TELEMETRY_EVENT_MIN_SCOPE: Record<TelemetryEventName, TelemetryScopeVersion> = {
  'app.started': 1,
  'generation.completed': 1,
  'export.completed': 1,
  'update.action': 1,
  // 范围 1 的「失败类别、Agent 工具失败」：工具名与失败码都是我们自己写的标识符，没有用户的一个字。
  'agent.tool.failed': 1,
  'perf.session.summary': 2,
}
export type ExportFormat = 'mp4' | 'webm' | 'gif' | 'unknown'
export type UpdateAction = 'check' | 'download' | 'install'
/** 更新失败的原因类别（只有枚举，没有 message / URL）。开发版与非正式版不算失败，不上报。 */
export type UpdateFailureReason = 'network' | 'parse' | 'other'
/**
 * 一次 Agent 工具调用失败（2026-11-07）。回答的是「哪个工具、哪种失败、第几次、熔断拦没拦」——
 * 用户反馈「经常参数不合法 然后重试」，线上要能数出来这件事是不是变少了。
 * 只有标识符：工具名是这条 lane 注册过的名字（否则 `other`），失败码是我们自己的码；不带入参、不带正文。
 *
 * `reason`（2026-11-08，可选第 6 格）：起草期被拒的**闭合原因**（`generationProblem.ts` 的码表，如 `unknown_model`）。
 * 粗码 `generation_input_invalid` 数不出「点名的模型不存在」和「没配默认模型」各几次；这一格数得出。
 * 仍在告知范围 1 的「失败类别」里：只能是码表里的值，校验拒收表外的任何字符串。
 */
export type AgentToolFailedProps = { toolName: string; failureCode: string; attempt: 1 | 2 | 3 | 4 | 5; breakerTripped: boolean; modelClass: ModelClass; reason?: GenerationProblemCode }
/** 工具名与失败码的形状：小写标识符。用户写的话（含空格、中文、大写、标点）过不了这一道。 */
export const TELEMETRY_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,47}$/

/**
 * 一次画布生成的结局（2026-11-13 补细）。每一格回答一个问题，取值全是闭合集合（`shared/contracts/telemetry.ts`）：
 *   mode / modelClass —— 哪种方式、哪一类模型；submitDuration / waitDuration —— 提交、等待（含取回落地）各多久；
 *   upstreamStatus —— 上游怎么答的（成功、鉴权、限流、其它 4xx、5xx、网络、超时、没发出去、受理后报失败、说不清）；
 *   失败才有：failureStage —— 卡在提交 / 等待 / 取回 / 落地哪一段；localRefusal —— 没发出去时是本机哪条规则（只认已闭合的码）；
 *   errorType —— 原有的失败类别码。
 */
export type GenerationCompletedProps = {
  capability: CapabilitySlot
  durationBucket: DurationBucket
  result: TelemetryResult
  mode: GenerationMode
  modelClass: ModelClass
  submitDuration: GenerationStageDuration
  waitDuration: GenerationStageDuration
  /** 取消时不带。 */
  upstreamStatus?: GenerationUpstreamStatus
  /** 只在 result='failure' 时带：失败类别码，永远不是原文。 */
  errorType?: string
  failureStage?: GenerationFailureStage
  /** 只在 upstreamStatus='not-sent' 时带。 */
  localRefusal?: GenerationLocalRefusal
}
/** 主进程补的两格：渲染层只交界面那一份（`PerfSummaryProps`），主进程停顿由主进程自己的监视器给。 */
export type PerfSessionSummaryProps = PerfSummaryProps & { mainStallMax: MainStallMax; mainStallCount: MainStallCount }

export type TelemetryProps =
  | { eventName: 'app.started'; props: { appMajor: number; appMinor: number; osFamily: 'macos' | 'windows' | 'linux' | 'other'; locale: 'zh-CN' | 'en'; /** 上一次启动是怎么结束的（本机退出标记，下次启动才知道）。 */ lastExit: LastExit } }
  | { eventName: 'generation.completed'; props: GenerationCompletedProps }
  | { eventName: 'export.completed'; props: { format: ExportFormat; durationBucket: DurationBucket; result: TelemetryResult } }
  | { eventName: 'update.action'; props: { action: UpdateAction; result: TelemetryResult; reason?: UpdateFailureReason } }
  | { eventName: 'agent.tool.failed'; props: AgentToolFailedProps }
  | { eventName: 'perf.session.summary'; props: PerfSessionSummaryProps }

export type TelemetryEnvelope = {
  schemaVersion: typeof TELEMETRY_SCHEMA_VERSION
  timestamp: string
  sessionId: string
  eventName: TelemetryEventName
  props: TelemetryProps['props']
  systemProps: { locale: 'zh-CN' | 'en'; osFamily: 'macos' | 'windows' | 'linux' | 'other'; appMajor: number; appMinor: number; /** 补丁位（2026-11-13）：「这版修好了吗」要分得开 0.24.0 和 0.24.1。 */ appPatch: number; /** 只在「这个进程是被测试 / 走查启动的」时出现，值恒为 true；真实用户的事件里根本没有这一格。 */ automated?: true }
}

const EVENT_SET = new Set<string>(TELEMETRY_EVENT_NAMES)
const RESULT_SET = new Set<TelemetryResult>(TELEMETRY_RESULT_VALUES)
const DURATION_SET = new Set<DurationBucket>(['<1s', '1-5s', '>5s'])
const CAPABILITY_SET = new Set<CapabilitySlot>(['text', 'image', 'image-edit', 'video', 'audio', '3d'])
const EXPORT_SET = new Set<ExportFormat>(['mp4', 'webm', 'gif', 'unknown'])
const UPDATE_SET = new Set<UpdateAction>(['check', 'download', 'install'])
const UPDATE_REASON_SET = new Set<UpdateFailureReason>(['network', 'parse', 'other'])
const MODEL_CLASS_SET = new Set<string>(MODEL_CLASS_VALUES)
const MODE_SET = new Set<string>(GENERATION_MODES)
const STAGE_DURATION_SET = new Set<string>(GENERATION_STAGE_DURATIONS)
const UPSTREAM_SET = new Set<string>(GENERATION_UPSTREAM_STATUSES)
const FAILURE_STAGE_SET = new Set<string>(GENERATION_FAILURE_STAGES)
const LOCAL_REFUSAL_SET = new Set<string>(GENERATION_LOCAL_REFUSALS)
const LAST_EXIT_SET = new Set<string>(LAST_EXIT_VALUES)
const MAIN_STALL_MAX_SET = new Set<string>(MAIN_STALL_MAX_VALUES)
const MAIN_STALL_COUNT_SET = new Set<string>(MAIN_STALL_COUNT_VALUES)

export function durationBucket(durationMs: number): DurationBucket {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return '<1s'
  if (durationMs <= 5000) return '1-5s'
  return '>5s'
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

/**
 * 生成完成：键集合由结果推出来、必须恰好相等（多一格少一格都拒）——
 *   成功 = 基础 7 格 + upstreamStatus（只能是 ok）；取消 = 基础 7 格；
 *   失败 = 基础 7 格 + upstreamStatus（ok 只许配取回 / 落地两段）+ errorType + failureStage，没发出去时再 + localRefusal。
 */
const GENERATION_BASE_KEYS = ['capability', 'durationBucket', 'result', 'mode', 'modelClass', 'submitDuration', 'waitDuration'] as const
function isGenerationProps(props: Record<string, unknown>): boolean {
  if (!(CAPABILITY_SET.has(props.capability as CapabilitySlot) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult)
    && MODE_SET.has(String(props.mode)) && MODEL_CLASS_SET.has(String(props.modelClass))
    && STAGE_DURATION_SET.has(String(props.submitDuration)) && STAGE_DURATION_SET.has(String(props.waitDuration)))) return false
  if (props.result === 'cancel') return hasExactKeys(props, GENERATION_BASE_KEYS)
  if (props.result === 'success') return hasExactKeys(props, [...GENERATION_BASE_KEYS, 'upstreamStatus']) && props.upstreamStatus === 'ok'
  const notSent = props.upstreamStatus === 'not-sent'
  return hasExactKeys(props, [...GENERATION_BASE_KEYS, 'upstreamStatus', 'errorType', 'failureStage', ...(notSent ? ['localRefusal'] : [])])
    && UPSTREAM_SET.has(String(props.upstreamStatus))
    // 上游答「成了」的失败只可能在取回 / 落地两段（钱花了、失败在我们这一侧）。
    && (props.upstreamStatus !== 'ok' || props.failureStage === 'fetch' || props.failureStage === 'land')
    && typeof props.errorType === 'string' && TELEMETRY_ERROR_TYPE_PATTERN.test(props.errorType)
    && FAILURE_STAGE_SET.has(String(props.failureStage))
    && (!notSent || LOCAL_REFUSAL_SET.has(String(props.localRefusal)))
}

/** perf 汇总 = 渲染层那一份（`isPerfSummaryProps` 的白名单）+ 主进程补的两格。 */
function isPerfSessionSummaryProps(props: Record<string, unknown>): boolean {
  const { mainStallMax, mainStallCount, ...renderer } = props
  return MAIN_STALL_MAX_SET.has(String(mainStallMax)) && MAIN_STALL_COUNT_SET.has(String(mainStallCount)) && isPerfSummaryProps(renderer)
}

/** reason 是可选的第 3 格：只许出现在失败事件上，且必须在白名单里（旧队列里没有 reason 的事件照旧合法）。 */
function hasUpdateKeys(props: Record<string, unknown>): boolean {
  if (!('reason' in props)) return hasExactKeys(props, ['action', 'result'])
  return hasExactKeys(props, ['action', 'result', 'reason']) && props.result === 'failure' && UPDATE_REASON_SET.has(props.reason as UpdateFailureReason)
}

/** reason 是可选的第 6 格：只许是闭合原因码表里的值（旧队列里没有 reason 的事件照旧合法）。 */
function hasAgentToolFailedKeys(props: Record<string, unknown>): boolean {
  const base = ['toolName', 'failureCode', 'attempt', 'breakerTripped', 'modelClass']
  if (!('reason' in props)) return hasExactKeys(props, base)
  return hasExactKeys(props, [...base, 'reason']) && isGenerationProblemCode(props.reason)
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
  if (eventName === 'app.started') return hasExactKeys(props, ['appMajor', 'appMinor', 'osFamily', 'locale', 'lastExit']) && Number.isInteger(props.appMajor) && Number.isInteger(props.appMinor) && ['macos', 'windows', 'linux', 'other'].includes(String(props.osFamily)) && ['zh-CN', 'en'].includes(String(props.locale)) && LAST_EXIT_SET.has(String(props.lastExit))
  if (eventName === 'generation.completed') return isGenerationProps(props)
  if (eventName === 'export.completed') return hasExactKeys(props, ['format', 'durationBucket', 'result']) && EXPORT_SET.has(props.format as ExportFormat) && DURATION_SET.has(props.durationBucket as DurationBucket) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'update.action') return hasUpdateKeys(props) && UPDATE_SET.has(props.action as UpdateAction) && RESULT_SET.has(props.result as TelemetryResult)
  if (eventName === 'agent.tool.failed') return hasAgentToolFailedKeys(props)
    && typeof props.toolName === 'string' && TELEMETRY_IDENTIFIER_PATTERN.test(props.toolName)
    && typeof props.failureCode === 'string' && TELEMETRY_IDENTIFIER_PATTERN.test(props.failureCode)
    && Number.isInteger(props.attempt) && (props.attempt as number) >= 1 && (props.attempt as number) <= 5
    && typeof props.breakerTripped === 'boolean' && MODEL_CLASS_SET.has(String(props.modelClass))
  if (eventName === 'perf.session.summary') return isPerfSessionSummaryProps(props)
  return false
}

export function buildTelemetryEnvelope(input: TelemetryProps, sessionId: string, appVersion: string, locale: 'zh-CN' | 'en' = 'zh-CN', platform = process.platform, automated = isAutomatedLaunch()): TelemetryEnvelope {
  const [major = 0, minor = 0, patch = 0] = String(appVersion || '0.0.0').split('.').map((part) => Number.parseInt(part, 10) || 0)
  const now = new Date()
  const timestamp = `${now.toISOString().slice(0, 10)}T00:00:00.000Z`
  return { schemaVersion: TELEMETRY_SCHEMA_VERSION, timestamp, sessionId, eventName: input.eventName, props: input.props, systemProps: { locale, osFamily: osFamily(platform), appMajor: major, appMinor: minor, appPatch: patch, ...(automated ? { automated: true as const } : {}) } } as TelemetryEnvelope
}

/**
 * 整份信封的白名单。待发队列读盘时也过这一道：升级前入队的旧形状（没有补丁号、带已删的事件名或格子）
 * 在这里被丢掉，不报错（★1c：待发 ≤100 条、≤7 天，平时入队即发）。
 */
export function isTelemetryEnvelope(value: unknown): value is TelemetryEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  const system = envelope.systemProps as Record<string, unknown> | null
  const systemKeys = ['locale', 'osFamily', 'appMajor', 'appMinor', 'appPatch', ...(system && 'automated' in system ? ['automated'] : [])]
  const validSystem = Boolean(system && !Array.isArray(system) && hasExactKeys(system, systemKeys) && (!('automated' in system) || system.automated === true) && ['zh-CN', 'en'].includes(String(system.locale)) && ['macos', 'windows', 'linux', 'other'].includes(String(system.osFamily)) && Number.isInteger(system.appMajor) && Number.isInteger(system.appMinor) && Number.isInteger(system.appPatch))
  return envelope.schemaVersion === TELEMETRY_SCHEMA_VERSION && typeof envelope.timestamp === 'string' && typeof envelope.sessionId === 'string' && EVENT_SET.has(String(envelope.eventName)) && validSystem && isTelemetryProps(envelope.props, envelope.eventName as TelemetryEventName)
}
