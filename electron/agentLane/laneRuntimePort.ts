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
  LaneApprovalDecision, LaneAttachmentResolver, LaneHandle, LanePendingApproval, LaneProjection, LaneSkillIndexEntry, LaneTaskFacts, LaneWorkspaceHandle,
} from '../shared/agentLane/laneContracts'
import { LaneDomainFailure } from '../shared/agentLane/laneToolContract'
import type { LaneToolEffect, LaneToolFailureShape, LaneToolNextAction, LaneToolSpec } from '../shared/agentLane/laneToolContract'
import type { RuntimeToolCall } from '../shared/agentCapabilities/transportContracts'
import type { LaneComposerContext, LaneInputMessage } from '../shared/agentLane/laneDesktopContracts'
import type { LaneHoldOutcome } from '../shared/agentLane/laneContracts'
import type { NomiModelConfig } from '../shared/agentLane/laneModelConfig'
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from '../shared/agentCapabilities/capabilityApprovalPolicy';
import type { LaneApprovalSubjectResolver } from '../shared/agentLane/laneApproval'
import type { AgentModelEntry } from '../shared/agentCapabilities/availableModels'
import type { ModelAvailabilityFacts } from '../shared/agentCapabilities/modelSpecProjection'
import type { SkillRecord } from '../skills/skillStore'
import type { LaneDeclaredDefaults } from './laneModelContext'
import type { PendingSpendRead } from '../shared/contracts/pendingSpendConfirm'

export type { LaneHandle, LaneProjection }
export type { LaneToolEffect, LaneToolFailureShape, LaneToolNextAction, LaneToolSpec }
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
  | { ok: true; text: string; details?: unknown; nextAction?: LaneToolNextAction }
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
export type LaneToolExecutionContext = {
  toolCallId: string
  signal: AbortSignal
  /**
   * 这次调用**真的**是怎么过闸的（`laneApprovalGate.decisionFor`）。写回执时读它。
   *
   * 为什么回执需要它：闸跑在 `before_tool`，工具跑完再写回执——那一刻卡早就答完了。
   * 一张静态表因此永远说不准「用户现在看到什么」：`edit_timeline` 原来无条件回
   * 「一张复审卡正在问用户」，而三档里只有 `step`/`safe-auto` 真出过卡，且出过的那张也已经答完。
   * 模型照着那句话让用户去点一张不存在的卡（2026-09-12「劈成两半」）。
   *
   * 缺席 = 这条 lane 没装闸（阶段 1 的影子夹具 / 单测）。那时回执只说做成了什么，不提卡。
   */
  approvalDecision?: LaneApprovalDecision
  /**
   * 用户回答这道题时的**原话**（只有 `approvalDecision === 'answered'` 才有）。
   *
   * `ask_user` 的 execute 读它，把这句话原样作为**成功形状**的 tool result 交回模型。
   * 2026-09-22 之前「他答上了」走的是 `block`，而 pi 对 block 硬编码 `isError: true`——
   * 模型收到的是一条「ask_user 失败了」，正文恰好是他那句答案（run4 六次全中）。
   */
  approvalAnswer?: string
}

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

/**
 * 领域端口在预检期能向宿主借的两样东西。等待的 owner 是审批闸（`laneApprovalGate.hold`）；
 * 端口只说「替我等这一次」，拿回结局——它自己不 race signal、不管关窗。
 */
