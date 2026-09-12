import type { CanvasWriteApprovalAuthority } from '../agentCapabilities/transportContracts'
// Agent lane · 中立契约层（阶段 1 影子期）
//
// 这一层是渲染进程与主进程**唯一**共同认识的东西。它刻意不认识 pi：pi 的类型只在
// `electron/agentLane/*.mts` 那个 ESM 岛里出现，越过这道门就只剩下面这几个结构。
// 分层理由与同层的 `electron/shared/agentCapabilities/transportContracts.ts` 同源（`electron/` → `src/` 的
// 依赖方向铁律，`check:boundaries` 只放行 `electron/shared/`）。
//
// **本层最重要的一个字段是 `sequence`。** 今天面板的顺序是渲染层用 `createdAt` + 数组
// 下标排出来的（`agentPanelV4Projection.sortedItems()`），也就是说「先说什么后做什么」
// 这件事在系统里是**推断出来的**。新通路里它是**记下来的**：pi 的 lane transcript 本身
// 就有序，主进程按走序赋 `sequence`，下游任何一层都不许再排一次（方案 §2.2 不变量 I1）。

import type { NomiModelConfig } from './laneModelConfig'
import type { LaneLegacyFacts } from './laneLegacyNote'
import type { ProjectAgentAttachmentClaim } from '../workbenchInput'

/** 一段 = 模型一轮回复里的一个小块，或转录里的一条记录。顺序由 `sequence` 唯一决定。 */
export interface LanePartIdentity {
  /**
   * 这一段在这条 lane 转录里的位置。**唯一的顺序真相。**
   * 由主进程按 pi 转录的走序赋值，冷重启后重放同一条转录得到同一串数字。
   */
  readonly sequence: number
  /** 这一段所属条目在 pi 存储里的序号（`Entry.seq`）。用来 join 与排错，**不用来排序**。 */
  readonly entrySeq: number
  /**
   * 这一段在那条助手消息 `content` 数组里的下标——pi 的 `contentIndex`（探针报告 §5.1）。
   * 不属于某条助手消息的段（用户气泡 / 工具结果 / 宿主记录）恒为 0。
   */
  readonly contentIndex: number
}

export type LanePart =
  | (LanePartIdentity & { readonly kind: 'error'; readonly text: string })
  | (LanePartIdentity & {
      readonly kind: 'user'
      readonly text: string
      /**
       * 用户发这句话时挂着的技能。**它是转录里已经有的事实**（`LaneInputMessage.context.skillKey`
       * 由 pi 的自定义消息一起落盘），这里只是把它从消息体里拿到段上——不是第二份真相。
       *
       * 为什么必须上屏：技能是「这一轮按哪套方法做」的唯一开关，而选完之后
       * 对话里一个字都看不到它，用户只能猜「到底用上没有」（2026-09-10 用户反馈 #6）。
       */
      readonly skillKey?: string
    })
  | (LanePartIdentity & { readonly kind: 'assistant-text'; readonly text: string; readonly streaming: boolean; readonly interrupted?: true; readonly continuationEntryId?: string })
  | (LanePartIdentity & { readonly kind: 'thinking'; readonly text: string; readonly streaming: boolean })
  | (LanePartIdentity & {
      readonly kind: 'tool-call'
      readonly toolCallId: string
      readonly toolName: string
      readonly args: unknown
      /** 工具已经开跑、结果还没落定（来自 `LaneSnapshot.operation.runningTools`）。 */
      readonly running: boolean
    })
  | (LanePartIdentity & {
      readonly kind: 'tool-result'
      readonly toolCallId: string
      readonly toolName: string
      readonly text: string
      readonly isError: boolean
    })
  | (LanePartIdentity & {
      /**
       * 宿主领域记录，经 `appendCustomEntry` 骑在**同一条**转录上（方案 §7 岔路 2 = B）。
       * 它按 id 引用领域事实（这里是 `toolCallId`），**永不复制**领域正文——
       * 复制过一次就有了第二份真相，而那正是今天三份转录的来历。
       */
      readonly kind: 'host-note'
      readonly noteType: string
      readonly data: unknown
    })
  | (LanePartIdentity & {
      /**
       * 一张生成任务卡在转录里的位置（方案 §2.2 G13）。
       *
       * **它只带引用，不带状态。** 卡上那些会动的数字（进度、已花、候选）住在
       * ProductionRun 领域存储里，投影时按 `productionRunId` join 一次
       * （K4「永不复制状态」）。把它们写进转录的代价不是多占几个字节，是**第二份真相**：
       * 转录是追加式的，写进去的那一刻就冻住了——用户重开这条对话会看到一个
       * 早就跑完的任务永远停在 37%，而领域那边一切正常。
       */
      readonly kind: 'task'
      /** 领域侧的 id。join 不到就只画标题（`facts` 缺席），不编一个「排队中」。 */
      readonly productionRunId: string
      /** 建这张卡的那次工具调用。用来把卡挂回它的起因，join 不到不影响卡本身。 */
      readonly operationId?: string
      /** 领域投影 join 出来的那一份。**缺席 = 这一刻没 join 到**，不是「全是 0」。 */
      readonly facts?: LaneTaskFacts
    })

