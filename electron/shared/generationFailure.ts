// 失败分类的**唯一家**（纯共享叶子：不 import src/、i18n、React、桌面桥）。
//
// 「这次失败算哪一类、给什么公开码、说什么（词条键）、能做什么」只在 decideGenerationFailure 判一次；
// 画布 / 分镜 / 任务中心 / 内置助手 / 外部助手各自只做投影（语言、受众、任务来源、pi 瞬时是**输入事实**，不是出口改判）。
// 出口在这之外读 message / code 再自己匹配或覆盖类别、公开码、词条键、动作，由 concept-owners 扫描红掉
// （diagnostics.generation-failure-decision）。词条文字不在这里：界面词条在 src/i18n，外部助手的公开码词条在 generationFailureCopy.ts。
import { isRetrievalStageCode, matchNomiErrorCode, stripNomiErrorCode } from './nomiErrorCodes'
import { isReferenceFetchRefusal } from './assets/referenceFetchRefusal'
import { withoutIpcInvokeWrapper } from './contracts/ipcInvokeFailure'
import { type FailureLocale } from './generationFailureCopy'
import { ERROR_KEY_BY_KIND, actionsOfKind, isVendorSideKind, shotClaimCopy, type GenerationErrorAction, type GenerationErrorKind } from './generationFailureKinds'
import { parseVendorErrorFromMessage, stripVendorErrorMarker, confirmPublicError } from './generationFailureWire'
import { cleanProviderMessage, extractReadableErrorLine, isTechnicalErrorLine, unknownCopyParams, truncateLine, STRUCTURED_KINDS, detectMissingImageReference, legacyEvidence, detectLegacyErrorKind, detectModelNotOpen, detectImageRouteDisabled, detectAccountGate, detectBalance, detectContentModerationTarget, detectAssetUploadFailed, detectAssetTooLarge, vendorOriginatedText, detectModelUnavailableUpstream, detectModelRetired, detectModelKindMismatch, detectNoTextBrain, isInLocale } from './generationFailureDetect'

export type { FailureLocale } from './generationFailureCopy'
export * from './generationFailureKinds'
export * from './generationFailureWire'

// ---------------------------------------------------------------------------
// 决定的形状：只带键与事实，不带翻译后的句子。
// ---------------------------------------------------------------------------

/** 词条插值值：普通字符串，或「这是一个模型类别，投影时翻成人话」。 */
export type FailureCopyParam = string | { readonly modelKind: string }
/** 一句话：要么是 i18n 词条键 + 插值，要么是从原文里抠出来的文字（认不出的失败标题等）。 */
export type FailureText = { readonly key: string; readonly params?: Readonly<Record<string, FailureCopyParam>> } | { readonly text: string }

export type GenerationFailureDecision = {
  kind: GenerationErrorKind
  primary: GenerationErrorAction
  secondary: GenerationErrorAction | null
  vendorSide: boolean
  reason: FailureText
  hint: FailureText
  /** 清洗过的供应商原话（有来源证据才有）；与 reason 相同的情况由投影按翻译后的 reason 去掉。 */
  providerMessage?: string
  /** 只有通用未知原因，无可展示的具体说明。 */
  unknownWithoutDetail?: true
  modelKindFix?: { modelKey: string; registered: string; requested: string }
  /** 去掉 IPC 外壳 / 码标记 / 旧 `→ hint` 尾巴后的原文（空原文时为 ''，投影补占位词条）。 */
  raw: string
  /** 确证过的公开错误码（只来自 code 字段或原文里的整词码），没有 = null。 */
  publicCode: string | null
}

export type DecideInput = {
  readonly message: string
  /** 失败对象自带的确证码字段（Error.code / errorCode）。 */
  readonly code?: string
  readonly locale: FailureLocale
  /** pi 判过「瞬时」（断线 / 超时 / 限流 / 5xx）。只有内置助手那一路有这个事实。 */
  readonly transient?: boolean
}

function keyOf(kind: GenerationErrorKind, part: string): string {
  return `generationCommon.observability.error.${ERROR_KEY_BY_KIND[kind]}.${part}`
}

