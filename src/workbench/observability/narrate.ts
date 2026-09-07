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

const NARRATE_PROGRESS: Record<GenerationProgressPhase, (ctx: ProgressNarrationContext) => string> = {
  queued: () => i18n.t('generationCommon.observability.progress.queued'),
  resolving: () => i18n.t('generationCommon.observability.progress.resolving'),
  requesting: () => i18n.t('generationCommon.observability.progress.requesting'),
  waiting: () => i18n.t('generationCommon.observability.progress.waiting'),
  generating: (ctx) =>
    typeof ctx.elapsedMs === 'number' && ctx.elapsedMs >= 5000
      ? i18n.t('generationCommon.observability.progress.generatingElapsed', {
          seconds: Math.round(ctx.elapsedMs / 1000),
        })
      : i18n.t('generationCommon.observability.progress.generating'),
  // 软超时后:视频较慢仍在跑,后台继续等。说真话(已等 N 分钟),不假装快完成。
  'still-generating': (ctx) =>
    typeof ctx.elapsedMs === 'number'
      ? i18n.t('generationCommon.observability.progress.stillGeneratingElapsed', {
          minutes: Math.round(ctx.elapsedMs / 60000),
        })
      : i18n.t('generationCommon.observability.progress.stillGenerating'),
  retrying: (ctx) =>
    ctx.attempt && ctx.maxAttempts
      ? i18n.t('generationCommon.observability.progress.retryingAttempt', {
          attempt: ctx.attempt,
          maxAttempts: ctx.maxAttempts,
        })
      : i18n.t('generationCommon.observability.progress.retrying'),
  finalizing: () => i18n.t('generationCommon.observability.progress.finalizing'),
  'comfyui-node': (ctx) =>
    ctx.currentClass && ctx.startedNodes && ctx.totalNodes
      ? i18n.t('generationCommon.observability.progress.comfyNodeAt', {
          cls: ctx.currentClass,
          current: ctx.startedNodes,
          total: ctx.totalNodes,
        })
      : i18n.t('generationCommon.observability.progress.comfyNode'),
  'comfyui-queued': (ctx) =>
    typeof ctx.queueAhead === 'number'
      ? i18n.t('generationCommon.observability.progress.comfyQueuedAhead', { count: ctx.queueAhead })
      : i18n.t('generationCommon.observability.progress.comfyQueued'),
}

