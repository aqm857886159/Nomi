// 人话翻译层(harness 总方案 §7.2:narrate 穷举注册表)。
// 纪律:进度/错误展示组件**只准经 narrate 取文案**,字面量文案 = review 必拒;
// Record 穷举 → 新增 phase 不补人话直接 typecheck 红(结构性防"底层在动、界面失语")。
// S2 先覆盖生成进度域;错误 hint(classifyGenerationError 七段)按总方案在 S4 迁入。
// 设计系统铁律呼应:No fake progress——没有真实百分比就不给 percent,用"已等 N 秒"说真话。
import i18n from '../../i18n'

export type GenerationProgressPhase =
  | 'queued' //      已入队,还没开始
  | 'resolving' //   正在确认模型与参数(catalog 解析)
  | 'requesting' //  正在把任务发给模型(vendor HTTP 出门)
  | 'waiting' //     模型已接单,排队中(拿到 taskId,首个非终态)
  | 'generating' //  模型生成中(轮询进行时)
  | 'still-generating' // 超过常规时长仍在生成(软超时后,后台继续等结果)
  | 'retrying' //    网络波动重试中
  | 'finalizing' //  正在保存结果(本地化/归一)
  | 'comfyui-node' // ComfyUI ws 逐节点进度(P 轨:真实百分比,不违背 No fake progress)
  | 'comfyui-queued' // ComfyUI 服务器队列排队中(ws status + /queue 位次)

export type ProgressNarrationContext = {
  elapsedMs?: number
  attempt?: number
  maxAttempts?: number
  /** comfyui-node：当前执行的节点 class + 第几/共几个。 */
  currentClass?: string
  startedNodes?: number
  totalNodes?: number
  /** comfyui-queued：前面还有几个任务。 */
  queueAhead?: number
}

/** C1: backend stages stay stable; this is the sole user-facing phase vocabulary. */
export type GenerationFeedbackPhase = 'queued' | 'submitting' | 'generating' | 'finalizing' | 'failed'

export const GENERATION_PHASE: Record<GenerationProgressPhase, GenerationFeedbackPhase> = {
  queued: 'queued',
  'comfyui-queued': 'queued',
  resolving: 'submitting',
  requesting: 'submitting',
  waiting: 'submitting',
  generating: 'generating',
  'still-generating': 'generating',
  retrying: 'generating',
  'comfyui-node': 'generating',
  finalizing: 'finalizing',
}

export function isGenerationProgressStage(value: string | undefined): value is GenerationProgressPhase {
  return value !== undefined && Object.prototype.hasOwnProperty.call(GENERATION_PHASE, value)
}

function queuedNarration(ctx: ProgressNarrationContext): string {
  return Number.isInteger(ctx.queueAhead) && ctx.queueAhead! >= 0
    ? i18n.t('generationCommon.observability.progress.comfyQueuedAhead', { count: ctx.queueAhead })
    : i18n.t('generationCommon.observability.progress.queued')
}

function generatingNarration(ctx: ProgressNarrationContext): string {
  return typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs) && ctx.elapsedMs >= 0
    ? i18n.t('generationCommon.observability.progress.generatingElapsed', { seconds: Math.floor(ctx.elapsedMs / 1000) })
    : i18n.t('generationCommon.observability.progress.generating')
}

const NARRATE_PROGRESS: Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string> = {
  queued: queuedNarration,
  resolving: () => i18n.t('generationCommon.observability.progress.submitting'),
  requesting: () => i18n.t('generationCommon.observability.progress.submitting'),
  waiting: () => i18n.t('generationCommon.observability.progress.submitting'),
  generating: generatingNarration,
  'still-generating': (ctx) => typeof ctx.elapsedMs === 'number' && Number.isFinite(ctx.elapsedMs)
    ? i18n.t('generationCommon.observability.progress.stillGeneratingElapsed', { minutes: Math.max(0, Math.floor(ctx.elapsedMs / 60000)) })
    : i18n.t('generationCommon.observability.progress.stillGenerating'),
  retrying: generatingNarration,
  finalizing: () => i18n.t('generationCommon.observability.progress.finalizing'),
  'comfyui-node': generatingNarration,
  'comfyui-queued': queuedNarration,
}

export function narrateProgress(stage: GenerationProgressPhase, ctx: ProgressNarrationContext = {}): string {
  return NARRATE_PROGRESS[stage](ctx)
}