export type LanePartKind = LanePart['kind']

/**
 * 任务卡五态。**与 `V4TaskStatus` 逐字相同是刻意的**：这一层是主进程与渲染层唯一的共同词表，
 * 而任务卡的状态词在 v4 定稿（Vocabulary 板 ④）里已经拍过板。在这里另起一套名字，
 * 就得再写一张映射表，而那张表是 R14.1 要横扫的「同一语义两份定义」。
 */
export const LANE_TASK_STATUSES = ['queued', 'running', 'complete', 'failed', 'stopped'] as const
export type LaneTaskStatus = (typeof LANE_TASK_STATUSES)[number]

/**
 * 一张任务卡 join 出来的领域事实。
 *
 * **金额是数字 + 币种，不是格式化好的串。** 渲染层才有 i18n（R15），主进程给一个
 * 「¥0.24」就等于在主进程里钉了一种语言和一种小数写法，而那两件事都随用户设置变。
 * 今天 `V4TaskFacts.spent` 是串，是因为它的产地本来就在渲染层；跨进程这一段不能照抄。
 */
/** Ephemeral, domain-verified media facts; no preview URL or adoption state enters the transcript. */
export interface LaneTaskCandidate {
  readonly projectId: string
  readonly productionRunId: string
  readonly artifactId: string
  readonly thumbnailUrl: string
  readonly adopted: boolean
  readonly canAdopt: boolean
}

export interface LaneTaskFacts {
  readonly status: LaneTaskStatus
  /** 0–100 的整数。阶段数为 0 时**缺席**，不写 0——0% 和「没有阶段可数」不是一回事。 */
  readonly progress?: number
  /** 已完成 / 总阶段数。两个数一起给，文案由渲染层拼。 */
  readonly stagesDone?: number
  readonly stagesTotal?: number
  /** 预算账本的币种（`ProductionRun.budget.currency`）。有金额就必有它。 */
  readonly currency?: string
  /** 已结算金额（账本的 `actual`）。 */
  readonly spent?: number
  /** 已预留金额（账本的 `reserved`）。 */
  readonly estimated?: number
  /** Media previews and adoption eligibility come from the ProductionRun owner. */
  readonly candidates?: readonly LaneTaskCandidate[]
}

/**
 * 一个数字的**三态**。三行（花费 / 上下文 / 推理）共用它，因为三行踩的是同一个坑：
 * 「没有数」被当成「数是 0」印出去。
 *
 * · `known`          —— 我们量到了这个数。
 * · `unknown`        —— 这个数**现在**拿不到（首轮还没结算、刚压缩完、模型没价目…）。
 *                       面板上印占位符，**绝不印 0**：0 是「几乎没花钱 / 几乎没用上下文」这个断言，
 *                       而那一刻我们其实是「不知道」。
 * · `not-applicable` —— 这个数**对这个模型不存在**（免费模型没有花费、不会思考的模型没有推理 token）。
 *                       它是一个真答案，不是缺失——所以和 `unknown` 分开，面板上说的是两句不同的话。
 *
 * 为什么不用 `number | undefined`：那样 `unknown` 和 `not-applicable` 会坍缩成同一个 `undefined`，
 * 下游只能靠猜决定印「—」还是印「免费」；而「有没有理由」这件事也就丢了，报错时没人知道数为什么没有。
 */
export type LaneMetric =
  | { readonly state: 'known'; readonly value: number }
  | { readonly state: 'unknown'; readonly reason: LaneMetricUnknownReason }
  | { readonly state: 'not-applicable'; readonly reason: LaneMetricNotApplicableReason }

export type LaneMetricUnknownReason =
  /** 一条结算过的助手回复都还没有（首轮）。此时任何数都还没产生，估算又不含系统提示词与工具 schema。 */
  | 'no-settled-turn'
  /** 刚压缩完，下一条助手回复之前：旧的用量数字描述的是压缩前的上下文，拿它当「现在装了多少」是错的。 */
  | 'just-compacted'
  /** 目录里这个模型没有 per-token 价目（`Model.tokenPricing` 缺席）。 */
  | 'model-has-no-pricing'
  /** 模型会思考，但供应商这一轮没报推理 token（pi 的 `Usage.reasoning` 是可选的）。 */
  | 'provider-omits-reasoning'

