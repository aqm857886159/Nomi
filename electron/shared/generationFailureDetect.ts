// 失败原文里的各类「检测器」：看原文 / 供应商结构化字段，回答「是不是 X」。判定入口在 generationFailure.ts 的 decideGenerationFailure；
// 这里只检测、不决定类别，也不产生任何词条文字。
import { matchNomiErrorCode, stripNomiErrorCode } from './nomiErrorCodes'
import { withoutIpcInvokeWrapper } from './contracts/ipcInvokeFailure'
import { type FailureLocale } from './generationFailureCopy'
import { type GenerationErrorKind } from './generationFailureKinds'
import { parseTaskFailureMessage, type VendorErrorStructuredLite } from './generationFailureWire'

export function cleanProviderMessage(candidate: string | undefined): string {
  const source = String(candidate || '').trim()
  const msg = (jsonErrorMessage(source) ?? source).replace(/\s+/g, ' ').trim()
  if (!msg || msg === '(no detail from provider)') return ''
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
export function extractReadableErrorLine(raw: string): string {
  // IPC 外壳（`Error invoking remote method '…': Error: …`）是我们自己的管道细节，对用户零信息，却正好占住
  // 错误卡最显眼的那一行。只从展示用的首行剥掉，`report.raw`（技术详情折叠区）保留原样，排查线索不丢。
  const source = stripNomiErrorCode(withoutIpcInvokeWrapper(String(raw || '').trim())).trim()
  if (!source) return ''
  // 1) provider 常把报错塞进 JSON（与 cleanProviderMessage 共用同一个剥壳器，两处不许各写一份）
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
 * 认不出的失败（unknown）的说明里附上**供应商自己给的错误码**——有就带（上游的 error.code，或业务码 logicalCode）。
 * 不编原因：码与「技术详情」里的原文是用户和我们排查的入口；没有码就不写这一句（copyOf 里 hint / hintWithCode 二选一）。
 */
export function unknownCopyParams(structured: VendorErrorStructuredLite | null): Record<string, string> | undefined {
  const logical = structured?.logicalCode === undefined || structured.logicalCode === '' ? '' : String(structured.logicalCode)
  const code = structured?.upstreamCode || logical
  return code ? { code } : undefined
}

export function truncateLine(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 100 ? `${clean.slice(0, 99)}…` : clean
}

export const STRUCTURED_KINDS: readonly GenerationErrorKind[] = ['auth', 'balance', 'quota', 'network', 'server', 'input']

export function detectMissingImageReference(raw: string): 'image_edit' | 'image_to_video' | null {
  if (raw.includes('图生图缺少参考图')) return 'image_edit'
  if (raw.includes('图生视频缺少参考图')) return 'image_to_video'
  return null
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
export function legacyEvidence(upstream: string | undefined, raw: string): string {
  return upstream ?? raw.replace(URL_IN_TEXT, ' ')
}

/** legacy 字符串 → 类别(老项目持久化的 node.error / 非 vendor 错误的兜底识别;文案不在这里)。`raw` 是 legacyEvidence 挑出的那段字。 */
export function detectLegacyErrorKind(raw: string): GenerationErrorKind | null {
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
export function detectModelNotOpen(upstream: string | undefined, raw: string): boolean {
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
export function detectImageRouteDisabled(upstream: string | undefined, raw: string): boolean {
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
export function detectAccountGate(upstream: string | undefined, raw: string): boolean {
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
export function detectBalance(upstream: string | undefined, raw: string): boolean {
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
export function detectContentModerationTarget(upstream: string | undefined, raw: string): 'image' | 'prompt' | null {
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
export function detectAssetUploadFailed(raw: string): boolean {
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
export function detectAssetTooLarge(raw: string): boolean {
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
 * **供应商说的那句话**（任何语言），能证明它是供应商说的才给：主进程结构化载荷里的 `upstreamMsg`，且载荷记着服务商这次
 * **回了话**（见 vendorAnswered）；或异步任务失败那个只由我们产出的格式（taskFailureMessage）。认不出来源的一律 `undefined`：
 * 那可能是我们自己的话（中文硬编码的 throw、内部英文错误、本机网络层的报错），不能被当成「服务商原话」或按供应商的语言规矩处理。
 */
export function vendorOriginatedText(structured: VendorErrorStructuredLite | null, raw: string): string | undefined {
  if (typeof structured?.upstreamMsg === 'string' && vendorAnswered(structured)) return structured.upstreamMsg
  return parseTaskFailureMessage(raw)?.upstream
}

/**
 * 服务商这次回了话：回了非 2xx（`httpStatus`），或 200 里带着业务错误码（`logicalCode`）。`upstreamMsg` 这个字段名不是证据——
 * 服务商没回话时（连不上 / 超时 / 本机拒发 / 跳转被拒 / 请求头守卫 / 响应超限），vendorHttp 与 runtimeVendorError 也把本机的话写进去
 * （`fetch failed`、`ECONNRESET: read ECONNRESET`、我们自己的超时句）。主进程 audioTaskRunner / relayNativeWireUpgrade 同样按
 * httpStatus 认（2026-10-27 用户拍板：只认有来源的原话）。
 */
function vendorAnswered(structured: VendorErrorStructuredLite): boolean {
  return typeof structured.httpStatus === 'number' || (structured.logicalCode !== undefined && structured.logicalCode !== '')
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

export function detectModelUnavailableUpstream(code: string | undefined, upstream: string | undefined, raw: string): boolean {
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
export function detectModelRetired(raw: string): boolean {
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

export function detectModelKindMismatch(raw: string): { model: string; registered: string; requested: string } | null {
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
export function detectNoTextBrain(raw: string): boolean {
  const lower = raw.toLowerCase()
  return lower.includes('no usable text model') || lower.includes('no local text model')
}


/** 这句话是不是界面当前语言的话：中文界面要有汉字，英文界面不能有（数字 / 符号 / 代码串在中文界面里算「不是中文」）。 */
export function isInLocale(text: string, locale: FailureLocale): boolean {
  const hasHan = /[㐀-鿿]/.test(text)
  return locale === 'zh-CN' ? hasHan : !hasHan
}
