import type { MediaImportRejection } from '../contracts/mediaImportPolicy';
// Agent lane · 一个模型可见工具的**契约**（说明书那一半），与它的执行分开。
//
// **为什么要把说明书和执行拆开**：门岗、系统提示词渲染、以及「模型第一次就填对了吗」
// 的评测，三者都只需要说明书那一半——而执行那一半要一个活着的领域 port（编辑器、画布、
// 时间轴）。把它们焊在一起，结果就是想扫一眼「模型看到了什么」都必须先起半个 App，
// 于是没人扫，于是 `z.record(z.unknown())` 活了半年（#547：`canvas.write` 真实 0/18）。
//
// 拆开之后：`LaneToolSpec` 是一份纯数据，`scripts/check-model-schema.ts` 直接 import
// 就能量；`bindLaneTool` 把 `execute` 挂上去变成可执行的 `LaneToolDescriptor`。
//
// ── 描述三通道（G-03，出处 `docs/research/2026-09-07-pi-reference-implementation-conformance.md` §1.1）──
//
// 上游 pi 把「模型怎么知道该用哪个工具」拆成三条通道，各花各的钱：
//   ① `description`        进工具 schema，**每次请求都花 token**。说「这个工具干什么、
//                          有什么限制、输出会不会被截断」。
//   ② `promptSnippet`      一行，进系统提示词的 `Available tools` 菜单
//                          （`pi-coding-agent/dist/core/system-prompt.js:42-43`）。**全表只出现一次。**
//   ③ `promptGuidelines`   进系统提示词的 `Guidelines` 列表，**去重且按实际工具集条件化**
//                          （`system-prompt.js:45-76`）。
//
// 「该用它还是用隔壁那个」住在 ③，只写一次。方案原本的 S4（三件事全塞进 description）
// 与 S7（≤4 000 token）在数学上互斥——把「不要用隔壁那个」写进 N 个工具的 description，
// 等于把同一段话买 N 遍。仓库现状实核：`promptSnippet`/`promptGuidelines` 全仓 0 次使用。
/**
 * 说明书那一半的类型**不住在这里**：它是能力契约层的东西（一个能力的模型可见描述符），
 * 两个 profile 共用一份（`../agentCapabilities/modelFacingTools.ts`，方案 §3.1）。
 *
 * 这里只保留 lane profile 自己的叫法。**不是第二份定义**——是同一份的别名：
 * 阶段 5a 之前 lane 与对外 MCP 各写各的描述符，那才是并行版（P1），现在两边 import 同一个类型。
 */
export type {
  VerbEffect as LaneToolEffect,
  VerbNextAction,
  ModelFacingToolExample as LaneToolExample,
  ModelFacingToolSpec as LaneToolSpec,
} from "../agentCapabilities/modelFacingTools";
export { verbMutates as laneToolMutates, verbBillable as laneToolBillable, approvalFacetsOf as laneToolApprovalFacets } from "../agentCapabilities/modelFacingTools";

import type { ModelFacingToolExample as LaneToolExample, ModelFacingToolSpec as LaneToolSpec } from "../agentCapabilities/modelFacingTools";
import { issuesFromZod, publicToolInputIssues, renderToolInputIssue, zodIssuesOfError, type ToolInputIssue } from "./toolInputIssues";

/**
 * 「一个工具最多允许跑多久」的 lane 侧叫法与预算常量。**同一份定义的别名**，理由与数字
 * 都住 `../agentCapabilities/modelFacingTools.ts`（`ModelFacingToolExecution` 头部）——
 * 预算是「这个领域动作最慢多久」，与谁在调它无关，所以它不该按 profile 各写一份。
 */
export type { ModelFacingToolExecution as LaneToolExecution } from "../agentCapabilities/modelFacingTools";

export {
  MODEL_TOOL_READ_TIMEOUT_MS as LANE_READ_TOOL_TIMEOUT_MS,
  MODEL_TOOL_WRITE_TIMEOUT_MS as LANE_WRITE_TOOL_TIMEOUT_MS,
} from "../agentCapabilities/modelFacingTools";

/**
 * 一次工具失败。**它是 throw 出去的那个 Error 的正文格式，不是 return 的形状**（G-02）。
 *
 * 上游文档原话：*"Returning a value never sets the error flag regardless of what properties
 * you include in the return object."*（`pi-coding-agent/docs/extensions.md`）。
 * 也就是说，把一个「失败对象」return 出去，pi 会记 `isError: false`——面板画绿收据、
 * 模型收到一条「成功」的工具结果里面装着错误。那正是「文字说的和下面那堆红字对不上」
 * 的机器成因之一。
 */
