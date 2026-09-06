/**
 * A renderer-only display cache for completed tool calls.
 *
 * ProjectAgentToolItem deliberately keeps the Host record ref-only. The
 * resident still needs a useful, stable summary after a turn (and after a
 * renderer refresh), so this module stores only redacted display strings. The
 * Host snapshot remains the source of truth for lifecycle and results.
 *
 * 2026-09-06：本模块从「只存人话摘要」扩成「也存这次调用**真实的**入参与结果」，
 * 因为一行收据展开后的两段（输入 / 输出）在拍板基线 `v4-tool-expanded.png` 里就是
 * 「入参 JSON」和「结果摘要」。此前两段读的都是**工具描述**（`readableToolPreview` /
 * `readableToolSummary` 的兜底串），于是展开「修改文稿」看到的是两遍「将内容写入当前文稿」——
 * 一句既不是这次写了什么、也不是写成没写的话。
 *
 * 入参照旧**不许**原样落盘：`redactToolArguments` 先按键名抹掉凭证、把绝对路径缩成
 * 文件名、截断长字符串，再过一遍 `redactResidentSensitiveText`。存的是「可以给人看的
 * 那份入参」，不是原始 payload。
 */

export type ResidentToolProjection = Readonly<{
  effect: string
  target: string
  technicalDetails: string
  /** 这次调用真实的入参（脱敏后的 JSON 文本）。拿不到就空串。 */
  input: string
  /** 这次调用真实的结果摘要，失败时是**可行动的原因**。拿不到就空串。 */
  output: string
  /**
   * 这次调用发生时，本回合的助手正文已经写了多少字（宿主的 `assistantTextAnchor.textOffset`）。
   *
   * 为什么要存：宿主把**一个回合的全部助手正文合并成一条** item。模型在工具之间说的那几句
   * （「让我修正…」）和最后那句真正的回答，落盘后是同一段文字，而且因为 item 创建得早，
   * 它整段排在所有收据**前面**——既读不出先后，也分不出哪一段是给用户的答案。
   * 偏移量是唯一能把这段文字切回原来位置的东西，而它只随**活的**事件到达一次
   * （`ToolCallEvent.assistantTextAnchor`），宿主的终态记录里没有。存在这里，冷启动后仍然切得开。
   */
  textOffset?: number
}>

export type ResidentToolProjectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORAGE_PREFIX = 'nomi.agent.resident.tool-projections.v1:'
const MAX_ENTRIES = 256
const MAX_TEXT_LENGTH = 2_000

function storageOrNull(storage?: ResidentToolProjectionStorage): ResidentToolProjectionStorage | null {
  if (storage) return storage
  if (typeof window === 'undefined' || !window.localStorage) return null
  return window.localStorage
}

function trimDisplayText(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT_LENGTH) : ''
}