/** 每一类失败的原因 / 说明词条（只返回键）；投影层（界面 i18n）翻译它。 */
export function failureCopyOf(kind: GenerationErrorKind, params?: Record<string, FailureCopyParam>): { reason: FailureText; hint: FailureText } {
  // 本机处理失败：生产者写的那句人话就是标题（带 detail 才用 reasonWithDetail）。
  const reasonPart = kind === 'local-processing' && params?.detail ? 'reasonWithDetail' : 'reason'
  // 认不出的失败：服务商给了错误码就把码带进说明（不编原因，码是用户和我们排查的入口）。
  const hintPart = kind === 'unknown' && params?.code ? 'hintWithCode' : 'hint'
  return {
    reason: { key: keyOf(kind, reasonPart), ...(params ? { params } : {}) },
    hint: kind === 'submission-unknown' ? { text: '' } : { key: keyOf(kind, hintPart), ...(params ? { params } : {}) },
  }
}

// ---------------------------------------------------------------------------
// 判据（原 classifyError.ts，原样搬来；优先序见 decideGenerationFailure）。
// ---------------------------------------------------------------------------


type Draft = Omit<GenerationFailureDecision, 'publicCode'>

/**
 * kind → 完整决定（词条键 + 动作 + 上游原话）。收口原先重复 7 遍的样板：每处都得记着取动作、算 providerMessage、带 raw。
 * `upstream` 只收 vendorOriginatedText 给的、有来源证据的那句；没有（undefined / ''）就不给 providerMessage，原文只在 raw。
 */
function reportFor(
  kind: GenerationErrorKind,
  raw: string,
  upstream: string | undefined,
  params?: Record<string, FailureCopyParam>,
): Draft {
  const copy = failureCopyOf(kind, params)
  const hint: FailureText = (kind === 'asset-upload-failed' || kind === 'asset-too-large') && matchNomiErrorCode(raw) && raw.includes('\n')
    ? { text: stripNomiErrorCode(withoutIpcInvokeWrapper(raw.split('\n')[0])) }
    : copy.hint
  const providerMessage = cleanProviderMessage(upstream)
  // 存进技术详情的 raw 也把 NOMI_ERR:: 码标记剥掉——那是给分类器读的机器标记,不是给人看的。
  // 「是不是服务商那一侧的事」只有类别表一个出处（VENDOR_SIDE_BY_KIND，穷举 Record）。
  return {
    kind, reason: copy.reason, hint, vendorSide: isVendorSideKind(kind), raw: stripNomiErrorCode(raw),
    ...actionsOfKind(kind),
    ...(providerMessage ? { providerMessage } : {}),
    ...(kind === 'unknown' && !providerMessage ? { unknownWithoutDetail: true } : {}),
  }
}

/** 本机拒绝类（没有服务商参与）：自带词条与动作的一档。 */
function localRefusal(reason: FailureText, hint: FailureText, raw: string, actions: { primary: GenerationErrorAction; secondary: GenerationErrorAction | null }): Draft {
  return { kind: 'local-refusal', reason, hint, vendorSide: false, raw, ...actions }
}

