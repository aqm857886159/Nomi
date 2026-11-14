// 一次画布生成的结局 → `generation.completed` 的各格（2026-11-13 补细）。纯函数，taskApi 的发送口只管传「哪扇门、错误原文、时间戳」。
//
// 每一格都只从**已经在内存里**的东西推：错误原文里本来就嵌着的两种机器标记（Nomi 自己的错误码、供应商结构化失败的状态码 / 类别），
// 请求 extras 里本来就带着的档案与方式，提交时记下的时间戳。不读盘、不多发 IPC（设计卡 ★7）。
// 认不出的一律落闭合集合里的兜底值（unknown / uncoded / none）——原文一个字都不出这个文件。
import {
  GENERATION_LOCAL_REFUSALS, stageDurationBucket,
  type CapabilitySlot, type DurationBucket, type GenerationFailureStage, type GenerationLocalRefusal, type GenerationMode,
  type GenerationStageDuration, type GenerationUpstreamStatus, type TelemetryResult,
} from '../../../electron/shared/contracts/telemetry'
import { matchNomiErrorCode, NOMI_ERROR_ONLY_BEFORE_SUBMIT, type NomiErrorCode } from '../../../electron/shared/nomiErrorCodes'
import { resolveArchetypeForModel } from '../../../electron/shared/modelArchetypes'
import { parseVendorErrorFromMessage, type VendorErrorStructuredLite } from '../generationCanvas/runner/vendorErrorIpc'
import { modeDisplayKind } from '../generationCanvas/nodes/controls/modeMenuModel'
import { isComfyuiVendorKey } from '../generationCanvas/model/comfyuiVendor'

/** 结局是在哪扇门上看到的：提交那一下抛了错 / 提交那一下就拿到了终态（同步任务）/ 轮询拿到终态（异步任务）。 */
export type GenerationOutcomeDoor = 'submit-threw' | 'submit-terminal' | 'poll-terminal'

export type GenerationFailureFacts = {
  upstreamStatus: GenerationUpstreamStatus
  failureStage: GenerationFailureStage
  localRefusal?: GenerationLocalRefusal
}

/** 渲染层交给主进程的那一份：`modelClass` 由主进程按 vendorKey 算（vendorKey 只过 IPC，不进事件）。 */
export type GenerationTrackPayload = {
  eventName: 'generation.completed'
  vendorKey: string
  props: {
    capability: CapabilitySlot
    durationBucket: DurationBucket
    result: TelemetryResult
    mode: GenerationMode
    submitDuration: GenerationStageDuration
    waitDuration: GenerationStageDuration
    upstreamStatus?: GenerationUpstreamStatus
    errorType?: string
    failureStage?: GenerationFailureStage
    localRefusal?: GenerationLocalRefusal
  }
}

const LOCAL_REFUSAL_SET: ReadonlySet<string> = new Set(GENERATION_LOCAL_REFUSALS)
/** 分类器（`observability/classifyError`）判「本机拒发、没发出去」的那个类别码。 */
const LOCAL_REFUSAL_KIND = 'local-refusal'
/** 分类器判「连不上 / 超时」的类别码（原文里的 timeout、ECONNRESET 等都归这一类）。 */
const NETWORK_KIND = 'network'

/** 带了码就知道卡在哪一段的那几个（其余看门）。 */
const STAGE_OF_CODE: Partial<Record<NomiErrorCode, GenerationFailureStage>> = {
  'retrieval-query': 'wait',
  'retrieval-parse': 'wait',
  'retrieval-timeout': 'wait',
  'retrieval-unavailable': 'wait',
  'retrieval-download': 'fetch',
  'output-retrieval-failed': 'fetch',
  'output-unreadable': 'land',
}

/** 解析原文的两个读口坏了也不抛：当没认出来。 */
function orNull<T>(read: () => T | null | undefined): T | null {
  try { return read() ?? null } catch { return null }
}

/** 上游回了状态码：按状态码分；只有同表的业务码（没有状态码）：按查表类别分（`shared/vendorFailure.categorizeVendorFailure`）。 */
function statusFromStructured(structured: VendorErrorStructuredLite): GenerationUpstreamStatus {
  const http = structured.httpStatus
  if (typeof http === 'number' && Number.isFinite(http)) {
    if (http === 401 || http === 403) return 'auth'
    if (http === 429) return 'rate-limit'
    if (http >= 400 && http < 500) return 'client-4xx'
    if (http >= 500) return 'server-5xx'
  }
  switch (structured.category) {
    case 'auth': return 'auth'
    case 'quota': return 'rate-limit'
    case 'balance':
    case 'input': return 'client-4xx'
    case 'server': return 'server-5xx'
    case 'timeout': return 'timeout'
    case 'network': return 'network'
    default: return 'unknown'
  }
}

/**
 * 失败的三格：上游怎么答的、卡在哪一段、（没发出去时）本机哪条规则。
 *   ① 带 Nomi 码且码的话「只在提交之前成立」→ 没发出去，阶段 = 提交，规则 = 码（不在闭合表里 = uncoded）；
 *   ①' 没有这种码、但分类器已经判成 `local-refusal`（主进程拒发的那几种结构化码：同节点在途、预演没好、镜头被占……）
 *      → 同样没发出去，规则 = uncoded（这些码还不是闭合表，不往外报具体是哪条）；
 *   ② 带供应商结构化失败 → 按状态码 / 类别；
 *   ③ 都没有：分类器从原文认出连不上 / 超时 → network；再认不出：在终态门上 = 上游受理后自己报失败（task-failed）；在抛错门上 = 说不清（unknown）。
 * 取回 / 落地两段的失败上游其实答过「成了」：没有结构化失败时记 ok（钱花了、失败在我们这一侧）。
 */
