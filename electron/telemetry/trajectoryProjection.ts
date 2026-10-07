// Agent 轨迹的**字段白名单投影** —— 离开这台机器前的最后一层。
//
// 它不是「又一份轨迹格式」：形状是 `electron/shared/agentLane/laneTrajectory.ts`（照 OTel GenAI
// 命名），入料是 `electron/agentLane/laneTrace.mts` 已经派生好的 `LaneTraceTurn`。
// 这里**只做减法**（R31：自定义只能放在标准的扩展点，不另起平行文件）。
//
// 两道网，顺序有意义：
//   ① **白名单投影**（结构性）——没被 `LaneTrajectoryTurn` 列出的字段根本不存在，
//      不是被抹成空。提示词、回复、工具参数值、工具结果、错误原文，连装它们的格子都没有。
//   ② **第二道网**——剩下那些**看起来无害**的字符串（工具名、模型 id、状态、审批决定）
//      再过一遍 `redactLogValue`，兜住「工具名里恰好拼进了一个绝对路径」这种事。
//
// 为什么不能只做 ②：正则识别不出「这是不是一段提示词」。`electron/logging/redact.ts` 的头注释
// 自己写了这条——靠内容检测去拦提示词只会给出一种「已经防住了」的错觉。真正防住它的是 ①。
// 为什么不能只做 ①：白名单管得住**字段**，管不住**字段里的值**；工具名是 Agent 侧拼出来的串。
import crypto from 'node:crypto'
import { redactLogValue } from '../logging/redact'
import { isLaneApprovalNote } from '../shared/agentLane/laneContracts'
import type {
  LaneTrajectoryEnvelope,
  LaneTrajectoryToolCall,
  LaneTrajectoryTurn,
  TrajectoryTurnInput,
} from '../shared/agentLane/laneTrajectory'
import { laneAssistantFaultOf } from '../shared/agentLane/laneAssistantFault'

/** 单个字符串出门前的上限。轨迹是给我们看趋势的，不是给我们看全文的。 */
const MAX_LABEL_CHARS = 120
/** 一次上报最多带几个回合。反馈只带「这一回合」，但开关开着的定期上报可能攒几个。 */
export const MAX_TRAJECTORY_TURNS = 20
/** 一个回合最多带几次工具调用；再多也说明不了别的。 */
const MAX_TOOL_CALLS = 50

/**
 * 会话 id → 稳定哈希。
 *
 * 为什么必须哈希：pi 把 cwd 编进会话目录名，会话 id 在我们这儿又跟 `/nomi-lane/<laneName>`
 * 绑着——`laneName` 是用户给对话起的名字。原样出门等于出门一段本机路径**加**一个用户起的标题。
 * 哈希之后仍然能回答唯一要紧的那个问题：「这几条轨迹是同一段对话吗」。
 */
export function trajectoryConversationId(sessionId: string): string {
  return crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16)
}

/** 一个**本应无害**的短标签出门前的样子：过第二道网 + 截断 + 空值兜底。 */
function label(value: unknown, fallback = 'unknown'): string {
  if (typeof value !== 'string') return fallback
  const clean = redactLogValue(value)
  if (!clean) return fallback
  return clean.length > MAX_LABEL_CHARS ? clean.slice(0, MAX_LABEL_CHARS) : clean
}

function duration(value: unknown): number | null {
  return Number.isFinite(value) && Number(value) >= 0 ? Math.round(Number(value)) : null
}

/** token 计数与耗时的判据是同一条，只有「取不到时算什么」不同：计数是 0，耗时是「不知道」。 */
function count(value: unknown): number {
  return duration(value) ?? 0
}

/**
 * 工具参数 → **键名**。
 *
 * 递归只走一层就停：`{ shots: [{ prompt: '…' }] }` 出门的是 `['shots']`，不是
 * `['shots', 'shots[0].prompt']`。再深一层就开始泄露 Agent 填了什么形状的内容，
 * 而「它填了 shots 这一格没有」已经够回答「动词翻对了吗」。
 * 键名本身也过一遍第二道网——键名可以是模型现编的（MCP 工具的自由 schema）。
 */
function argumentKeys(args: unknown): string[] {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return []
  return Object.keys(args).slice(0, 40).map((key) => label(key, 'key')).sort()
}

