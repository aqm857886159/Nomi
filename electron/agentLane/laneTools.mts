// Agent lane · 能力契约 → pi 的工具面
//
// **为什么不是 `defineTool`**：方案与任务书都写「用 `defineTool`」，实核后它不成立——
// `defineTool` 住在 `pi-coding-agent` 的**扩展面**（`dist/core/extensions/types.d.ts:386`），
// 它的 `execute(toolCallId, params, signal, onUpdate, ctx: ExtensionContext)` 与
// `AgentHarness` 要的 `AgentHarnessTool.execute(toolCallId, params, onUpdate, toolContext,
// invocation, context)` **签名不兼容**：前者是 `createAgentSession` 那条老路的工具工厂。
// 既然岔路 1 取了 A（`AgentHarness`），这里就用 `AgentHarnessTool`。`prepareArguments`
// 两边同名同义，方案要的那个官方容忍钩子一点没丢。
//
// 形状只验一次：pi 在调用 `execute` 之前用 `parameters` 跑 ajv（带容忍梯，G-08）。
// `toModelVisibleSchema` 的「信息不丢」门岗保证生成的 schema 不弱于 zod，所以宿主不再为
// **形状**开第二个验证器——那正是 #547 §2.2③「8 行报错只有 1 行是真的」的成因。
//
// 但扁平 schema 声明不了的那一层——**跨字段约束与分支专属字段**（哪个 operation 必须带
// 哪些字段、哪些字段不属于这个 operation）——住在契约的 `transform` 里，而 pi 不认识 zod：
// ajv 通过之后没有任何东西会去跑它。2026-09-07 合并评审实核：`{operation:"connect_canvas_edges",
// edges:[]}` 与带着别的 operation 字段的调用一路绿到领域端口。所以 `execute` 里跑**一次**契约
// parse，就在这个唯一的出口——不是第二个形状验证器（ajv 刚验过形状，这里只会剩下组合错误），
// 而是设计里本来就该有、却没人调用的那一次。
import { formatSize, truncateHead, type AgentHarnessTool, type AgentToolResult } from '@earendil-works/pi-agent-core';
import type { ZodError, ZodIssue } from 'zod';
import { LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES } from '../shared/agentLane/laneContracts.js';
import {
  laneToolModelDescription, renderLaneToolFailure, type LaneToolFailureShape,
} from '../shared/agentLane/laneToolContract.js';
import type { LaneToolDescriptor } from './laneRuntimePort.js';
import { toModelVisibleSchema } from './laneToolSchema.mjs';

const TOOL_NAME = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

/**
 * 一个可行动的失败。
 *
 * pi 把抛出的错误正文变成模型看到的 tool result，所以这句话是模型自纠的**唯一**输入。
 * 「`[error] E_DENIED`」这种写法在真机上等于什么都没说（#547 §2.2⑤：同一个仓库里，
 * 外部 MCP 客户端拿到的是可行动错误，我们自己的 Agent 拿到一个错误码）。
 */
class LaneToolFailure extends Error {}

/** 截断发生了什么。进 `details`，不进模型载荷——pi 的分工（核对 §2.6）。 */
export interface LaneOutputTruncation {
  readonly truncatedBy: 'lines' | 'bytes'
  readonly shownLines: number
  readonly totalLines: number
  readonly shownBytes: number
  readonly totalBytes: number
}

/**
 * 工具结果自截断（核对表 G-04）。
 *
 * 它在解决哪个真实摩擦：`read_full_text` 返回的是**用户的整份原稿**。一份三万字的稿子
 * 一次读回来就能吃掉整个上下文窗口，而失败的样子不是报错——是这一轮突然变笨、
 * 或者压缩在半路失败。上游把这件事写成 MUST 并给了工具（`docs/extensions.md:2170-2212`）。
 *
 * **为什么截在这一层而不是每个工具自己截**：这里是所有工具结果通向模型的**唯一**出口。
 * 截在这里，阶段 2 搬进来的每一个能力都自动带着这条保证；截在各自的 `execute` 里，
 * 它就变成一条要靠人记得的约定，而漏掉的那个工具**不会报错**（R28：防线建在最早能拦住的那层）。
 *
 * **为什么不像上游示例那样把全文另存一个文件**：上游那句 `Full output saved to: …` 是给
 * `bash`/`grep` 那种「输出是新生成的、别处没有」的工具用的。我们这一族的全文是**用户自己的
 * 原稿**——它已经在他的文稿里躺着了，再往临时目录抄一份，等于刚把转录收紧到 `0o600`
 * （`laneFileSystem.mts`）又在旁边留一份世界可读的副本。所以正文里给的是**下一步怎么做**，
 * 不是一个路径。
 */