export type LaneToolPreflightHost = Readonly<{
  signal: AbortSignal
  /** 这条 lane 此刻有没有一个能问的人（没装闸 / MCP stdio / 后台批 = false）。 */
  canAskUser: boolean
  /** 开始替一张画在别处的卡等用户。`settle` 把那张卡上的结论递进来（只认第一次）。 */
  waitForUser(): Readonly<{ outcome: Promise<LaneHoldOutcome>; settle(outcome: Exclude<LaneHoldOutcome, { kind: 'cancelled' }>): boolean }>
}>

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
  native?: { settingsRoot: string; skills: readonly SkillRecord[] | (() => readonly SkillRecord[] | Promise<readonly SkillRecord[]>) }
  /**
   * 模型可用性（keyStatus/usable/statusReason）的**只读查询**，由持有目录的装配层注入。
   * lane 自己不 import 目录：那会把 catalogStore 的磁盘读拖进 agent 运行时的模块图（分层门岗会红）。
   * 不注入 = 这三样不出现，**绝不编一个 usable:true 冒充**。
   */
  modelAvailability?: (entry: AgentModelEntry) => ModelAvailabilityFacts | undefined
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
  /**
   * 殿后的一段：拼在**整份最终系统提示的最末尾**（技能、引用、权限清单之后）。回复语言规则放这里——
   * 提示词主体几乎全是中文，规则只在最前面一次，英文界面会被后面的大段中文带回中文
   * （老 `composeAgentSystemPrompt` 首尾各放一次，就是被用户抓过中英混答）。定义仍只有 `buildLanguageRule` 一处。
   * 与 `systemPrompt` 同一条纪律：给函数，每个回合求值一次。
   */
  systemPromptClosing?: string | (() => string)
  /** Snapshot the composer per message; activate only after pi consumes that message. */
  input?: {
    capture(): LaneComposerContext
    prepare?(context: LaneComposerContext): LaneComposerContext | Promise<LaneComposerContext>
    activate(context: LaneComposerContext): void
    rewritePayload(payload: unknown, api: string): unknown
    providerContent(message: LaneInputMessage, previous?: LaneComposerContext): Promise<string | Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>>
  }
  tools: readonly LaneToolDescriptor[]
  /** Domain ports prepare before confirmation, then persist the accepted authority in the lane. */
  toolLifecycle?: {
    prepare(call: RuntimeToolCall, signal: AbortSignal): Promise<void>
    /**
     * 闸放行之后、工具执行之前。它跑在 `before_tool` 里，所以**不计入工具超时**——需要等用户的那一步
     * （`generate` 的报价卡）只许住在这里，不许住在 execute 里（2026-09-22 裁决 A）。
     */
    approved(call: RuntimeToolCall, record: (type: string, data: Record<string, string | number>) => Promise<void>, host?: LaneToolPreflightHost): Promise<void>
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
   * 用户消息上的附件 claim → 展示快照（文件名 / 类型 / 大小）。给函数不给快照，理由同 `tasks`：
   * 素材索引在主进程、每一刻都可能变。不传 = 历史里的附件只有 claim，渲染层画「附件不可用」。
   */
  attachments?: LaneAttachmentResolver
  /**
   * 用户在设置里声明的默认图片 / 视频模型（此刻真能用的）。**给函数不给快照**：用户在设置里改了默认，
   * 下一次模型请求的索引就该跟上。不传 = 索引里没有默认那一段（影子夹具 / 没有设置的宿主）。
   */
  modelDefaults?: () => LaneDeclaredDefaults
  /**
   * 传输层看门狗的三个预算（毫秒）。缺省是 `laneProviderGuard` 的 `LANE_STREAM_WATCHDOG`。
   *
   * **为什么是宿主可配而不是写死**：同一条 lane 可能指向一台本机 ComfyUI 旁边的
   * 小模型（首字节几百毫秒），也可能指向一个跨洋网关（几十秒）。用同一个数去卡两者，
   * 要么把慢的那条误杀，要么让快的那条卡满 90 秒。
   */
  watchdog?: { firstResponseMs?: number; firstTokenMs?: number; idleMs?: number }
  /** 一个回合最多几次模型请求。**缺省不设**（见 `LANE_MAX_MODEL_REQUESTS` 的注释）；设了才拦。 */
  limits?: { maxModelRequests?: number; contextTokenBudget?: number }
}

/** `productionRunId` → 领域投影出的那一份事实。解不出来返回 `undefined`，**不返回空对象**。 */
export type LaneTaskFactsResolver = (productionRunId: string) => LaneTaskFacts | undefined

export type OpenLane = (options: OpenLaneOptions) => Promise<LaneHandle>

export type OpenDesktopLaneWorkspace = (options: Omit<OpenLaneOptions, 'model'> & {
  model?: NomiModelConfig
  /** 项目级的待决出价读口（见 `LaneWorkspaceProjection.spend`）。给函数不给快照，理由同 `tasks`。 */
  spend?: () => PendingSpendRead
  approval: LaneApprovalOptions
  toolLifecycle: NonNullable<OpenLaneOptions['toolLifecycle']>
}) => Promise<LaneWorkspaceHandle>

export type RunLaneSingleShot = (options: {
  fetch: typeof globalThis.fetch
  model: NomiModelConfig
  systemPrompt?: string
  /** 见 `OpenLaneOptions.systemPromptClosing`：拼在整份提示的最末尾。 */
  systemPromptClosing?: string
  prompt: string
  input?: OpenLaneOptions['input']
  signal?: AbortSignal
}) => Promise<LaneProjection>

/**
 * 「这条路真的拿不到目录」——**说出来的**那句话，不是一个省略号。
 *
 * 2026-09-22（对方会话 Ponytail 记的账）：可用性注入以前一路可选，于是
 * `createLaneModelRead(resolve, availabilityOf?)` 里一个 `?.` 就把「装配漏接目录」
 * 洗成了「这个模型没有可用性信息」——模型读到的每一行都没有 keyStatus/usable，
 * 它以为所有模型都能用，然后带着一个没钥匙的模型去花钱。装配层现在**必传**；
 * 只有这一个常量可以表示「没有目录」，而它在代码里是看得见的一句话。
 */
export const NO_CATALOG_MODEL_AVAILABILITY = (): ModelAvailabilityFacts | undefined => undefined
