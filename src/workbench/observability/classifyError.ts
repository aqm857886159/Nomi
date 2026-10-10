// 错误 message → 人话 reason+hint+raw 的单一真相源（harness S4-2）。
// 与 narrate 同层（人话叶子层）：生成域（节点/批跑）与对话域（两个 agent）都从这里取错误文案，
// reason/hint 永不散落第二处（P1）。从 generationRunController 抽出，避免把 515 行批跑器拖进
// 对话 bundle；generationRunController 改 re-export 保持既有 import 不破。
import {
  narrateGenerationError,
  narrateGenerationErrorActions,
  narrateIsVendorSideFailure,
  narrateModelKind,
  type GenerationErrorAction,
  type GenerationErrorKind,
} from './narrate'
import { parseVendorErrorFromMessage, stripVendorErrorMarker, type VendorErrorStructuredLite } from '../generationCanvas/runner/vendorErrorIpc'
import { parseTaskFailureMessage } from '../generationCanvas/runner/taskFailureMessage'
import { shotClaimCopy } from './shotClaimCopy'
import { matchNomiErrorCode, stripNomiErrorCode } from '../../../electron/shared/nomiErrorCodes'
import i18n from '../../i18n'

export type GenerationErrorReport = {
  /** 分类结果本身（错误卡按它取动作/埋点，别再从 reason 文案反猜）。 */
  kind: GenerationErrorKind
  /**
   * 这一类错误的**下一步动作**（2026-07-30）：确定性失败给「换个模型 / 去模型接入」，
   * 偶发失败才给「重试」——以前一律「重试」，等于让用户对着确定失败的模型死磕。
   */
  primary: GenerationErrorAction
  /** `null` = 这一类没有第二个有用的动作（如已下线：重试必然再撞同一张卡），错误卡不摆次按钮。 */
  secondary: GenerationErrorAction | null
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
  /**
   * 仅 model-kind-mismatch：一键改对所需的三个事实。让 UI **直接读**，不从文案里反解——
   * 文案是给人看的、还要翻译，用正则从它里面抠 modelKey 是必然会烂的耦合。
   */
  modelKindFix?: { modelKey: string; registered: string; requested: string }
  /**
   * 这次失败是不是**服务商那一侧**的事（分类的类别本身说了算，`unknown` 看有没有供应商说的话）。
   * 任何点名供应商说「它失败了」的界面（切家提示）只在它为 true 时才有资格：我们自己这一侧的失败
   * （读不出产物、本地校验、出站策略……）点名供应商就是栽赃，劝换一家也不是解法。
   */
  vendorSide: boolean
  /** Original raw error message (any "→ hint" tail from older builds stripped). */
  raw: string
}

/**
 * 上游原话提到可见区前的清洗：剥 JSON 信封、去掉占位、与 reason 重复、过长。
 *
 * 剥信封不能省：厂商多半整坨 JSON 甩回来，直接贴出去用户看到的是
 * `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request
 * failed because…` —— 真正那句人话被 code/param/type 埋在中间，还把窄节点上的卡片撑到要滚
 * （2026-07-31 走查截图）。抠出 message 后仍是**服务商自己的原话**，只是不带信封；
 * 完整报文照旧在「技术详情」里（report.raw 不动）。
 */
function pickProviderMessage(candidate: string | undefined, reason: string): string {
  const source = String(candidate || '').trim()
  const msg = (jsonErrorMessage(source) ?? source).replace(/\s+/g, ' ').trim()
  if (!msg || msg === '(no detail from provider)' || msg === reason) return ''
  return msg.length > 200 ? `${msg.slice(0, 199)}…` : msg
}

/** provider 常把报错塞进 JSON：{ error: { message } } / { message } / { error }。抠不出返回 null。 */
function jsonErrorMessage(source: string): string | null {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!parsed || typeof parsed !== 'object') return null
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
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return null
  } catch {
    return null // 不是 JSON
  }
}

/**
 * 未命中任何已知分类时，从 raw 里抠一句**可读首行**当 reason——而不是又甩一句
 * "生成失败"（那会和顶部状态徽标重复，对用户零信息）。优先解析 JSON 里的
 * message/error 字段，否则取第一行非空文本并截断。抠不出可读内容才返回 ''。
 */
function extractReadableErrorLine(raw: string): string {
  const source = stripNomiErrorCode(
    String(raw || '')
      .trim()
      .replace(IPC_WRAPPER_PREFIX, ''),
  ).trim()
  if (!source) return ''
  // 1) provider 常把报错塞进 JSON（与 pickProviderMessage 共用同一个剥壳器，两处不许各写一份）
  const fromJson = jsonErrorMessage(source)
  if (fromJson) return truncateLine(fromJson)
  // 2) 纯文本：取第一行非空内容
  const firstLine = source
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine ? truncateLine(firstLine) : ''
}

/**
 * Electron 的 `ipcRenderer.invoke` 会把主进程抛的错重新包一层
 * `Error invoking remote method 'nomi:tasks:run': Error: …`。这层是**我们自己的管道细节**，
 * 对用户零信息——却正好占住错误卡最显眼的那一行（未识别错误的 reason 就取 raw 首行）。
 * 只从展示用的首行剥掉，`report.raw`（技术详情折叠区）保留原样，排查线索不丢。
 */
const IPC_WRAPPER_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/

/**
 * 这句话是不是界面当前语言的话。判据只有一条：中文界面要有汉字，英文界面不能有。
 * 数字 / 符号 / 代码串在中文界面里算「不是中文」——标题不该是一串没人读得懂的标识。
 */
function isInUiLanguage(text: string): boolean {
  const hasHan = /[㐀-鿿]/.test(text)
  return String(i18n.language || '').toLowerCase().startsWith('zh') ? hasHan : !hasHan
}

