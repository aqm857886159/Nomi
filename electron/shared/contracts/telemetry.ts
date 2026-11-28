import type { NomiErrorCode } from '../nomiErrorCodes'

export type TelemetryStatus ='disabled' | 'unconfigured' | 'configured'
export const TELEMETRY_RESULT_VALUES = ['success', 'failure', 'cancel'] as const
export type TelemetryResult = typeof TELEMETRY_RESULT_VALUES[number]
export type DurationBucket = '<1s' | '1-5s' | '>5s'
export type CapabilitySlot = 'text' | 'image' | 'image-edit' | 'video' | 'audio' | '3d'
/**
 * 生成失败的「类别码」形状（照 OpenTelemetry `error.type`：低基数的错误类别，不是消息）。
 * 取值只来自 `GenerationErrorKind`（src/workbench/observability/narrate.ts）这一张分类表；
 * 主进程在门口只认形状（短的 kebab-case 标识），装不下一句话、一个路径或一个 URL。
 */
export const TELEMETRY_ERROR_TYPE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/
/** 工具名与失败码的闭合形状：小写字母加数字与下划线，物理装不下自然语言句子、路径或密钥。 */
export const TELEMETRY_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,47}$/

// ── 2026-11-28 全维度匿名产品数据闭环（第 1 刀）：全部新增维度均为闭合枚举或粗分档 ────────────────
/** 安装账龄粗分档（基于本机遥测配置文件首次创建时间粗算，精确时间戳不出本机）。 */
export const INSTALL_AGE_BUCKETS = ['d0', 'd1-7', 'd8-30', 'd30plus'] as const
export type InstallAgeBucket = typeof INSTALL_AGE_BUCKETS[number]

/** 首日激活与模型接入漏斗固定步骤。 */
export const ONBOARDING_STEPS = [
  'prompt_shown',
  'setup_opened',
  'key_submitted',
  'verify_succeeded',
  'verify_failed',
  'first_generation_succeeded',
] as const
export type OnboardingStep = typeof ONBOARDING_STEPS[number]

/** 模型接入验证失败的闭合原因类别。 */
export const ONBOARDING_FAIL_REASONS = ['invalid_format', 'auth_failed', 'zero_quota', 'network', 'other'] as const
export type OnboardingFailReason = typeof ONBOARDING_FAIL_REASONS[number]

/** Agent 单回合工具调用次数分档。 */
export const AGENT_TOOL_CALLS_BUCKETS = ['0', '1-2', '3-5', '6plus'] as const
export type AgentToolCallsBucket = typeof AGENT_TOOL_CALLS_BUCKETS[number]

/** Agent 单回合重试次数闭合范围（0 = 一次做对）。 */
export const AGENT_RETRY_COUNTS = [0, 1, 2, 3, 4, 5] as const
export type AgentRetryCount = typeof AGENT_RETRY_COUNTS[number]

/** Agent 回合失败时的闭合故障大类。 */
export const AGENT_FAULT_CATEGORIES = [
  'auth',
  'quota',
  'context_overflow',
  'stream_cut',
  'timeout',
  'protocol_or_schema',
  'tool_refused',
  'upstream',
  'other',
] as const
export type AgentFaultCategory = typeof AGENT_FAULT_CATEGORIES[number]

/** 时间轴片段真实采纳来源。 */
export const TIMELINE_ADOPTED_SOURCES = ['canvas', 'storyboard', 'agent', 'import'] as const
export type TimelineAdoptedSource = typeof TIMELINE_ADOPTED_SOURCES[number]

/** 导出失败的闭合原因类别。 */
export const EXPORT_FAILURE_REASONS = ['ffmpeg_error', 'missing_media', 'disk_or_permission', 'other'] as const
export type ExportFailureReason = typeof EXPORT_FAILURE_REASONS[number]

// ── 2026-11-13 补细：每一格的全部合法取值（主进程白名单、渲染层推导、雷达都只认这里）────────────────
/**
 * 「模型种类」—— 用户拍板要收的那一格，但**不能是模型 id**：自建中转的 key 由用户自己的
 * base-url 派生（`src/ui/community/feedbackDiagnostics.ts:41` 已经为反馈面解决过同一个问题），
 * 原样上报等于上报一个私有域名。所以只分三类：
 *   builtin = 我们策展过的供应商（稳定字面量）· custom = 用户自建/中转 · local = 本机跑的（ComfyUI 等）
 */
export const MODEL_CLASS_VALUES = ['builtin', 'custom', 'local'] as const
export type ModelClass = typeof MODEL_CLASS_VALUES[number]
/** 这次按哪种方式发：`modeDisplayKind` 已有的闭合集合；档案认不出（ComfyUI、自建）= none。 */
export const GENERATION_MODES = ['text', 'image', 'firstLast', 'reference', 'other', 'none'] as const
export type GenerationMode = typeof GENERATION_MODES[number]
/** 单段耗时分档（提交 / 等待）。none = 这一段没有（同步任务没有「等待」）。视频要等几分钟，所以比总耗时的三档细。 */
export const GENERATION_STAGE_DURATIONS = ['none', 'lt-1s', '1-5s', '5-30s', '30-120s', '2-10m', 'gt-10m'] as const
export type GenerationStageDuration = typeof GENERATION_STAGE_DURATIONS[number]
/**
 * 上游怎么答的。ok = 成功；auth / rate-limit / client-4xx / server-5xx = 上游回了状态码（或同表的业务码）；
 * network / timeout = 没拿到回答；not-sent = 请求没离开本机；task-failed = 上游受理后自己报失败；unknown = 说不清。
 */