// ---------------------------------------------------------------------------
// 生成错误词表(S4-2:classifyGenerationError 的唯一文案来源)。
// structured 路径(VendorRequestError.category 查表)与 legacy 正则路径都只产 kind,
// 文案在这一张表里——reason/hint 永不散落第二处(P1)。
// ---------------------------------------------------------------------------

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
  // Nomi 自己的出站安全策略把取片拦下了（私网/回环/fake-ip 未确证）。与 network 分开，因为
  // 它的**真相和下一步都不同**：network = 上游或线路偶发，等一等重试可能就好；这条是**确定性**
  // 的自我拒绝（同一个 URL 重试一万次都是同一堵墙），而且任务**已经付过钱**——正确的动作是去
  // 网络设置确认代理，然后**免费重新拉取**，不是再生成一次再付一次钱。
  | 'outbound-blocked'
  // 同族的**提交侧**：策略在付费请求发出**之前**拒了它。与上面一条分家的理由是「钱怎么样了」相反：
  // 请求从未离开本机 → 没有计费、也没有可找回的 taskId，所以下一步是「修网络后重新生成」（免费），
  // 而不是「免费重新拉取」（那需要一个已经存在的任务）。
  | 'outbound-blocked-submit'
  // 同族第三条：请求带着密钥，但目的地不是用户保存这把 key 时确认过的 origin。没有计费，
  // 也没有网络要修——下一步是回接入页重新保存一次密钥（那一页是这条连接地址的唯一家）。
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
  // 与 outbound-blocked 分开：那条的下一步是去看网络；这条覆盖整个确定性取回失败族，下一步只有「重新取回」。
  | 'output-retrieval-failed'
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
  'outbound-blocked': 'outboundBlocked',
  'outbound-blocked-submit': 'outboundBlockedSubmit',
  'outbound-blocked-credential-origin': 'outboundBlockedCredentialOrigin',
  'credential-redirect': 'credentialRedirect',
  server: 'server',
  input: 'input',
  'output-truncated': 'outputTruncated',
  'output-unreadable': 'outputUnreadable',
  'submission-unknown': 'submissionUnknown',
  'submission-not-sent': 'submissionNotSent',
  'output-retrieval-failed': 'outputRetrievalFailed',
  unknown: 'unknown',
}

/**
 * `params` 给需要说出**具体事实**的类别插值（目前只有 model-kind-mismatch：要说清「哪个模型、
 * 登记成什么、这里要什么」）。泛泛一句「类型不对」等于没说——用户得知道改成哪个才算数。
 * 不需要插值的类别原样返回，词表仍是唯一文案来源（P1）。
 */
export function narrateGenerationError(
  kind: GenerationErrorKind,
  params?: Record<string, string>,
): { reason: string; hint: string } {
  const key = ERROR_KEY_BY_KIND[kind]
  const reason = i18n.t(`generationCommon.observability.error.${key}.reason`, params)
  // 认不出的失败：服务商给了错误码就把码带进说明（不编原因，码是用户和我们排查的入口）。
  const hintKey = kind === 'unknown' && params?.code ? 'hintWithCode' : 'hint'
  return {
    // 标题只说失败的原因，不附「未计费」：现在都走中转站，扣没扣钱 Nomi 不知道，只说失败原因和下一步。
    reason,
    hint: i18n.t(`generationCommon.observability.error.${key}.${hintKey}`, params),
  }
}

/** kind → 人话类别名（「图片」「视频」…）。单源复用 runtime 词表，错误卡与空目录提示说法一致。 */
export function narrateModelKind(kind: string): string {
  return i18n.t(`runtime.modelCatalog.kind.${kind}` as 'runtime.modelCatalog.kind.image', {
    defaultValue: kind,
  })
}

// ---------------------------------------------------------------------------
// 每类错误的「下一步动作」（2026-07-30 用户拍板）。
//
// 病根：错误卡的主按钮一律是「重试」——可确定性失败（上游没这个模型 / Key 无效 / 模型已下线）
// 重试一万次都是同样结果，那个红按钮在骗用户。分类器早能分 15 类，却没有一类说得出「该干嘛」。
//
// 穷举 Record：新增错误类不补动作 → typecheck 直接红（同 NARRATE_PROGRESS 的结构性防失语纪律）。
// 只有三种动作，因为只有这三件事用户真做得到；「改提示词」不设按钮——提示词框本来就在错误卡
// 正下方、一直可编辑，加个按钮是多余（R2：好产品不靠按钮解释），那两类的动作给 retry。
// ---------------------------------------------------------------------------

// fix-model-kind：**直接把缺口补上**（改类型 + 按新类型重建调用通道），不是又把用户送去某一页
// 自己找。这是这次唯一新增的动作——因为它是唯一一类「我们确切知道哪里错、也确切知道怎么改对」的
// 失败。其余类别我们只知道现象、改不动，所以只能给「去哪儿」或「换一个」。
export type GenerationErrorAction = 'retry' | 'switch-model' | 'open-model-access' | 'fix-model-kind' | 'reconcile' | 'view-task' | 'release-regenerate'

