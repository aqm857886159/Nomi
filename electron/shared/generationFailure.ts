// 失败分类的**唯一家**（纯共享叶子：不 import src/、i18n、React、桌面桥）。
//
// 「这次失败算哪一类、给什么公开码、说什么（词条键）、能做什么」只在 decideGenerationFailure 判一次；
// 画布 / 分镜 / 任务中心 / 内置助手 / 外部助手各自只做投影（语言、受众、任务来源、pi 瞬时是**输入事实**，不是出口改判）。
// 出口在这之外读 message / code 再自己匹配或覆盖类别、公开码、词条键、动作，由 concept-owners 扫描红掉
// （diagnostics.generation-failure-decision）。词条文字不在这里：界面词条在 src/i18n，外部助手的公开码词条在 generationFailureCopy.ts。
import { isRetrievalStageCode, matchNomiErrorCode, stripNomiErrorCode } from './nomiErrorCodes'
import { isReferenceFetchRefusal } from './assets/referenceFetchRefusal'
import { withoutIpcInvokeWrapper } from './contracts/ipcInvokeFailure'
import { VENDOR_ERROR_IPC_MARKER } from './vendorFailure'
import type { ShotClaimReason } from './decideShotClaim'
import { CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES } from './surfacePortBinding'
import { INTEGRATION_ERROR_CODES } from './integrationContract'
import { GENERATION_INPUT_INVALID_CODE } from './agentCapabilities/admissionRejectionHints'
import { TASK_FAILED_FALLBACK, TOOL_ERROR_HINT, type FailureLocale } from './generationFailureCopy'

export type { FailureLocale } from './generationFailureCopy'

