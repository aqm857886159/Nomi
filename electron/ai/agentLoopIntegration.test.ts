// 集成测试（audit#9）：补「整条多步 tool_use 流式循环」的回归网。
//
// 此前 agentLoop 只测了 oneshot 单步 + 可重入计数，**没有**任何测试用 MockLanguageModelV1
// 驱动一次真实的「tool-call → 确认门 → 喂回结果 → 续下一步」循环。改坏 runAgentLoop 的
// maxSteps 截断、确认门焊接、消费者 idle 计时器都不会被 CI 五门发现（全是静态/纯函数门）。
// 这里用 ai/test 的 MockLanguageModelV1 脚本化流式步骤，零额度、可重复地守住主链路行为。
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import type { CoreMessage, LanguageModelV1StreamPart } from "ai";
import { z } from "zod";
import { runAgentLoop } from "./agentLoop";
import { consumeAgentStreamWithTimeout } from "./agentStreamConsumer";
import { makeAgentTool, type AgentChatV2Hooks } from "./agentChatV2";

function streamParts(parts: LanguageModelV1StreamPart[]): ReadableStream<LanguageModelV1StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/** 每次 doStream 调用（= 一步）按序返回脚本里的下一段流；超出则复用最后一段（无限步用）。 */
function scriptedStreamModel(steps: LanguageModelV1StreamPart[][]): MockLanguageModelV1 {
  let call = 0;
  return new MockLanguageModelV1({
    doStream: async () => {
      const parts = steps[Math.min(call, steps.length - 1)];
      call += 1;
      return { stream: streamParts(parts), rawCall: { rawPrompt: null, rawSettings: {} } };
    },
  });
}

const toolCallPart = (id: string, name: string, args: unknown): LanguageModelV1StreamPart => ({
  type: "tool-call",
  toolCallType: "function",
  toolCallId: id,
  toolName: name,
  args: JSON.stringify(args),
});
const textPart = (textDelta: string): LanguageModelV1StreamPart => ({ type: "text-delta", textDelta });
const finishPart = (finishReason: "stop" | "tool-calls"): LanguageModelV1StreamPart => ({
  type: "finish",
  finishReason,
  usage: { promptTokens: 1, completionTokens: 1 },
});

const userMessage = (content: string): CoreMessage[] => [{ role: "user", content }];
const consumeOpts = { firstChunkTimeoutMs: 5_000, idleTimeoutMs: 5_000, label: "test" };

describe("runAgentLoop — 多步 tool_use 流式循环集成", () => {
  it("tool-call → 确认通过 → 喂回结果 → 续下一步 stop（整链路）", async () => {
    const events: Array<{ type: string; [k: string]: unknown }> = [];
    const confirmSpy = vi.fn(async () => ({ ok: true as const, result: { rows: 3 } }));
    const hooks: AgentChatV2Hooks = { emit: (e) => events.push(e), awaitToolConfirmation: confirmSpy };
    const tools = {
      read_canvas_state: makeAgentTool(hooks, "read_canvas_state", "read", z.object({ q: z.string() })),
    };
    const stepsSeen: number[] = [];
    const stream = runAgentLoop(
      { model: scriptedStreamModel([
        [toolCallPart("c1", "read_canvas_state", { q: "x" }), finishPart("tool-calls")],
        [textPart("已读取，共 3 个节点"), finishPart("stop")],
      ]), messages: userMessage("读画布"), tools, maxSteps: 5 },
      { onStepFinish: ({ stepIndex }) => stepsSeen.push(stepIndex) },
      { mode: "stream" },
    );
    const res = await consumeAgentStreamWithTimeout(stream, new AbortController(), hooks, consumeOpts);

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0]![0]).toMatchObject({ toolName: "read_canvas_state", args: { q: "x" } });
    expect(events.some((e) => e.type === "tool-result")).toBe(true);
    expect(res.finalFinish).toBe("stop");
    expect(res.finalText).toContain("3 个节点");
    expect(stepsSeen.length).toBeGreaterThanOrEqual(2); // 至少两步：工具步 + 收尾步
  });

  it("确认被拒 → 工具返回结构化 error 不抛、loop 优雅收尾（agentChatV2 §193-202 不变量）", async () => {
    const events: Array<{ type: string; message?: string }> = [];
    const hooks: AgentChatV2Hooks = {
      emit: (e) => events.push(e),
      awaitToolConfirmation: async () => ({ ok: false as const, message: "用户拒绝" }),
    };
    const tools = { read_canvas_state: makeAgentTool(hooks, "read_canvas_state", "read", z.object({})) };
    const stream = runAgentLoop(
      { model: scriptedStreamModel([
        [toolCallPart("c1", "read_canvas_state", {}), finishPart("tool-calls")],
        [textPart("好的，已停止"), finishPart("stop")],
      ]), messages: userMessage("go"), tools, maxSteps: 5 },
      {},
      { mode: "stream" },
    );
    const res = await consumeAgentStreamWithTimeout(stream, new AbortController(), hooks, consumeOpts);

    expect(res.ok).toBe(true); // 没抛异常，正常收尾
    expect(events.some((e) => e.type === "tool-error" && e.message === "用户拒绝")).toBe(true);
    expect(res.finalFinish).toBe("stop");
  });

  it("maxSteps 截断：模型每步都发 tool-call 也终止，不无限循环", async () => {
    const confirmSpy = vi.fn(async () => ({ ok: true as const, result: {} }));
    const hooks: AgentChatV2Hooks = { emit: () => {}, awaitToolConfirmation: confirmSpy };
    const tools = { read_canvas_state: makeAgentTool(hooks, "read_canvas_state", "read", z.object({})) };
    // 每步生成唯一 toolCallId 的 tool-call、永不 stop —— 没有 maxSteps 就是死循环。
    let n = 0;
    const model = new MockLanguageModelV1({
      doStream: async () => {
        n += 1;
        return {
          stream: streamParts([toolCallPart(`c${n}`, "read_canvas_state", {}), finishPart("tool-calls")]),
          rawCall: { rawPrompt: null, rawSettings: {} },
        };
      },
    });
    const stream = runAgentLoop(
      { model, messages: userMessage("go"), tools, maxSteps: 3 },
      {},
      { mode: "stream" },
    );
    const res = await consumeAgentStreamWithTimeout(stream, new AbortController(), hooks, consumeOpts);

    expect(res).toBeDefined(); // 终止了（promise resolve，没挂）
    expect(confirmSpy.mock.calls.length).toBeLessThanOrEqual(3); // 被 maxSteps 限制
  });
});