function projectToolCall(tool: TrajectoryTurnInput['tools'][number]): LaneTrajectoryToolCall {
  return {
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.name': label(tool.name, 'unknown_tool'),
    'gen_ai.tool.call.id': label(tool.toolCallId, 'unknown'),
    'nomi.tool.argument_keys': argumentKeys(tool.arguments),
    'nomi.tool.failed': typeof tool.failed === 'boolean' ? tool.failed : null,
    'nomi.tool.failure_code': typeof tool.failureCode === 'string' && tool.failureCode ? label(tool.failureCode) : null,
    'nomi.tool.duration_ms': duration(tool.durationMs),
  }
}

/**
 * 审批决定：只取闭合枚举里的那一格。
 * 用 `isLaneApprovalNote`（中立契约层的守卫）而不是自己读 `note.decision`——
 * 自己读等于又写一份「审批记录长什么样」的判据，上游加字段时它不会红。
 */
function approvalDecisions(approvals: readonly unknown[]): string[] {
  return approvals.slice(0, 20).filter(isLaneApprovalNote).map((note) => note.decision)
}

/** 错误原文 → 认得出的类别（闭合词表）；原文本身不出门。 */
function errorKinds(errors: readonly string[]): string[] {
  return errors.slice(0, 20).flatMap((text) => {
    const fault = laneAssistantFaultOf(text)
    if (!fault) return []
    return [fault.kind === 'model-timeout' ? `model-timeout:${fault.phase}` : fault.kind]
  })
}

/**
 * 一个回合 → 出门的样子。
 *
 * `includeContent` 只有在用户**亲手勾了**「也附带提示词和文稿」时才是 true。
 * 没勾时那两个键**不存在**（不是空串）：接收端看不到键，就不会有人误以为「这条没写提示词」。
 */
export function projectTrajectoryTurn(turn: TrajectoryTurnInput, includeContent = false): LaneTrajectoryTurn {
  const projected: LaneTrajectoryTurn = {
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.conversation.id': trajectoryConversationId(turn.sessionId),
    'gen_ai.provider.name': [...new Set(turn.models.map((model) => label(model.provider)))],
    'gen_ai.request.model': [...new Set(turn.models.map((model) => label(model.model)))],
    'gen_ai.usage.input_tokens': count(turn.tokens?.input),
    'gen_ai.usage.output_tokens': count(turn.tokens?.output),
    'gen_ai.usage.cache_read.input_tokens': count(turn.tokens?.cacheRead),
    'gen_ai.usage.cache_creation.input_tokens': count(turn.tokens?.cacheWrite),
    'gen_ai.response.finish_reasons': [label(turn.status, 'unknown')],
    'nomi.turn.duration_ms': duration(turn.durationMs),
    'nomi.turn.tool_calls': (turn.tools ?? []).slice(0, MAX_TOOL_CALLS).map(projectToolCall),
    'nomi.turn.approval_decisions': approvalDecisions(turn.approvals ?? []),
    'nomi.turn.error_count': (turn.errors ?? []).length,
    'nomi.turn.error_kinds': errorKinds(turn.errors ?? []),
    'nomi.turn.request_count': (turn.requestInputs ?? []).length,
    'nomi.turn.max_request_input_tokens': (turn.requestInputs ?? []).reduce((max, value) => Math.max(max, count(value)), 0),
  }
  if (includeContent) {
    // 用户勾了才走这一支。仍然过第二道网 + 截断：他同意分享文稿，不等于同意分享
    // 文稿里恰好粘着的一个密钥或一条绝对路径。
    projected['gen_ai.input.messages'] = redactLogValue(String(turn.prompt ?? '')).slice(0, 4000)
    projected['gen_ai.output.messages'] = redactLogValue(String(turn.response ?? '')).slice(0, 4000)
  }
  return projected
}

/** 一批回合 → 一个可以直接发给 `/v1/trajectories` 的信封。 */
export function projectLaneTrajectory(
  turns: readonly TrajectoryTurnInput[],
  options: { includeContent?: boolean; maxTurns?: number } = {},
): LaneTrajectoryEnvelope {
  const includeContent = options.includeContent === true
  const limit = Math.min(options.maxTurns ?? MAX_TRAJECTORY_TURNS, MAX_TRAJECTORY_TURNS)
  // 取最后 N 个：出问题的总是最近这几回合。
  return {
    schemaVersion: 1,
    contentIncluded: includeContent,
    turns: turns.slice(-limit).map((turn) => projectTrajectoryTurn(turn, includeContent)),
  }
}
