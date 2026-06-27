// 错误 message → 人话 reason+hint+raw 的单一真相源（harness S4-2）。
// 与 narrate 同层（人话叶子层）：生成域（节点/批跑）与对话域（两个 agent）都从这里取错误文案，
// reason/hint 永不散落第二处（P1）。从 generationRunController 抽出，避免把 515 行批跑器拖进
// 对话 bundle；generationRunController 改 re-export 保持既有 import 不破。
import { narrateGenerationError, type GenerationErrorKind } from './narrate'
import { parseVendorErrorFromMessage, stripVendorErrorMarker } from '../generationCanvas/runner/vendorErrorIpc'

export type GenerationErrorReport = {
  /** Short human reason, e.g. 配额或限流. */
  reason: string
  /** Actionable suggestion sentence (empty for unknown errors). */
  hint: string
  /**
   * 服务商的**真实原话**（如「官方算力限制，请等待一段时间后再进行使用」）。分类标题
   * 只说"哪一类"，这条说"服务商到底咋讲的"——以前它被埋进折叠的「技术详情」，用户一脸懵逼。
   * 只在它与 reason 不同、且有信息量时给（unknown 类的 reason 本身就是原话，不重复）。
   */
  providerMessage?: string
  /** Original raw error message (any "→ hint" tail from older builds stripped). */
  raw: string
}

/** 上游原话提到可见区前的清洗：去掉占位、与 reason 重复、过长。 */
function pickProviderMessage(candidate: string | undefined, reason: string): string {
  const msg = String(candidate || '').replace(/\s+/g, ' ').trim()
  if (!msg || msg === '(no detail from provider)' || msg === reason) return ''
  return msg.length > 200 ? `${msg.slice(0, 199)}…` : msg
}

/**
 * 未命中任何已知分类时，从 raw 里抠一句**可读首行**当 reason——而不是又甩一句
 * "生成失败"（那会和顶部状态徽标重复，对用户零信息）。优先解析 JSON 里的
 * message/error 字段，否则取第一行非空文本并截断。抠不出可读内容才返回 ''。
 */
function extractReadableErrorLine(raw: string): string {
  const source = String(raw || '').trim()
  if (!source) return ''
  // 1) provider 常把报错塞进 JSON：{ error: { message } } / { message } / { error }
  try {
    const parsed = JSON.parse(source) as unknown
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>
      const errorField = record.error
      const candidates = [
        typeof errorField === 'object' && errorField ? (errorField as Record<string, unknown>).message : undefined,
        typeof errorField === 'string' ? errorField : undefined,
        record.message,
        record.detail,
        record.error_description,
      ]
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim()) return truncateLine(value.trim())
      }
    }
  } catch {
    // 不是 JSON，走纯文本路径
  }
  // 2) 纯文本：取第一行非空内容
  const firstLine = source.split('\n').map((line) => line.trim()).find(Boolean)
  return firstLine ? truncateLine(firstLine) : ''
}

function truncateLine(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 100 ? `${clean.slice(0, 99)}…` : clean
}

/**
 * Single source of truth: classify a raw API error into a human reason + hint.
 * 生成 runner 存 raw message；节点错误 UI 与对话错误卡都调它渲染。
 * Common cases: API key 无效、模型未配置、配额/限流、网络/超时、内容拦截。
 */
const STRUCTURED_KINDS: readonly GenerationErrorKind[] = ['auth', 'balance', 'quota', 'network', 'server', 'input']

