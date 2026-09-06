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
import type { AgentHarnessTool, AgentToolResult } from '@earendil-works/pi-agent-core';
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
        const result: AgentToolResult<unknown> = {
          content: [{ type: 'text', text: outcome.text }],
          details: outcome.details ?? {},
        };
        return result;
      },
    };
    return tool;
  });
}
