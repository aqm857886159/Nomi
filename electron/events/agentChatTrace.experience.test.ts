import { describe, expect, it, vi } from "vitest";
import { beginTurnTrace, setExperienceCompletionHandlerForTests, traceChatEvent } from "./agentChatTrace";
import { setEventLogProjectDirResolverForTests } from "./eventLogRepository";

describe("agent trace experience completion", () => {
  it("invokes the completion handler once after a result and isolates handler failures", async () => {
    setEventLogProjectDirResolverForTests(() => null);
    const handler = vi.fn(async () => { throw new Error("projection failed"); });
    setExperienceCompletionHandlerForTests(handler);
    beginTurnTrace("session-experience", { projectId: "p1", prompt: "修复", history: { kind: "ephemeral" } });
    traceChatEvent("session-experience", { type: "result", result: { status: "finished", text: "done", usage: {} } });
    traceChatEvent("session-experience", { type: "done", reason: "finished" });
    expect(handler).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    setExperienceCompletionHandlerForTests(null);
  });
});
