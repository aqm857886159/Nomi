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
// 校验只发生一次：pi 在调用 `execute` 之前用 `parameters` 跑一遍 ajv。宿主**不再**用 zod
// 复验——那正是 #547 §2.2③「8 行报错只有 1 行是真的」的成因。安全性由
// `toModelVisibleSchema` 的「信息不丢」门岗承担：生成的 schema 不弱于 zod。
import { formatSize, truncateHead, type AgentHarnessTool, type AgentToolResult } from '@earendil-works/pi-agent-core';
import { LANE_MODEL_OUTPUT_MAX_BYTES, LANE_MODEL_OUTPUT_MAX_LINES } from '../shared/agentLane/laneContracts.js';
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
    names.add(descriptor.name);
    const tool: AgentHarnessTool<undefined> = {
      name: descriptor.name,
      label: descriptor.name,
      description: descriptor.description,
      parameters: toModelVisibleSchema(descriptor.schema, { toolName: descriptor.name }),
      executionMode: 'sequential',
      // 效果不可安全重放：一次文稿写入重放两遍就是写了两遍。pi 拿这个字段决定
      // 崩溃恢复时敢不敢替我们再跑一次，默认值不该由我们含糊过去。
      replay: 'never',
      ...(descriptor.prepareArguments
        ? { prepareArguments: descriptor.prepareArguments as (args: unknown) => never }
        : {}),
      execute: async (toolCallId, params, _onUpdate, _toolContext, _invocation, context) => {
        const signal = context.abortSignal ?? new AbortController().signal;
        signal.throwIfAborted();
        const outcome = await descriptor.execute(params, { toolCallId, signal });
        if (!outcome.ok) throw new LaneToolFailure(outcome.message);
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