/** legacy 字符串 → 类别(老项目持久化的 node.error / 非 vendor 错误的兜底识别;文案不在这里)。 */
function detectLegacyErrorKind(raw: string): GenerationErrorKind | null {
  const lower = raw.toLowerCase()
  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || lower.includes('401')) return 'auth'
  // 余额不足要和限流分开——用户动作不同(充值 vs 等待)。只匹配明确指向余额/欠费的词,
  // 避免把 OpenAI 的 insufficient_quota(配额)误判成余额。
  if (raw.includes('余额') || lower.includes('balance') || raw.includes('欠费') || lower.includes('arrears') || lower.includes('402')) return 'balance'
  if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('429') || lower.includes('insufficient')) return 'quota'
  // 我们自己的轮询超时(视频长任务常见)——不是网络问题,任务多半还在服务商侧跑。
  if (raw.includes('轮询超时') || lower.includes('task poll timeout')) return 'poll-timeout'
  if (lower.includes('timeout') || lower.includes('etimedout') || lower.includes('econnreset') || lower.includes('network')) return 'network'
  if (lower.includes('model') && (lower.includes('not found') || lower.includes('未找到') || lower.includes('not configured'))) return 'model-config'
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('safety') || lower.includes('filter'))) return 'content-policy'
  return null
}

/**
 * 「模型未开通」是文本信号,不是状态码信号——火山方舟用 404、别家可能 403/400,
 * 各自的 category 会被派生成 auth/input/unknown,把「去控制台开通」误导成「查密钥/查参数」。
 * 故在分类前先按文案判定,命中即压过 structured.category。短语取得很窄,避免误吞普通 404。
 */
function detectModelNotOpen(upstream: string | undefined, raw: string): boolean {
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  return (
    text.includes('not activated the model') ||
    text.includes('activate the model service') ||
    text.includes('modelnotopen') ||
    text.includes('未开通') ||
    text.includes('开通管理') ||
    (text.includes('开通') && text.includes('模型'))
  )
}

export function classifyGenerationError(message: string): GenerationErrorReport {
  // S4-2:structured 优先(VendorRequestError 经 IPC 标记穿透,源头保留的事实,不是猜);
  // 老数据/非 vendor 错误退回 legacy 正则识别。两条路只产 kind,文案统一出自 narrate 词表。
  const structured = parseVendorErrorFromMessage(message)
  // 模型未开通先于 category 判(理由见 detectModelNotOpen):reason 用 narrate 词表,
  // 服务商原话(如「has not activated the model …」)单独提到 providerMessage 可见区。
  const cleanRaw = stripVendorErrorMarker(String(message || '')).split('\n→')[0].trim() || '生成失败'
  if (detectModelNotOpen(structured?.upstreamMsg, cleanRaw)) {
    const { reason, hint } = narrateGenerationError('model-not-open')
    const providerMessage = pickProviderMessage(structured?.upstreamMsg ?? extractReadableErrorLine(cleanRaw), reason)
    return { reason, hint, raw: cleanRaw, ...(providerMessage ? { providerMessage } : {}) }
  }
  if (structured?.category && (STRUCTURED_KINDS as readonly string[]).includes(structured.category)) {
    const { reason, hint } = narrateGenerationError(structured.category as GenerationErrorKind)
    const providerMessage = pickProviderMessage(structured.upstreamMsg, reason)
    return { reason, hint, raw: stripVendorErrorMarker(message), ...(providerMessage ? { providerMessage } : {}) }
  }
  // Strip any legacy "\n→ hint" tail that older builds baked into node.error.
  const raw = stripVendorErrorMarker(String(message || '')).split('\n→')[0].trim() || '生成失败'
  if (raw.includes('网页媒体下载失败')) {
    return {
      reason: '网页媒体下载失败',
      hint: '部分站点会禁止跨域请求或开启防盗链。请先在浏览器中把图片/视频下载到本地，再复制或拖入画布。',
      raw,
    }
  }
  const kind = detectLegacyErrorKind(raw)
  if (kind) {
    const { reason, hint } = narrateGenerationError(kind)
    const providerMessage = pickProviderMessage(extractReadableErrorLine(raw), reason)
    return { reason, hint, raw, ...(providerMessage ? { providerMessage } : {}) }
  }
  // 兜底:抠 raw 可读首行当 reason,通用建议出自 narrate 的 unknown 词条。
  return {
    reason: extractReadableErrorLine(raw) || narrateGenerationError('unknown').reason,
    hint: narrateGenerationError('unknown').hint,
    raw,
  }
}