export type GenerationErrorKind =
  | 'auth'
  | 'balance'
  | 'quota'
  | 'poll-timeout'
  | 'network'
  | 'model-config'
  // 「目录里登记的类型 ≠ 这次请求要的类型」。与 model-config 分开是因为它们的**真相不同**：
  // model-config = 真没配好；这条 = 配好了、只是接入时按 id 关键词猜错了类别（guessModelKind
  // 必然有猜错的）。压成同一类的话用户看到「模型未配置」，去那页只会看到一切正常——没有一个字
  // 指向真实缺口，所以没人会去用那个改类型的控件。
  | 'model-kind-mismatch'
  | 'model-not-open'
  | 'model-unavailable-upstream'
  | 'model-retired'
  | 'image-route-disabled'
  | 'account-gate'
  | 'content-policy'
  | 'input-image-blocked'
  | 'asset-upload-failed'
  | 'asset-too-large'
  // 参考素材本身有问题（上传前的本机检查没过）。与 asset-upload-failed 分开：那条是通道没通、
  // 换网络或稍后重试可能就好；这条是**这个文件**不行，重试一万次都一样，得换素材。
  | 'asset-invalid'
  // 参考图走的是服务商的临时链接，**模型那一侧**去拉时拉不到（过期 / 防盗链 / 地区限制）。请求已经发出去了；
  // 与 asset-upload-failed 分开（那条是我们这侧上传没成、服务商没被请求到），也与 input 分开（400 不是「参数不对」）。
  // 下一步先「重试」：重试会尽量改用本机原图上传后再发（这条连接已被记下）；上传过模型还拒绝，就换个模型。判据与记账共用 electron/shared/assets/referenceFetchRefusal。
  | 'reference-unfetchable'
  // 主进程发送前的参考守在花钱之前拒了：请求里带着参考区没在用的图（有入口绕过了唯一推导）。
  // 请求没离开本机；下一步是重新点生成，会按参考区重新组一次请求。不是服务商的事。
  | 'reference-not-in-use'
  // 用户明确选的画幅比例超出这条连接的尺寸范围（electron/catalog/paramTranslate.ts 的 ratioResToOpenAiSize 在构造请求时抛，
  // 机器码 NOMI_ERR::aspect-ratio-unsupported::）。以前这种比例会被悄悄省略 size、让服务商按默认尺寸出图——选的画幅被换成别的。
  // 请求没离开本机；下一步是在生成框里换一个比例再生成（或换一个支持该比例的模型）。不是服务商的事，也不是模型没配好。
  | 'aspect-ratio-unsupported'
  // 请求带着密钥，但目的地不是用户保存这把 key 时确认过的 origin。没有计费，
  // 也没有网络要修——下一步是回接入页重新保存一次密钥（那一页是这条连接地址的唯一家）。
  // （按目的地地址拒绝的 outbound-blocked / outbound-blocked-submit 两类已于 2026-11-13 删掉。）
  | 'outbound-blocked-credential-origin'
  // 带密钥的请求被服务商地址跳转了，Nomi 不跟随（防止自定义鉴权头 / POST 正文被带去另一个网站）。
  // 请求已经到过用户配置的地址，所以不在 NEVER_SENT_KINDS——花没花钱 Nomi 不替它说。
  | 'credential-redirect'
  | 'server'
  | 'input'
  | 'output-truncated'
  // 供应商**已经把结果发回来了**，但 Nomi 在本机没能把这个文件读出来（解码不出画面 / 认不出格式 /
  // 是网页冒充的）。与 unknown 分开：unknown 的说法是「可能是服务商临时故障或额度问题，换一个模型」——
  // 对一份已经送达的产物，那是把我们这一侧读文件失败栽给服务商，还劝用户换一家（2026-09-29 Seedream 5.0）。
  // 机器码 NOMI_ERR::output-unreadable::（electron/assets/generatedMediaDecode.ts 抛），不靠英文句子认。
  | 'output-unreadable'
  // 付费提交发出后没拿到回复（连接被重置 / 响应超时 / 提交途中进程退出）：供应商**可能已经收下**。
  // 与 network 分开：network 说「请求没发到」，对这一类是假话；而且重试 = 可能重复提交，所以不给重试按钮。
  | 'submission-unknown'
  // 付费提交**确定没离开本机**（主进程的出站证据：这次派发一个可能花钱的请求都没交给网络，结构化码 submission_not_sent /
  // never_reached_network）。与 submission-unknown 恰好相反：服务商没收到，可以直接重试；与 network 分开：network 是
  // 连不上服务商，这一条是在本机就停下了（出网策略、本机检查、密钥、网络设置……具体原因在技术详情里）。
  | 'submission-not-sent'
  // 已生成、取回失败（#975 A2，机器码 NOMI_ERR::output-retrieval-failed::）：结果在服务商那边，丢的只是下载。
  // 这条覆盖整个确定性取回失败族，下一步只有「重新取回」。
  | 'output-retrieval-failed'
  // 已提交、这次没取回（机器码 NOMI_ERR::retrieval-query / -parse / -download / -timeout::，⑬ 用户 10-22 拍板）：任务已经交给服务商、
  // 钱已经花了，是查结果 / 读结果 / 下载结果这一次没成，**不知道**服务商那边做完没有（所以不能说成 output-retrieval-failed 的「已经生成」）。
  // 以前分类器不认这四个码，落进 unknown，给「可以重试一次」+ 主动作 retry——再生成、再扣一次。下一步只有「重新取回」。
  | 'retrieval-incomplete'
  // 本机处理失败（机器码 NOMI_ERR::local-processing::）：截帧 / 提取深度 / 本地素材复制——没有服务商参与，所以动作只有「重试」。
  | 'local-processing'
  | 'local-refusal'
  | 'unknown'

