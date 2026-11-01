// 反馈包里的日志尾巴：读最近的按天日志，再投影成能自动出机的样子。
//
// 日志写在用户自己的硬盘上，出机有两条路：诊断包是用户自己看过、自己决定发给谁；一键反馈是点一下就走。
// 字段名黑名单（`logging/redact.ts`）和错误事实（`logging/diskSafeFailure.ts`）挡住了提示词、密钥、路径、
// 错误原文，挡不住名字无害、值是自由文本的字段（`firstLine` / `detail` / `message` / `lane` / `host`）。
// 这些留在本机日志里没问题，点一下就出机不行，所以这条路**默认不要**：只留时间、级别、模块、事件名、
// 下面那张表里的字段、错误类名和码、栈帧的文件名和行号，其余一律变成 `…`。
// 和轨迹投影（`telemetry/trajectoryProjection.ts`）同一个做法：新字段想出门，来这张表登记一次。
import fs from 'node:fs'
import path from 'node:path'
import { builtinVendorSeed } from '../catalog/builtinVendorSeeds'
import { diskSafeMessage } from '../logging/diskSafeFailure'
import { CRASH_LOG_FILE_NAME, listLogFilesForBundle } from '../logging/logFiles'
import { logWarn } from '../logging/logger'
import { redactLogValue } from '../logging/redact'
import { builtinVendorKeyOfKey } from '../shared/builtinVendorIdentity'
import { isCodeClassName } from '../shared/contracts/ipcInvokeFailure'

/**
 * 能出门的字段：数字、枚举、版本号、码、运行 id。
 * 刻意不在表里的：项目 / 分镜 / 素材 id（`projectId` / `shotId` / `assetId`）、对话名（`lane`）、
 * 路径与地址（`absolutePath` / `host` / `base` / `route`）、自由文本（`detail` / `message` / `firstLine`）、花费（`cost`）。
 * `vendor` / `vendorKey` / `model` 另有判据，见 `projectVendor`。
 */
const OUTBOUND_LOG_FIELDS: ReadonlySet<string> = new Set([
  'appliedThreshold', 'appVersion', 'attempt', 'attempts', 'bytes', 'cap', 'category', 'chunk', 'chunks', 'code',
  'consecutive', 'contentType', 'count', 'coveredSeconds', 'declaredBytes', 'detected', 'detectedLanguage', 'dropped',
  'durationSeconds', 'elapsedMs', 'electron', 'entries', 'errno', 'event', 'exitCode', 'failure', 'family',
  'fileVersion', 'frames', 'fromSchema', 'height', 'http', 'jobId', 'kept', 'kind', 'limit', 'line', 'mode', 'ms',
  'needBytes', 'neverSent', 'nomi', 'outcome', 'pid', 'platform', 'platformKey', 'port', 'probeCode', 'quotedCalls',
  'rawCode', 'reason', 'receivedBytes', 'release', 'req', 'requestId', 'runId', 'segments', 'sentOrUnknown', 'shots',
  'signal', 'stage', 'stamped', 'status', 'step', 'syscall', 'taskId', 'threads', 'tier', 'timedOut', 'tool', 'toSchema',
  'totalFrames', 'transcribe', 'unmatched', 'upstreamCode', 'vad', 'verb', 'verdict', 'version', 'width', 'windowMs',
])

const DROPPED = '…'
const MAX_LINE_CHARS = 600
const MAX_VALUE_CHARS = 64
const LINE_HEAD = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s+(.+)$/
const LEVELS: ReadonlySet<string> = new Set(['INFO', 'WARN', 'ERROR'])
const SCOPE = /^[a-z][a-z-]{0,20}$/
const EVENT = /^[\w:.-]{1,80}$/
const FIELD = /^([A-Za-z][\w.-]*)=(.*)$/
/** 单个词的值：数字、枚举、版本号、码。最多一个斜杠（`video/mp4`、`openai/gpt-5`），路径过不了。 */
const SAFE_VALUE = /^(?:-|-?[A-Za-z0-9][\w.:+-]*(?:\/[\w.:+-]+)?)$/
const ERROR_MESSAGE = /^msg#(?:[0-9a-f]{8}|unreadable)$/
const FRAME_LOCATION = /^\((?:[\w.$-]{1,80}:\d+:\d+|<anonymous>)\)$/
const FRAME_FUNCTION = /^[\w$.<>-]{1,80}$/
const FRAME_KEYWORDS: ReadonlySet<string> = new Set(['async', 'new'])
const NO_VENDOR_VALUES: ReadonlySet<string> = new Set(['unknown', '?', '-'])