/** Remove common credential forms before any display text crosses storage. */
export function redactResidentSensitiveText(value: string): string {
  return trimDisplayText(value)
    .replace(/\b(?:sk|rk|pk|key|token)-[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b(?:bearer)\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, 'Bearer [redacted]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization|lease(?:handle)?|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
}

/** 值一旦挂在这些键下就不出现在展示里——名字命中即抹，不看值长什么样。 */
const SECRET_KEY_PATTERN = /(api[_-]?key|access[_-]?token|refresh[_-]?token|^key$|secret|password|passphrase|authorization|credential|lease(handle)?|cookie|session[_-]?id)/i

const MAX_ARG_STRING = 200

/** `/Users/x/Movies/a.mp4` → `…/a.mp4`：路径在收据里唯一的信息量是文件名。 */
function shortenPath(value: string): string {
  return value.replace(/(?:[A-Za-z]:)?[/\\](?:[^\s/\\:*?"<>|]+[/\\]){2,}([^\s/\\:*?"<>|]+)/g, '…/$1')
}

/**
 * 入参 → 一段可以给人看的 JSON。
 *
 * 短对象压成一行（`{ "scope": "timeline", "range": "all" }`，拍板基线里就是这个样子），
 * 长的保留缩进——340px 宽的一列里，一行 200 字的 JSON 和没有内容是一回事。
 */
export function redactToolArguments(args: unknown): string {
  if (args === undefined || args === null) return ''
  let text: string
  try {
    text = JSON.stringify(args, (key, value: unknown) => {
      if (SECRET_KEY_PATTERN.test(key)) return '[redacted]'
      if (typeof value === 'string') {
        const shortened = shortenPath(value)
        return shortened.length > MAX_ARG_STRING ? `${shortened.slice(0, MAX_ARG_STRING)}…` : shortened
      }
      return value
    }, 2) ?? ''
  } catch {
    // 循环引用 / BigInt：入参本来就不该长这样，但收据不能因此炸掉整条流。
    return ''
  }
  const collapsed = text.replace(/\s*\n\s*/g, ' ')
  return redactResidentSensitiveText(collapsed.length <= 72 ? collapsed : text)
}

export function normalizeResidentToolProjection(input: Partial<ResidentToolProjection>): ResidentToolProjection {
  return Object.freeze({
    effect: redactResidentSensitiveText(trimDisplayText(input.effect)),
    target: redactResidentSensitiveText(trimDisplayText(input.target)),
    technicalDetails: redactResidentSensitiveText(trimDisplayText(input.technicalDetails)),
    input: redactResidentSensitiveText(trimDisplayText(input.input)),
    output: redactResidentSensitiveText(trimDisplayText(input.output)),
    ...(typeof input.textOffset === 'number' && Number.isInteger(input.textOffset) && input.textOffset >= 0
      ? { textOffset: input.textOffset }
      : {}),
  })
}

export function residentToolProjectionScope(bindingKey: string, threadId: string): string {
  return bindingKey && threadId ? `${bindingKey}:${threadId}` : ''
}

export function residentToolProjectionKey(scope: string, turnId: string, toolCallId: string): string {
  return `${scope}:${turnId}:${toolCallId}`
}

function storageKey(scope: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(scope)}`
}

function isProjection(value: unknown): value is ResidentToolProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  // `input` / `output` 是 2026-09-06 加的两段。**不**把它们纳入判据：旧缓存里没有这两个键，
  // 纳入等于让上一版留下的所有收据在冷启动后整批消失（`normalize` 会把缺的补成空串）。
  return typeof record.effect === 'string' && typeof record.target === 'string' && typeof record.technicalDetails === 'string'
}

/** Read only the current thread's derived display cache; malformed data is ignored. */
export function readResidentToolProjections(scope: string, storage?: ResidentToolProjectionStorage): Record<string, ResidentToolProjection> {
  const source = storageOrNull(storage)
  if (!source || !scope) return {}
  try {
    const raw = source.getItem(storageKey(scope))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, ResidentToolProjection> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>).slice(-MAX_ENTRIES)) {
      if (!key || !isProjection(value)) continue
      result[key] = normalizeResidentToolProjection(value)
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 「这份缓存变了」的订阅口。
 *
 * 少了它，读侧那个 `useMemo` 只挂着 scope，而 scope 在一次对话里从不变——于是本次运行
 * **刚写进去**的收据正文一次都读不回来，展开一条收据是空的，非要关掉重开才有内容。
 * （早先那里有一句注释说「写完就已经在 store 里了」——写进的是 localStorage，
 *  而 React 不会因为 localStorage 变了就重算。）
 */
const listeners = new Set<() => void>()
let revision = 0

export function subscribeResidentToolProjections(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 快照值：内容变一次就换一个数，`useSyncExternalStore` 据此重算。 */
export function residentToolProjectionRevision(): number {
  return revision
}

/** Persist a bounded map of redacted display strings, never raw tool args. */
export function writeResidentToolProjections(scope: string, projections: ReadonlyMap<string, ResidentToolProjection>, storage?: ResidentToolProjectionStorage): void {
  const target = storageOrNull(storage)
  if (!target || !scope) return
  try {
    const entries = Array.from(projections.entries()).slice(-MAX_ENTRIES)
    const payload = Object.fromEntries(entries.map(([key, value]) => [key, normalizeResidentToolProjection(value)]))
    target.setItem(storageKey(scope), JSON.stringify(payload))
    revision += 1
    for (const listener of [...listeners]) listener()
  } catch {
    // Storage can be disabled or full in a hardened Electron profile. The
    // current render still works from the in-memory projection.
  }
}
