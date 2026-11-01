// 一键反馈的**组包**层。纯函数 + 注入依赖，不碰 Electron API（那半在 `feedbackIpc.ts`）。
//
// 反馈包 = 诊断包的一个**有界子集** + 这一回合的轨迹投影。
//
// 为什么不直接把 `buildDiagnosticsBundle()` 那个 zip 发出去：它上限 25MB，而这是一次
// 用户点了按钮就该立刻拿到编号的请求（接收端 body 上限 2MB）。所以这里带的是
//   · 日志**尾部**（最近若干行，按 `feedbackLogTail.ts` 的白名单投影）
//   · 模型目录（`redactModelCatalog` 抹掉密钥，`feedbackCatalog.ts` 抹掉自建连接的地址，只留配过的那几家的映射）
//   · 这一回合的轨迹投影（`projectLaneTrajectory` 的字段白名单）
//   · 上下文（版本 / 系统 / 失败面 / 错误码 / 那句人话 / 用户可空的留言）
// 完整原始日志与 Agent 记录仍然走既有的 **设置 → 导出诊断包**（用户自己挑保存位置、
// 自己决定发不发）。这条分工写进清单的 `excluded`，不藏。
//
// 清单机制**直接复用** `DiagnosticsBundleEntry{path,bytes,what}` /
// `DiagnosticsBundleExclusion{what,why}`（`electron/shared/contracts/diagnostics.ts`）——
// 「每项写清是什么、没带的写清为什么」这件事已经有 owner，不另造一份。
import { redactLogValue } from '../logging/redact'
import { redactModelCatalog } from '../diagnostics/catalogRedaction'
import { logWarn } from '../logging/logger'
import { isPerfSummaryProps } from '../shared/contracts/perfTelemetry'
import { projectLaneTrajectory } from '../telemetry/trajectoryProjection'
import type { TrajectoryTurnInput } from '../shared/agentLane/laneTrajectory'
import type { DiagnosticsBundleEntry, DiagnosticsBundleExclusion, DiagnosticsBundleManifest } from '../shared/contracts/diagnostics'
import {
  FEEDBACK_MANIFEST_ITEMS as ITEMS,
  FEEDBACK_SURFACES,
  type FeedbackExclusionReason,
  type FeedbackReportRequest,
  type FeedbackSurface,
} from '../shared/contracts/feedback'
import { projectCatalogForReport } from './feedbackCatalog'
import { isLocalVendor, projectLogLines } from './feedbackLogTail'

/** 摘要那句人话的上限。它是**已经派生好的**一句话，长到这个数说明调用处传错了东西。 */
const MAX_SUMMARY_CHARS = 300
/** 用户留言上限。他只需要补一句「我刚换了模型就出这个」。 */
const MAX_NOTE_CHARS = 1000
/** 日志尾部行数。够看到失败前后那一小段，不够重建他这一天干了什么。 */
const MAX_LOG_LINES = 300
/** 整包上限，留出余量给接收端的 2MB。 */
export const FEEDBACK_REPORT_MAX_BYTES = 1_200_000
/**
 * 轨迹最多等多久。对话还在跑时它要排在派生视图写入后面，等不到头，而界面正停在「正在发送…」。
 * 等不到就不带，读取本身停不下来，让它自己跑完。
 */
const TRAJECTORY_READ_TIMEOUT_MS = 5_000

export type FeedbackReportDeps = {
  now: Date
  app: { version: string; electron: string; node: string; chrome: string }
  system: { platform: string; arch: string; osRelease: string; locale: string; timeZone: string }
  projectId: string | null
  /** 日志尾部的原始行，组包时才投影，出门的一定是投影过的。文件读不了给 null，没有日志给 []。 */
  readLogTail(maxLines: number): string[] | null
  /** 模型目录原文（未脱敏）。拿不到给 null。 */
  readModelCatalog(): unknown | null
  /** 这一回合的轨迹入料。拿不到给 null，清单里写原因。 */
  readTrajectory(laneName: string): Promise<TrajectoryTurnInput[] | null>
  /** 只给测试用，默认 `TRAJECTORY_READ_TIMEOUT_MS`。 */
  trajectoryTimeoutMs?: number
}

export type FeedbackReportPayload = {
  schemaVersion: 1
  manifest: DiagnosticsBundleManifest
  context: {
    surface: FeedbackSurface
    /** 已经派生好的那句人话（仍过一遍第二道网：它可能带着服务商原话里的一段 URL）。 */
    summary: string
    errorCode: string | null
    note: string | null
    /** 这份包里**真的**有提示词和回复才是 true。勾了但没有对话、读不到轨迹，都是 false。 */
    contentIncluded: boolean
    provider: string | null
    model: string | null
  }
  /** 清单里列到的东西，逐项放在这里。清单与内容一一对应，不许有清单里没写的格。 */
  attachments: Record<string, unknown>
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // 第二道网：摘要与留言都可能带着一段服务商原话里的签名 URL，或用户顺手粘的路径。
  return redactLogValue(value).trim().slice(0, max)
}

