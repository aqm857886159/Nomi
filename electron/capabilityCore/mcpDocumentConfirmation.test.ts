import { describe, expect, it, vi } from "vitest";

import { handleDocumentEditConfirmation } from "./mcpDocumentConfirmation";

const input = {
  id: 7,
  args: { operation: "append", content: "真实文档" },
  routedMethod: "document.write",
  built: { operation: "append", content: "真实文档" },
};

function dependencies(confirm: { supported: boolean; confirmed?: boolean; action?: "decline" | "timeout" }, locale: "en" | "zh-CN" = "en") {
  const reply = vi.fn();
  const invokeForRequest = vi.fn(async () => ({ applied: true, revision: 2 }));
  const elicitBooleanConfirm = vi.fn(async () => confirm);
  return {
    reply,
    invokeForRequest,
    elicitBooleanConfirm,
    buildToolResultPayload: vi.fn((_toolName, _args, result) => ({ content: [{ type: "text", text: JSON.stringify(result) }] })),
    locale: () => locale,
  };
}

describe("MCP document confirmation helper", () => {
  it("forwards an approved human decision with documentConfirmed", async () => {
    const deps = dependencies({ supported: true, confirmed: true, action: undefined });

    await handleDocumentEditConfirmation(input, deps);

    expect(deps.invokeForRequest).toHaveBeenCalledWith("document.write", input.built, { documentConfirmed: true });
    expect(deps.reply).toHaveBeenCalledWith(7, expect.objectContaining({ content: expect.anything() }));
  });

  it.each([
    [{ supported: true, confirmed: false, action: "decline" as const }, "declined"],
    [{ supported: true, confirmed: false, action: "timeout" as const }, "timeout"],
    [{ supported: false }, "declined"],
  ])("returns typed fail-closed evidence for %s", async (confirm, reason) => {
    const deps = dependencies(confirm);

    await handleDocumentEditConfirmation(input, deps);

    expect(deps.invokeForRequest).not.toHaveBeenCalled();
    expect(deps.reply).toHaveBeenCalledWith(7, expect.objectContaining({
      isError: true,
      structuredContent: { nomiOutcome: { operation: "document.write", applied: false, denied: true, reason } },
    }));
  });

  it("uses the Chinese fail-closed message when the user declines", async () => {
    const deps = dependencies({ supported: true, confirmed: false, action: "decline" }, "zh-CN");

    await handleDocumentEditConfirmation(input, deps);

    expect(deps.reply).toHaveBeenCalledWith(7, expect.objectContaining({
      content: [{ type: "text", text: "未生效：这次文稿修改没有获得批准。" }],
    }));
  });
});