export type LaneMetricNotApplicableReason =
  /** 目录明说这个模型不按 token 计费。 */
  | 'model-is-free'
  /** `getSupportedThinkingLevels(model)` 只返回 `["off"]` —— 这个模型没有推理这回事。 */
  | 'model-has-no-reasoning'

/** 这条 lane 到此为止的用量。数字全部来自 pi 的 `SessionStats`，本层不做第二次换算（不变量 I3）。 */
export interface LaneUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  /**
   * 从缓存前缀读回来的 token（pi 的 `Usage.cacheRead`）。
   *
   * **为什么它必须单独一列，而不是并进 `inputTokens`**：缓存命中的那部分便宜一个数量级，
   * 把两者加成一个「输入」数字，等于把「这一轮真正贵在哪」这条信息抹掉。而它正是唯一能
   * 告诉我们**前缀合同有没有被自己破坏**的信号——工具定义或系统提示词只要抖一个字节，
   * 整段前缀作废（tools → system → messages 是逐级失效的，见
   * <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching>），
   * 症状就是这一列突然塌到 0 而 `inputTokens` 猛涨。合成一个数就看不出来了。
   */
  readonly cacheReadTokens: number
  /** 写进缓存前缀的 token（`Usage.cacheWrite`）。一条新 lane 的第一轮几乎全在这一列。 */
  readonly cacheWriteTokens: number
  readonly totalTokens: number
  /**
   * 本条 lane 到此为止的花费（美元），三态。
   *
   * **不是 `costUsd?: number`。** pi 的 `Usage.cost` 不可选：没有价目的模型照样产出一份全零
   * （`pi-ai/dist/models.js:543-547` 拿 `Model.cost` 直接乘），所以 `cost.total === 0` 同时长得像
   * 「免费」「还没花钱」和「我们没有价目」。用 `> 0` 去分辨它们是猜——那条判断 2026-09-07 删掉了，
   * 判据改为目录声明的 `NomiPricingBasis`（`electron/shared/agentLane/laneModelConfig.ts`）。
   */
  readonly cost: LaneMetric
  /**
   * 「现在上下文里装了多少 token」，三态。**不是累计用量**：累计会随聊天次数一路涨到超过窗口，
   * 画出一个 300% 的环（`agentPanelV4Projection.projectV4Context` 早就把这条写在注释里了）。
   * 取的是最后一条**结算过**的助手消息那次请求的 prompt（`input + cacheRead + cacheWrite`，
   * 与 pi `calculateCost` 对「输入」的定义一字不差）。
   */
  readonly contextTokens: LaneMetric
  /**
   * 推理（thinking）token，三态。**逐消息累加**：pi 的会话总计把 `reasoning` 丢掉了
   * （`core/usage-totals.js` 只并 input/output/cacheRead/cacheWrite），所以它只能从转录里的
   * 每条助手消息上取。它是 `output` 的**子集**，不是另加的一份。
   */
  readonly reasoningTokens: LaneMetric
  /**
   * 这个模型的上下文窗口（分母）。**缺就是缺**——没有分母就不画环，也不拿一个默认值凑
   * （`createNomiProvider` 内部为了满足 pi 的类型给了 128k 兜底，那个数不许上屏）。
   */
  readonly contextWindow?: number
}

/** pi 的思考档（`ModelThinkingLevel`）。中立层复述一遍，是因为 `src/` 那侧 import 不到 pi。 */
export type LaneThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * 推理档位。**全部由 `getSupportedThinkingLevels(model)` derive**，不在我们这侧另列一张表：
 * pi 已经把「`thinkingLevelMap[level] === null` 的档不支持」这条规则写进那个函数
 * （`pi-ai/dist/models.js:551-562`），再抄一份就是两把尺子。
 */
export interface LaneThinking {
  /** 这个模型真正可选的档。UI 只许画这几个——画一个点不动的档比不画更糟。 */
  readonly supportedLevels: readonly LaneThinkingLevel[]
  /** 当前档（`LaneSnapshot.configuration.thinkingLevel`）。 */
  readonly level: LaneThinkingLevel
  /**
   * 能不能关掉思考。`off` 被模型标成 `null` 时它是 `false`——那种模型**关不掉思考**，
   * UI 不能给一个按下去不生效的「关闭」。
   */
  readonly canTurnOff: boolean
}

