// Agent lane · 主进程侧的接缝（CJS 这一半）
//
// 与旧运行核那道端口同一个形状、同一条理由：pi 的包是
// ESM-only（探针报告 §2.3 实测 `require()` 恒 `ERR_PACKAGE_PATH_NOT_EXPORTED`），
// 所以主进程只能通过动态 `import()` 摸到它。这道门外面只出现 Nomi 自己的结构。
//
// **和旧接缝的区别只有一处，但那一处是重做的全部理由**：旧的 `RuntimeTurnResult`
// 把一轮回复压成 `text: string` + `toolCalls[]` 两堆（`harness/runtime/runtimePort.ts` 的
// `RuntimeTurnResult`，随阶段 4 的切换 PR 一起删），
// 「先说什么后做什么」在数据里就不存在了；这道门送出去的是 `LaneProjection`，
// 一串**有序的段**，顺序是记下来的不是推出来的。
import type {
  LaneHandle, LanePendingApproval, LaneProjection, LaneSkillIndexEntry, LaneTaskFacts, LaneWorkspaceHandle,
} from '../shared/agentLane/laneContracts'
import { LaneDomainFailure } from '../shared/agentLane/laneToolContract'
import type { LaneToolEffect, LaneToolFailureShape, LaneToolSpec } from '../shared/agentLane/laneToolContract'
import type { RuntimeToolCall } from '../shared/agentCapabilities/transportContracts'
import type { LaneComposerContext, LaneInputMessage } from '../shared/agentLane/laneDesktopContracts'
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig'
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from '../shared/agentCapabilities/capabilityApprovalPolicy';
import type { LaneApprovalSubjectResolver } from '../shared/agentLane/laneApproval'
import type { SkillRecord } from '../skills/skillStore'

export type { LaneHandle, LaneProjection }
export type { LaneToolEffect, LaneToolFailureShape, LaneToolSpec }
export { LaneDomainFailure }

/**
 * 工具执行的结果。宿主域执行完把人话结果交回来，pi 负责把它变成模型看到的 tool result。
 *
 * **失败那一支带的是结构，不是一句 `message`**（方案 §3.3）。理由是真机抓到的那段：
 * 模型收到的干脆就是错误码字符串本身（`canvasWriteTransportAdapters.ts:69-75`：
 * `message: code`）——`[error] E_DENIED` 对一个要自纠的模型等于什么都没说。
 * 同一个仓库里，**外部 MCP 客户端**拿到的却是带 `nextAction` 的可行动错误
 * （`capabilityCore/dispatcher.ts:557-565`）。内外同源就是把这条不对等消掉：
 * 一个 `LaneToolFailureShape`，两个投影。
 */
export type LaneToolOutcome =
  | { ok: true; text: string; details?: unknown }
  | { ok: false; failure: LaneToolFailureShape }

/**
 * 一个可执行的模型可见工具 = **说明书那一半**（`LaneToolSpec`：名字、三条描述通道、
 * schema、示例、`prepareArguments`）+ **执行那一半**。
 *
 * 两半分开的理由写在 `../shared/agentLane/laneToolContract.ts` 的头部：门岗、系统提示词
 * 渲染、以及「模型第一次就填对了吗」的评测，三者只需要说明书那一半，而执行那一半要一个
 * 活着的领域 port。焊在一起的结果就是想扫一眼「模型看到了什么」都得先起半个 App——
 * 于是没人扫，于是 `z.record(z.unknown())` 活了半年。
 */
export type LaneToolExecutionContext = { toolCallId: string; signal: AbortSignal }

export type LaneToolDescriptor = LaneToolSpec & {
  execute(args: unknown, context: LaneToolExecutionContext): Promise<LaneToolOutcome>
}

