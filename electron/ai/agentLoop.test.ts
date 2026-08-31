import { describe, expect, it } from "vitest";
import { MockLanguageModelV1 } from "ai/test";
import type { CoreMessage } from "ai";
import { runAgentLoop } from "./agentLoop";

const makeModel = () =>
  new MockLanguageModelV1({
    doGenerate: async () => ({
      finishReason: "stop" as const,
      usage: { promptTokens: 1, completionTokens: 1 },
      text: "ok",
      rawCall: { rawPrompt: null, rawSettings: {} },
    }),
  });

const userMessage = (content: string): CoreMessage[] => [{ role: "user", content }];

describe("runAgentLoop", () => {
  it("oneshot 模式跑通并回传文本", async () => {
    const result = await runAgentLoop(
      { model: makeModel(), messages: userMessage("hi"), tools: {} },
      {},
      { mode: "oneshot" },
    );
    expect(result.text).toBe("ok");
  });

  it("可重入:并发两次,各自 stepIndex 从 1 计数互不污染(S0 不变量①)", async () => {
    const seenA: number[] = [];
    const seenB: number[] = [];
    await Promise.all([
      runAgentLoop(
        { model: makeModel(), messages: userMessage("a"), tools: {} },
        { onStepFinish: ({ stepIndex }) => seenA.push(stepIndex) },
        { mode: "oneshot" },
      ),
      runAgentLoop(
        { model: makeModel(), messages: userMessage("b"), tools: {} },
        { onStepFinish: ({ stepIndex }) => seenB.push(stepIndex) },
        { mode: "oneshot" },
      ),
    ]);
    expect(seenA).toEqual([1]);
    expect(seenB).toEqual([1]);
  });
});