/** 目录（generationCommon.observability.error）里每一类失败的词条 key——单源；noChargeClaims.test 也读它。 */
export const ERROR_KEY_BY_KIND: Record<GenerationErrorKind, string> = {
  auth: 'auth',
  balance: 'balance',
  quota: 'quota',
  'poll-timeout': 'pollTimeout',
  network: 'network',
  'model-config': 'modelConfig',
  'model-kind-mismatch': 'modelKindMismatch',
  'model-not-open': 'modelNotOpen',
  'model-unavailable-upstream': 'modelUnavailableUpstream',
  'model-retired': 'modelRetired',
  'image-route-disabled': 'imageRouteDisabled',
  'account-gate': 'accountGate',
  'content-policy': 'contentPolicy',
  'input-image-blocked': 'inputImageBlocked',
  'asset-upload-failed': 'assetUploadFailed',
  'asset-too-large': 'assetTooLarge',
  'asset-invalid': 'assetInvalid',
  'reference-unfetchable': 'referenceUnfetchable',
  'reference-not-in-use': 'referenceNotInUse',
  'aspect-ratio-unsupported': 'aspectRatioUnsupported',
  'outbound-blocked-credential-origin': 'outboundBlockedCredentialOrigin',
  'credential-redirect': 'credentialRedirect',
  server: 'server',
  input: 'input',
  'output-truncated': 'outputTruncated',
  'output-unreadable': 'outputUnreadable',
  'submission-unknown': 'submissionUnknown',
  'submission-not-sent': 'submissionNotSent',
  'output-retrieval-failed': 'outputRetrievalFailed',
  'retrieval-incomplete': 'retrievalIncomplete',
  'local-processing': 'localProcessing',
  'local-refusal': 'localRefusal',
  unknown: 'unknown',
}

// fix-model-kind：**直接把缺口补上**（改类型 + 按新类型重建调用通道），不是又把用户送去某一页
// 自己找。这是这次唯一新增的动作——因为它是唯一一类「我们确切知道哪里错、也确切知道怎么改对」的
// 失败。其余类别我们只知道现象、改不动，所以只能给「去哪儿」或「换一个」。
export type GenerationErrorAction = 'retry' | 'switch-model' | 'switch-same-capability' | 'open-model-access' | 'fix-model-kind' | 'reconcile' | 'view-task' | 'open-recoverable' | 'release-regenerate'

// 每类的主动作 + 次动作都写在表里（2026-09-29 起）。次动作默认是「另一个最可能有用的」：主动作不是重试 →
// 次给重试（想试还能试，不堵死用户）；主动作就是重试 → 次给换模型（等不及就换一家）。下面三个常量就是这条
// 默认；不走默认的类（fix-model-kind、model-retired）在表里直接写出来，不在函数里另开例外。
type GenerationErrorActions = Readonly<{ primary: GenerationErrorAction; secondary: GenerationErrorAction | null }>
const RETRY_FIRST: GenerationErrorActions = { primary: 'retry', secondary: 'switch-model' }
const SWITCH_FIRST: GenerationErrorActions = { primary: 'switch-model', secondary: 'retry' }
const ACCESS_FIRST: GenerationErrorActions = { primary: 'open-model-access', secondary: 'retry' }