/**
 * 一条**还没被吃进去**的插话。
 *
 * 它不是转录里的一段（用户话还没进上下文），也不是「正在跑的东西」——它是用户已经打了、
 * 系统答应了、但还轮不到的一句话。做成独立字段而不是塞进 `parts`，是因为它随时会消失：
 * 下一次模型请求前它会变成一条真的用户消息，那时它在 `parts` 里；混在一起的话，
 * 面板要么把同一句话画两遍，要么得自己判「这条是不是已经落定了」。
 */
export interface LaneDraftInput {
  readonly text: string
  readonly attachments?: readonly ProjectAgentAttachmentClaim[]
}

export interface LaneQueuedMessage extends LaneDraftInput {
  /** pi 铸的 id。取消它要原样送回来（`cancelQueued`）。 */
  readonly entryId: string
  readonly kind: LaneQueueKind
}

/**
 * 插话的三种时机（pi 的 `LaneQueuedItem.kind` 去掉 `write` 之后剩下的那些）。
 *
 * · `steer`     —— 下一次模型请求之前注入：「等这一步做完就听我的」。
 * · `follow-up` —— 这一轮整个跑干之后再送：「等它做完再说」。
 * · `next-run`  —— 下一轮。Nomi 今天不发这种（没有命令产它），但它**照样投影**：
 *                  一条排在队里却在面板上不存在的话，比多画一行危险得多。
 *
 * **`write` 不在这张表里**（方案 §1.4 规则三）：`kind:"write"` 是宿主自己排队等着落盘的
 * 记录（`appendCustomEntry` 在操作进行中被 pi 排进同一个 inbox），把它画成「排队的用户消息」
 * 会让用户看到一条他从没打过的指令。
 */
export const LANE_QUEUE_KINDS = ['steer', 'follow-up', 'next-run'] as const
export type LaneQueueKind = (typeof LANE_QUEUE_KINDS)[number]

/**
 * 这一轮正在重试中（`LaneSnapshot.operation.retry`，pi 自己记的）。
 *
 * **为什么必须上屏**：一次 429 或网络抖动今天在用户那边长成「它卡住了」——面板既不动也不报错，
 * 而底下 pi 正在 1s / 2s / 4s 地退避。三个数字上屏之后，同一件事变成「正在重试 2/4」，
 * 用户知道该等还是该按停。字段缺失 = **没有在重试**，不是重试了 0 次。
 */
export interface LaneRetry {
  /** 第几次重试（1 起）。 */
  readonly attempt: number
  /** 最多几次（pi 的 `maxRetries + 1`）。 */
  readonly maxAttempts: number
  /** 下一次不早于这个时刻（epoch ms）。倒计时由渲染层自己算，本层不算第二遍。 */
  readonly nextAttemptAt: number
}

/**
 * 命令沙箱**没起来**的原因码。
 *
 * 只有两个成员，因为**用户能做的处置只有两种**：换一台支持的机器（平台不支持），
 * 或者重开一次会话再看（这次没初始化成功）。上游那句英文异常正文不是原因码——
 * 它是排错用的诊断串，只进主进程日志，一个字都不该出现在界面上
 * （R15：可见文字走 i18n；`check:error-surface`：不把内部英文原文丢给用户）。
 */
export type LaneSandboxInactiveCode = 'unsupported-platform' | 'init-failed'

/** 一次推送 = lane 当前的全部有序段。阶段 1 走全量快照；增量是阶段 3 的事。 */
export interface LaneProjection {
  readonly legacy?: LaneLegacyFacts
  readonly lane: string
  /** Current runtime identity only; credentials never enter the projection. */
  readonly model?: { readonly provider: string; readonly modelId: string }
  readonly parts: readonly LanePart[]
  /** 这条 lane 现在有没有在跑（`LaneSnapshot.operation !== null`）。 */
  readonly running: boolean
  readonly usage: LaneUsage
  /** 有一张卡在等用户。**这一段不在 pi 的快照里**，见 `LanePendingApproval`。 */
  readonly pending?: LanePendingApproval
  readonly thinking: LaneThinking
  /** 排着队还没被吃进去的插话，按 pi 的队列顺序。空数组 = 队列是空的。 */
  readonly queues: readonly LaneQueuedMessage[]
  /** 只在真的在退避时存在。见 `LaneRetry`。 */
  readonly retry?: LaneRetry
  /**
   * 命令沙箱**没起来**时才有；值是原因码（`LaneSandboxInactiveCode`）。
   *
   * **有它 = 这条 lane 里每一条命令都要用户逐条点头**：`codingCommandPolicy` 的第 ① 档
   * （自动放行）整档消失，理由见那个文件头部。字段缺失 = 沙箱在生效，界面对这件事一个字不提。
   *
   * 为什么要上屏：没有它时，「沙箱没起来」的全部症状就是「每条命令都在问我」——
   * 那和「Nomi 变啰嗦了」在界面上长得一模一样，用户没有任何线索知道原因，也不知道换台机器就好了
   * （D4：缺口明着标）。
   */
  readonly sandboxInactive?: LaneSandboxInactiveCode
}

