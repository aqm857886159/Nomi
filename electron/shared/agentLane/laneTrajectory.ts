// Agent 轨迹**出门后的形状** —— 中立契约层（两个编译岛都要引：ESM 岛供料、CommonJS 岛投影）。
//
// 为什么只放类型、不放逻辑：投影要用 `electron/logging/redact.ts` 当第二道网，而那份住在
// CommonJS 那半；`electron/shared/` 是电中立契约层，让它反向依赖 logging/ 会把分层拧反。
// 所以**形状住这里，逻辑住 `electron/telemetry/trajectoryProjection.ts`**。
//
// 键名全部照 OpenTelemetry GenAI 语义约定写（R31：外部也读写的东西先对齐标准，不自造）。
// 对齐依据与偏差登记在 `docs/engineering/standard-formats.json` 的 `nomi-agent-trace-view`，
// 属性注册表见 https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/docs/registry/attributes/gen-ai.md
//
// **这份类型本身就是脱敏判据**：OTel 自己把六格标了「含消息内容」——
//   gen_ai.input.messages / output.messages / system_instructions /
//   tool.call.arguments / tool.call.result / retrieval.query.text
// 它们正好就是我们承诺「默认不出门」的那一类。所以除了用户**亲手勾选**才带的
// input/output 两格（可选属性），这里**根本没有**装它们的字段位——
// 不是抹成空串，是结构上不存在（R28：能让编译器拦的别留给门岗）。

/**
 * 投影的**入料形状**。它结构性地对应 `electron/agentLane/laneTrace.mts` 的 `LaneTraceTurn`，
 * 但刻意不从那边 import：那是 ESM 岛的文件，CommonJS 这半的 tsconfig 里没有它。
 *
 * 两处形状会不会漂？不会——`laneNativeLoader.cts` 的桥把岛里那个函数声明成返回
 * `TrajectoryTurnInput[]`，`LaneTraceTurn` 不再结构兼容时**编译当场红**（那座桥就是漂移守卫）。
 */
export interface TrajectoryTurnInput {
  readonly sessionId: string
  readonly turnId: string
  readonly timestamp: number
  readonly spanName: string
  readonly prompt: string
  readonly response: string
  readonly models: readonly { readonly provider: string; readonly model: string }[]
  readonly tokens: { readonly input: number; readonly cacheRead: number; readonly cacheWrite: number; readonly output: number }
  /** 这一回合每一次模型请求各自的输入 token（input + cacheRead）。`tokens.input` 是它们的和，看不出哪一次撑爆。 */
  readonly requestInputs?: readonly number[]
  readonly durationMs: number | null
  readonly status: string
  readonly tools: readonly {
    readonly toolCallId: string
    readonly name: string
    readonly arguments: unknown
    readonly durationMs: number | null
    readonly failed: boolean | null
    /** 失败信封里的码（闭合词表，不含内容）。 */
    readonly failureCode?: string | null
  }[]
  readonly approvals: readonly unknown[]
  readonly errors: readonly string[]
}

/** 一次工具调用出门的样子。参数**只留键名**，值一个都不带。 */
export interface LaneTrajectoryToolCall {
  'gen_ai.operation.name': 'execute_tool'
  'gen_ai.tool.name': string
  'gen_ai.tool.call.id': string
  /**
   * `gen_ai.tool.call.arguments` 被 OTel 标成敏感（参数值里住着提示词、路径、素材名），
   * 所以出门的是**参数的结构**：键名排序后的数组。「Agent 把 prompt 这一格填了没有」
   * 是我们真正要的诊断信号，而填了什么不是。
   */
  'nomi.tool.argument_keys': string[]
  'nomi.tool.failed': boolean | null
  /**
   * 失败时的码（`document_position_unavailable` / `capability_receipt_unresolved` …，闭合词表）。
   * 2026-10-06 之前只有 `failed: true`，NF-1001-0001 / NF-1001-0002 两条反馈因此只能凭代码猜是哪一种失败。
   */
  'nomi.tool.failure_code': string | null
  'nomi.tool.duration_ms': number | null
}

/** 一个回合出门的样子。版本号由信封持有（`LaneTrajectoryEnvelope`）——出门的单位是信封，不是单个回合。 */
export interface LaneTrajectoryTurn {
  'gen_ai.operation.name': 'invoke_agent'
  /** 会话 id 的**哈希**：原样出门等于出门一段本机路径（pi 把 cwd 编进 id 的兄弟目录名里）。 */
  'gen_ai.conversation.id': string
  'gen_ai.provider.name': string[]
  'gen_ai.request.model': string[]
  'gen_ai.usage.input_tokens': number
  'gen_ai.usage.output_tokens': number
  'gen_ai.usage.cache_read.input_tokens': number
  'gen_ai.usage.cache_creation.input_tokens': number
  /** pi 的运行状态当 finish reason 用（`invoke_agent` 这一层没有别的收尾信号）。 */
  'gen_ai.response.finish_reasons': string[]
  'nomi.turn.duration_ms': number | null
  'nomi.turn.tool_calls': LaneTrajectoryToolCall[]
  /** 审批决定的**闭合枚举值**（来自 `isLaneApprovalNote`），不是审批卡的内容。 */
  'nomi.turn.approval_decisions': string[]
  /** 出错几次。错误原文不出门——它可能是服务商原话，也可能是拼了路径的内部断言。 */
  'nomi.turn.error_count': number
  /** 认得出的那几类错误（看门狗相位 / 半路断流 / 上下文溢出，`laneAssistantFault.ts`），闭合词表。 */
  'nomi.turn.error_kinds': string[]
  /** 这一回合发了几次模型请求（含自动重试）。 */
  'nomi.turn.request_count': number
  /** 单次请求里最大的输入 token。回合总量是各次之和，撑爆窗口的是这一个数（NF-0928-0003）。 */
  'nomi.turn.max_request_input_tokens': number
  /** 用户勾了「也附带提示词和文稿」才有。没勾时**这两个键不存在**。 */
  'gen_ai.input.messages'?: string
  'gen_ai.output.messages'?: string
}

export interface LaneTrajectoryEnvelope {
  schemaVersion: 1
  /** 内容带没带，写在信封上，不让接收端去猜。 */
  contentIncluded: boolean
  turns: LaneTrajectoryTurn[]
}