const ACTION_BY_KIND: Record<GenerationErrorKind, GenerationErrorActions> = {
  // 换模型才有救：上游/目录层面就没有这个模型，配置和重试都改不了它。
  // 2026-10-06 用户拍板：主按钮直接写出「换成〈同能力里此刻可用的另一个〉」，点一下才换（不自动换、换完不自动跑）；
  // 没有同能力的另一个时，失败卡退回「换个模型」（打开下拉，useSameCapabilityAlternative 返回 null）。
  'model-unavailable-upstream': { primary: 'switch-same-capability', secondary: 'switch-model' },
  // 已下线：目录里整条都没有了，重试必然再撞同一张卡（免费、不出门，但毫无意义）——不给次动作
  // （2026-09-29 协调会话裁决：撤 Sora 2 以后这张卡会被更多人看到）。
  'model-retired': { primary: 'switch-model', secondary: null },
  // 参考图被内容安全挡下：同一张图 + 同一个模型 = 同一个判定，重试是确定性再撞（2026-07-31
  // 用户真机：方舟 Seedance 拒写实人脸参考图）。用户真正的两条路是「换图」和「换模型」，
  // 换图就在画布上（连着的那个节点，不需要按钮），所以按钮给「换个模型」——各家审核松紧不同。
  'input-image-blocked': SWITCH_FIRST,
  // 一键改对：我们知道它登记成了什么、也知道这里要什么，那就别让用户去猜去找（D1 effect-first）。
  // 次动作给「换个模型」而不是「重试」：类型不符是确定性失败，不改就重试一万次都是同一堵墙。
  'model-kind-mismatch': { primary: 'fix-model-kind', secondary: 'switch-model' },
  // 去模型接入：密钥/开通/分组/档位/配置——都在那一页能解。
  auth: ACCESS_FIRST,
  balance: ACCESS_FIRST,
  'model-config': ACCESS_FIRST,
  'model-not-open': ACCESS_FIRST,
  'image-route-disabled': ACCESS_FIRST,
  'account-gate': ACCESS_FIRST,
  // 重试是对的动作：偶发/限流/超时，等一等再来确实可能成。
  // 免费匿名图床挂掉通常是偶发（下一分钟可能就好了），所以主动作仍是重试；
  // 「一劳永逸」那条（接一个自带上传通道的服务商）写在 hint 里，不占按钮。
  'asset-upload-failed': RETRY_FIRST,
  // 素材超过所有通道的上限：**确定性**失败，同一个文件重试一万次都是同一堵墙（还每次都把整个
  // 文件传上去再被拒）。用户真正的路是「换/压缩这个素材」——素材就在画布上连着，不需要按钮，
  // 所以主动作给「换个模型」（换一家上限更高的通道也确实可能过），重试退到次动作。
  'asset-too-large': SWITCH_FIRST,
  // 参考素材本身不行：换素材的地方就在画布上（连着的那个节点，不需要按钮），换好后点重试。
  // 同「改提示词后重试」那两类的理由——按钮只给 retry，改的动作在画布上。
  'asset-invalid': RETRY_FIRST,
  // 先重试：重试会尽量改用本机原图上传，不用换图。上传过模型还拒绝（比如这家拉不到上传通道的地址）时，再点重试只会再失败一次，
  // 换模型是唯一的出口，所以留在次动作。
  'reference-unfetchable': RETRY_FIRST,
  // 请求没离开本机：重新点生成会按参考区重新组请求，主动作就是重试。
  'reference-not-in-use': RETRY_FIRST,
  // 比例超界：换比例的地方就在下方生成框（按钮只给 retry，改的动作在 composer）；该比例确实要用，就换一个支持它的模型。
  'aspect-ratio-unsupported': RETRY_FIRST,
  // 送去模型接入重新保存密钥（hint 里写清）。绝不给 retry 当主动作：
  // 地址没改回来之前，重试一万次都是同一堵墙。
  'outbound-blocked-credential-origin': ACCESS_FIRST,
  // 地址得改（去模型接入改成跳转后的地址）；不改，重试一万次都是同一个跳转。
  'credential-redirect': ACCESS_FIRST,
  quota: RETRY_FIRST,
  'poll-timeout': RETRY_FIRST,
  network: RETRY_FIRST,
  server: RETRY_FIRST,
  // 改提示词/参数后重试（按钮只给 retry，改的地方就在下方 composer）。
  'content-policy': RETRY_FIRST,
  input: RETRY_FIRST,
  'output-truncated': RETRY_FIRST,
  // 只有重试：读不出来发生在我们这一侧，换供应商不是它的解法，更不能把它说成服务商的失败。
  'output-unreadable': { primary: 'retry', secondary: null },
  // 人确认可能再次扣费后发；机器仍然跳过。
  'submission-unknown': { primary: 'release-regenerate', secondary: 'reconcile' },
  // 没发出去：处理好原因后直接重试；等不及就换一个模型（换了也不会和上一次重复，上一次根本没到服务商）。
  'submission-not-sent': RETRY_FIRST,
  // 只指路去任务面板（那里有「重新取回」）。绝不给 retry：重试 = 再生成一份、再花一次钱，而这一份已经做好了。
  'output-retrieval-failed': { primary: 'view-task', secondary: null },
  // 同上：只指路去任务面板「重新取回」。绝不给 retry（= 再生成、再扣一次），也不给换模型（换了也是另一份新的）。
  'retrieval-incomplete': { primary: 'view-task', secondary: null },
  // 本机处理失败：换模型帮不上忙（没有模型参与），只留重试。
  'local-processing': { primary: 'retry', secondary: null },
  'local-refusal': { primary: 'view-task', secondary: null },
  unknown: RETRY_FIRST,
}