// 每类的主动作 + 次动作都写在表里（2026-09-29 起）。次动作默认是「另一个最可能有用的」：主动作不是重试 →
// 次给重试（想试还能试，不堵死用户）；主动作就是重试 → 次给换模型（等不及就换一家）。下面三个常量就是这条
// 默认；不走默认的类（fix-model-kind、model-retired）在表里直接写出来，不在函数里另开例外。
type GenerationErrorActions = Readonly<{ primary: GenerationErrorAction; secondary: GenerationErrorAction | null }>
const RETRY_FIRST: GenerationErrorActions = { primary: 'retry', secondary: 'switch-model' }
const SWITCH_FIRST: GenerationErrorActions = { primary: 'switch-model', secondary: 'retry' }
const ACCESS_FIRST: GenerationErrorActions = { primary: 'open-model-access', secondary: 'retry' }

const ACTION_BY_KIND: Record<GenerationErrorKind, GenerationErrorActions> = {
  // 换模型才有救：上游/目录层面就没有这个模型，配置和重试都改不了它。
  'model-unavailable-upstream': SWITCH_FIRST,
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
  // 「去模型接入」正是网络那一行的家（NetworkSection 就住在模型设置抽屉里）。绝不给 retry：
  // 重试 = 再生成 = 再扣一次钱，而这次的钱根本没丢，只是产物还没取回来。
  'outbound-blocked': ACCESS_FIRST,
  // 同样把用户送去网络那一行（NetworkSection 就住在模型接入抽屉里）。这一条的次动作是 retry，
  // 而且这次的 retry 是**诚实的**：请求从未发出、没有计费，修好网络后重来一次不多花一分钱。
  'outbound-blocked-submit': ACCESS_FIRST,
  // 同样送去模型接入——但要做的是**重新保存密钥**，不是看代理（hint 里写清）。绝不给 retry 当主动作：
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
  // 不给一键重试：这一镜可能已经被服务商收下，重试可能重复提交。次动作「我核对过了，重新生成」点下去先展开一段确认，
  // 确认后只释放占用、再走正常的付费确认卡；主动作指路去任务中心看这一笔的时间 / 模型 / 服务商。
  'submission-unknown': { primary: 'reconcile', secondary: 'release-regenerate' },
  // 没发出去：处理好原因后直接重试；等不及就换一个模型（换了也不会和上一次重复，上一次根本没到服务商）。
  'submission-not-sent': RETRY_FIRST,
  // 只指路去任务面板（那里有「重新取回」）。绝不给 retry：重试 = 再生成一份、再花一次钱，而这一份已经做好了。
  'output-retrieval-failed': { primary: 'view-task', secondary: null },
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
  'outbound-blocked': false,
  'outbound-blocked-submit': false,
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
  unknown: false,
}

export function narrateIsVendorSideFailure(kind: GenerationErrorKind): boolean {
  return VENDOR_SIDE_BY_KIND[kind]
}

/** 全部失败类别——就是上面那张穷举表的键，不另抄一份（单测 / 走查要遍历「目录能说的每一句」时读它）。 */
export const GENERATION_ERROR_KINDS = Object.keys(VENDOR_SIDE_BY_KIND) as readonly GenerationErrorKind[]

/** 主动作 + 次动作（都出自上面那张表）。次动作 `null` = 不摆第二颗按钮。 */
export function narrateGenerationErrorActions(kind: GenerationErrorKind): {
  primary: GenerationErrorAction
  secondary: GenerationErrorAction | null
} {
  const { primary, secondary } = ACTION_BY_KIND[kind]
  return { primary, secondary }
}

const ACTION_KEY: Record<GenerationErrorAction, string> = {
  'switch-model': 'switchModel',
  'open-model-access': 'modelAccess',
  'fix-model-kind': 'fixModelKind',
  retry: 'retry',
  reconcile: 'reconcile',
  'view-task': 'viewTask',
  'release-regenerate': 'releaseRegenerate',
}

/** 动作按钮文案（次动作用 `.alt` 变体，如「仍要重试」——避免和主按钮读起来一样重）。
 *  `params` 供需要点名的动作插值（fix-model-kind 要说「改成**图片**」，光说「改类型」用户还得再想一步）。 */
export function narrateErrorActionLabel(
  action: GenerationErrorAction,
  variant: 'primary' | 'secondary',
  params?: Record<string, string>,
): string {
  return i18n.t(
    `generationCommon.observability.action.${ACTION_KEY[action]}.${variant === 'secondary' ? 'alt' : 'main'}`,
    params,
  )
}

/** Queue history outcomes stay in the narration owner too; cancellation is not failure. */
export function narrateTaskOutcome(state: string, recoverable = false): string {
  if (recoverable) return i18n.t('taskCenter.row.recoverable')
  if (state === 'cancelled') return i18n.t('taskCenter.row.cancelled')
  if (state === 'error') return i18n.t('taskCenter.row.failed')
  if (state === 'success') return i18n.t('generationCommon.observability.progress.saved')
  return narrateProgress(state === 'queued' ? 'queued' : 'generating')
}
