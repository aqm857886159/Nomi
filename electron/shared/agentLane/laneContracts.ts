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

/** 这条 lane 到此为止的用量。数字全部来自 pi 的 `SessionStats`，本层不做第二次换算（不变量 I3）。 */
export interface LaneUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  /** 运行时对这个模型没有价目时**整个字段不存在**——不是 0。0 会印成一个我们没资格下的断言。 */
  readonly costUsd?: number
}

/** 一次推送 = lane 当前的全部有序段。阶段 1 走全量快照；增量是阶段 3 的事。 */
export interface LaneProjection {
  readonly lane: string
  readonly parts: readonly LanePart[]
  /** 这条 lane 现在有没有在跑（`LaneSnapshot.operation !== null`）。 */
  readonly running: boolean
  readonly usage: LaneUsage
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