/**
 * 这一类失败是不是「服务商那一侧的事」。任何一句点名供应商说「它失败了」的话（切家提示：「某某家：原因。建议」）
 * 都必须先过这一问——我们自己这一侧的失败（读不出产物 / 素材本身不行 / 我们的出站策略拦了 / 目录没配好 / 类型登记错 /
 * 模型已下线 / 输出被截断）点名供应商就是栽赃，换一家也不是它的解法（2026-09-29 pb06：本机判失败之后提示劝换一家）。
 * 穷举 Record：新增一类不回答这个问题 → typecheck 红（同上面的动作表）。
 * `unknown` 例外由分类器按证据定（有供应商说的话才算）——这里只给它一个保守的 false。
 */
const VENDOR_SIDE_BY_KIND: Record<GenerationErrorKind, boolean> = {
  auth: true,
  balance: true,
  quota: true,
  'poll-timeout': true,
  network: true,
  'model-config': false,
  'model-kind-mismatch': false,
  'model-not-open': true,
  'model-unavailable-upstream': true,
  'model-retired': false,
  'image-route-disabled': true,
  'account-gate': true,
  'content-policy': true,
  'input-image-blocked': true,
  'asset-upload-failed': false,
  'asset-too-large': true,
  'asset-invalid': false,
  // 拉不到的是我们给的临时链接，修法在我们这一侧（改用上传）；不点名服务商「失败了」，也不触发「换一家」的切家提示。
  'reference-unfetchable': false,
  'reference-not-in-use': false,
  'aspect-ratio-unsupported': false,
  'outbound-blocked-credential-origin': false,
  'credential-redirect': false,
  server: true,
  input: true,
  'output-truncated': false,
  'output-unreadable': false,
  // 服务商是否收下 Nomi 并不知道，不替它定性（也不触发「换一家」的切家提示）。
  'submission-unknown': false,
  // 服务商根本没被请求到，不点名它。
  'submission-not-sent': false,
  // 失败在 Nomi 取回这一侧（策略 / 对方拒绝下载 / 返回的不是可用文件），不点名服务商「失败了」。
  'output-retrieval-failed': false,
  // 失败在取回这一侧；服务商原话（如 503「无可用渠道」）照旧由分类器单独给，这里不替服务商定性、不触发「换一家」。
  'retrieval-incomplete': false,
  // 全程在本机，没有服务商。
  'local-processing': false,
  'local-refusal': false,
  unknown: false,
}

export function isVendorSideKind(kind: GenerationErrorKind): boolean {
  return VENDOR_SIDE_BY_KIND[kind]
}

/** 全部失败类别——就是上面那张穷举表的键，不另抄一份（单测 / 走查要遍历「目录能说的每一句」时读它）。 */
export const GENERATION_ERROR_KINDS = Object.keys(VENDOR_SIDE_BY_KIND) as readonly GenerationErrorKind[]

/** 主动作 + 次动作（都出自上面那张表）。次动作 `null` = 不摆第二颗按钮。 */
export function actionsOfKind(kind: GenerationErrorKind): {
  primary: GenerationErrorAction
  secondary: GenerationErrorAction | null
} {
  const { primary, secondary } = ACTION_BY_KIND[kind]
  return { primary, secondary }
}

/**
 * 没有可以再查的任务时（2026-10-28）：同步供应商把结果放在创建请求的那一次回答里，Nomi 本机没能把它落进项目——
 * 节点上没有任务号，结果地址也只在那一次回答里，再取一次无从谈起。默认动作 / 说明会把人领去「重新取回」的那几类，
 * 这里给不暗示能取回的那一版：动作按「有没有任务号」选（主动作重试 = 重新生成），说明换成 hintWithoutTask 词条。
 * 不在表里的类照默认。守门：narrateWithoutTask.test 遍历全部类别。
 */
const WITHOUT_TASK_BY_KIND: Readonly<Partial<Record<GenerationErrorKind, GenerationErrorActions & { hintKey: string }>>> = {
  'retrieval-incomplete': { primary: 'retry', secondary: null, hintKey: 'generationCommon.observability.error.retrievalIncomplete.hintWithoutTask' },
  'output-retrieval-failed': { primary: 'retry', secondary: null, hintKey: 'generationCommon.observability.error.retrievalIncomplete.hintWithoutTask' },
}