export function narrateProgress(phase: GenerationProgressPhase, ctx: ProgressNarrationContext = {}): string {
  return NARRATE_PROGRESS[phase](ctx)
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
  // Nomi 自己的出站安全策略把取片拦下了（私网/回环/fake-ip 未确证）。与 network 分开，因为
  // 它的**真相和下一步都不同**：network = 上游或线路偶发，等一等重试可能就好；这条是**确定性**
  // 的自我拒绝（同一个 URL 重试一万次都是同一堵墙），而且任务**已经付过钱**——正确的动作是去
  // 网络设置确认代理，然后**免费重新拉取**，不是再生成一次再付一次钱。
  | 'outbound-blocked'
  // 同族的**提交侧**：策略在付费请求发出**之前**拒了它。与上面一条分家的理由是「钱怎么样了」相反：
  // 请求从未离开本机 → 没有计费、也没有可找回的 taskId，所以下一步是「修网络后重新生成」（免费），
  // 而不是「免费重新拉取」（那需要一个已经存在的任务）。
  | 'outbound-blocked-submit'
  | 'server'
  | 'input'
  | 'output-truncated'
  | 'unknown'

const ERROR_KEY_BY_KIND: Record<GenerationErrorKind, string> = {
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
  'outbound-blocked': 'outboundBlocked',
  'outbound-blocked-submit': 'outboundBlockedSubmit',
  server: 'server',
  input: 'input',
  'output-truncated': 'outputTruncated',
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
  return {
    reason: i18n.t(`generationCommon.observability.error.${key}.reason`, params),
    hint: i18n.t(`generationCommon.observability.error.${key}.hint`, params),
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
export type GenerationErrorAction = 'retry' | 'switch-model' | 'open-model-access' | 'fix-model-kind'

const ACTION_BY_KIND: Record<GenerationErrorKind, GenerationErrorAction> = {
  // 换模型才有救：上游/目录层面就没有这个模型，配置和重试都改不了它。
  'model-unavailable-upstream': 'switch-model',
  'model-retired': 'switch-model',
  // 参考图被内容安全挡下：同一张图 + 同一个模型 = 同一个判定，重试是确定性再撞（2026-07-31
  // 用户真机：方舟 Seedance 拒写实人脸参考图）。用户真正的两条路是「换图」和「换模型」，
  // 换图就在画布上（连着的那个节点，不需要按钮），所以按钮给「换个模型」——各家审核松紧不同。
  'input-image-blocked': 'switch-model',
  // 一键改对：我们知道它登记成了什么、也知道这里要什么，那就别让用户去猜去找（D1 effect-first）。
  'model-kind-mismatch': 'fix-model-kind',
  // 去模型接入：密钥/开通/分组/档位/配置——都在那一页能解。
  auth: 'open-model-access',
  balance: 'open-model-access',
  'model-config': 'open-model-access',
  'model-not-open': 'open-model-access',
  'image-route-disabled': 'open-model-access',
  'account-gate': 'open-model-access',
  // 重试是对的动作：偶发/限流/超时，等一等再来确实可能成。
  // 免费匿名图床挂掉通常是偶发（下一分钟可能就好了），所以主动作仍是重试；
  // 「一劳永逸」那条（接一个自带上传通道的服务商）写在 hint 里，不占按钮。
  'asset-upload-failed': 'retry',
  // 素材超过所有通道的上限：**确定性**失败，同一个文件重试一万次都是同一堵墙（还每次都把整个
  // 文件传上去再被拒）。用户真正的路是「换/压缩这个素材」——素材就在画布上连着，不需要按钮，
  // 所以主动作给「换个模型」（换一家上限更高的通道也确实可能过），重试退到次动作。
  'asset-too-large': 'switch-model',
  // 「去模型接入」正是网络那一行的家（NetworkSection 就住在模型设置抽屉里）。绝不给 retry：
  // 重试 = 再生成 = 再扣一次钱，而这次的钱根本没丢，只是产物还没取回来。
  'outbound-blocked': 'open-model-access',
  // 同样把用户送去网络那一行（NetworkSection 就住在模型接入抽屉里）。这一条的次动作是 retry，
  // 而且这次的 retry 是**诚实的**：请求从未发出、没有计费，修好网络后重来一次不多花一分钱。
  'outbound-blocked-submit': 'open-model-access',
  quota: 'retry',
  'poll-timeout': 'retry',
  network: 'retry',
  server: 'retry',
  // 改提示词/参数后重试（按钮只给 retry，改的地方就在下方 composer）。
  'content-policy': 'retry',
  input: 'retry',
  'output-truncated': 'retry',
  unknown: 'retry',
}

/**
 * 主动作 + 次动作。次动作恒为「另一个最可能有用的」：主动作不是重试 → 次给重试（想试还能试，
 * 不堵死用户）；主动作就是重试 → 次给换模型（等不及就换一家）。
 *
 * 例外 fix-model-kind：次动作给「换个模型」而不是「重试」。类型不符是**确定性**失败，不改就重试
 * 一万次都是同一堵墙——把重试摆在旁边等于再骗一次（同 model-retired 的理由）。
 */
export function narrateGenerationErrorActions(kind: GenerationErrorKind): {
  primary: GenerationErrorAction
  secondary: GenerationErrorAction
} {
  const primary = ACTION_BY_KIND[kind]
  return { primary, secondary: primary === 'retry' || primary === 'fix-model-kind' ? 'switch-model' : 'retry' }
}

const ACTION_KEY: Record<GenerationErrorAction, string> = {
  'switch-model': 'switchModel',
  'open-model-access': 'modelAccess',
  'fix-model-kind': 'fixModelKind',
  retry: 'retry',
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