/** 内置家的 root key（`apimart--mini` 的后半段是用户起的连接名，不要）；不是内置家给 null。 */
function builtinVendorOf(value: string): string | null {
  const root = builtinVendorKeyOfKey(value)
  return builtinVendorSeed(root) ? root : null
}

/**
 * 用户自建中转的 vendor key 是从他自己的地址和连接名铸出来的，可能是一个内网域名；
 * 这一格和反馈包的 provider 同一条规矩（`buildFeedbackDiagnostics`）：内置家原样，其余塌成 `custom`。
 */
function projectVendor(value: string): string {
  return NO_VENDOR_VALUES.has(value) ? 'unknown' : builtinVendorOf(value) ?? 'custom'
}

function vendorValueOf(token: string): string | null {
  const field = FIELD.exec(token)
  return field && (field[1] === 'vendor' || field[1] === 'vendorKey') ? field[2] : null
}

/** 这个字段出门时的值；整个字段都不该出门回 null。 */
function projectField(key: string, value: string, builtinVendor: boolean): string | null {
  if (key === 'vendor' || key === 'vendorKey') return projectVendor(value)
  // 自建中转的模型名可能是用户自己起的别名，跟着 vendor 一起判。
  if (key === 'model') return builtinVendor && SAFE_VALUE.test(value) && value.length <= MAX_VALUE_CHARS ? value : DROPPED
  if (!OUTBOUND_LOG_FIELDS.has(key)) return null
  return SAFE_VALUE.test(value) && value.length <= MAX_VALUE_CHARS ? value : DROPPED
}

function isErrorMessage(token: string | undefined): token is string {
  return token !== undefined && (ERROR_MESSAGE.test(token) || diskSafeMessage(token) === token)
}

/**
 * `redactError` 的开头：类名，后面跟码形 message 或 `msg#指纹`。
 * 只凭大写开头不够（自由文本里一个 `Project` 也长这样），所以要么名字以 Error / Exception 结尾，要么后面跟着 message。
 */
function isErrorHead(token: string, next: string | undefined): boolean {
  if (!isCodeClassName(token)) return false
  return /(?:Error|Exception)$/.test(token) || isErrorMessage(next)
}

/** `| at fn (file.js:1:2) < at (other.js:3:4)`：只认函数名和文件位置，其他的不要。 */
function projectFrames(tokens: readonly string[]): string[] {
  const kept = ['|']
  let functionAllowed = false
  for (const token of tokens) {
    if (token === 'at' || token === '<') {
      kept.push(token)
      functionAllowed = token === 'at'
    } else if (FRAME_LOCATION.test(token)) {
      kept.push(token)
      functionAllowed = false
    } else if (functionAllowed && FRAME_KEYWORDS.has(token)) {
      kept.push(token)
    } else if (functionAllowed && FRAME_FUNCTION.test(token)) {
      kept.push(token)
      functionAllowed = false
    } else {
      if (kept.at(-1) !== DROPPED) kept.push(DROPPED)
      functionAllowed = false
    }
  }
  return kept
}