/** 这一类失败在「没有可以再查的任务」时的说明键与动作；`null` = 照默认。 */
export function withoutTaskOfKind(kind: GenerationErrorKind): { hintKey: string; primary: GenerationErrorAction; secondary: GenerationErrorAction | null } | null {
  const entry = WITHOUT_TASK_BY_KIND[kind]
  return entry ? { hintKey: entry.hintKey, primary: entry.primary, secondary: entry.secondary } : null
}

export type FailureRunFacts = Readonly<{ taskId?: string; productionRunId?: string; isProductionRecord: boolean }>

/**
 * 三个制作页面和任务中心读同一个「失败动作」判据：任务来源决定动作。
 * 没有可再查的任务（无任务号、也不是制作记录）→ 用无任务那一版；有任务号且不是制作 Run → 把「去任务面板」换成「去重新取回」。
 */
export function failureActionsFor(
  decision: Pick<GenerationFailureDecision, 'kind' | 'primary' | 'secondary'>,
  run?: FailureRunFacts,
): { primary: GenerationErrorAction; secondary: GenerationErrorAction | null; hintKey: string | null; canRetry: boolean } {
  const hasTask = Boolean(run?.taskId?.trim())
  const withoutTask = decision.primary !== 'release-regenerate' && !hasTask && !run?.isProductionRecord
    ? withoutTaskOfKind(decision.kind) : null
  const primary = withoutTask?.primary ?? decision.primary
  const secondary = withoutTask ? withoutTask.secondary : decision.secondary
  return {
    primary: primary === 'view-task' && hasTask && !run?.productionRunId ? 'open-recoverable' : primary,
    secondary,
    hintKey: withoutTask?.hintKey ?? null,
    canRetry: primary === 'retry' || secondary === 'retry',
  }
}

/** 镜头被占用的原因 → 词条键 + 动作（原 shotClaimCopy）。 */
export type ShotClaimCopy = {
  key: 'queued' | 'awaitingConfirmation' | 'inFlight' | 'needsReconcile'
  action: 'view-task' | 'reconcile'
}
const SHOT_CLAIM_COPY_BY_REASON: Partial<Record<ShotClaimReason, ShotClaimCopy>> = {
  queued: { key: 'queued', action: 'view-task' },
  awaiting_confirmation: { key: 'awaitingConfirmation', action: 'view-task' },
  in_flight: { key: 'inFlight', action: 'view-task' },
  needs_reconcile: { key: 'needsReconcile', action: 'reconcile' },
}
export function shotClaimCopy(reason: ShotClaimReason | undefined): ShotClaimCopy | undefined {
  return reason ? SHOT_CLAIM_COPY_BY_REASON[reason] : undefined
}

// ---------------------------------------------------------------------------
// 穿 IPC 的结构化载荷 / 异步任务失败格式：唯一的产出、唯一的解析（原 vendorErrorIpc / taskFailureMessage）。
// ---------------------------------------------------------------------------

export type VendorErrorStructuredLite = {
  code?: string
  reason?: string
  vendorKey?: string
  httpStatus?: number
  logicalCode?: number | string
  upstreamMsg?: string
  /** 上游自己给的错误码（`model_not_found` 这一类）；只有响应体里真有才会带。 */
  upstreamCode?: string
  category?: string
  retryable?: boolean
}

/** 从错误 message 中解出 structured;没有标记/解析失败 → null(走 legacy 正则兜底)。 */
export function parseVendorErrorFromMessage(message: string): VendorErrorStructuredLite | null {
  const text = String(message || '')
  const start = text.indexOf(VENDOR_ERROR_IPC_MARKER)
  if (start < 0) return null
  const rest = text.slice(start + VENDOR_ERROR_IPC_MARKER.length)
  const end = rest.indexOf('::')
  if (end < 0) return null
  try {
    // base64 → UTF-8(upstreamMsg 可能是中文,atob 直接产 Latin-1 二进制串,需 TextDecoder)
    const binary = atob(rest.slice(0, end))
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as VendorErrorStructuredLite
  } catch {
    return null
  }
}