function classify(message: string, locale: FailureLocale): Draft {
  // S4-2:structured 优先(VendorRequestError 经 IPC 标记穿透,源头保留的事实,不是猜);
  // 老数据/非 vendor 错误退回 legacy 正则识别。两条路只产 kind,文案统一出自词条键。
  const structured = parseVendorErrorFromMessage(message)
  const cleanRaw = stripVendorErrorMarker(String(message || '')).split('\n→')[0].trim()
  // 供应商说的那句话（能证明来源才有值）：判据、「服务商原话」框、标题的语言规矩都读它，不再各自从 raw 里抠。
  const upstream = vendorOriginatedText(structured, cleanRaw)
  const missingImageReference = detectMissingImageReference(cleanRaw)
  if (missingImageReference) {
    return {
      kind: 'input',
      reason: { key: missingImageReference === 'image_edit' ? 'generationCommon.composer.imageConnectionRequired' : 'generationCommon.composer.videoFirstFrameRequired' },
      hint: { text: '' },
      // 本机在发请求前的护栏：请求没出门，说不上是哪家供应商拒了什么。
      vendorSide: false,
      raw: cleanRaw,
      ...actionsOfKind('input'),
    }
  }
  // Nomi **自己**挂的稳定机器码最先判：必须先于一切「猜文案」的检测，也必须先于 structured.category ——
  // 这些错误里服务商没说过话，upstream 显式给 ''：抑制「服务商说：」框，别栽赃上游。
  const outboundCode = matchNomiErrorCode(cleanRaw)
  if (outboundCode === 'model-config') return reportFor('model-config', cleanRaw, '')
  // 主进程发送前的参考守拒发：请求从未发出，upstream 给 ''（服务商根本没被请求到）。
  if (outboundCode === 'reference-not-in-use') return reportFor('reference-not-in-use', cleanRaw, '')
  // 用户明确选的画幅比例超出连接的尺寸范围：构造请求时就拒了，请求从未发出，upstream 给 ''（别把我们自己那句栽赃成「服务商原话」）。
  if (outboundCode === 'aspect-ratio-unsupported') return reportFor('aspect-ratio-unsupported', cleanRaw, '')
  // 凭据绑定：下一步是「回接入页重新保存密钥」，这台机器的网络一点毛病都没有。
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
  // 已提交、这次没取回（⑬）：任务已经交给服务商，是查 / 读 / 下载 / 等这一次没成——主动作只有「重新取回」，
  // 绝不落进 unknown 被配上「可以重试一次」（= 再生成、再扣一次）。服务商真说过的话（503「无可用渠道」）照旧给；
  // 没有就给 ''，不从正文里抠一句冒充（取回出口写的「Nomi 本机拦下」那句不是服务商说的）。
  // 按族判，不抄码表：新增的 retrieval-* 自动归这里，不会漏到下面被猜文案判成别的。
  if (isRetrievalStageCode(outboundCode)) {
    return reportFor('retrieval-incomplete', cleanRaw, upstream || '')
  }
  // 本机处理失败：没有服务商参与，upstream 给 ''（不印「服务商原话」）；原因就是码后面那句人话，已经在 raw / 标题里。
  if (outboundCode === 'local-processing') {
    // 第一行 = 生产者写的那句人话（标题）；其余行是技术细节，只进「技术详情」。先切行再剥码——剥码会把换行压成空格。
    const detail = stripNomiErrorCode(cleanRaw.split('\n')[0] ?? '')
    return reportFor('local-processing', cleanRaw, '', detail ? { detail } : undefined)
  }
  // 已退役下线**最先**判：判据是 electron 抛的专用签名（确定性事实），不该被任何猜文案的检测抢走——
  // 也不该被下面那条通用的 submission_not_sent 抢走：画布的付费提交把花钱之前的失败统一包成那个码，退役 / 类型不符的
  // 签名正是从这条路抛出来的（findExecutableModel 在 runTask 里），排在它后面，画布上就只剩一张泛泛的「没发出去」+ 重试。
  // upstream 显式给 ''，与下面类型不符 / 缺文本大脑同理：这是我们自己的签名，服务商根本没被请求到
  // （2026-09-29 Sora 2 退役走查抓到过「Model is retired: sora-2」被印成「服务商原话」；没有来源证据的话现在一律不进那一行）。
  if (detectModelRetired(cleanRaw)) return reportFor('model-retired', cleanRaw, '')
  // 类型不符同理是专用签名，同层最先判。upstream 显式给 ''：这是**我们自己**的内部信号，
  // 不是服务商原话——落进「服务商说：」那个框里会是彻头彻尾的栽赃（那家根本没被请求到）。
  const kindMismatch = detectModelKindMismatch(cleanRaw)
  if (kindMismatch) {
    const params = {
      model: kindMismatch.model,
      registered: { modelKind: kindMismatch.registered },
      requested: { modelKind: kindMismatch.requested },
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
  // 主进程的出站证据说「这次付费提交确定没离开本机」（结构化码 submission_not_sent，不认文案）。上面那几条更具体的
  // 本机拒绝（出网策略 / 凭据绑定 / 目录没配好）已经先判了；剩下的：连不上 → network（请求没发到服务商，查网络和代理），
  // 在本机就被拦下 → submission-not-sent。都排在一切「猜文案」的检测之前：这一类没有服务商参与，不许被说成服务商的失败。
  // 参考素材没送出去（读不到、传不上、太大）有自己更具体的卡，说得清下一步。
  if (structured?.code === 'submission_not_sent' && outboundCode !== 'asset-invalid' && outboundCode !== 'asset-upload-failed' && outboundCode !== 'asset-too-large') {
    return reportFor(structured.reason === 'connect_failed' ? 'network' : 'submission-not-sent', cleanRaw, '')
  }
  // 缺可用文本大脑同样是**我们自己**的内部签名（服务商没被请求到）——归 model-config 报人话，
  // upstream='' 抑制「服务商说：」框，别把那句英文散句栽赃给上游（2026-08-25 走查 F5）。
  if (detectNoTextBrain(cleanRaw)) return reportFor('model-config', cleanRaw, '')
  // 账号档位闸（会员/企业 Key/网页授权）先判——它的关键词（会员/授权/开通即梦会员）比
  // model-not-open 更具体；反过来放后面会被宽词抢走（即梦 CLI 兜底文案曾被判成「模型未开通」
  // 并给出火山 Ark 指引，2026-07-06 真机走查抓出）。
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
  // 模型那一侧去拉参考图的临时链接、拉不到（过期 / 防盗链 / 地区限制）：失败在**链接**这一跳。必须先于 category 判——
  // 这类报错常走 HTTP 400 / 422，会被派生成「参数不被接受·检查比例/尺寸」，把人带去改一个并没有错的参数。
  // 判据与主进程记账共用一份（electron/shared/assets/referenceFetchRefusal）。服务商原话照给（上游真说过才有），完整报文在技术详情。
  if (isReferenceFetchRefusal({ upstreamCode: structured?.upstreamCode, text: `${upstream ?? ''}\n${cleanRaw}` })) {
    return reportFor('reference-unfetchable', cleanRaw, upstream)
  }
  // 内容安全拦截先于 category 判——审核拒绝走 HTTP 400，会被派生成「参数不被接受·检查比例/尺寸」
  // 并配一个必然再撞的「重试」（理由见 detectContentModerationTarget）。
  const moderated = detectContentModerationTarget(upstream, cleanRaw)
  if (moderated) {
    return reportFor(moderated === 'image' ? 'input-image-blocked' : 'content-policy', cleanRaw, upstream)
  }
  // 同一节点上一笔还在路上，主进程拒了这一笔（这一次还没发出去）：照实说，不当成供应商失败。
  if (isOpenGenerationRefusal(message)) {
    return localRefusal(
      { key: 'generationCommon.observability.error.nodeInFlight.reason' },
      { text: '' },
      cleanRaw,
      { primary: 'release-regenerate', secondary: 'reconcile' },
    )
  }
  // 升级前留下的批量确认草稿（没记来源节点）：先落节点、再发请求之后主进程不发它，按「没交」收尾——如实说，要他再确认一次。
  if (structured?.code === 'canvas_consent_predates_upgrade') {
    return localRefusal(
      { key: 'generationCommon.observability.error.consentPredatesUpgrade.reason' },
      { key: 'generationCommon.observability.error.consentPredatesUpgrade.hint' },
      cleanRaw,
      { primary: 'retry', secondary: null },
    )
  }
  // 3D-BOX 预演没好，主进程准入拒了这一次（还没发出去、没花钱）：说的是哪一步没好，不当成供应商失败。
  if (structured?.code === 'director_preview_blocked') {
    return localRefusal(
      { key: structured.reason === 'failed' ? 'director.agent.spendBlockedFailed' : 'director.agent.spendBlockedRendering' },
      { key: 'generationCommon.observability.error.previewBlocked.hint' },
      cleanRaw,
      actionsOfKind('local-refusal'),
    )
  }
  const claimReason = structured?.code === 'production_shot_claimed' ? structured.reason : undefined
  const claim = shotClaimCopy(claimReason as Parameters<typeof shotClaimCopy>[0])
  if (claim) {
    return localRefusal(
      { key: `generationCommon.observability.error.shotClaimed.${claim.key}.reason` },
      claimReason === 'needs_reconcile' ? { text: '' } : { key: `generationCommon.observability.error.shotClaimed.${claim.key}.hint` },
      cleanRaw,
      {
        primary: claimReason === 'needs_reconcile' ? 'release-regenerate' : claim.action,
        secondary: claimReason === 'needs_reconcile' ? 'reconcile' : null,
      },
    )
  }
  if (['generation_input_changed', 'storyboard_content_conflict'].includes(structured?.code ?? '')
    || /generation_input_changed|storyboard_content_conflict|Storyboard target changed/.test(cleanRaw)) {
    return { ...reportFor('local-refusal', cleanRaw, ''), reason: { key: 'generationCommon.observability.error.storyboardContentChanged' }, primary: 'retry', secondary: null }
  }
  if (structured?.category && (STRUCTURED_KINDS as readonly string[]).includes(structured.category)) {
    return reportFor(structured.category as GenerationErrorKind, stripVendorErrorMarker(message), upstream)
  }
  if (structured?.category === 'timeout') {
    return reportFor('network', stripVendorErrorMarker(message), upstream)
  }
  // Strip any legacy "\n→ hint" tail that older builds baked into node.error.
  const raw = cleanRaw
  if (raw.includes('网页媒体下载失败')) {
    return {
      kind: 'unknown',
      reason: { key: 'generationCommon.observability.error.webMedia.reason' },
      hint: { key: 'generationCommon.observability.error.webMedia.hint' },
      vendorSide: false,
      raw,
      ...actionsOfKind('unknown'),
    }
  }
  const kind = detectLegacyErrorKind(legacyEvidence(upstream, raw))
  if (kind) return reportFor(kind, raw, upstream)
  // 供应商说的话，只有**和界面同一种语言**才配当标题（读得懂、说得具体）；否则标题是界面语言的一句话，
  // 原话降为「服务商原话」那一格的次要信息（中文界面不再顶着供应商的一整句英文，英文界面同理）。
  // 认不出来源的（可能是我们自己的话）不走这里：照下面抠首行，别把我们自己说得很具体的话换成泛泛的「生成失败」。
  if (upstream) {
    const said = cleanProviderMessage(upstream)
    if (said && isInLocale(said, locale)) {
      return {
        kind: 'unknown',
        reason: { text: truncateLine(said) },
        hint: failureCopyOf('unknown', unknownCopyParams(structured)).hint,
        vendorSide: true, // 供应商说了话（且不是我们认得的任何一类）：它这次失败了
        raw,
        ...actionsOfKind('unknown'),
      }
    }
    return { ...reportFor('unknown', raw, upstream, unknownCopyParams(structured)), vendorSide: true }
  }
  // 兜底:抠 raw 可读首行当 reason,通用建议出自 unknown 词条。
  const readable = extractReadableErrorLine(raw)
  if (!readable || isTechnicalErrorLine(readable)) return reportFor('unknown', raw, undefined, unknownCopyParams(structured))
  return {
    kind: 'unknown',
    reason: { text: truncateLine(readable) },
    hint: failureCopyOf('unknown', unknownCopyParams(structured)).hint,
    // 认不出来源、也没有供应商说的话：可能是我们自己的话（本机护栏 / 内部错误），不点名任何一家。
    vendorSide: false,
    raw,
    ...actionsOfKind('unknown'),
  }
}

/**
 * 唯一的判定入口：原文 + 确证码字段 + 事实（语言、pi 瞬时）→ 类别 / 公开码 / 词条键 / 动作。
 * pi 判过「瞬时」而判据没认出来 → 归到网络类，不让它落进「认不出」（输入事实，不是出口改判）。
 */
export function decideGenerationFailure(input: DecideInput): GenerationFailureDecision {
  const draft = classify(input.message, input.locale)
  const publicCode = confirmPublicError(input.code, input.message).code
  if (draft.kind === 'unknown' && input.transient) {
    const network = reportFor('network', 'network error', undefined)
    return { ...network, raw: draft.raw, ...(draft.providerMessage ? { providerMessage: draft.providerMessage } : {}), publicCode }
  }
  return { ...draft, publicCode }
}

/** Admission races are not generation failures and must not replace the original Run. */
export function isOpenGenerationRefusal(message: string): boolean {
  const error = parseVendorErrorFromMessage(message)
  return error?.code === 'node_generation_in_flight'
    || (error?.code === 'production_shot_claimed' && (error.reason === 'in_flight' || error.reason === 'needs_reconcile'))
    || /node_generation_in_flight|production_shot_claimed:\s*(?:in_flight|needs_reconcile)/.test(message)
}