/**
 * 说明书 + 执行 → 一个可执行工具。**绑定是唯一的组装点**，别在别处手拼对象字面量——
 * 因为这里还顺手做了一件每个工具都必须有、而每个工具都会忘的事：
 *
 * **把任何漏网的领域异常兜成一个带 `nextAction` 的失败。** 不兜的后果不是崩溃，
 * 是领域异常的 `message`（往往是 `[error] E_DENIED` 这种给日志看的东西）原样变成模型
 * 看到的 tool result，而模型据此没法自纠，只会把同一个调用再发一遍——用户撞到的
 * 「连续 6 次被自己拒收」就是这么来的。放在每个 `execute` 里靠人记得写，漏掉的那个
 * **不会报错**（R28：防线建在最早能拦住的那层）。
 */
export function bindLaneTool(
  spec: LaneToolSpec,
  execute: LaneToolDescriptor['execute'],
): LaneToolDescriptor {
  return {
    ...spec,
    execute: async (args, context) => {
      try {
        return await execute(args, context)
      } catch (cause) {
        if (cause instanceof LaneDomainFailure) return { ok: false, failure: cause.failure }
        // 中断不是失败：它是用户按了停，兜成一条「下一步怎么做」反而会让模型接着试。
        if (context.signal.aborted) throw cause
        return {
          ok: false,
          failure: {
            code: 'tool_execution_failed',
            message: `${spec.name} could not complete: ${cause instanceof Error ? cause.message : String(cause)}`,
            nextAction: 'Re-read the current state with the matching read tool, then retry with values taken from what you just read. '
              + 'Do not resend the identical call — it will fail the same way.',
          },
        }
      }
    },
  }
}

/**
 * 审批闸要知道的三件事。**判据本身不在这里**——它住在
 * `../shared/agentLane/laneApproval.ts`（纯函数）与 `laneApprovalGate.ts`（运行时）。
 *
 * 档位与工作模式给的是**函数**不是快照：用户在一张卡等着的时候把档位从「每步问」调到
 * 「自动改」是允许的，下一次预检就该按新档位走。传快照等于把用户刚做的选择冻在开 lane 那一刻。
 */
export interface LaneApprovalOptions {
  resolveSubject?: LaneApprovalSubjectResolver
  policy?(): ProjectAgentApprovalPolicy | undefined
  workMode?(): ProjectAgentWorkMode | undefined
  /**
   * 这条 lane 有没有一个能问的人。**必填、且没有默认值**：
   * 「忘了传就当有人」正是那种在 MCP stdio 上悄悄替用户点头的默认值。
   */
  hasUserInterface: boolean
  /** 「在等你」变了，宿主据此重发投影。由 `openLane` 内部接上，调用方通常不传。 */
  onPendingChange?(pending: LanePendingApproval | undefined): void
}

