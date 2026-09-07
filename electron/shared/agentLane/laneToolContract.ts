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
import type { ZodTypeAny } from "zod";

/**
 * 一个 schema-valid 的调用示例（#547：35/35 工具零示例）。
 *
 * **写进 description，不用 Anthropic 专有的 `input_examples`**——我们要跨供应商，
 * 而那个字段只有一家认。示例的 `arguments` 会被测试拿去真的过一遍 schema：
 * 一个过不了自己 schema 的示例比没有示例更糟，它教模型写错。
 */
export interface LaneToolExample {
  /** 一句话说清这个示例在做什么，进 description 的示例块。 */
  readonly when: string;
  /** 真正的参数对象。必须能通过本工具的 schema——`lane-tool-contract.test.mts` 逐条验。 */
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * 一个工具**自己声明**它会造成什么后果（阶段 2 评审第 ⑨ 维）。
 *
 * **为什么是声明而不是登记**：今天这三件事散在四个地方——`replay` 在 `laneTools.mts` 里
 * 对**每一个**工具硬写成 `'never'`（连纯读也是，而重放一次读是安全的）、「可逆」写在
 * `CANVAS_GUIDELINES` 的散文里、「花不花钱」压根没人写。散着的后果不是难看：阶段 3 接生成类
 * 工具时，第一个真正**花用户钱**的工具会以和一次 `read_timeline` 完全相同的形状进来，
 * 而没有任何一层会因此报错。做成契约上的**必填字段**，编译器就成了最早那道防线——
 * 加一个工具而不说清它花不花钱、可不可逆，代码编译不过（R28）。
 *
 * 每个字段都有真正的消费者，不是装饰：
 * - `mutates` → pi 的 `replay` 恢复策略（`laneTools.mts` 的唯一派生点）；
 * - `billable` → 装配期不变量（花钱必然改状态），阶段 3 面板的花费收据按它分档；
 * - `reversal` → 装配期不变量（只读必然 `none`），阶段 3 的闸按它决定要不要停下来问用户。
 */
export interface LaneToolEffects {
  /** 会不会改领域状态。只读工具重放一次是安全的，写入工具不是。 */
  readonly mutates: boolean;
  /** 会不会花用户在供应商那里的钱。阶段 2 的 11 个工具全是 `false`。 */
  readonly billable: boolean;
  /**
   * 改动怎么收回：
   * - `none` —— 只读，没有要收回的东西；
   * - `proposal` —— 只是一份提案，用户还要点接受（画布这一族全是）；
   * - `undoable` —— 已经落进领域状态，但进了撤销栈（文稿写入这一族）。
   */
  readonly reversal: "none" | "proposal" | "undoable";
}

/** 模型可见工具的说明书那一半。纯数据，不需要任何领域 port。 */
export interface LaneToolSpec {
  readonly name: string;
  /**
   * 这个工具投影的那个能力契约 id（`canvas.write`）。**必填。**
   *
   * 为什么不用工具名去查：lane 上的工具名是**这个面自己的名字**
   * （`nomi_storyboard_write` 不在 `CANVAS_WRITE_CAPABILITY.aliases` 里，也不该在——
   * 三个 lane 工具投影的是同一个能力）。审批要的 `effectClass` / `requiresPlanReview`
   * 只有契约知道，所以工具**自己说**它是谁的投影，通用系统按 id 去 registry 取
   * （P4：档案声明槽，通用系统负责填）。
   *
   * 「本会话允许这类」的 grant 也按这个 id 记：用户点的是「这类改动」，
   * 而不是「这个名字」——同一个能力的三个投影不该让他答三遍。
   */
  readonly capabilityId: string;
  /**
   * 通道①。**只说这个工具自己的事**：干什么、有什么限制、输出会不会被截断。
   * 「该用它还是用隔壁那个」不写在这里——那是通道③ 的活，写在这里就是买 N 遍。
   */
  readonly description: string;
  /** 通道②。一行，进系统提示词的 `Available tools` 菜单。全表只出现一次。 */
  readonly promptSnippet: string;
  /**
   * 通道③。进系统提示词的 `Guidelines`，**跨工具去重**——同一族工具给同一条纪律时，
   * 用户只花一次 token。渲染见 `lanePromptSections.ts`。
   */
  readonly promptGuidelines?: readonly string[];
  /** 这个工具会造成什么后果。**必填**——见 `LaneToolEffects` 头部。 */
  readonly effects: LaneToolEffects;
  /**
   * 模型真正要填的那一部分语义输入。**由别名决定的字段已经剥掉**——
   * `read_full_text` 的 `scope` 不在这里，因为名字已经把它定死了；
   * 让模型在参数里再选一次是 #547 里 0% 那一族的形状。
   */
  readonly schema: ZodTypeAny;
  /** 至少一个，当工具字段数 ≥10 或语义上有分支时（门岗 `missing-example`）。 */
  readonly examples: readonly LaneToolExample[];
  /**
   * pi 官方的容忍钩子（`pi-agent-core/dist/types.d.ts:347`），在 ajv 校验**之前**跑。
   *
   * 为什么容忍只能落在这里：阶段 0 探针 §4.2 臂 A 实测——**schema 不合法的参数根本走不到**
   * `before_tool`，pi 的校验器先把它拦下并自己生成了错误回给模型。放松 schema 则是对
   * **所有**调用放松，那是 0/18 的来历。所以：schema 保持严格，捏合发生在校验之前。
   */
  prepareArguments?(args: unknown): unknown;
}

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
  };
}

/**
 * 示例块。渲染成 description 的尾巴，所以它和 schema 一起进每次请求——
 * 这是有意的取舍：#547 的数据说零示例的工具在复杂参数上就是填不对，
 * 而一个示例的 token 成本远低于一次失败的重试。
 */
export function renderLaneToolExamples(examples: readonly LaneToolExample[]): string {
  if (examples.length === 0) return "";
  const blocks = examples.map((example) => `${example.when}\n${JSON.stringify(example.arguments)}`);
  return `\nExample${examples.length > 1 ? "s" : ""}:\n${blocks.join("\n")}`;
}

/** 模型真正读到的 description = 说明 + 示例块。生成点只有这一个。 */
export function laneToolModelDescription(spec: LaneToolSpec): string {
  return `${spec.description}${renderLaneToolExamples(spec.examples)}`;
}