/**
 * 供应商身份只放**渲染层已经脱敏过的那一格**（`buildFeedbackDiagnostics` 的产物：
 * 策展供应商原样、本机多实例塌成它的固定名字、用户自建塌成字面量 `custom`）。
 * 这里再收一次形状，防的是「有人绕过那一层直接调 IPC」。
 */
function identity(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  if (!clean || clean.length > 64) return null
  return /^[a-z0-9][a-z0-9._-]*$/i.test(clean) ? clean : 'custom'
}

export function isFeedbackReportRequest(value: unknown): value is FeedbackReportRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const request = value as Record<string, unknown>
  if (!(FEEDBACK_SURFACES as readonly string[]).includes(String(request.surface))) return false
  if (typeof request.summary !== 'string' || !request.summary.trim()) return false
  if (request.note !== undefined && typeof request.note !== 'string') return false
  if (request.errorCode !== undefined && typeof request.errorCode !== 'string') return false
  if (request.laneName !== undefined && typeof request.laneName !== 'string') return false
  if (request.includeContent !== undefined && typeof request.includeContent !== 'boolean') return false
  if (request.perf !== undefined && !isPerfSummaryProps(request.perf)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

type TrajectoryRead = { turns: TrajectoryTurnInput[] } | { why: FeedbackExclusionReason }

async function readTrajectoryWithin(laneName: string, deps: FeedbackReportDeps): Promise<TrajectoryRead> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), deps.trajectoryTimeoutMs ?? TRAJECTORY_READ_TIMEOUT_MS)
  })
  try {
    const turns = await Promise.race([Promise.resolve().then(() => deps.readTrajectory(laneName)), expired])
    if (turns === 'expired') return { why: 'trajectory-timeout' }
    return turns === null ? { why: 'trajectory-unavailable' } : { turns }
  } catch (error) {
    logWarn('diagnostics', 'feedback-trajectory-read-failed', undefined, error)
    return { why: 'trajectory-unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 组一份反馈包。
 *
 * 顺序：先把每一项取出来并脱敏，再算体积，**清单最后写** —— 这样清单描述的一定是
 * 最终真的带上的那些东西，而不是我们打算带的那些（`diagnosticsBundle.ts` 的同一条纪律）。
 *
 * 取料的顺序就是超预算时保谁的顺序：小而有用的在前，目录最大也最容易从别处补，排最后。
 * 每一项都隔离：哪一项出错只排除那一项，不许连累整份报告。
 */
export async function buildFeedbackReport(
  request: FeedbackReportRequest,
  deps: FeedbackReportDeps,
): Promise<FeedbackReportPayload> {
  const entries: DiagnosticsBundleEntry[] = []
  const excluded: DiagnosticsBundleExclusion[] = []
  const attachments: Record<string, unknown> = {}
  const provider = identity(request.provider)

  const exclude = (what: string, why: FeedbackExclusionReason): void => {
    excluded.push({ what, why })
  }
  const add = (path: string, value: unknown, what: string): void => {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8')
    const used = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    if (used + bytes > FEEDBACK_REPORT_MAX_BYTES) {
      exclude(path, 'report-size-limit')
      return
    }
    attachments[path] = value
    entries.push({ path, bytes, what })
  }
  /** 取一项，抛了只排除这一项，并留一行日志。 */
  const attempt = (path: string, why: FeedbackExclusionReason, work: () => void): void => {
    try {
      work()
    } catch (error) {
      logWarn('diagnostics', 'feedback-attachment-failed', { kind: path }, error)
      exclude(path, why)
    }
  }

  // ① 界面流畅度分档数字。用户点「发送」就是同意；形状由 isPerfSummaryProps 收（只有分档标签）。
  if (request.perf && isPerfSummaryProps(request.perf)) {
    add(ITEMS.perf, request.perf, '界面流畅度分档数字：点击响应与掉帧的档位、画布规模档位、设备档位（没有原始毫秒、没有内容）')
  } else {
    exclude(ITEMS.perf, 'perf-unavailable')
  }

  // ② 这一回合的轨迹。字段白名单在 trajectoryProjection.ts，不在这里——
  //    组包层不该有第二套「什么能出门」的判据。
  const wantsContent = request.includeContent === true
  if (!request.laneName) {
    exclude(ITEMS.trajectory, 'no-conversation-in-context')
  } else {
    const read = await readTrajectoryWithin(request.laneName, deps)
    if ('why' in read) {
      exclude(ITEMS.trajectory, read.why)
    } else {
      attempt(ITEMS.trajectory, 'trajectory-unavailable', () => {
        add(
          ITEMS.trajectory,
          projectLaneTrajectory(read.turns, { includeContent: wantsContent, maxTurns: 3 }),
          wantsContent
            ? '最近 3 个回合：工具名、参数结构、耗时、token —— 外加你勾选带上的提示词和回复（每段只取开头一小段）'
            : '最近 3 个回合：工具名、参数**结构**（只有键名）、耗时、token。提示词、回复、工具结果都不在里面',
        )
      })
    }
  }
  // 内容只住在轨迹里：轨迹没带上，勾了也等于没带，原因就是轨迹没带上的原因。
  const trajectoryMissing = excluded.find((item) => item.what === ITEMS.trajectory)
  const contentIncluded = wantsContent && !trajectoryMissing

  // ③ 日志尾部。只出门投影过的（见 `feedbackLogTail.ts`）。
  attempt(ITEMS.logTail, 'logs-unavailable', () => {
    const lines = deps.readLogTail(MAX_LOG_LINES)
    if (lines === null) {
      exclude(ITEMS.logTail, 'logs-unavailable')
      return
    }
    const projected = projectLogLines(lines)
    if (projected.length === 0) exclude(ITEMS.logTail, 'logs-empty')
    else add(ITEMS.logTail, projected, `最近 ${projected.length} 行运行日志：只留时间、级别、模块、事件名和白名单字段，其余字段一律不出门`)
  })

  // ④ 模型目录。它是「为什么这个模型不工作」最有用的一份。密钥由 redactModelCatalog 抹掉，自建连接由 feedbackCatalog 收成一行「是自建」。
  attempt(ITEMS.modelCatalog, 'catalog-unavailable', () => {
    const catalog = deps.readModelCatalog()
    const projected = catalog === null ? null : projectCatalogForReport(redactModelCatalog(catalog), provider)
    if (projected === null) exclude(ITEMS.modelCatalog, 'catalog-unavailable')
    else add(ITEMS.modelCatalog, projected, '模型目录（接了哪几家、官方地址和模型配置；自建连接只留「是自建」，不带地址；本机连接的模型只留个数；密钥、代理地址、自定义头全部抹掉；接口映射只留配过的厂商和这次出问题的那一家）')
  })

  // 永远排除的三类，逐条写清原因（D4：包里没有什么，比包里有什么更容易引起误解）。
  exclude(ITEMS.secrets, 'never-collected-by-design')
  exclude(ITEMS.paths, 'never-collected-by-design')
  // 不在对话里的问题，卡上根本没有那个勾，不能说「没勾选」。
  if (!request.laneName) exclude(ITEMS.content, 'no-conversation-in-context')
  else if (!wantsContent) exclude(ITEMS.content, 'content-checkbox-not-ticked')
  else if (trajectoryMissing) excluded.push({ what: ITEMS.content, why: trajectoryMissing.why })
  exclude(ITEMS.fullLogs, 'available-only-via-settings-diagnostics-export')

  const manifest: DiagnosticsBundleManifest = {
    schemaVersion: 1,
    createdAt: deps.now.toISOString(),
    app: deps.app,
    system: deps.system,
    projectId: deps.projectId,
    entries,
    excluded,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
  }

  return {
    schemaVersion: 1,
    manifest,
    context: {
      surface: request.surface,
      summary: text(request.summary, MAX_SUMMARY_CHARS),
      errorCode: typeof request.errorCode === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(request.errorCode.trim())
        ? request.errorCode.trim()
        : null,
      note: text(request.note, MAX_NOTE_CHARS) || null,
      contentIncluded,
      provider,
      // 本机那几家的模型名可能是用户自己起的（`isLocalVendor`）。
      model: provider !== null && isLocalVendor(provider) ? null : identity(request.model),
    },
    attachments,
  }
}

/**
 * 接收端回 413 时的那一份：附件全部去掉，摘要、留言、版本、清单留着。
 * 至少让我们知道出了什么事；清单写明附件是因为超限没带上的。形状认不出（比如旧版本排队的奇怪东西）回 null。
 */
export function shrinkFeedbackReport(payload: unknown): FeedbackReportPayload | null {
  if (!isRecord(payload) || !isRecord(payload.manifest) || !isRecord(payload.context)) return null
  const report = payload as unknown as FeedbackReportPayload
  if (!Array.isArray(report.manifest.entries) || !Array.isArray(report.manifest.excluded)) return null
  const oversize = report.manifest.entries.map((entry) => ({ what: entry.path, why: 'report-size-limit' }))
  if (report.context.contentIncluded) oversize.push({ what: ITEMS.content, why: 'report-size-limit' })
  return {
    ...report,
    context: { ...report.context, contentIncluded: false },
    manifest: { ...report.manifest, entries: [], excluded: [...oversize, ...report.manifest.excluded], totalBytes: 0 },
    attachments: {},
  }
}