/** 一个项目里的一条对话，在列表上的样子。正文不过桥——列表只需要认出它是哪一条。 */
export interface LaneSummary {
  /** 对话身份。它同时是这条对话在盘上的目录名，所以字符集受限（见 `laneCommandCodec`）。 */
  readonly laneName: string
  /** pi 铸的会话 id。排错与 join 用，面板不显示。 */
  readonly sessionId: string
  readonly createdAt: number
  /** 会话文件的 mtime。列表按它排「最近聊过的在上面」。 */
  readonly updatedAt: number
}

/**
 * 一次推送的完整形状：**这个项目有哪些对话** + **当前这条长什么样**。
 *
 * 为什么 `lanes` 不塞进 `LaneProjection`：那一份是**一条 lane 的宿主**产的，它按定义
 * 不知道隔壁还有几条对话。塞进去就得让每个 lane 宿主都能看到全局，而那正是
 * 「一个窗口一条」这条限制解除时最容易长出来的第二个所有者。
 */
export interface LaneWorkspaceProjection {
  /** 这个项目盘上的全部对话，最近更新的在前。 */
  readonly lanes: readonly LaneSummary[]
  /** 用户正看着的那一条。 */
  readonly active: LaneProjection
}

/**
 * 宿主记录的两个命名空间（方案 §1.4 规则二）。**分界只有一条：模型该不该看见。**
 *
 * · `nomi.ui.*` —— 只给面板画。projector 恒 `() => undefined`，一个 token 都不进模型上下文。
 *   审批卡是最典型的一条：拒收的理由 pi 已经一字不改地做成了那次调用的 tool result
 *   （探针 §4.2 臂 B），再投一遍就是同一句话说两遍、买两份上下文。
 * · `nomi.ctx.*` —— 是模型下一步的依据（用户在卡上改过的提示词那类），逐类型注册 projector。
 *
 * 做成**前缀**而不是一张登记表，是因为登记表会漏：新加一个 `nomi.ui.task` 忘了登记，
 * 症状不是报错，而是它悄悄进了模型上下文。前缀让「进不进」由名字本身决定。
 */
export const LANE_UI_NOTE_PREFIX = 'nomi.ui.' as const

/** 见 `LANE_UI_NOTE_PREFIX`。这一族**进**模型上下文。 */
export const LANE_CTX_NOTE_PREFIX = 'nomi.ctx.' as const

/** 这条宿主记录进不进模型上下文。两个命名空间之外的类型名 fail-closed 到「不进」。 */
export function laneNoteEntersModelContext(noteType: string): boolean {
  return noteType.startsWith(LANE_CTX_NOTE_PREFIX)
}

/** 宿主审批记录的 custom entry 类型名。渲染层按它认出「这是策略拒收，不是工具坏了」。 */
export const LANE_APPROVAL_NOTE_TYPE = `${LANE_UI_NOTE_PREFIX}approval` as const

/**
 * 生成任务卡的 custom entry 类型名（方案 §1.4 规则二第二行）。
 *
 * 它在 `nomi.ui.*` 这一族里，所以 **projector 恒 `undefined`**：模型要任务状态得调
 * `nomi_generation_status` 工具去问领域，而不是从一条早就冻住的转录记录里读。
 */
export const LANE_TASK_NOTE_TYPE = `${LANE_UI_NOTE_PREFIX}task` as const

/**
 * 写进转录的那一条任务记录。**两个 id，零份状态。**
 *
 * 这里每多一个字段，就多一个「转录里的数」和「领域里的数」不一致的机会。
 * 唯一允许的例外是 id 本身——它不会变。
 */
export interface LaneTaskNote {
  readonly productionRunId: string
  /** 建这张卡的那次工具调用（`toolCallId`）。缺席不影响卡。 */
  readonly operationId?: string
}

export function isLaneTaskNote(value: unknown): value is LaneTaskNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const note = value as Record<string, unknown>
  return typeof note.productionRunId === 'string' && note.productionRunId.length > 0
}

/**
 * 一次工具调用的审批**结局**。等待本身不在这张表里——它不是「发生了的事」，
 * 只活在 laneHost 内存与 `LaneProjection.pending`（方案 §1.2）。
 *
 * 六个值都有各自的用户文案，不许折成一个「没批准」：
 * 「你关掉了窗口」和「你说了不要」在用户那里是两件完全不同的事（G6-④ 那族）。
 */