function truncateForModel(text: string): { text: string; truncation?: LaneOutputTruncation } {
  const result = truncateHead(text, {
    maxLines: LANE_MODEL_OUTPUT_MAX_LINES, maxBytes: LANE_MODEL_OUTPUT_MAX_BYTES,
  });
  if (!result.truncated || result.truncatedBy === null) return { text };
  // 这句话是模型唯一能读到的截断信号。它必须说清三件事：**被截了**（否则它会把
  // 半截原稿当成全文继续写）、**截掉了多少**、**下一步做什么**。少了第三件，
  // 模型知道自己看不全却无路可走，只能猜——那比不截断更糟。
  const note = `\n\n[Truncated: showing the first ${result.outputLines} of ${result.totalLines} lines `
    + `(${formatSize(result.outputBytes)} of ${formatSize(result.totalBytes)}). `
    + 'The rest was not sent, so do not assume the content ends here. '
    + 'Ask for a narrower scope — a selection, a section — and call again.]';
  return {
    text: `${result.content}${note}`,
    truncation: {
      truncatedBy: result.truncatedBy, shownLines: result.outputLines, totalLines: result.totalLines,
      shownBytes: result.outputBytes, totalBytes: result.totalBytes,
    },
  };
}

/**
 * 契约 parse 的失败 → 模型看到的失败正文（§3.3 的形状）。
 *
 * 只带**类型名与字段名**，绝不回传收到的值：用户文稿正文、素材路径都可能在参数里。
 * `allowed` 从枚举类 issue 的 `options` 取，那是模型自纠时最有用的一样东西。
 */
function argumentFailure(toolName: string, args: unknown, error: ZodError): LaneToolFailureShape {
  const issues = error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join('.') : '(root)',
    expected: expectedOf(issue),
    receivedType: receivedTypeOf(issue, args),
  }));
  const enumIssue = error.issues.find(
    (issue): issue is Extract<ZodIssue, { options: unknown[] }> =>
      issue.code === 'invalid_enum_value' || issue.code === 'invalid_union_discriminator',
  );
  return {
    code: 'tool_arguments_invalid',
    message: `${toolName} was called with arguments its contract rejects.`,
    issues,
    ...(enumIssue ? { allowed: enumIssue.options.map(String) } : {}),
    nextAction: 'Fix the listed fields and call again with the same operation. Fields that belong to another operation must be left out.',
  };
}

function expectedOf(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected;
    case 'invalid_enum_value':
    case 'invalid_union_discriminator':
      return `one of ${issue.options.map(String).join(', ')}`;
    case 'unrecognized_keys':
      return `no field named ${issue.keys.join(', ')} for this operation`;
    default:
      // 剩下的是我们自己写的约束文案（"connect_canvas_edges needs at least one edge"）
      // 或 zod 的界文案（"Array must contain at least 1 element(s)"）——都不含收到的值。
      return issue.message;
  }
}

function receivedTypeOf(issue: ZodIssue, args: unknown): string {
  if (issue.code === 'invalid_type') return issue.received;
  let current: unknown = args;
  for (const key of issue.path) {
    if (!current || typeof current !== 'object') return 'undefined';
    current = (current as Record<string | number, unknown>)[key as string | number];
  }
  return Array.isArray(current) ? 'array' : current === null ? 'null' : typeof current;
}

/** 领域回执原样保留，截断元信息挂在旁边。非对象回执塞进 `value`，不静默丢掉。 */
function detailsWithTruncation(details: unknown, truncation: LaneOutputTruncation): Record<string, unknown> {
  if (details === undefined) return { truncation };
  if (!details || typeof details !== 'object' || Array.isArray(details)) return { value: details, truncation };
  return { ...(details as Record<string, unknown>), truncation };
}

