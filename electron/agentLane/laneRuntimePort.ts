// Agent lane · 主进程侧的接缝（CJS 这一半）
//
// 与 `electron/harness/runtime/runtimePort.ts` 同一个形状、同一条理由：pi 的包是
// ESM-only（探针报告 §2.3 实测 `require()` 恒 `ERR_PACKAGE_PATH_NOT_EXPORTED`），
// 所以主进程只能通过动态 `import()` 摸到它。这道门外面只出现 Nomi 自己的结构。
//
// **和旧接缝的区别只有一处，但那一处是重做的全部理由**：旧的 `RuntimeTurnResult`
// 把一轮回复压成 `text: string` + `toolCalls[]` 两堆（`runtimePort.ts:122-133`），
// 「先说什么后做什么」在数据里就不存在了；这道门送出去的是 `LaneProjection`，
// 一串**有序的段**，顺序是记下来的不是推出来的。
import type { ZodTypeAny } from 'zod'
import type { LaneHandle, LaneProjection } from '../shared/agentLane/laneContracts'
import type { NomiModelConfig } from '../harness/runtime/runtimePort'

export type { LaneHandle, LaneProjection }

/** 工具执行的结果。宿主域执行完把人话结果交回来，pi 负责把它变成模型看到的 tool result。 */
export type LaneToolOutcome =
  | { ok: true; text: string; details?: unknown }
  | { ok: false; message: string }

export interface LaneToolDescriptor {
  name: string
  /** 模型看到的说明。工具契约自己写，不是这里编的。 */
  description: string
  /**
   * 模型真正要填的那一部分语义输入。**由别名决定的字段已经剥掉**——
   * `read_full_text` 的 `scope` 不在这里，因为别名已经把它定死了；
   * 让模型在参数里再选一次是 #547 里 0% 那一族的形状（一个工具塞多个分支）。
   */
  schema: ZodTypeAny
  /**
   * pi 官方的容忍钩子（`pi-agent-core/dist/types.d.ts:347`）。
   *
   * 为什么容忍必须落在这里、而不是闸层：探针报告 §4.2 臂 A 实测——**schema 不合法的参数
   * 根本走不到 `before_tool`**，pi 的校验器先把它拦下并自己生成了错误回给模型。
   * 所以「模型把数组写成了 JSON 字符串」这类畸形，只能在校验**之前**捏合。
   */
  prepareArguments?(args: unknown): unknown
  execute(args: unknown, context: { toolCallId: string; signal: AbortSignal }): Promise<LaneToolOutcome>
}

export interface LaneToolGateRequest {
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
}

/**
 * 闸的结果。拒收必须带一句**可行动**的话——它会一个字不改地成为模型看到的 tool result
 * （探针报告 §4.2 臂 B 实测 `needleReachedModelVerbatim: true`），所以这句话的质量
 * 直接决定模型下一步能不能自己改对。
 */
export type LaneToolGateDecision =
  | { allow: true }
  | { allow: false; reason: string }

export interface OpenLaneOptions {
  /** 项目目录。会话落在 `<project>/.nomi/agent-sessions/` 下。 */
  projectDir: string
  /** 一条 lane = 一条独立的对话轨。默认 `main`。 */
  laneName?: string
  /** 复用已存在的会话（冷重启走这条）。缺省新建一条并把 id 报出来。 */
  sessionId?: string
  model: NomiModelConfig
  systemPrompt: string
  tools: readonly LaneToolDescriptor[]
  gate?(request: LaneToolGateRequest): Promise<LaneToolGateDecision> | LaneToolGateDecision
}

export type OpenLane = (options: OpenLaneOptions) => Promise<LaneHandle>