export const LANE_APPROVAL_DECISIONS = [
  /** 策略判定直接放行，没有弹过卡。 */
  'auto-granted',
  /** 用户点了「允许这次」。 */
  'granted-once',
  /** 用户点了「本会话允许这类」，同能力后续直接 `auto-granted`。 */
  'granted-session',
  /** 用户点了「不要」，`reason` 是他自己那句话（或默认文案）。 */
  'denied',
  /** 预检就拒了：工作模式不允许、无 UI 可问、或硬清单。用户从没被问过。 */
  'denied-by-policy',
  /** 等待期被打断：按了停、关了窗、切了项目、或重启前没答完。 */
  'cancelled',
] as const

export type LaneApprovalDecision = (typeof LANE_APPROVAL_DECISIONS)[number]

/** `cancelled` 是被什么打断的。文案不同，所以它不是一个可省的细节。 */
export const LANE_APPROVAL_CANCEL_CAUSES = ['stopped', 'window-closed', 'restart'] as const
export type LaneApprovalCancelCause = (typeof LANE_APPROVAL_CANCEL_CAUSES)[number]

export interface LaneApprovalNote {
  readonly toolCallId: string
  readonly toolName: string
  readonly decision: LaneApprovalDecision
  /** 拒收/取消时给模型看的那句可行动的话。与工具结果里的那句是同一句，**不是第二份**。 */
  readonly reason?: string
  readonly cause?: LaneApprovalCancelCause
}

const APPROVAL_DECISIONS: ReadonlySet<string> = new Set(LANE_APPROVAL_DECISIONS)

export function isLaneApprovalNote(value: unknown): value is LaneApprovalNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const note = value as Record<string, unknown>
  return typeof note.toolCallId === 'string' && typeof note.toolName === 'string'
    && typeof note.decision === 'string' && APPROVAL_DECISIONS.has(note.decision)
}

/** 一条被拒的记录（含策略拒和取消）——面板据此把那一行从「坏了」改成「被拒了」。 */
export function laneApprovalWasRefused(note: LaneApprovalNote): boolean {
  return note.decision === 'denied' || note.decision === 'denied-by-policy' || note.decision === 'cancelled'
}

/**
 * 「它在等你」。
 *
 * **必须由宿主投影，不能从 pi 快照推**：停在预检里的调用 `execute` 还没开始，
 * 它不在 `runningTools` 里、`operation.status` 只会写 `open`——pi 眼里「在等人」
 * 和「在等模型回话」是同一个字（探针 §2.1 实核）。
 */
export interface LanePendingApproval {
  readonly toolCallId: string
  readonly toolName: string
  readonly args: unknown
  /** 这次调用的效果类，面板据此选介入槽的 kind 与徽标。解不出就是 `undefined`（fail-closed 到不可逆）。 */
  readonly effectClass?: 'reversible_local' | 'spend' | 'irreversible'
  /**
   * 「本会话允许这类」这个按钮该不该出现。只有本地可撤销的改动有它；
   * 花钱的、不可逆的、`step` 档下的永远逐次问——门槛与现役介入槽逐字一致，不加宽。
   */
  readonly grantable: boolean
  /** 同时待决的条数。串行执行下恒为 1，留着是因为并行读那一批可能同时进预检。 */
  readonly pendingCount: number
}

/** 用户在审批卡上能做的四件事。「停」不在这里——它是 `abort`，停的是整轮不是这一次。 */
export const LANE_APPROVAL_ACTIONS = ['allow-once', 'allow-session', 'deny'] as const
export type LaneApprovalAction = (typeof LANE_APPROVAL_ACTIONS)[number]

/**
 * 模型可见的工具结果上限。**两个都是 pi 自己内建工具用的那两个数**
 * （`pi-agent-core/dist/harness/utils/truncate.js:10-11` 的 `DEFAULT_MAX_LINES` / `DEFAULT_MAX_BYTES`），
 * 上游把「工具必须自截断」写成 MUST：*"Tools MUST truncate their output"*
 * （`pi-coding-agent/docs/extensions.md:2172`），理由是超限的工具结果会撑爆上下文、
 * 让压缩失败，而这三件事都**不报错**——只是这一轮突然变笨。
 *
 * 为什么这两个数字住在中立契约层而不是 pi 那侧的岛：**说明书和执行必须同一个数**。
 * 截断发生在 `laneTools.mts`（ESM 岛，能 import pi），而向模型宣布上限的
 * 工具 description 写在 `laneDocumentTools.ts`（CJS 侧，`require()` 不到 pi 的 ESM 包）。
 * 两侧唯一都看得见的地方就是这里。抄来的数字会漂，所以
 * `tests/agent-runtime/lane-tool-output.test.mts` 把它和 pi 的常量钉成相等——
 * 上游改了默认值，那条测试先红，而不是等模型某天被喂了 100KB。
 */