export interface OpenLaneOptions {
  fetch: typeof globalThis.fetch
  /**
   * 桌面原生资源（沙箱、coding 工具、技能索引）。
   *
   * **`skills` 想跟着技能库变，就给函数不给快照**（与 `systemPrompt` / `tasks` 同一条纪律）：
   * 用户在 Agent 面板旁边导入一个技能包、或者让 Agent 自己写一个落盘，都发生在这条 lane
   * 活着的时候。2026-09-11 走查实锤：传数组时那条技能要关掉项目重开才出现在索引里。
   * 给函数时每个回合重读一次（`laneInstalledSkills.mts` 的 `LaneSkillIndexSource`），
   * 模型看到的索引与 `read` 允许越出项目的技能根始终是同一份。
   */
  native?: { settingsRoot: string; skills: readonly SkillRecord[] | (() => readonly SkillRecord[]) }
  /** 项目目录。会话落在 `<project>/.nomi/agent-sessions/` 下。 */
  projectDir: string
  /** 一条 lane = 一条独立的对话轨。默认 `main`。 */
  laneName?: string
  /** 复用已存在的会话（冷重启走这条）。缺省新建一条并把 id 报出来。 */
  sessionId?: string
  model: NomiModelConfig
  /**
   * 宿主的身份提示词。`Available tools` / `Guidelines` 两段由 `openLane` 按 `tools` 自己拼，别在这里手写。
   *
   * **想跟着设置变的，给函数不给快照**（与下面 `tasks` 同一条纪律）：一条 lane 会跨很多回合活着，
   * 传字符串就等于把「这段提示词该说什么」冻在开 lane 那一刻。2026-09-11 走查实锤：回复语言规则
   * 是快照传进来的，用户中途在设置里把界面切成英文后，这条 lane 里连开新对话都还在说中文，
   * 只有冷启动才生效。给函数时 `openLane` 每个回合重新求值（`transform_context`）。
   */
  systemPrompt: string | (() => string)
  /** Snapshot the composer per message; activate only after pi consumes that message. */
  input?: {
    capture(): LaneComposerContext
    activate(context: LaneComposerContext): void
    rewritePayload(payload: unknown, api: string): unknown
    providerContent(message: LaneInputMessage, previous?: LaneComposerContext): Promise<string | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>>
  }
  tools: readonly LaneToolDescriptor[]
  /** Domain ports prepare before confirmation, then persist the accepted authority in the lane. */
  toolLifecycle?: {
    prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<void>
    approved(call: RuntimeToolCall, record: (type: string, data: Record<string, string | number>) => Promise<void>): Promise<void>
    settled(call: RuntimeToolCall): void
  }
  /**
   * 这条 lane 看得见的技能索引（name + description + SKILL.md 绝对路径）。
   * 正文**不在这里**——模型按 description 自己决定去 `read` 哪一条（方案 §3.4 的「自动触发就是 description」）。
   * 缺省 = 这个项目没有技能，那一段整个不出现（`formatSkillsForPrompt` 对空数组返回空串）。
   */
  skills?: readonly LaneSkillIndexEntry[]
  /** 审批闸。**不传 = 不装闸**（阶段 1 的影子夹具就是这样跑的）；装了就是 fail-closed 的那一套。 */
  approval?: LaneApprovalOptions
  /**
   * 任务卡的领域读口（方案 §2.2 G13）。**给函数，不给快照**：任务卡上的进度和金额每秒都在变，
   * 传一份快照进来就等于把「这张卡现在什么样」冻在开 lane 那一刻。
   *
   * 不传 = 任务卡只画标题（`LanePart.facts` 缺席）。这是诚实的降级：join 不到就说 join 不到，
   * 不给一个「排队中」——那会让用户以为有东西在跑。
   */
  tasks?: LaneTaskFactsResolver
  /**
   * 传输层看门狗的两个预算（毫秒）。缺省是 `laneHost` 的 `LANE_FIRST_RESPONSE_MS` /
   * `LANE_IDLE_MS`。
   *
   * **为什么是宿主可配而不是写死**：同一条 lane 可能指向一台本机 ComfyUI 旁边的
   * 小模型（首字节几百毫秒），也可能指向一个跨洋网关（几十秒）。用同一个数去卡两者，
   * 要么把慢的那条误杀，要么让快的那条卡满 90 秒。
   */
  watchdog?: { firstResponseMs?: number; idleMs?: number }
  /** 一个回合最多几次模型请求。缺省 `LANE_MAX_MODEL_REQUESTS`。 */
  limits?: { maxModelRequests?: number; contextTokenBudget?: number }
}

/** `productionRunId` → 领域投影出的那一份事实。解不出来返回 `undefined`，**不返回空对象**。 */
export type LaneTaskFactsResolver = (productionRunId: string) => LaneTaskFacts | undefined

export type OpenLane = (options: OpenLaneOptions) => Promise<LaneHandle>

export type OpenDesktopLaneWorkspace = (options: Omit<OpenLaneOptions, 'model'> & {
  model?: NomiModelConfig
  approval: LaneApprovalOptions
  toolLifecycle: NonNullable<OpenLaneOptions['toolLifecycle']>
}) => Promise<LaneWorkspaceHandle>

export type RunLaneSingleShot = (options: {
  fetch: typeof globalThis.fetch
  model: NomiModelConfig
  systemPrompt?: string
  prompt: string
  input?: OpenLaneOptions['input']
  signal?: AbortSignal
}) => Promise<LaneProjection>