/** 事件名之后的部分：`k=v k=v 错误类名 msg#… code=… | 栈帧`。 */
function projectBody(tokens: readonly string[]): string[] {
  const builtinVendor = tokens.some((token) => {
    const vendor = vendorValueOf(token)
    return vendor !== null && builtinVendorOf(vendor) !== null
  })
  const kept: string[] = []
  const drop = (): void => {
    if (kept.at(-1) !== DROPPED) kept.push(DROPPED)
  }
  let inFreeText = false
  let cursor = 0
  for (; cursor < tokens.length && tokens[cursor] !== '|'; cursor += 1) {
    const token = tokens[cursor]
    const field = FIELD.exec(token)
    if (field && !inFreeText) {
      const value = projectField(field[1], field[2], builtinVendor)
      if (value === null) drop()
      else kept.push(`${field[1]}=${value}`)
    } else if (isErrorHead(token, tokens[cursor + 1])) {
      inFreeText = false
      kept.push(token)
      if (isErrorMessage(tokens[cursor + 1])) {
        cursor += 1
        kept.push(tokens[cursor])
      }
    } else {
      if (!field) {
        // 裸词说明前一个字段的值里有空格，是一段自由文本：它的值也不能要，后面的 k=v 也可能是文本的一部分。
        inFreeText = true
        const previous = FIELD.exec(kept.at(-1) ?? '')
        if (previous) kept[kept.length - 1] = `${previous[1]}=${DROPPED}`
      }
      drop()
    }
  }
  return cursor < tokens.length ? [...kept, ...projectFrames(tokens.slice(cursor + 1))] : kept
}

/** 把一行日志投影成能出机的样子；认不出形状的行回 null，整行不要。 */
export function projectLogLine(line: string): string | null {
  const head = LINE_HEAD.exec(line)
  if (!head) return null
  const tokens = head[2].trim().split(/\s+/)
  let kept: string[]
  if (tokens[0] === '---' && tokens[1] === 'session') {
    // 表头：`--- session nomi=… electron=… darwin-arm64 pid=…`
    kept = tokens.slice(0, 2).concat(
      tokens.slice(2).filter((token) => /^(?:nomi|electron|pid)=[\w.+-]{1,40}$/.test(token) || /^[a-z0-9]+-[a-z0-9]+$/.test(token)),
    )
  } else {
    const [level, scope, event, ...body] = tokens
    if (!LEVELS.has(level) || !SCOPE.test(scope ?? '') || !EVENT.test(event ?? '')) return null
    kept = [level, scope, event, ...projectBody(body)]
  }
  // 第二道网：上面的形状判据之外再认一遍密钥形串，认出来的整个词不要。
  const clean = kept.map((token) => (token === DROPPED || redactLogValue(token) === token ? token : DROPPED)).join(' ')
  return `[${head[1]}] ${clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}${DROPPED}` : clean}`
}

export function projectLogLines(lines: readonly string[]): string[] {
  return lines.flatMap((line) => projectLogLine(line) ?? [])
}

/**
 * 从最新的按天日志往前读，直到凑够行数，按时间从旧到新返回。今天的文件可能只有几行（刚滚动、刚过零点）。
 * 崩溃日志不在内：它的行没有级别和模块，投影不了。
 * 读整个文件再取尾部：单文件上限 4MB，用户点一次才走一遍；从中间读会切掉半行。
 *
 * 没有日志文件回 `[]`；有文件但一个都读不了回 null（并留一行日志，下次反馈能看到）。
 */
export function readRecentLogLines(dir: string, maxLines: number): string[] | null {
  const names = listLogFilesForBundle(dir).filter((name) => name !== CRASH_LOG_FILE_NAME)
  const newestFirst: string[][] = []
  let remaining = maxLines
  let readable = 0
  for (const name of names) {
    if (remaining <= 0) break
    try {
      const lines = fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/).filter((line) => line.trim())
      readable += 1
      const taken = lines.slice(-remaining)
      newestFirst.push(taken)
      remaining -= taken.length
    } catch (error) {
      logWarn('diagnostics', 'feedback-log-read-failed', undefined, error)
    }
  }
  if (names.length > 0 && readable === 0) return null
  return newestFirst.reverse().flat()
}
