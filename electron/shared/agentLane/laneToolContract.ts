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

import type { ModelFacingToolExample as LaneToolExample, ModelFacingToolSpec as LaneToolSpec, VerbNextAction } from "../agentCapabilities/modelFacingTools";

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
  /** 一句人话：哪里错、期望什么。门岗断言 `message !== code`。 */
  readonly message: string;
  /** 下一步具体怎么做。「把 nodes 直接给数组本体，不要 JSON.stringify」这种。 */
  readonly nextAction: string;
  /** 枚举/operation 的全部合法值。模型自纠时最有用的一样东西。 */
  readonly allowed?: readonly string[];
  /**
   * 出错的字段。**只带类型名，绝不回传收到的值**——用户文稿正文、素材路径都可能在参数里，
   * 那是 provenance/隐私边界。今天 pi 那层会把整个 `Received arguments` 原样回给模型。
   */
  readonly issues?: readonly { readonly path: string; readonly expected: string; readonly receivedType: string }[];
  /**
   * `code === "wrong_verb"` 时点名正确的动词。**只点名，不代调**（设计正本原则 7：错动词拒绝，
   * 没有静默转发、没有兜底）。模型读到后自己改用它。
   */
  readonly useInstead?: string;
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
 * 写动词成功时的返回信封（设计正本 §6.2）：用户接下来会看到什么。`userSees` 是宿主写的一句人话，
 * 与面板投影同源——模型可以直接转述，不必自己编「已经出卡了」。
 */
export interface LaneToolNextAction {
  readonly kind: VerbNextAction;
  readonly userSees: string;
  readonly jobId?: string;
  readonly cardId?: string;
  /** 给 `undo` 用；`reversible_local` 的写动词必有。 */
  readonly changeId?: string;
}

/** 信封 → 模型看到的尾行。**唯一渲染点**，与失败正文的 `Next:` 行同一形状。 */
export function renderLaneToolNextAction(next: LaneToolNextAction): string {
  const refs = [
    ...(next.changeId ? [`changeId=${next.changeId}`] : []),
    ...(next.jobId ? [`jobId=${next.jobId}`] : []),
    ...(next.cardId ? [`cardId=${next.cardId}`] : []),
  ];
  return `User sees: ${next.userSees}${refs.length > 0 ? ` (${refs.join(", ")})` : ""}`;
}

/**
 * 失败 → 模型看到的那段正文。**内外同源**：内部 lane 与对外 MCP 从同一个描述符派生
 * （方案 §3.6），不再各写一份。形状对照 `capabilityCore/dispatcher.ts:557-565`——
 * 对外 MCP 今天已经是这个样子，反倒是我们自己的 Agent 拿到一个错误码（#547 §2.2⑤）。
 */
export function renderLaneToolFailure(failure: LaneToolFailureShape): string {
  const lines = [failure.message];
  for (const issue of failure.issues ?? []) {
    lines.push(`  - ${issue.path}: expected ${issue.expected}, received ${issue.receivedType}`);
  }
  if (failure.allowed && failure.allowed.length > 0) {
    lines.push(`Allowed values: ${failure.allowed.join(", ")}.`);
  }
  if (failure.useInstead) lines.push(`Use ${failure.useInstead} instead.`);
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
 * 同一个失败的**对外 MCP 投影**（方案 §3.6：一个描述符两个投影）。
 *
 * 形状对齐 `capabilityCore/dispatcher.ts:557-565` 今天已经在用的那个——不是新发明的，
 * 是把内部路径接到已经做对的那一份上。允许的差异只有一条：MCP 侧回结构化字段（宿主自己
 * 会渲染），模型侧回渲染好的正文（模型只读文本）。
 */
export function laneToolFailureToRpc(failure: LaneToolFailureShape): Readonly<Record<string, unknown>> {
  return {
    code: failure.code,
    message: failure.message,
    nextAction: failure.nextAction,
    ...(failure.allowed ? { allowed: failure.allowed } : {}),
    ...(failure.issues ? { issues: failure.issues } : {}),
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
