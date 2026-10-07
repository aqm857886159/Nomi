// Agent capabilities · 模型 ↔ 宿主之间那一次工具调用的**传输契约**（阶段 4 前置 ③）
//
// 这里的八个类型描述的是「模型要调哪个工具、宿主准不准、结果与用量长什么样」，
// 与**谁在跑那一轮**无关：`capabilityCore/*TransportAdapters.ts`、`projectAgentHost/`、
// `skills/skillCapability.ts`、`ai/runtimeVendorError.ts` 都只认这一层。
//
// 为什么从 `electron/harness/runtime/runtimePort.ts` 搬出来：那个文件同时装着两批东西——
// 这八个「谁跑都要用」的传输类型，和 `RuntimeTurnRequest/Hooks/Result` 那批「旧运行核
// 一轮怎么跑」的类型。后者依赖 `harness/context/promptPipe`，且没有一个消费者活过阶段 4
// 的切换；前者的消费者全都活着。混住一个文件的后果是：删 `harness/runtime/` 这个动作
// 会同时删掉二十多个活文件唯一的类型来源。**搬走活的那一半**，旧文件对它们只留 re-export，
// 旧通路一行逻辑不改（P1：不是第二份定义，是同一份换了住址）。
import type { MediaImportRejection } from '../contracts/mediaImportPolicy'
import type { ZodTypeAny } from 'zod'

export interface RuntimeToolDescriptor {
  name: string
  description: string
  schema: ZodTypeAny
}

/**
 * `args` 默认仍是 `unknown`——传输层大多数路口确实不知道自己在搬什么形状。
 *
 * 但它可以在**知道**的那条路上被收窄：`cancel_job` 的导出域那一支已经从宿主契约 schema 派生出了
 * 模型面（`verbs/verbProjections.ts`），所以那条路上的调用带着推断出来的参数类型走，宿主字段
 * 改名时是 tsc 红而不是运行期静默。2026-09-18 的交接文档把 `args: unknown` 列为「整个问题的物理
 * 原因」：类型一旦抹平，两份 schema 就永远不可能在编译期对上账。这个类型参数是把那句话反过来用的
 * 第一处——**一条路一条路地收**，不是一次改全部（默认值保证其余调用点逐字不变）。
 */
export interface RuntimeToolCall<TArgs = unknown> {
  toolCallId: string
  toolName: string
  args: TArgs
}

export type RuntimeToolDecision =
  | { ok: true; result?: unknown; effectiveArgs?: Record<string, unknown>; overridesDelta?: Record<string, unknown>; silent?: boolean; proposalId?: string; approvalScope?: 'once' | 'session' | 'always' }
  | { ok: false; message?: string; code?: string; reason?: MediaImportRejection['reason']; denied?: boolean }

export interface RuntimeToolCallRecord extends RuntimeToolCall {
  status: 'ok' | 'denied' | 'cancelled' | 'error'
  decision?: RuntimeToolDecision
  result?: unknown
  error?: string
}

export interface RuntimeUsage {
  promptTokens: number
  completionTokens: number
  cachedPromptTokens: number
  totalTokens: number
  /**
   * Reasoning/thinking tokens, and only when the provider actually reports a
   * breakdown. A subset of `completionTokens`, never added on top of it.
   * Absent means "this provider did not say" — never coerce it to 0, or the
   * panel prints a confident zero for a number nobody measured.
   */
  reasoningTokens?: number
  /**
   * Provider-priced cost of this one turn, in USD, straight from the runtime's
   * own price table. Absent when the runtime has no price for the model.
   * This is the only cost source; nothing downstream multiplies tokens by a
   * rate of its own.
   */
  costUsd?: number
}

export type RuntimeFinishReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted'

export interface RuntimeErrorFacts {
  // `'step-limit'` 曾经在这里。它唯一的产地（`run.mts` 的第三层）已随本次改动删掉，
  // 留着一个没人再铸造的成员，只会让下一个人以为「到上限」是一类失败——而它不是失败，
  // 是一次停在预算边界上的正常收尾。
  kind: 'http' | 'network' | 'timeout' | 'abort' | 'runtime'
  message: string
  code?: string
  status?: number
  body?: string
  url?: string
  /** 响应头之前 / 响应头之后第一段正文之前（模型在想）/ 正文开始之后两段之间。唯一手写处，看门狗与投影都从这里 derive。 */
  timeoutPhase?: 'first-response' | 'first-token' | 'idle'
}

export type RuntimeActivityEvent =
  | { type: 'content-delta'; delta: string }
  | ({ type: 'tool-call' } & RuntimeToolCall)
  | { type: 'tool-result'; toolCallId: string; toolName: string; result?: unknown; decision?: RuntimeToolDecision }
  | { type: 'tool-error'; toolCallId: string; toolName: string; message: string; denied?: boolean; cancelled?: boolean }
  | { type: 'step-finish'; step: number; finishReason: RuntimeFinishReason; usage: RuntimeUsage }
  | { type: 'warning'; error: RuntimeErrorFacts }

/** Approval correlation carried unchanged through domain adapters and receipt persistence. */
export type CanvasWriteApprovalAuthority = Readonly<{
  receiptProposalId: string;
  approvalId: string;
  actionHash: string;
}>;

export const AGENT_TOOL_PROFILES = ["creation", "generation", "storyboard", "timeline", "production"] as const;
export type AgentToolProfile = (typeof AGENT_TOOL_PROFILES)[number];