export function generationFailureFacts(message: string | undefined, door: GenerationOutcomeDoor, errorType?: string): GenerationFailureFacts {
  const text = String(message ?? '')
  const code: NomiErrorCode | null = orNull(() => matchNomiErrorCode(text))
  const structured: VendorErrorStructuredLite | null = orNull(() => parseVendorErrorFromMessage(text))
  const doorStage: GenerationFailureStage = door === 'submit-threw' ? 'submit' : 'wait'

  if (code === 'submission-unknown') return { upstreamStatus: structured ? statusFromStructured(structured) : 'network', failureStage: 'submit' }
  if (code && NOMI_ERROR_ONLY_BEFORE_SUBMIT[code]) {
    return { upstreamStatus: 'not-sent', failureStage: 'submit', localRefusal: LOCAL_REFUSAL_SET.has(code) ? code as GenerationLocalRefusal : 'uncoded' }
  }
  if (!code && errorType === LOCAL_REFUSAL_KIND) return { upstreamStatus: 'not-sent', failureStage: 'submit', localRefusal: 'uncoded' }
  const failureStage = (code && STAGE_OF_CODE[code]) || doorStage
  if (structured) return { upstreamStatus: statusFromStructured(structured), failureStage }
  if (code === 'retrieval-timeout') return { upstreamStatus: 'timeout', failureStage }
  if (failureStage === 'fetch' || failureStage === 'land') return { upstreamStatus: 'ok', failureStage }
  if (code) return { upstreamStatus: 'unknown', failureStage }
  // 没码、没结构，但分类器已从原文认出是连不上 / 超时（如 `connect ETIMEDOUT`）→ network，不落「说不清」。
  if (errorType === NETWORK_KIND) return { upstreamStatus: 'network', failureStage }
  return { upstreamStatus: door === 'submit-threw' ? 'unknown' : 'task-failed', failureStage }
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 这次按哪种方式发：请求 extras 里带着这次真发的档案方式（`archetype.modeId`，buildCatalogTaskRequest 写的），
 * 按它在档案里的槽位用 `modeDisplayKind` 归类——和节点底栏「方式」一格同一个判据。认不出 = none。
 */
export function generationModeOf(vendor: string, extras: Record<string, unknown> | undefined): GenerationMode {
  try {
    if (!extras || isComfyuiVendorKey(vendor)) return 'none'
    const modelKey = readString(extras.modelKey) || readString(extras.modelAlias)
    if (!modelKey) return 'none'
    const archetype = resolveArchetypeForModel({ modelKey, modelAlias: readString(extras.modelAlias), vendorKey: vendor || null, meta: extras })
    const declared = extras.archetype && typeof extras.archetype === 'object' ? readString((extras.archetype as Record<string, unknown>).modeId) : ''
    const mode = archetype?.modes.find((candidate) => candidate.id === declared) ?? (archetype?.modes.length === 1 ? archetype.modes[0] : undefined)
    return archetype && mode ? modeDisplayKind(archetype, mode) : 'none'
  } catch {
    return 'none'
  }
}

export type GenerationTiming = { startedAt: number; acceptedAt: number | null; endedAt: number }

function totalDurationBucket(ms: number): DurationBucket {
  return ms < 1000 ? '<1s' : ms <= 5000 ? '1-5s' : '>5s'
}

/** 组一份 `generation.completed`。成功带 upstreamStatus=ok；失败再带失败三格与原有的类别码。 */
export function generationTrackPayload(input: {
  capability: CapabilitySlot
  vendorKey: string
  mode: GenerationMode
  timing: GenerationTiming
  door: GenerationOutcomeDoor
  result: Exclude<TelemetryResult, 'cancel'>
  errorType?: string
  failureMessage?: string
}): GenerationTrackPayload {
  const { startedAt, acceptedAt, endedAt } = input.timing
  const submitEnd = acceptedAt ?? endedAt
  const base = {
    capability: input.capability,
    durationBucket: totalDurationBucket(endedAt - startedAt),
    result: input.result,
    mode: input.mode,
    submitDuration: stageDurationBucket(submitEnd - startedAt),
    waitDuration: acceptedAt === null ? 'none' as const : stageDurationBucket(endedAt - acceptedAt),
  }
  if (input.result === 'success') return { eventName: 'generation.completed', vendorKey: input.vendorKey, props: { ...base, upstreamStatus: 'ok' } }
  const facts = generationFailureFacts(input.failureMessage, input.door, input.errorType)
  return {
    eventName: 'generation.completed',
    vendorKey: input.vendorKey,
    props: { ...base, upstreamStatus: facts.upstreamStatus, errorType: input.errorType ?? 'unknown', failureStage: facts.failureStage, ...(facts.upstreamStatus === 'not-sent' ? { localRefusal: facts.localRefusal ?? 'uncoded' } : {}) },
  }
}
