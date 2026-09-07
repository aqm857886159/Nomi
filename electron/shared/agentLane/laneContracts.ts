// Agent lane · 中立契约层（阶段 1 影子期）
//
// 这一层是渲染进程与主进程**唯一**共同认识的东西。它刻意不认识 pi：pi 的类型只在
// `electron/agentLane/*.mts` 那个 ESM 岛里出现，越过这道门就只剩下面这几个结构。
// 分层理由与 `electron/harness/runtime/runtimePort.ts` 同源（`electron/` → `src/` 的
// 依赖方向铁律，`check:boundaries` 只放行 `electron/shared/`）。
//
// **本层最重要的一个字段是 `sequence`。** 今天面板的顺序是渲染层用 `createdAt` + 数组
// 下标排出来的（`agentPanelV4Projection.sortedItems()`），也就是说「先说什么后做什么」
// 这件事在系统里是**推断出来的**。新通路里它是**记下来的**：pi 的 lane transcript 本身
// 就有序，主进程按走序赋 `sequence`，下游任何一层都不许再排一次（方案 §2.2 不变量 I1）。

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
  | (LanePartIdentity & { readonly kind: 'user'; readonly text: string })
  | (LanePartIdentity & { readonly kind: 'assistant-text'; readonly text: string; readonly streaming: boolean })
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

export type LanePartKind = LanePart['kind']

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
   * 判据改为目录声明的 `NomiPricingBasis`（`electron/harness/runtime/pi/model.mts`）。
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

/** 一次推送 = lane 当前的全部有序段。阶段 1 走全量快照；增量是阶段 3 的事。 */
export interface LaneProjection {
  readonly lane: string
  readonly parts: readonly LanePart[]
  /** 这条 lane 现在有没有在跑（`LaneSnapshot.operation !== null`）。 */
  readonly running: boolean
  readonly usage: LaneUsage
  readonly thinking: LaneThinking
}

/** 宿主审批记录的 custom entry 类型名。渲染层按它认出「这是策略拒收，不是工具坏了」。 */
export const LANE_APPROVAL_NOTE_TYPE = 'nomi.approval' as const

export interface LaneApprovalNote {
  readonly toolCallId: string
  readonly toolName: string
  readonly decision: 'granted' | 'denied'
  /** 拒收时给模型看的那句可行动的话。与工具结果里的那句是同一句，**不是第二份**。 */
  readonly reason?: string
}

export function isLaneApprovalNote(value: unknown): value is LaneApprovalNote {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const note = value as Record<string, unknown>
  return typeof note.toolCallId === 'string' && typeof note.toolName === 'string'
    && (note.decision === 'granted' || note.decision === 'denied')
}

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
 * 阶段 1 的两条通道名。**它们此刻没有注册进 `main.ts`**——影子期用户走不到新通路，
 * 回滚面积因此为零（方案 §8.1 规则 O6「开发期不可达」）。切换 PR 才注册。
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
  projection(): LaneProjection
  subscribe(listener: (projection: LaneProjection) => void): () => void
  execute(command: LaneCommand): Promise<void>
  close(): Promise<void>
}