export const LANE_MODEL_OUTPUT_MAX_LINES = 2000

/** 见上。50KB —— 与 pi 的 `DEFAULT_MAX_BYTES` 同一个数。 */
export const LANE_MODEL_OUTPUT_MAX_BYTES = 50 * 1024

/** 渲染层能发给主进程的命令。**渲染层不铸造任何宿主记录**（方案 B6）：只说要做什么。 */
export type LaneCommand =
  | { readonly kind: 'prompt'; readonly text: string }
  | { readonly kind: 'abort' }
  /**
   * 对某一张审批卡的答复。`toolCallId` 是 pi 铸的，渲染层只是把它原样送回来——
   * 它证明「用户答的是这一张卡」，而不是答完之后又来了一张、答案落到了新的那张上。
   */
  | {
      readonly kind: 'approval'
      readonly toolCallId: string
      readonly action: LaneApprovalAction
      /** 「不要」时用户那句话。空 = 用默认文案；它会一字不改成为模型看到的拒收理由。 */
      readonly reason?: string
    }
  /** 「等这一步做完就听我的」——下一次模型请求前注入（pi 的 `lane.steer`）。 */
  | { readonly kind: 'steer'; readonly text: string }
  /** 「等它整个做完再说」——这一轮跑干之后才送（pi 的 `lane.followUp`）。 */
  | { readonly kind: 'follow-up'; readonly text: string }
  /**
   * 撤回一条还排在队里的插话。`entryId` 是 pi 铸的，渲染层从 `queues` 里原样取。
   * 结果**三态**（见 `LaneCancelQueuedResult`）——「刚被吃进去了」不是「已取消」。
   */
  | { readonly kind: 'cancel-queued'; readonly entryId: string }
  /** 切到这个项目的另一条对话。不存在就抛，不静默新建。 */
  | { readonly kind: 'lane-select'; readonly laneName: string }
  /** 新建一条对话并切过去。同名已存在就抛——「新建」不该悄悄变成「打开」。 */
  | { readonly kind: 'lane-create'; readonly laneName: string }
  /** 删掉一条对话（连同它的落盘转录）。当前这条不许删——删了就没有活着的对话了。 */
  | { readonly kind: 'lane-delete'; readonly laneName: string }

/**
 * 一条命令执行完之后，主进程有没有东西要交还给用户。
 *
 * 今天只有一样：`abort` 从 pi 的 `AbortResult` 里拿回**没送出去的插话**
 * （`lane.js:799-808`）。用户按停止的那一刻，他刚打的字不能丢——TUI 的
 * `restoreQueuedMessagesToEditor` 就是这么做的，我们抄它。
 */
export interface LaneCommandOutcome {
  readonly restoredInput?: readonly LaneDraftInput[]
  /** `cancel-queued` 的三态结局。见 `LANE_CANCEL_QUEUED_RESULTS`。 */
  readonly cancelQueued?: LaneCancelQueuedResult
  /** 排队成功时 pi 铸的 id（`steer` / `follow-up`）。取消那一条要用它。 */
  readonly queuedEntryId?: string
}

/**
 * 撤回一条排队插话的三种结局（pi 的 `CancelQueuedResult.kind`，`agent-harness.d.ts:32-34`）。
 *
 * **三态必须各画各的**，尤其中间那个：
 * · `cancelled`        —— 撤回成功，那句话不会被送出去。
 * · `already_consumed` —— **晚了一步**：模型上一次请求前刚把它吃进去了。用户要知道
 *                          「它已经听见了」，因为下一段回复会带着那句话的影响；
 *                          把它画成「已取消」是在告诉用户一件没发生的事。
 * · `not_found`        —— 这条 id 队列里没有（面板拿着一份过期的队列）。这是刷新的信号，
 *                          不是一次成功的取消。
 */
export const LANE_CANCEL_QUEUED_RESULTS = ['cancelled', 'already_consumed', 'not_found'] as const
export type LaneCancelQueuedResult = (typeof LANE_CANCEL_QUEUED_RESULTS)[number]

/**
 * 阶段 1 的两条通道名。**它们此刻没有注册进 `main.ts`**——影子期用户走不到新通路，
 * 阶段 4 在主进程注册；渲染层只经 preload 发送意图并接收完整投影。
 */