export function createLaneTools(descriptors: readonly LaneToolDescriptor[]): AgentHarnessTool<undefined>[] {
  const names = new Set<string>();
  return descriptors.map((descriptor) => {
    if (!TOOL_NAME.test(descriptor.name) || names.has(descriptor.name)) {
      throw new Error(`Invalid or duplicate Nomi lane tool name: ${descriptor.name}`);
    }
    if (!descriptor.description.trim()) {
      throw new Error(`Nomi lane tool ${descriptor.name} needs a model-visible description`);
    }
    // 自声明的副作用与它自己必须自洽（阶段 2 评审第 ⑨ 维）。装配期抛，不是运行期发现：
    // 一个「不改状态却说自己可撤销」的声明，唯一的症状会是崩溃恢复时替用户多跑一次。
    const effects = descriptor.effects;
    if (effects.mutates !== (effects.reversal !== 'none')) {
      throw new Error(
        `Nomi lane tool ${descriptor.name} declares mutates=${effects.mutates} with reversal="${effects.reversal}". `
        + 'A read-only tool has nothing to reverse; a writing tool must say how its change is taken back.',
      );
    }
    if (effects.billable && !effects.mutates) {
      throw new Error(`Nomi lane tool ${descriptor.name} claims to spend the user's money without changing anything.`);
    }
    names.add(descriptor.name);
    const tool: AgentHarnessTool<undefined> = {
      name: descriptor.name,
      label: descriptor.name,
      // 模型读到的是「说明 + 示例块」。示例的 token 成本远低于一次失败重试——
      // #547 的数据说零示例的工具在复杂参数上就是填不对（35/35 零示例）。
      description: laneToolModelDescription(descriptor),
      parameters: toModelVisibleSchema(descriptor.schema, { toolName: descriptor.name }),
      // 并行/串行**从同一个副作用声明派生**，和 `replay` 同一个派生点：写操作必须一个一个来
      // （两次并发写同一张画布必冲突），而读没有理由串行——「读画布 + 读时间轴 + 读文稿」
      // 这类扇出串起来就是白等三倍。上一版对**每一个**工具硬写 `'sequential'`，那是
      // 框架边界登记表上到期的那笔债（一致性核对 §1.10）。
      //
      // ⚠️ 实核一条要写死的事：**`AgentHarness` 今天不读这个字段**——它按 run 级的
      // `AgentHarnessOptions.toolExecution` 分派（`harness/runtime/drive/tools.js:445`），
      // 逐工具的 `executionMode` 只有老路 `agent-loop.js:287` 在看。所以这行今天改变不了
      // 一次真实批次的行为；它是**声明**，按上游自己的契约填对（`pi-agent-core/dist/types.d.ts:353-359`
      // 的原话就是「这个工具必须一次一个」）。哪天上游让 harness 也读它，我们不用再动一行。
      // `lane-tool-contract` 里那条断言把这个「今天由谁决定」钉住，上游改了它先红。
      executionMode: effects.mutates ? 'sequential' : 'parallel',
      // 崩溃恢复时敢不敢替我们再跑一次。**从工具自己声明的副作用派生，唯一的派生点**：
      // 一次文稿写入重放两遍就是写了两遍（`'never'`），而重放一次 `nomi_canvas_read`
      // 只是多读一次画布（`'safe'`）。上一版对**每一个**工具硬写 `'never'`，包括纯读的
      // 那五个——那不会报错，只会让冷恢复白白丢掉本来能自动补上的那次读。
      replay: effects.mutates ? 'never' : 'safe',
      ...(descriptor.prepareArguments
        ? { prepareArguments: descriptor.prepareArguments as (args: unknown) => never }
        : {}),
      execute: async (toolCallId, params, _onUpdate, _toolContext, _invocation, context) => {
        const signal = context.abortSignal ?? new AbortController().signal;
        signal.throwIfAborted();
        // 契约自己的那一次 parse（文件头部说明了为什么它必须在这里、且只在这里）。
        // 失败按 §3.3 的形状 throw：字段名 + 类型名 + 合法值 + 下一步，不回传值。
        const bound = descriptor.schema.safeParse(params);
        if (!bound.success) {
          throw new LaneToolFailure(renderLaneToolFailure(argumentFailure(descriptor.name, params, bound.error)));
        }
        const outcome = await descriptor.execute(bound.data, { toolCallId, signal });
        // **必须 throw，不能 return**（G-02）。上游文档原话：*"Returning a value never sets
        // the error flag regardless of what properties you include in the return object."*
        // return 一个「失败对象」的后果是 pi 记 `isError: false`——面板画绿收据、模型收到
        // 一条「成功」的工具结果里面装着错误。那正是「文字说的和下面那堆红字对不上」的
        // 机器成因之一。正文由**唯一**的渲染点生成，内外两个投影同源。
        if (!outcome.ok) throw new LaneToolFailure(renderLaneToolFailure(outcome.failure));
        const shown = truncateForModel(outcome.text);
        const result: AgentToolResult<unknown> = {
          content: [{ type: 'text', text: shown.text }],
          details: shown.truncation ? detailsWithTruncation(outcome.details, shown.truncation) : outcome.details ?? {},
        };
        return result;
      },
    };
    return tool;
  });
}
