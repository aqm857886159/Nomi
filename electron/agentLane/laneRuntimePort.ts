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
import type { LaneHandle, LanePendingApproval, LaneProjection } from '../shared/agentLane/laneContracts'
import { LaneDomainFailure } from '../shared/agentLane/laneToolContract'
import type { LaneToolEffects, LaneToolFailureShape, LaneToolSpec } from '../shared/agentLane/laneToolContract'
import type { NomiModelConfig } from '../harness/runtime/runtimePort'
import type { ProjectAgentApprovalPolicy, ProjectAgentWorkMode } from '../shared/projectAgentContracts'

export type { LaneHandle, LaneProjection }
export type { LaneToolEffects, LaneToolFailureShape, LaneToolSpec }
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
export type LaneToolDescriptor = LaneToolSpec & {
  execute(args: unknown, context: { toolCallId: string; signal: AbortSignal }): Promise<LaneToolOutcome>
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
  /** 项目目录。会话落在 `<project>/.nomi/agent-sessions/` 下。 */
  projectDir: string
  /** 一条 lane = 一条独立的对话轨。默认 `main`。 */
  laneName?: string
  /** 复用已存在的会话（冷重启走这条）。缺省新建一条并把 id 报出来。 */
  sessionId?: string
  model: NomiModelConfig
  /** 宿主的身份提示词。`Available tools` / `Guidelines` 两段由 `openLane` 按 `tools` 自己拼，别在这里手写。 */
  systemPrompt: string
  tools: readonly LaneToolDescriptor[]
  /** 审批闸。**不传 = 不装闸**（阶段 1 的影子夹具就是这样跑的）；装了就是 fail-closed 的那一套。 */
  approval?: LaneApprovalOptions
}

export type OpenLane = (options: OpenLaneOptions) => Promise<LaneHandle>