export interface LaneToolFailureShape {
  /** 闭合词表，供 UI 分档。**它不是给模型读的**——`[error] E_DENIED` 在真机上等于什么都没说。 */
  readonly code: string;
  readonly reason?: MediaImportRejection['reason'];
  /** 一句人话：哪里错、期望什么。门岗断言 `message !== code`。 */
  readonly message: string;
  /** 下一步具体怎么做。「把 nodes 直接给数组本体，不要 JSON.stringify」这种。 */
  readonly nextAction: string;
  /** 枚举/operation 的全部合法值。模型自纠时最有用的一样东西。 */
  readonly allowed?: readonly string[];
  /**
   * 出错的字段（`toolInputIssues.ts` 的同一份清单）。模型那一行可以带**收到的短标量**（它自己刚发的），
   * 公开信封里没有（`publicToolInputIssues`）——用户文稿正文、素材路径都可能在参数里。
   */
  readonly issues?: readonly ToolInputIssue[];
  /** 一个对的调用（工具自己的 `examples[0].arguments`）。模型照着改最快；不进公开信封。 */
  readonly example?: unknown;
  /**
   * `code === "wrong_verb"` 时点名正确的动词。**只点名，不代调**（设计正本原则 7：错动词拒绝，
   * 没有静默转发、没有兜底）。模型读到后自己改用它。
   */
  readonly useInstead?: string;
}

/** 一个例子塞进拒收信的上限：再长就不是「照着改」，是又一份要读的说明书。 */
const EXAMPLE_TEXT_LIMIT = 600;

/**
 * 「入参被拒收」的**唯一构造点**（pi 的形状校验、契约 parse、执行期抛出的 ZodError 三处共用）。
 *
 * 首行保留 `Validation failed for tool "X"`：走查脚本按这个头数「参数被拒」次数（`ARG_REJECTED`），
 * 熔断按 `tool_arguments_invalid` + 字段路径认墙。2026-11-07 之前三处各写各的
 * （pi 默认文本 / `argumentFailure` / 裸 issue JSON）。
 */
export function toolArgumentsRejected(toolName: string, issues: readonly ToolInputIssue[], example?: unknown): LaneToolFailureShape {
  const fields = issues.length === 1 ? "1 field" : `${issues.length} fields`;
  // 第一条「不在表里」的合法值也挂到顶层 `allowed`：熔断撞满转 `ask_user` 时，这几个值就是现成的选项。
  const allowed = issues.find((issue) => issue.kind === "not_allowed" && issue.allowed && issue.allowed.length > 0)?.allowed;
  return {
    code: "tool_arguments_invalid",
    message: `Validation failed for tool "${toolName}" (tool_arguments_invalid): nothing ran. Fix ${fields}:`,
    issues,
    ...(allowed ? { allowed } : {}),
    ...(example === undefined ? {} : { example }),
    nextAction: `Fix the listed fields and call ${toolName} again with the same intent. Fields that belong to another operation must be left out.`,
  };
}

/** `wrong_verb` 的唯一构造点：拒绝的原因、该用哪个动词、下一步。 */
export function wrongVerbFailure(input: { readonly attempted: string; readonly useInstead: string; readonly because: string }): LaneToolFailureShape {
  return {
    code: "wrong_verb",
    message: `${input.attempted} does not do this: ${input.because}`,
    nextAction: `Call ${input.useInstead} instead with the same intent. Nothing was changed by this call.`,
    useInstead: input.useInstead,
  };
}

/**
 * 写动词成功时的返回信封与它的尾行渲染**住在 `./laneToolNextAction`**，不在这里：
 * 投影层与渲染层都要 import 那一行的渲染函数按结构去尾（尾行是给模型的话，不是用户文案），
 * 而它们不能把本文件这条 import 链（`../agentCapabilities/*` → zod）拖进浏览器 bundle。
 * 这里只把它**再导出**一次，`laneToolContract` 的既有调用方一个字都不用改（P1：不是第二份定义）。
 */
export type { LaneToolNextAction } from "./laneToolNextAction";
export { renderLaneToolNextAction, laneToolNextActionOf } from "./laneToolNextAction";

/**
 * 失败 → 模型看到的那段正文。**内外同源**：内部 lane 与对外 MCP 从同一个描述符派生
 * （方案 §3.6），不再各写一份。形状对照 `capabilityCore/dispatcher.ts:557-565`——
 * 对外 MCP 今天已经是这个样子，反倒是我们自己的 Agent 拿到一个错误码（#547 §2.2⑤）。
 */
