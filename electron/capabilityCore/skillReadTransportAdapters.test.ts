import { describe, expect, it, vi } from "vitest";

import type { RuntimeToolCall } from "../harness/runtime/runtimePort";
import { SKILL_READ_CAPABILITY } from "../shared/agentCapabilities/skillRead";
import type { SkillRecord } from "../skills/skillStore";
import { createPiSkillReadTransportAdapter } from "./skillReadTransportAdapters";

function record(overrides: Partial<SkillRecord> = {}): SkillRecord {
  return {
    name: "brand.promo",
    directoryName: "brand-promo",
    filePath: "/not-returned/SKILL.md",
    description: "A compact brand workflow",
    body: "# Brand promo\nUse the approved brand palette.",
    manifest: null,
    origin: "user",
    audience: "internal",
    packageVersion: "nomi-skill-v1",
    contentHash: "a".repeat(64),
    ...overrides,
  };
}

function call(args: unknown): RuntimeToolCall {
  return { toolCallId: "skill-read-1", toolName: SKILL_READ_CAPABILITY.aliases.pi, args };
}

function liveSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("skill.read transport adapter", () => {
  it("loads the same bounded catalog record without approval or path leakage", async () => {
    const readRecords = vi.fn(() => [record()]);
    const adapter = createPiSkillReadTransportAdapter({ readRecords });
    const result = await adapter.tryExecute(call({ name: "brand-promo" }), liveSignal());
    expect(result).toMatchObject({
      ok: true,
      silent: true,
      result: {
        loaded: true,
        name: "brand.promo",
        directoryName: "brand-promo",
        body: expect.stringContaining("approved brand palette"),
        contentHash: "a".repeat(64),
      },
    });
    expect(result).not.toHaveProperty("result.filePath");
    expect(readRecords).toHaveBeenCalledOnce();
  });

  it("rejects malformed, missing, and stale reads instead of returning a guessed body", async () => {
    const adapter = createPiSkillReadTransportAdapter({ readRecords: () => [record()] });
    await expect(adapter.tryExecute(call({ name: "" }), liveSignal())).resolves.toMatchObject({
      ok: false,
      code: "capability_input_invalid",
    });
    await expect(adapter.tryExecute(call({ name: "missing" }), liveSignal())).resolves.toMatchObject({
      ok: false,
      code: "skill_not_found",
    });
    await expect(adapter.tryExecute(call({ name: "brand.promo", expectedContentHash: "b".repeat(64) }), liveSignal())).resolves.toMatchObject({
      ok: false,
      code: "skill_changed_before_load",
    });
  });

  it("fails closed after cancellation or disposal", async () => {
    const adapter = createPiSkillReadTransportAdapter({ readRecords: () => [record()] });
    const controller = new AbortController();
    controller.abort();
    await expect(adapter.tryExecute(call({ name: "brand.promo" }), controller.signal)).resolves.toMatchObject({
      ok: false,
      code: "capability_cancelled",
    });
    adapter.dispose();
    await expect(adapter.tryExecute(call({ name: "brand.promo" }), liveSignal())).resolves.toMatchObject({
      ok: false,
      code: "capability_surface_unavailable",
    });
  });

  it("does not handle another tool alias", async () => {
    const adapter = createPiSkillReadTransportAdapter({ readRecords: () => [record()] });
    await expect(adapter.tryExecute({ ...call({ name: "brand.promo" }), toolName: "author_skill" }, liveSignal())).resolves.toBeNull();
  });
});
