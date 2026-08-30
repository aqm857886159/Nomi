import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeTurnRequest, RuntimeTurnResult } from "../harness/runtime/runtimePort";
import type { CatalogState } from "../catalog/types";

const state = vi.hoisted(() => ({
  catalog: undefined as CatalogState | undefined,
  prepared: undefined as RuntimeTurnRequest | undefined,
  decryptString: vi.fn((value: Buffer) => value.toString("utf8")),
}));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", getAppPath: () => process.cwd() },
  safeStorage: { decryptString: state.decryptString },
}));
vi.mock("../catalog/catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/catalogStore")>(),
  readCatalog: () => state.catalog,
}));
vi.mock("../memory/projectMemory", () => ({ getProjectMemory: () => ({ facts: [] }), formatMemoryForPrompt: () => "" }));
vi.mock("../skills/skillStore", () => ({ findSkillRecord: () => null }));
vi.mock("../harness/context/contextService", () => ({
  createAgentContextService: () => ({
    run: async (_scope: unknown, prepare: (signal: AbortSignal) => Promise<RuntimeTurnRequest>) => {
      state.prepared = await prepare(new AbortController().signal);
      return {
        status: "finished",
        text: "unexpected",
        finishReason: "stop",
        usage: { promptTokens: 0, completionTokens: 0, cachedPromptTokens: 0, totalTokens: 0 },
        toolCalls: [],
        snapshot: "unused",
      } satisfies RuntimeTurnResult;
    },
  }),
}));

import { runAgentChatV2 } from "./agentChatV2";

const now = "2026-08-28T00:00:00.000Z";

beforeEach(() => {
  state.prepared = undefined;
  state.decryptString.mockClear();
  state.catalog = {
    version: 8,
    vendors: [
      { key: "selected", name: "Selected", enabled: true, authType: "bearer", createdAt: now, updatedAt: now },
      { key: "unrelated", name: "Unrelated", enabled: true, authType: "bearer", baseUrlHint: "https://unrelated.example.test/v1", createdAt: now, updatedAt: now },
    ],
    models: [
      { vendorKey: "selected", modelKey: "same-chat", labelZh: "Selected", kind: "text", enabled: true, createdAt: now, updatedAt: now },
      { vendorKey: "unrelated", modelKey: "same-chat", labelZh: "Unrelated", kind: "text", enabled: true, createdAt: now, updatedAt: now },
    ],
    mappings: [],
    apiKeysByVendor: {
      unrelated: {
        vendorKey: "unrelated",
        apiKey: Buffer.from("unrelated-secret").toString("base64"),
        enc: "safeStorage",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
  };
});

describe("agentChatV2 explicit text identity", () => {
  it("does not prepare or send a runtime request for an unrelated same-name vendor when the selected credential is missing", async () => {
    const hooks = { emit: vi.fn(), awaitToolConfirmation: vi.fn(async () => ({ ok: true as const, result: {} })) };

    await expect(runAgentChatV2({
      prompt: "hello",
      displayPrompt: "hello",
      capability: "canvas-chat",
      history: { kind: "ephemeral" },
      agentVendorKey: "selected",
      agentModelKey: "same-chat",
    }, hooks)).rejects.toMatchObject({
      code: "text_model_unavailable",
      reason: "credential_missing",
      vendorKey: "selected",
      modelKey: "same-chat",
    });

    expect(state.prepared).toBeUndefined();
    expect(state.decryptString).not.toHaveBeenCalled();
  });
});