export const LANE_IPC_CHANNELS = Object.freeze({
  /** 主 → 渲染：推一份完整的有序投影。 */
  projection: 'nomi:agent-lane:projection',
  /** 渲染 → 主：一条命令，请求-响应。 */
  command: 'nomi:agent-lane:command',
})

/** 主进程 lane 宿主对外的形状。CJS 侧只认识它，pi 的类型一个都不过这道门。 */
export interface LaneHandle {
  readonly laneName: string
  readonly sessionId: string
  receiptAuthority(proposalId: string): CanvasWriteApprovalAuthority | undefined
  projection(): LaneProjection
  subscribe(listener: (projection: LaneProjection) => void): () => void
  execute(command: LaneCommand, options?: { onAccepted?(): void }): Promise<LaneCommandOutcome>
  /**
   * 领域侧在这条对话里记下「这儿有一张生成任务卡」（G13 的承接点）。
   *
   * **只有主进程够得到它**——它铸造一条宿主记录，而渲染层不铸造宿主记录（B6）。
   * 桥上没有对应的命令，这是刻意的：面板能看见卡、能点卡，但造卡的是发起那次生成的领域，
   * 不是那个正在看它的窗口。
   */
  appendTaskNote(note: LaneTaskNote): Promise<void>
  /**
   * 「领域那边的任务变了，重投一次」。
   *
   * **为什么需要一个显式的通知，而不是让 `projection()` 每次现算**：投影是**推**给面板的，
   * 推送那一刻的那个对象就是面板此后看到的东西（渲染层零状态机）。让 getter 每次现算，
   * 面板拿到的和推过去的就会是两份不同的数据，而两份都「对」——排错时没人分得清看到的是哪一份。
   * 所以真相仍然是「每次 publish 时 join 一次」，而这个方法就是**多一个 publish 的理由**：
   * 领域说它变了。不通知就不变，是诚实的——我们确实还不知道。
   */
  refreshTasks(): void
  close(): Promise<void>
}

/**
 * 一个项目的全部对话，加上「现在开着哪一条」。
 *
 * **一次只有一条 lane 是打开的**（它持有那条会话的写权）。切换 = 关掉上一条、打开下一条，
 * 不是同时开着好几条：pi 的单打开者名单（#8852）是按会话算的，同时开两条同名会话会写坏文件；
 * 而同时开两条**不同**会话虽然安全，却意味着两条对话同时在跑、同时在花钱，而用户只看得见一条。
 */
export interface LaneWorkspaceHandle {
  /** Main-only configuration; credentials never enter the IPC projection. */
  configureModel(model: NomiModelConfig): Promise<void>
  receiptAuthority(proposalId: string): CanvasWriteApprovalAuthority | undefined
  projection(): LaneWorkspaceProjection
  subscribe(listener: (projection: LaneWorkspaceProjection) => void): () => void
  execute(command: LaneCommand, options?: { onAccepted?(): void }): Promise<LaneCommandOutcome>
  /** 把任务卡记进**当前打开的那条**对话。领域侧只认识工作区，不该自己去挑 lane。 */
  appendTaskNote(note: LaneTaskNote): Promise<void>
  /** 见 `LaneHandle.refreshTasks`。 */
  refreshTasks(): void
  close(): Promise<void>
}

/**
 * 一条技能在 lane 眼里的样子（方案 §3.4）。
 *
 * **它住在中立层，不住在 ESM 岛上**，理由和这个文件顶上那句话一样：`laneRuntimePort.ts`
 * 是 CJS 那一半，它要在 `OpenLaneOptions` 上写出这个字段；而把类型定义留在
 * `laneSkillIndex.mts` 上会把整个岛地拖进 CJS 工程——`agent-runtime-wiring.test.mjs:84`
 * 那条断言正是为此存在的，2026-09-07 它当场红了一次（type-only import 也算「看见」）。
 *
 * 正文**不在这里**：索引只带 name/description/location，模型按 description 自己决定
 * 去 `read` 哪一条（自动触发就是 description，没有宿主侧分类器）。
 */
export interface LaneSkillIndexEntry {
  /** frontmatter 的 `name`。模型看见的标识，也是 `/skill` chip 引用的那个。 */
  readonly name: string
  readonly description: string
  /** SKILL.md 的**绝对**路径——coding 工具的 operations 插槽只收绝对路径。 */
  readonly filePath: string
  /** `disable-model-invocation: true` 的技能不进索引，只能由 `/skill` chip 显式送。 */
  readonly disableModelInvocation: boolean
  /** 这个技能要跑脚本吗（自带 `scripts/`/`bin/`/`hooks/`，或 frontmatter 写了 `tools: coding`）。 */
  readonly requiresCodingTools: boolean
}