/** 展示用:把 message 里的标记段剥掉,只留人读得懂的部分。 */
export function stripVendorErrorMarker(message: string): string {
  const text = String(message || '')
  const start = text.indexOf(VENDOR_ERROR_IPC_MARKER)
  if (start < 0) return text
  const rest = text.slice(start + VENDOR_ERROR_IPC_MARKER.length)
  const end = rest.indexOf(':: ')
  if (end < 0) return text.slice(0, start).trim() || text
  return (text.slice(0, start) + rest.slice(end + 3)).trim()
}

export type TaskFailureIds = { taskId?: string; kind?: string }

/** 产出：`<原话或我们的兜底句> (taskId=…, kind=…)`；没有任何 id 就不带后缀。 */
export function formatTaskFailureMessage(upstream: string, ids: TaskFailureIds, locale: FailureLocale): string {
  const prefix = upstream.trim() || TASK_FAILED_FALLBACK[locale]
  const suffix = [ids.taskId ? `taskId=${ids.taskId}` : '', ids.kind ? `kind=${ids.kind}` : ''].filter(Boolean).join(', ')
  return suffix ? `${prefix} (${suffix})` : prefix
}

const TASK_FAILURE_SUFFIX = /^([\s\S]+?) \(((?:taskId=[^,()]*)?(?:, )?(?:kind=[^,()]*)?)\)$/

/**
 * 解析：是这个形状 → 返回**供应商说的那句话**（没说就是 ''，兜底句不算它说的）；不是 → null。
 * 后缀里必须真有 `taskId=` 或 `kind=`，一句碰巧以括号收尾的人话不会被误认。
 */
export function parseTaskFailureMessage(message: string): { upstream: string } | null {
  const match = TASK_FAILURE_SUFFIX.exec(String(message || '').trim())
  if (!match || !/^(?:taskId=|kind=)/.test(match[2])) return null
  const prefix = match[1].trim()
  // 兜底句是我们自己的话（两种语言都认），不算供应商说的。
  return { upstream: Object.values(TASK_FAILED_FALLBACK).includes(prefix) ? '' : prefix }
}

// ---------------------------------------------------------------------------
// 公开错误码（外部助手 MCP 的 errorCode）：只认**确证**的码。
// ---------------------------------------------------------------------------

/** 资源找不到那一档：码本身就是全部公开信息，不带任何私有路径/供应商原文。 */
const NOT_FOUND_CODES = [
  'node_not_found', 'unknown_node_kind', 'invalid_edge_mode', 'document_not_found', 'project_not_found',
] as const

/** 项目会话那一档：得重选项目 / 重开会话。 */
const PROJECT_SESSION_CODES = [
  'project_session_unavailable', 'project_selection_denied',
  'lease_required', 'lease_invalid', 'lease_expired', 'lease_revoked', 'project_scope_changed',
] as const

/**
 * 这些带类型的失败可能包着私有的磁盘 / 供应商原因；码本身就是它们全部的公开信息。
 * 传输层码表只从 owner spread，本文件只列自己这一层独有的分档。
 */
const SAFE_CANVAS_READ_CODES: ReadonlySet<string> = new Set<string>([
  ...CAPABILITY_TRANSPORT_PUBLIC_ERROR_CODES,
  ...NOT_FOUND_CODES,
])

/** 准入层拒绝码（`ParameterRejectionCode` + 画布模型身份）。 */
const ADMISSION_CODES = [
  'unknown_parameter', 'parameter_type_mismatch', 'parameter_not_in_enum',
  'parameter_out_of_range', 'missing_required_parameter', 'unknown_variant',
  'contract_invalid', 'unknown_model_identity', 'ambiguous_model_vendor', GENERATION_INPUT_INVALID_CODE,
] as const

const POLICY_CODES: ReadonlySet<string> = new Set<string>([
  ...ADMISSION_CODES,
  ...SAFE_CANVAS_READ_CODES,
  ...PROJECT_SESSION_CODES,
  ...INTEGRATION_ERROR_CODES,
  'mcp_connection_unauthenticated',
  // `feature_disabled` / `phase_not_ready` 随 env flag 与三段式 rollout 删除，不再是策略码。
  'legacy_path_forbidden', 'not_ready',
  'human_approval_required', 'receipt_invalid', 'receipt_expired',
])