export const GENERATION_UPSTREAM_STATUSES = ['ok', 'auth', 'rate-limit', 'client-4xx', 'server-5xx', 'network', 'timeout', 'not-sent', 'task-failed', 'unknown'] as const
export type GenerationUpstreamStatus = typeof GENERATION_UPSTREAM_STATUSES[number]
/** 失败卡在哪一段：提交（拿到任务号之前）/ 等待（受理后到终态）/ 取回（把结果拿回本机）/ 落地（本机读出、写进项目）。 */
export const GENERATION_FAILURE_STAGES = ['submit', 'wait', 'fetch', 'land'] as const
export type GenerationFailureStage = typeof GENERATION_FAILURE_STAGES[number]
/**
 * 没发出去时是本机哪条规则。只收**已经是闭合码**的本机拒绝（`nomiErrorCodes.ts` 里「只在提交之前成立」的那几个）；
 * 自由文本的拒绝、没有码的拒绝一律 `uncoded`——这一刀不造新码。
 * 出网按地址判断那一层的码不在表里（那一层正在被整段删，不依赖它）。
 */
export const GENERATION_LOCAL_REFUSALS = [
  'model-config', 'asset-too-large', 'asset-upload-failed', 'asset-invalid', 'reference-not-in-use', 'aspect-ratio-unsupported', 'outbound-blocked-credential-origin', 'uncoded',
] as const satisfies readonly (NomiErrorCode | 'uncoded')[]
export type GenerationLocalRefusal = typeof GENERATION_LOCAL_REFUSALS[number]
/**
 * 上一次启动是怎么结束的（`electron/telemetry/sessionExit.ts`）。renderer-* = 那次有渲染进程非正常死亡（Electron 的
 * render-process-gone 原因枚举，认不出 = renderer-other）；main-exception = 主进程抛过未捕获异常；
 * unresponsive-killed = 窗口无响应时进程没了；abnormal = 没正常退出、也没留下别的线索（原生崩溃、强杀、断电）；
 * unknown = 没有上一次的标记（第一次启动，或上次没开统计）。
 */
export const LAST_EXIT_VALUES = [
  'clean', 'main-exception',
  'renderer-crashed', 'renderer-oom', 'renderer-killed', 'renderer-abnormal-exit', 'renderer-launch-failed', 'renderer-integrity-failure', 'renderer-memory-eviction', 'renderer-other',
  'unresponsive-killed', 'abnormal', 'unknown',
] as const
export type LastExit = typeof LAST_EXIT_VALUES[number]
/** 主进程最长一次停顿（stallMonitor 的估计值，≥100ms 才算）。unknown = 监视器没在跑。 */
export const MAIN_STALL_MAX_VALUES = ['unknown', 'none', '100-250', '250-1000', '1000-5000', 'gt-5000'] as const
export type MainStallMax = typeof MAIN_STALL_MAX_VALUES[number]
/** 主进程超过约 100ms 的停顿次数。 */
export const MAIN_STALL_COUNT_VALUES = ['unknown', '0', '1-3', '4-10', 'gt-10'] as const
export type MainStallCount = typeof MAIN_STALL_COUNT_VALUES[number]

export function stageDurationBucket(ms: number | null): GenerationStageDuration {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return 'none'
  if (ms < 1000) return 'lt-1s'
  if (ms < 5000) return '1-5s'
  if (ms < 30_000) return '5-30s'
  if (ms < 120_000) return '30-120s'
  return ms < 600_000 ? '2-10m' : 'gt-10m'
}

export function mainStallMaxBucket(ms: number | null): MainStallMax {
  if (ms === null || !Number.isFinite(ms)) return 'unknown'
  if (ms < 100) return 'none'
  if (ms < 250) return '100-250'
  if (ms < 1000) return '250-1000'
  return ms < 5000 ? '1000-5000' : 'gt-5000'
}

export function mainStallCountBucket(count: number | null): MainStallCount {
  if (count === null || !Number.isFinite(count)) return 'unknown'
  if (count <= 0) return '0'
  if (count <= 3) return '1-3'
  return count <= 10 ? '4-10' : 'gt-10'
}

const DAY_MS = 24 * 60 * 60 * 1000

export function installAgeBucketFromElapsedMs(elapsedMs: number): InstallAgeBucket {
  if (!Number.isFinite(elapsedMs) || elapsedMs < DAY_MS) return 'd0'
  if (elapsedMs < 8 * DAY_MS) return 'd1-7'
  if (elapsedMs <= 30 * DAY_MS) return 'd8-30'
  return 'd30plus'
}

export function agentToolCallsBucket(count: number): AgentToolCallsBucket {
  if (!Number.isFinite(count) || count <= 0) return '0'
  if (count <= 2) return '1-2'
  if (count <= 5) return '3-5'
  return '6plus'
}

export function clampAgentRetryCount(count: number): AgentRetryCount {
  if (!Number.isFinite(count) || count <= 0) return 0
  return Math.min(5, Math.trunc(count)) as AgentRetryCount
}
export type TelemetrySettingsView = {
  schemaVersion: 1
  enabled: boolean
  endpointMode: 'nomi'
  consentedAt: string | null
  installSessionId: string | null
  /** 用户同意的告知范围版本；小于当前版本（2）= 需要在界面上重新确认一次。 */
  scopeVersion: 1 | 2
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