export function renderLaneToolFailure(failure: LaneToolFailureShape): string {
  const lines = [failure.message];
  for (const issue of failure.issues ?? []) lines.push(renderToolInputIssue(issue));
  // 某条 issue 已经逐字列过这份合法值（`toolArgumentsRejected` 挂上来的就是同一个数组）就不再印第二遍。
  if (failure.allowed && failure.allowed.length > 0 && !failure.issues?.some((issue) => issue.allowed === failure.allowed)) {
    lines.push(`Allowed values: ${failure.allowed.join(", ")}.`);
  }
  if (failure.useInstead) lines.push(`Use ${failure.useInstead} instead.`);
  if (failure.example !== undefined) {
    const example = JSON.stringify(failure.example);
    if (example.length <= EXAMPLE_TEXT_LIMIT) lines.push(`Example of a valid call: ${example}`);
  }
  lines.push(`Next: ${failure.nextAction}`);
  return lines.join("\n");
}

/**
 * 领域侧知道「为什么失败、下一步该干嘛」时抛这个。
 *
 * 不知道的时候抛什么都行——`bindLaneTool` 会把任何异常兜成一个带 `nextAction` 的失败
 * （见 `electron/agentLane/laneRuntimePort.ts`）。**兜底存在的意义不是好看**：
 * 一个漏网的异常今天会原样变成模型看到的 tool result，而领域异常的 `message` 往往是
 * `[error] E_DENIED` 这种给日志看的东西——模型据此没法自纠，只会把同一个调用再发一遍
 * （用户撞到的那条真实摩擦：连续 6 次被自己拒收）。
 */
export class LaneDomainFailure extends Error {
  constructor(readonly failure: LaneToolFailureShape) {
    super(failure.message);
    this.name = "LaneDomainFailure";
  }
}

/**
 * 一个抛出来的异常 → lane 失败。认得出两种：领域自己写好的 `LaneDomainFailure`，以及 ZodError
 * （契约 parse 抛出的；它的 `message` 是整段 issue JSON，原样给模型等于什么都没说）。
 * 认不出返回 `undefined`，由调用方兜——这里不猜。
 *
 * `args` / `schema` 是**这次被校验的那份输入**与它的模型可见 schema：有了才能回收到的短值、这一层能填的字段名。
 */
export function laneFailureOfThrown(
  toolName: string,
  error: unknown,
  input: Readonly<{ args?: unknown; schema?: unknown; example?: unknown }> = {},
): LaneToolFailureShape | undefined {
  if (error instanceof LaneDomainFailure) return error.failure;
  const zodIssues = zodIssuesOfError(error);
  if (zodIssues) return toolArgumentsRejected(toolName, issuesFromZod(zodIssues, input.args, input.schema), input.example);
  return undefined;
}

/**
 * 同一个失败的**对外 MCP 投影**（方案 §3.6：一个描述符两个投影）。
 *
 * 形状对齐 `capabilityCore/dispatcher.ts:557-565` 今天已经在用的那个——不是新发明的，
 * 是把内部路径接到已经做对的那一份上。允许的差异只有一条：MCP 侧回结构化字段（宿主自己
 * 会渲染），模型侧回渲染好的正文（模型只读文本）。
 */
export function laneToolFailureToRpc(failure: LaneToolFailureShape): Readonly<Record<string, unknown>> {
  return {
    code: failure.code,
    ...(failure.reason ? { reason: failure.reason } : {}),
    message: failure.message,
    nextAction: failure.nextAction,
    ...(failure.allowed ? { allowed: failure.allowed } : {}),
    ...(failure.issues ? { issues: publicToolInputIssues(failure.issues) } : {}),
    ...(failure.useInstead ? { useInstead: failure.useInstead } : {}),
  };
}

/**
 * 示例块进入稳定系统段；参数示例仍逐条通过 schema 验证。
 */
export function renderLaneToolExamples(examples: readonly LaneToolExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples.map((example) => `${example.when}\n${JSON.stringify(example.arguments)}`);
  return `\nExample${examples.length > 1 ? "s" : ""}:\n${blocks.join("\n")}`;
}

/** Schema carries the selection sentence; the full description and examples live in the stable system prompt. */
export function laneToolModelDescription(spec: Pick<LaneToolSpec, "description">): string {
  return spec.description.split(/(?<=[.!?])\s+|(?<=。)/u)[0]!;
}