const CODE_IN_TEXT = /(?<![A-Za-z0-9_])[A-Za-z0-9_]+(?![A-Za-z0-9_])/g

export type PublicError = {
  /** 确证过的码；没有 = null。 */
  code: string | null
  /** 码来自失败对象自带的 code 字段，且是登记过的策略码（带 nextAction / capability 透传）。 */
  policy: boolean
  /** 这个码本身就是全部公开信息（message 只留码）。 */
  codeOnly: boolean
}

/** 外部助手认得的全部公开码（字段里能被确证的码 ∪ 有词条的码）。快照测试钉住：增删公开码是显式决定，不是搬家的副产品。 */
export const PUBLIC_ERROR_CODES: readonly string[] = [...new Set<string>([...POLICY_CODES, ...Object.keys(TOOL_ERROR_HINT)])].sort()

const isHintedCode = (code: string): boolean => Object.prototype.hasOwnProperty.call(TOOL_ERROR_HINT, code)

/**
 * 确证码：① 失败对象自带的 code 字段，在登记表（策略码 ∪ 有词条的码）里；② 否则原文里的**整词**码，取**最先出现**的那一个
 * （包装错误外层通常在前，最先出现的就是最贴近调用方能做的那一步；不按表序，也不当子串）。
 * `not_node_not_found_extra` 不是 `node_not_found`；`unknown_model_identity node_not_found` 认 `unknown_model_identity`。
 */
export function confirmPublicError(code: string | undefined, message: string): PublicError {
  const field = typeof code === 'string' && (POLICY_CODES.has(code) || isHintedCode(code)) ? code : null
  const inText = field ? null : (String(message).match(CODE_IN_TEXT) ?? []).find(isHintedCode) ?? null
  const confirmed = field ?? inText
  return {
    code: confirmed,
    policy: Boolean(field && POLICY_CODES.has(field)),
    codeOnly: Boolean(field && SAFE_CANVAS_READ_CODES.has(field)),
  }
}

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

function cleanProviderMessage(candidate: string | undefined): string {
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
function extractReadableErrorLine(raw: string): string {
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
function unknownCopyParams(structured: VendorErrorStructuredLite | null): Record<string, string> | undefined {
  const logical = structured?.logicalCode === undefined || structured.logicalCode === '' ? '' : String(structured.logicalCode)
  const code = structured?.upstreamCode || logical
  return code ? { code } : undefined
}

function truncateLine(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 100 ? `${clean.slice(0, 99)}…` : clean
}

const STRUCTURED_KINDS: readonly GenerationErrorKind[] = ['auth', 'balance', 'quota', 'network', 'server', 'input']

function detectMissingImageReference(raw: string): 'image_edit' | 'image_to_video' | null {
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
 * **供应商说的那句话**（任何语言），能证明它是供应商说的才给：主进程结构化载荷里的 `upstreamMsg`，且载荷记着服务商这次
 * **回了话**（见 vendorAnswered）；或异步任务失败那个只由我们产出的格式（taskFailureMessage）。认不出来源的一律 `undefined`：
 * 那可能是我们自己的话（中文硬编码的 throw、内部英文错误、本机网络层的报错），不能被当成「服务商原话」或按供应商的语言规矩处理。
 */
function vendorOriginatedText(structured: VendorErrorStructuredLite | null, raw: string): string | undefined {
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


/** 这句话是不是界面当前语言的话：中文界面要有汉字，英文界面不能有（数字 / 符号 / 代码串在中文界面里算「不是中文」）。 */
function isInLocale(text: string, locale: FailureLocale): boolean {
  const hasHan = /[㐀-鿿]/.test(text)
  return locale === 'zh-CN' ? hasHan : !hasHan
}

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
  return { kind, reason: copy.reason, hint, vendorSide: isVendorSideKind(kind), raw: stripNomiErrorCode(raw), ...actionsOfKind(kind), ...(providerMessage ? { providerMessage } : {}) }
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
  return {
    kind: 'unknown',
    reason: readable ? { text: readable } : failureCopyOf('unknown').reason,
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