/**
 * 认不出的失败（unknown）的说明里附上**供应商自己给的错误码**——有就带（上游的 error.code，或业务码 logicalCode）。
 * 不编原因：码与「技术详情」里的原文是用户和我们排查的入口；没有码就不写这一句（narrate 里 hint / hintWithCode 二选一）。
 */
function unknownCopyParams(structured: VendorErrorStructuredLite | null): Record<string, string> | undefined {
  const logical = structured?.logicalCode === undefined || structured.logicalCode === '' ? '' : String(structured.logicalCode)
  const code = structured?.upstreamCode || logical
  return code ? { code } : undefined
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

function detectMissingImageReference(raw: string): 'image_edit' | 'image_to_video' | null {
  if (raw.includes('图生图缺少参考图')) return 'image_edit'
  if (raw.includes('图生视频缺少参考图')) return 'image_to_video'
  return null
}

function reportForMissingImageReference(
  kind: 'image_edit' | 'image_to_video',
  raw: string,
): GenerationErrorReport {
  const reason = i18n.t(
    kind === 'image_edit'
      ? 'generationCommon.composer.imageConnectionRequired'
      : 'generationCommon.composer.videoFirstFrameRequired',
  )
  return {
    kind: 'input',
    reason,
    hint: '',
    // 本机在发请求前的护栏：请求没出门，说不上是哪家供应商拒了什么。
    vendorSide: false,
    raw,
    ...narrateGenerationErrorActions('input'),
  }
}

/**
 * 三位状态码只认**独立的词**：`HTTP 401` / `401 Unauthorized` / `(401)` / `status=401` 算；
 * 端口 `59401`、任务 id `task_a4029b`、版本号 `10.0.0.401` 里碰巧连着的三个字符不算。
 */
function hasStatusCode(lower: string, code: '401' | '402' | '429'): boolean {
  return new RegExp(`(?:^|[^\\w.])${code}(?!\\w)`).test(lower)
}

/** URL 整段（scheme 起到空白为止）——里面的端口、路径、任务 id 都是别人的字，不是失败的证据。 */
const URL_IN_TEXT = /[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi

/**
 * legacy 关键词嗅探**读哪一段文字**——判据不能读自己写的字。
 *
 * 病根（2026-09-30 pb07 真机走查抓出）：嗅探读整句 raw，而 raw 里有一大半是我们自己拼的诊断外壳：供应商键、方法、
 * **带随机端口 / 任务 id 的 URL**、`taskId=…`。'401' / '402' / '429' 这几个裸子串于是从 `127.0.0.1:59401`
 * 这样的端口里「读」出鉴权 / 余额 / 限流——供应商回了一句「我认不出」（418 + 自由文本）的失败，被配上「API Key 无效」。
 * 生产里同一个洞：任何带随机 id 的 URL（`…/tasks/5c1429ab`）都能让一条 404 变成「额度」。
 *
 *   · 认得出哪句是供应商自己的话（结构化载荷的 upstreamMsg，或异步任务失败格式里的原话）→ 只读它，外壳一个字都不读
 *     （三条传输通道产出的载荷都带 upstreamMsg——外壳里没有任何「另外的」证据）；
 *   · 来源不明的串（老项目持久化的 node.error、非 vendor 错误、只有 {code, reason} 的载荷）只能整句读，但先把 URL 抠掉，
 *     状态码只认独立的词（hasStatusCode）。
 */
function legacyEvidence(upstream: string | undefined, raw: string): string {
  return upstream ?? raw.replace(URL_IN_TEXT, ' ')
}

/** legacy 字符串 → 类别(老项目持久化的 node.error / 非 vendor 错误的兜底识别;文案不在这里)。`raw` 是 legacyEvidence 挑出的那段字。 */
function detectLegacyErrorKind(raw: string): GenerationErrorKind | null {
  const lower = raw.toLowerCase()
  // 输出截断（agentError.describeEmptyAgentReply 的 length 签名）最先判——它是确定性失败，
  // 落进 unknown 会给出「稍等重试」的误导（重试必再撞）。短语来自我们自己的文案，单一来源。
  if (raw.includes('输出长度上限') || raw.includes('内容被截断')) return 'output-truncated'
  if (lower.includes('api key') || lower.includes('apikey') || lower.includes('unauthorized') || hasStatusCode(lower, '401'))
    return 'auth'
  // 余额不足要和限流分开——用户动作不同(充值 vs 等待)。只匹配明确指向余额/欠费的词,
  // 避免把 OpenAI 的 insufficient_quota(配额)误判成余额。
  if (
    raw.includes('余额') ||
    lower.includes('balance') ||
    raw.includes('欠费') ||
    lower.includes('arrears') ||
    hasStatusCode(lower, '402')
  )
    return 'balance'
  if (
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    hasStatusCode(lower, '429') ||
    lower.includes('insufficient')
  )
    return 'quota'
  // 我们自己的轮询超时(视频长任务常见)——不是网络问题,任务多半还在服务商侧跑。
  if (raw.includes('轮询超时') || lower.includes('task poll timeout')) return 'poll-timeout'
  // 连不上 ≠ 超时。以前这桶只认 timeout 一族，「压根没连上」的那半边全漏进 unknown，拿到
  // 「可能是服务商临时故障或额度问题，建议稍等重试」——把用户自己的网络/代理问题甩锅给一个
  // 根本没被请求到的服务商，而重试必再撞（同 output-truncated 的理由）。三处真实来源都得认：
  //   · `fetch failed`     Node/undici——主进程 fetch 断网/代理不通时的原话（最常撞的一条）
  //   · `Failed to fetch`  浏览器 TypeError（网络层掐断，2026-08-12 群反馈的网页版报错原文）
  //   · `网络请求失败`      我们自己 electron/systemProxy.ts 的兜底文案，中文，匹配不到 'network'
  // ENOTFOUND 带 E 前缀，和下面「model not found」（中间有空格）不会互吞。
  if (
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('socket hang up') ||
    lower.includes('fetch failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    // 兜底词：openai 客户端断线的原话 `Connection error.`、`Request timed out.`、undici 的 `other side closed`。
    // `terminated` 不进这张共享表（太宽：「account has been terminated」「terminated due to policy」会被说成连不上）；
    // undici 断线的原话整串就是 `terminated`，下面单独按整串等于判。**主判据不在这张表**——Agent 对话那一路由 pi 的 `isRetryableAssistantError`
    // 判「瞬时」后直接归网络类（laneProjection 的 `transient`）；这几个词只让生成域等其他入口也认得。
    lower.includes('connection error') ||
    lower.includes('timed out') ||
    lower.includes('other side closed') ||
    lower.trim().replace(/[.\s]+$/, '') === 'terminated' ||
    raw.includes('网络请求失败')
  )
    return 'network'
  // `Model is not enabled: x` = 目录里记录还在、只是被停用（退役下线走另一条专用签名）。
  // 以前漏了 'not enabled' → 落 unknown 拿到「稍等重试」：停用的模型重试一万次也起不来，
  // 该做的是去模型接入把它打开（2026-07-30 补）。
  if (
    lower.includes('model') &&
    (lower.includes('not found') ||
      lower.includes('未找到') ||
      lower.includes('not configured') ||
      lower.includes('not enabled'))
  )
    return 'model-config'
  if (lower.includes('content') && (lower.includes('policy') || lower.includes('safety') || lower.includes('filter')))
    return 'content-policy'
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
    // 「开通+模型」必须再有控制台语境才算——否则太宽：即梦 CLI 的会员兜底文案（「需开通即梦会员…
    // 该模型首次使用…」）曾被这条误吞成「模型未开通/火山 Ark 指引」（2026-07-06 真机走查抓出）。
    (text.includes('开通') &&
      text.includes('模型') &&
      (text.includes('控制台') || text.includes('console') || text.includes('ark') || text.includes('激活')))
  )
}

/**
 * 「中转生图路由未开通」文案信号（2026-07-24 y7api 403 定案："Image generation is not enabled
 * for this group"）——one-api/new-api 的令牌分组没开 /v1/images/* 路由。electron 侧同短语用于
 * 自动回退 chat 路由（catalog/imageRouteFallback，改短语两处同步）；走到这里=回退也失败，
 * 指引去中转控制台开分组，而不是误导成「查 API Key」。短语取窄，不吞普通 403。
 */
function detectImageRouteDisabled(upstream: string | undefined, raw: string): boolean {
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  if (text.includes('not enabled for this group')) return true
  if (text.includes('image generation is not enabled')) return true
  if (text.includes('images api is not enabled') || text.includes('endpoint is disabled')) return true
  return (
    (text.includes('分组') || text.includes('group')) &&
    (text.includes('未开通') || text.includes('无权限') || text.includes('not enabled') || text.includes('no permission'))
  )
}

/**
 * 「账号档位闸」是文案信号，不是状态码信号——会员/企业 Key/网页授权各家用不同码（即梦静默 exit≠0、
 * RunningHub 200+errorCode 1014、即梦 compliance 文本），分别会被派生成 unknown/input，把「开会员/换企业
 * Key/去授权」误导成「查参数」。故在 category 分类前先按文案判定，命中即压过 structured.category。
 * 短语取得窄，避免误吞普通错误。区别于 model-not-open（去控制台开通一个动作）。
 */
function detectAccountGate(upstream: string | undefined, raw: string): boolean {
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  return (
    // 即梦高级会员（dreamina）
    text.includes('maestro vip') ||
    text.includes('高级会员') ||
    text.includes('开通即梦会员') ||
    text.includes('dreamina_cli 使用权限') ||
    (text.includes('会员') && (text.includes('生成') || text.includes('试用'))) ||
    // RunningHub 标准模型需企业级共享 Key（errorCode 1014）
    text.includes('enterprise-shared') ||
    text.includes('企业级') ||
    text.includes('企业共享') ||
    text.includes('仅限企业') ||
    // 即梦部分模型首次需网页端授权
    text.includes('aigccomplianceconfirmationrequired') ||
    text.includes('complianceconfirmationrequired') ||
    (text.includes('授权') && (text.includes('网页') || text.includes('web') || text.includes('确认')))
  )
}

/**
 * 余额不足/欠费是文案信号——各家用不同业务码（RunningHub 605「账户余额不足」、1620「活动会员金额不支持 API
 * 调用，请充值」），categorizeVendorFailure 按数值会派生成 server/input 误导成「服务商故障/参数错」。故文案优先判，
 * 命中即归 balance（充值一个动作能解）。区别于 quota（限流·等待）。短语取得窄，避免误吞普通报错。
 */
function detectBalance(upstream: string | undefined, raw: string): boolean {
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  return (
    text.includes('余额不足') ||
    text.includes('请充值') ||
    text.includes('账户余额') ||
    text.includes('欠费') ||
    text.includes('不支持 api 调用') ||
    text.includes('insufficient balance') ||
    text.includes('please recharge') ||
    text.includes('top up')
  )
}

/**
 * 「内容安全把输入挡了」——**必须先于 category 判**：各家审核拒绝都用 HTTP 400 回，
 * categorizeVendorFailure 一律派生成 `input`，于是「参考图被审核拦了」被说成「参数不被接受，
 * 请检查比例/尺寸」+ 一个红色「重试」按钮 —— 三处全错（不是参数问题、改比例救不了、
 * 同图同模型重试是确定性再撞）。legacy 的 content-policy 分支也救不了：① 它只在 structured
 * 落空时才跑，② 判据是英文 content+policy/safety/filter，方舟的错误码一个都不匹配。
 *
 * 实测来源（2026-07-31 用户真机，中转代理火山方舟 Seedance 2.0）：
 * HTTP 400 `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation",
 * "message":"The request failed because the input image 'content[1]' may contain real person"…}}`
 *
 * 返回值区分**挡的是哪一头**——动作完全不同：图被挡要换图/换模型（改提示词没用），
 * 提示词被挡改下面的 composer 就行。短语取窄（要么是厂商固定错误码，要么「敏感/审核」
 * 与「输入图片」同时出现），不吞普通 400。
 */
function detectContentModerationTarget(upstream: string | undefined, raw: string): 'image' | 'prompt' | null {
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  const blocksImage =
    text.includes('inputimagesensitivecontentdetected') ||
    text.includes('may contain real person') ||
    text.includes('may contain a real person') ||
    ((text.includes('sensitive') || text.includes('敏感') || text.includes('审核')) &&
      (text.includes('input image') || text.includes('输入图片') || text.includes('参考图')))
  if (blocksImage) return 'image'
  if (text.includes('inputtextsensitivecontentdetected')) return 'prompt'
  return null
}

/**
 * 「参考图压根没送到服务商」——失败发生在**我们这一侧**：本机素材要先换成公网可取的
 * 地址，用户没接任何自带上传通道的服务商时会掉到最后一档免费匿名图床（litterbox/tmpfiles），
 * 那两个挂了整条链就断（2026-07-31 用户真机：HTTP 500 + fetch failed）。
 *
 * 判据是 assetLocalization 自己抛的固定短语（我们的字符串，不是猜厂商文案）。没这条的话
 * 它落进 unknown，用户看到的是「可能是服务商临时故障或额度问题」——甩锅给一个**根本没被
 * 请求到**的服务商，再配一句没用的「换一个模型」。
 */
function detectAssetUploadFailed(raw: string): boolean {
  // 三种形态都要认（都出自 assetLocalization / localAssetFile，是我们自己的字符串）：
  // ① 匿名链包出来的；② 逐条候选通道都挂的汇总；③ 某条通道直接抛的裸 `素材上传失败(HTTP 4xx)`。
  // 只认 ① 的时候，直连通道（KIE/apimart）抛的 413 落进 unknown → 用户看到「可能是服务商临时故障
  // 或额度问题，建议稍等重试」（2026-08-20 用户截图逐字如此），于是不停重试一个必然再撞的上限。
  if (matchNomiErrorCode(raw) === 'asset-upload-failed') return true
  return (
    raw.includes('所有免配置上传 host 都失败') ||
    raw.includes('的所有上传通道都没成功') ||
    raw.includes('素材上传失败')
  )
}

/**
 * 素材大到所有上传通道都装不下（HTTP 413）——重试永远不会成，得让用户去压缩，不能说「稍等重试」。
 *
 * 2026-09-01 root-cause:主判据改成**机器码**（assetLocalization 通过 tagNomiError('asset-too-large')
 * 附的 NOMI_ERR:: 标记），不再靠 include 那句中文人话——人话将来 i18n 化/改词都不影响分类。
 * 保留两条 legacy 兜底:① `HTTP 413`(英文、非 CJK,直连通道抛的裸 413);② 那句中文串——为的是
 * 认出**本次改动前**已经 persist 进 node.error 的旧错误(它们没有码标记)。两条都不脆弱地依赖新文案。
 */
function detectAssetTooLarge(raw: string): boolean {
  if (matchNomiErrorCode(raw) === 'asset-too-large') return true
  return raw.includes('超过了所有可用上传通道的大小上限') || raw.includes('HTTP 413')
}

/**
 * 上游**自己给的错误码** → 失败类别（全仓唯一一张码表）。
 *
 * 为什么码要压过状态码：`categorizeVendorFailure` 把 400/422 一律派生成 `input`，可 400 只说「请求有问题」，
 * 从不说为什么——模型已下线、审核拦了、余额不足都可以回 400。把 400 当成「参数不被接受」就是猜
 * （2026-09-29 走查：供应商说「模型已下线」，界面却叫用户去改比例 / 尺寸）。上游的错误码才是它自己说的原因，
 * 主进程把它随失败载荷一起带过来（`upstreamCode`，electron/jsonUtils.pickUpstreamCode），这里按码归类。
 *
 * 只登记**有明确类别、且各家共用**的标识码（OpenAI 兼容 / new-api 一族的 `model_not_found` 等）；没登记的码
 * 不猜——落回文案判据与状态码。加一行 = 加一个码、一条用例，不写「某某家」的分支。
 */
const UPSTREAM_CODE_KINDS: ReadonlyArray<readonly [GenerationErrorKind, readonly string[]]> = [
  ['model-unavailable-upstream', ['model_not_found', 'model_not_available', 'model_unavailable', 'model_deprecated', 'model_offline', 'model_decommissioned']],
]
const KIND_BY_UPSTREAM_CODE: ReadonlyMap<string, GenerationErrorKind> = new Map(
  UPSTREAM_CODE_KINDS.flatMap(([kind, codes]) => codes.map((code) => [code, kind] as const)),
)

function upstreamCodeKind(code: string | undefined): GenerationErrorKind | null {
  return KIND_BY_UPSTREAM_CODE.get(String(code || '').trim().toLowerCase().replace(/[-.\s]+/g, '_')) ?? null
}

/**
 * **供应商说的那句话**（任何语言），能证明它是供应商说的才给——主进程的结构化载荷（`upstreamMsg`），
 * 或异步任务失败那个只由我们产出的格式（taskFailureMessage）。认不出来源的一律 `undefined`：
 * 那可能是我们自己的话（中文硬编码的 throw、内部英文错误），不能被当成「服务商原话」或按供应商的语言规矩处理。
 */
function vendorOriginatedText(structured: VendorErrorStructuredLite | null, raw: string): string | undefined {
  if (typeof structured?.upstreamMsg === 'string') return structured.upstreamMsg
  return parseTaskFailureMessage(raw)?.upstream
}

/**
 * 「模型在服务商上游根本不存在 / 已下线 / 不可用」——确定性失败，重试必再撞同一堵墙，所以不能落进 unknown
 * 拿到「稍等重试」那句误导（同 output-truncated 的理由）。
 *
 * 三路证据，强的在前：
 *   ① 上游自己的错误码（UPSTREAM_CODE_KINDS）；
 *   ② 供应商固定原话（Google / Vertex：实测来源 2026-07-30 apimart 的 Imagen 4，`data.error.message` 里裹着
 *      `{"error":{"code":404,"message":"Requested entity was not found.","status":"NOT_FOUND"}}`，`credits_cost: 0`）；
 *   ③ 供应商说「这个模型 已下线 / 不再可用 / 不存在」（英文 / 中文）。③ 只读**供应商说的那句话**
 *      （结构化载荷的 upstreamMsg，或任务失败格式里的原话），不读带 URL 的诊断串——路径里的 `/model/` 不该被当成证据。
 * 短语取窄：必须同时出现「模型」与「下线 / 不再可用 / 不存在」这一族；「参数已弃用」「素材 404」「项目不存在」都不算。
 */
const MODEL_UNAVAILABLE_WORDS: readonly RegExp[] = [
  // "This model has been deprecated and is no longer available." / "The model `x` was discontinued"
  /\bmodels?\b[^.\n]{0,120}\b(?:deprecated|no longer (?:available|supported|offered|provided)|discontinued|decommissioned|retired|sunset|taken offline|unavailable)\b/i,
  /\b(?:deprecated|discontinued|decommissioned|retired)\b[^.\n]{0,40}\bmodels?\b/i,
  // "The model `gpt-x` does not exist (or you do not have access to it)" / "No such model" / "Unknown model"
  /\bmodels?\b[^.\n]{0,80}\b(?:does not exist|doesn't exist|is not found|was not found|not found)\b/i,
  // 「Model not exist.」（应用内反馈 NF-0928-0001，自建渠道原话，少了 does）：只认 model 紧跟（至多隔一个模型名）的 not exist，
  // 不像上一行那样隔 80 个字符——「Prompt too long for model; template not exist」里不存在的是模板，不是模型。
  /\bmodels?\s+(?:(?:[`'"][^`'"\n]{1,80}[`'"]|[\w.:/-]{1,80})\s+)?not\s+exists?\b/i,
  /\b(?:no such|unknown|invalid) model\b/i,
  /模型[^。\n]{0,20}(?:已下线|已停用|已弃用|已废弃|已下架|不再(?:提供|可用|支持)|暂不(?:提供|可用)|不存在|不可用)/,
]

function detectModelUnavailableUpstream(code: string | undefined, upstream: string | undefined, raw: string): boolean {
  if (upstreamCodeKind(code) === 'model-unavailable-upstream') return true
  const text = `${upstream || ''} ${raw}`.toLowerCase()
  if (
    // Google / Vertex 家族：模型 ID 不存在或该 key 无权访问时的固定原话
    text.includes('requested entity was not found') ||
    text.includes('模型不存在')
  ) return true
  return typeof upstream === 'string' && MODEL_UNAVAILABLE_WORDS.some((pattern) => pattern.test(upstream))
}

/**
 * 「这个模型已经被我们下线了」—— 节点存的 modelKey 在目录里整条不见了（走 seedBuiltins 的退役
 * 清单主动移除，如 apimart Imagen 4 上游确定性 404）。判据是 electron 侧
 * `findExecutableModel` 抛的专用签名，不是猜文案（那句 `Model is not enabled` 留给「记录还在、
 * 只是被停用」，归 model-config 去模型接入）。
 *
 * 没这条的话：删模型 = 老节点撞一句英文技术报错 + 误导的「稍等重试」——坑换坑。
 */
function detectModelRetired(raw: string): boolean {
  return raw.includes('Model is retired:')
}

/**
 * 「目录里登记的类型和这次要的对不上」——electron 侧 findExecutableModel 的专用签名
 * `Model kind mismatch: <modelKey> (registered=<kind>, requested=<kind>)`，不是猜文案。
 *
 * 为什么单列一类：接入中转时类型是按 id 关键词猜的（guessModelKind，猜不中默认 text），必然有
 * 猜错的。旧实现把这种情形也压成 `Model is not enabled` → 归 model-config → 用户读到「模型未配置·
 * 请去模型接入页设置」。那句话是**假的**（模型明明启用着），而且指了个死路：去那页只会看到一切正常。
 * 抽出三个事实（哪个模型/登记成什么/这里要什么）后，文案才说得出真实缺口，按钮才能一键改对。
 */
const MODEL_KIND_MISMATCH_RE = /Model kind mismatch: (.+?) \(registered=(\w+), requested=(\w+)\)/

function detectModelKindMismatch(raw: string): { model: string; registered: string; requested: string } | null {
  const m = MODEL_KIND_MISMATCH_RE.exec(raw)
  return m ? { model: m[1], registered: m[2], requested: m[3] } : null
}

/**
 * 「没有可用文本大脑」——创作助手/拆镜头缺可用 text 模型时 agentChatV2 抛的**内部**签名
 * （新：`Model is not configured: no usable text model`；旧散句：`No local text model is configured`）。
 *
 * 为什么单列一类、且必须 upstream='' 处理（2026-08-25 走查 F5）：这是我们**自己**这侧的信号，
 * 服务商根本没被请求到。旧行为里它落进 unknown（下面 legacy 的 'not configured' 抓不到字面
 * "is configured"），reason 直接取英文原串——用户看到「服务器：…No local text model is configured…」
 * 半中半英。归 model-config 报人话之外，还要**不**把这句英文塞进「服务商说：」框（那是纯栽赃，
 * 同 model-kind-mismatch 的处理）。短语取窄，只认这两条我们自己的签名。
 */
function detectNoTextBrain(raw: string): boolean {
  const lower = raw.toLowerCase()
  return lower.includes('no usable text model') || lower.includes('no local text model')
}

/**
 * kind → 完整 report（文案 + 动作 + 上游原话）。收口原先重复 7 遍的四行样板：
 * 每处都得记着调 narrate、算 providerMessage、带 raw——漏一样就是一处失语。
 * `upstream` 给 undefined = 从 raw 里抠可读首行。
 */
function reportFor(
  kind: GenerationErrorKind,
  raw: string,
  upstream: string | undefined,
  params?: Record<string, string>,
): GenerationErrorReport {
  const { reason, hint } = narrateGenerationError(kind, params)
  const providerMessage = pickProviderMessage(upstream ?? extractReadableErrorLine(raw), reason)
  // 存进技术详情的 raw 也把 NOMI_ERR:: 码标记剥掉——那是给分类器读的机器标记,不是给人看的。
  // 「是不是服务商那一侧的事」只有类别表一个出处（narrate.VENDOR_SIDE_BY_KIND，穷举 Record）：
  // 我们自己的签名（服务商没被请求到 / 结果已经送达）在表里写 false，这里不再按调用点另判一遍。
  const vendorSide = narrateIsVendorSideFailure(kind)
  return { kind, reason, hint, vendorSide, raw: stripNomiErrorCode(raw), ...narrateGenerationErrorActions(kind), ...(providerMessage ? { providerMessage } : {}) }
}

export function classifyGenerationError(message: string): GenerationErrorReport {
  // S4-2:structured 优先(VendorRequestError 经 IPC 标记穿透,源头保留的事实,不是猜);
  // 老数据/非 vendor 错误退回 legacy 正则识别。两条路只产 kind,文案统一出自 narrate 词表。
  const structured = parseVendorErrorFromMessage(message)
  const cleanRaw =
    stripVendorErrorMarker(String(message || ''))
      .split('\n→')[0]
      .trim() || i18n.t('generationCommon.observability.error.unknown.reason')
  // 供应商说的那句话（能证明来源才有值）：判据、「服务商原话」框、标题的语言规矩都读它，不再各自从 raw 里抠。
  const upstream = vendorOriginatedText(structured, cleanRaw)
  const missingImageReference = detectMissingImageReference(cleanRaw)
  if (missingImageReference) return reportForMissingImageReference(missingImageReference, cleanRaw)
  // 我们**自己**的出站策略拒绝：判据是稳定机器码（NOMI_ERR::outbound-blocked::），最先判。
  // 必须先于一切「猜文案」的检测，也必须先于 structured.category —— 这条错误里根本没有服务商
  // 参与（请求从未发出），把它归成 network 会配上「稍等重试」，而重试是确定性再撞同一堵墙，
  // 且在生成语境下重试 = 再付一次钱。upstream 显式给 ''：抑制「服务商说：」框，别栽赃上游。
  const outboundCode = matchNomiErrorCode(cleanRaw)
  if (outboundCode === 'input-validation') return {
    kind: 'input', reason: i18n.t('generationCommon.sourceTask.invalid'), raw: stripNomiErrorCode(cleanRaw),
    hint: `${stripNomiErrorCode(cleanRaw)}\n${i18n.t('generationCommon.observability.progress.notCharged')}`,
    ...narrateGenerationErrorActions('input'),
  }
  if (outboundCode === 'model-config') return reportFor('model-config', cleanRaw, '')
  if (outboundCode === 'outbound-blocked') return reportFor('outbound-blocked', cleanRaw, '')
  // 提交侧的同族码：请求从未发出、没有计费。必须与上面一条分开，否则用户读到的是「钱已经付过、
  // 用重新拉取结果免费取回」——一句完全相反的假话，还会把他推向一颗根本不存在的按钮。
  if (outboundCode === 'outbound-blocked-submit') return reportFor('outbound-blocked-submit', cleanRaw, '')
  // 同族第三条（凭据绑定）：也必须单独一支——它的下一步是「回接入页重新保存密钥」，
  // 归进上面那条会把用户送去查代理，而这台机器的网络一点毛病都没有。
  if (outboundCode === 'outbound-blocked-credential-origin') return reportFor('outbound-blocked-credential-origin', cleanRaw, '')
  // 服务商地址回了跳转、Nomi 为护住密钥没有跟随：是地址配置的事，不是服务商故障，upstream 显式给 ''。
  if (outboundCode === 'credential-redirect') return reportFor('credential-redirect', cleanRaw, '')
  // 结果已经送达、Nomi 本机读不出来：失败在我们这一侧，upstream 显式给 ''——把那句英文校验串印进「服务商原话」
  // 就是栽赃（服务商已经把图发回来了）。也不给「换一家」：动作表里这一类只有重试。
  if (outboundCode === 'output-unreadable') return reportFor('output-unreadable', cleanRaw, '')
  // 付费提交发出后没拿到回复：供应商可能已经收下。必须在一切「猜文案」的网络分类之前判——原始报错里
  // 带着 fetch failed / ECONNRESET，落进 network 会被说成「请求没发到服务商」，那是假话，还会引人重试。
  if (outboundCode === 'submission-unknown') return reportFor('submission-unknown', cleanRaw, '')
  // 已生成、取回失败（#975 A2）：机器码先判，upstream 给 ''——失败在我们取回这一侧，不印「服务商原话」。
  if (outboundCode === 'output-retrieval-failed') return reportFor('output-retrieval-failed', cleanRaw, '')
  // 本机处理失败：没有服务商参与，upstream 给 ''（不印「服务商原话」）；原因就是码后面那句人话，已经在 raw / 标题里。
  if (outboundCode === 'local-processing') {
    // 第一行 = 生产者写的那句人话（标题）；其余行是技术细节，只进「技术详情」。先切行再剥码——剥码会把换行压成空格。
    const detail = stripNomiErrorCode(cleanRaw.split('\n')[0] ?? '')
    return reportFor('local-processing', cleanRaw, '', detail ? { detail } : undefined)
  }
  // 主进程的出站证据说「这次付费提交确定没离开本机」（结构化码 submission_not_sent，不认文案）。上面那几条更具体的
  // 本机拒绝（出网策略 / 凭据绑定 / 目录没配好）已经先判了；剩下的：连不上 → network（请求没发到服务商，查网络和代理），
  // 在本机就被拦下 → submission-not-sent。都排在一切「猜文案」的检测之前：这一类没有服务商参与，不许被说成服务商的失败。
  if (structured?.code === 'submission_not_sent' && outboundCode !== 'asset-invalid') {
    return reportFor(structured.reason === 'connect_failed' ? 'network' : 'submission-not-sent', cleanRaw, '')
  }
  // 已退役下线**最先**判：判据是 electron 抛的专用签名（确定性事实），不该被任何猜文案的检测抢走。
  // upstream 显式给 ''，与下面类型不符 / 缺文本大脑同理：这是我们自己的签名，服务商根本没被请求到。
  // 给 undefined 会从 raw 抠出「Model is retired: sora-2」，以「服务商原话：」印在退役卡正文里——
  // 一句英文，还栽赃给了没被请求的那家（2026-09-29 Sora 2 退役真机走查截图抓到）。
  if (detectModelRetired(cleanRaw)) return reportFor('model-retired', cleanRaw, '')
  // 类型不符同理是专用签名，同层最先判。upstream 显式给 ''：这是**我们自己**的内部信号，
  // 不是服务商原话——落进「服务商说：」那个框里会是彻头彻尾的栽赃（那家根本没被请求到）。
  const kindMismatch = detectModelKindMismatch(cleanRaw)
  if (kindMismatch) {
    const params = {
      model: kindMismatch.model,
      registered: narrateModelKind(kindMismatch.registered),
      requested: narrateModelKind(kindMismatch.requested),
    }
    return {
      ...reportFor('model-kind-mismatch', cleanRaw, '', params),
      modelKindFix: {
        modelKey: kindMismatch.model,
        registered: kindMismatch.registered,
        requested: kindMismatch.requested,
      },
    }
  }
  // 缺可用文本大脑同样是**我们自己**的内部签名（服务商没被请求到）——归 model-config 报人话，
  // upstream='' 抑制「服务商说：」框，别把那句英文散句栽赃给上游（2026-08-25 走查 F5）。
  if (detectNoTextBrain(cleanRaw)) return reportFor('model-config', cleanRaw, '')
  // 账号档位闸（会员/企业 Key/网页授权）先判——它的关键词（会员/授权/开通即梦会员）比
  // model-not-open 更具体；反过来放后面会被宽词抢走（即梦 CLI 兜底文案曾被判成「模型未开通」
  // 并给出火山 Ark 指引，2026-07-06 真机走查抓出）。reason 出自 narrate，服务商原话单独提到可见区。
  if (detectAccountGate(upstream, cleanRaw)) {
    return reportFor('account-gate', cleanRaw, upstream)
  }
  // 上游「模型不存在」先于 model-not-open 判——两者都是模型级问题，但动作不同：这条是**换模型**
  // （上游根本没这个模型，去控制台也开不出来），model-not-open 是去控制台开通。
  if (detectModelUnavailableUpstream(structured?.upstreamCode, upstream, cleanRaw)) {
    return reportFor('model-unavailable-upstream', cleanRaw, upstream)
  }
  // 模型未开通先于 category 判(理由见 detectModelNotOpen)。
  if (detectModelNotOpen(upstream, cleanRaw)) {
    return reportFor('model-not-open', cleanRaw, upstream)
  }
  // 中转生图路由未开通先于 category 判——403 会被派生成 auth（「API Key 无效」），把「去中转
  // 控制台开分组」误导成「查密钥」（2026-07-24 y7api 真实报错定案）。
  if (detectImageRouteDisabled(upstream, cleanRaw)) {
    return reportFor('image-route-disabled', cleanRaw, upstream)
  }
  // 余额不足/欠费先于 category 判——RunningHub 605/1620 数值会被派生成 server/input 误导。
  if (detectBalance(upstream, cleanRaw)) {
    return reportFor('balance', cleanRaw, upstream)
  }
  // 素材上传失败先于 category 判——失败在我们这侧，服务商根本没被请求到，不能借上游的状态码说话。
  // 太大（413）比「上传失败」更具体，先判——否则会被归成「稍等重试」，而重试永远不可能成。
  // 素材本身不合格（读不到 / 认不出 / 不是真媒体）只认机器码：它来自我们自己的本机检查，
  // 服务商没被请求到，不能落进 unknown 被说成「服务商临时故障或额度问题」（2026-09-27 用户截图）。
  if (outboundCode === 'asset-invalid') return reportFor('asset-invalid', cleanRaw, undefined)
  if (detectAssetTooLarge(cleanRaw)) return reportFor('asset-too-large', cleanRaw, undefined)
  if (detectAssetUploadFailed(cleanRaw)) return reportFor('asset-upload-failed', cleanRaw, undefined)
  // 内容安全拦截先于 category 判——审核拒绝走 HTTP 400，会被派生成「参数不被接受·检查比例/尺寸」
  // 并配一个必然再撞的「重试」（理由见 detectContentModerationTarget）。
  const moderated = detectContentModerationTarget(upstream, cleanRaw)
  if (moderated) {
    return reportFor(moderated === 'image' ? 'input-image-blocked' : 'content-policy', cleanRaw, upstream)
  }
  if (structured?.category && (STRUCTURED_KINDS as readonly string[]).includes(structured.category)) {
    return reportFor(structured.category as GenerationErrorKind, stripVendorErrorMarker(message), upstream)
  }
  if (structured?.category === 'timeout') {
    return reportFor('network', stripVendorErrorMarker(message), upstream)
  }
  // Strip any legacy "\n→ hint" tail that older builds baked into node.error.
  const raw =
    stripVendorErrorMarker(String(message || ''))
      .split('\n→')[0]
      .trim() || i18n.t('generationCommon.observability.error.unknown.reason')
  if (raw.includes('网页媒体下载失败')) {
    return {
      kind: 'unknown',
      reason: i18n.t('generationCommon.observability.error.webMedia.reason'),
      hint: i18n.t('generationCommon.observability.error.webMedia.hint'),
      vendorSide: false,
      raw,
      ...narrateGenerationErrorActions('unknown'),
    }
  }
  // 同一节点上一笔还在路上，主进程拒了这一笔（这一次还没发出去）：照实说，不当成供应商失败。
  if (structured?.code === 'node_generation_in_flight') {
    return {
      kind: 'unknown',
      reason: i18n.t('generationCommon.observability.error.nodeInFlight.reason'),
      hint: i18n.t('generationCommon.observability.error.nodeInFlight.hint'),
      vendorSide: false,
      raw,
      ...narrateGenerationErrorActions('unknown'),
    }
  }
  // 升级前留下的批量确认草稿（没记来源节点）：先落节点、再发请求之后主进程不发它，按「没交」收尾——如实说，要他再确认一次。
  if (structured?.code === 'canvas_consent_predates_upgrade') {
    return {
      kind: 'unknown',
      reason: i18n.t('generationCommon.observability.error.consentPredatesUpgrade.reason'),
      hint: i18n.t('generationCommon.observability.error.consentPredatesUpgrade.hint'),
      vendorSide: false,
      raw,
      ...narrateGenerationErrorActions('unknown'),
    }
  }
  // 3D-BOX 预演没好，主进程准入拒了这一次（还没发出去、没花钱）：说的是哪一步没好，不当成供应商失败。
  if (structured?.code === 'director_preview_blocked') {
    return {
      kind: 'unknown',
      reason: i18n.t(structured.reason === 'failed' ? 'director.agent.spendBlockedFailed' : 'director.agent.spendBlockedRendering'),
      hint: i18n.t('generationCommon.observability.error.previewBlocked.hint'),
      vendorSide: false,
      raw,
      ...narrateGenerationErrorActions('unknown'),
    }
  }
  const claimReason = structured?.code === 'production_shot_claimed' ? structured.reason : undefined
  const copy = shotClaimCopy(claimReason as Parameters<typeof shotClaimCopy>[0])
  if (copy) {
    return {
      kind: 'unknown',
      reason: i18n.t(`generationCommon.observability.error.shotClaimed.${copy.key}.reason`),
      hint: i18n.t(`generationCommon.observability.error.shotClaimed.${copy.key}.hint`),
      vendorSide: false,
      raw,
      primary: copy.action,
      secondary: copy.action,
    }
  }
  const kind = detectLegacyErrorKind(legacyEvidence(upstream, raw))
  if (kind) return reportFor(kind, raw, upstream)
  // 供应商说的话，只有**和界面同一种语言**才配当标题（读得懂、说得具体）；否则标题是界面语言的一句话，
  // 原话降为「服务商原话」那一格的次要信息（中文界面不再顶着供应商的一整句英文，英文界面同理）。
  // 认不出来源的（可能是我们自己的话）不走这里：照下面抠首行，别把我们自己说得很具体的话换成泛泛的「生成失败」。
  if (upstream) {
    const said = pickProviderMessage(upstream, '')
    if (said && isInUiLanguage(said)) {
      return {
        kind: 'unknown',
        reason: truncateLine(said),
        hint: narrateGenerationError('unknown', unknownCopyParams(structured)).hint,
        vendorSide: true, // 供应商说了话（且不是我们认得的任何一类）：它这次失败了
        raw,
        ...narrateGenerationErrorActions('unknown'),
      }
    }
    return { ...reportFor('unknown', raw, upstream, unknownCopyParams(structured)), vendorSide: true }
  }
  // 兜底:抠 raw 可读首行当 reason,通用建议出自 narrate 的 unknown 词条。
  return {
    kind: 'unknown',
    reason: extractReadableErrorLine(raw) || narrateGenerationError('unknown').reason,
    hint: narrateGenerationError('unknown', unknownCopyParams(structured)).hint,
    // 认不出来源、也没有供应商说的话：可能是我们自己的话（本机护栏 / 内部错误），不点名任何一家。
    vendorSide: false,
    raw,
    ...narrateGenerationErrorActions('unknown'),
  }
}
