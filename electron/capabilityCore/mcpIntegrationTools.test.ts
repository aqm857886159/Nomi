import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { dispatch } from "./dispatcher";
import { validateToolArguments } from "./mcpArgValidation";
import { MCP_INTEGRATION_TOOL } from "./mcpIntegrationTools";
import { MCP_TOOL_CATALOG } from "./mcpToolCatalog";
import { createMcpProtocol, type McpTransport } from "./mcpProtocol";
import { IntegrationSessionService } from "../integrationCertification/integrationSession";

// Q8：T14 只保留 5 个确定性缝，provider discovery/workflow orchestration 由 Agent 在 propose 外完成。
function beginTool() {
  return MCP_INTEGRATION_TOOL;
}

function service(overrides: ConstructorParameters<typeof IntegrationSessionService>[0] = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-integration-"));
  return new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
    credentialResolver: () => "relay-test-key",
    approvalReceiptAuthority: {
      requestChallenge: () => ({ challenge: {
        challengeId: "challenge-test",
        expiresAt: "2099-01-01T00:00:00.000Z",
        contractHash: "contract",
        reservationPreview: { maximum: 1, currency: "USD" },
      } }),
    } as never,
    ...overrides,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("MCP integration tool contract", () => {
  it('queues the durable handoff before notifying the GUI navigation callback', async () => {
    const sessions = service()
    const created = await dispatch('integration.begin', {
      kind: 'http-api-provider', name: 'Kling', baseUrl: 'https://api.kling.example/v1', providerKind: 'openai-compatible',
    }, { integrationSessions: sessions, origin: { host: 'claude' } } as never) as { id: string; revision: number }
    const order: string[] = []
    const opened = await dispatch('integration.open_credentials', {
      sessionId: created.id, expectedRevision: created.revision,
    }, {
      integrationSessions: sessions,
      origin: { host: 'claude' },
      openCredentialsInNomi: async ({ sessionId, vendorName }: { sessionId: string; vendorName: string }) => {
        order.push(`${sessionId}:${vendorName}:${sessions.get(sessionId, 'claude').stage}`)
        return { opened: true }
      },
    } as never) as Record<string, unknown>
    expect(order).toEqual([`${created.id}:Kling:needs_credential`])
    expect(opened.credentialUiOpened).toBe(true)
    expect(opened.credentialEntry).toBeUndefined()
  })

  it('keeps the manual startup fallback when the GUI navigation callback is unavailable', async () => {
    const handoffs: unknown[] = []
    const sessions = service({ enqueueHandoff: (handoff) => handoffs.push(handoff) })
    const created = await dispatch('integration.begin', {
      kind: 'http-api-provider', name: 'Kling', baseUrl: 'https://api.kling.example/v1', providerKind: 'openai-compatible',
    }, { integrationSessions: sessions, origin: { host: 'claude' } } as never) as { id: string; revision: number }
    const opened = await dispatch('integration.open_credentials', {
      sessionId: created.id, expectedRevision: created.revision,
    }, {
      integrationSessions: sessions,
      origin: { host: 'claude' },
      openCredentialsInNomi: async () => { throw new Error('renderer unavailable') },
    } as never) as Record<string, unknown>
    expect(handoffs).toHaveLength(1)
    expect(opened.credentialUiOpened).toBe(false)
  })

  it("accepts only public begin configuration and rejects credential-shaped fields", () => {
    const tool = beginTool();
    const valid = {
      action: "begin",
      kind: "http-api-provider",
      name: "Example",
      baseUrl: "https://api.example/v1",
      docs: "https://docs.example/api",
      providerKind: "openai",
      authType: "x-api-key",
      authHeader: "X-Api-Key",
      authQueryParam: "key",
      clientRequestId: "request-1",
    };
    expect(validateToolArguments(tool.name, tool.inputSchema, valid)).toBeNull();
    expect(validateToolArguments(tool.name, tool.inputSchema, { ...valid, apiKey: "secret" })?.message).toContain("未知参数");
    expect(validateToolArguments(tool.name, tool.inputSchema, { ...valid, authorization: "Bearer secret" })?.message).toContain("未知参数");
    expect(validateToolArguments(tool.name, tool.inputSchema, { ...valid, authType: "custom" })?.message).toContain("必须是以下之一");
  });

  it("forwards public authentication metadata while retaining no credential value", async () => {
    const sessions = service();
    const result = await dispatch(
      "integration.begin",
      {
        kind: "http-api-provider",
        name: "Example",
        baseUrl: "https://api.example/v1/",
        docs: "https://docs.example/api",
        providerKind: "openai",
        authType: "x-api-key",
        authHeader: "X-Api-Key",
        authQueryParam: "key",
      },
      { integrationSessions: sessions, origin: { host: "codex" } } as never,
    );
    expect(result).toMatchObject({
      ownerClientId: "codex",
      config: {
        baseUrl: "https://api.example/v1",
        providerKind: "openai",
        authType: "x-api-key",
        authHeader: "X-Api-Key",
        authQueryParam: "key",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(JSON.stringify(result)).not.toContain("credentialRef");
  });

  it("rejects unsigned external clients before a session or UI handoff can be created", async () => {
    const sessions = service();
    await expect(
      dispatch(
        "integration.begin",
        { kind: "http-api-provider", name: "Example", baseUrl: "https://api.example" },
        { integrationSessions: sessions, origin: { host: "external" } } as never,
      ),
    ).rejects.toThrow(/signed client identity/i);
  });

  it("accepts a complete public proposal, rejects bad fields readably, and supports CAS patch retry", async () => {
    const sessions = service();
    const created = await dispatch(
      "integration.begin",
      { kind: "http-api-provider", name: "Relay", baseUrl: "https://relay.example/v1" },
      { integrationSessions: sessions, origin: { host: "codex" } } as never,
    ) as { id: string; revision: number };
    const ready = sessions.markCredentialReady(created.id, "ref-never-returned", "codex");
    const invalid = {
      candidates: [{ modelKey: "relay-text", kind: "text", apiKey: "secret" }],
      selections: [{ modelKey: "relay-text" }],
    };
    expect(validateToolArguments(MCP_INTEGRATION_TOOL.name, MCP_INTEGRATION_TOOL.inputSchema, {
      action: "propose", sessionId: created.id, expectedRevision: ready.revision, proposal: invalid,
    })?.message).toContain("未知参数");
    await expect(dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision,
      proposal: { candidates: [{ modelKey: "relay-text", kind: "image" }], selections: [{ modelKey: "wrong" }] },
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never)).rejects.toThrow(/proposal\.selections\[0\]\.modelKey.*proposal\.candidates/);
    expect(sessions.get(created.id, "codex").revision).toBe(ready.revision);
    const accepted = await dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision,
      proposal: { candidates: [{ modelKey: "relay-text", kind: "text" }], selections: [{ modelKey: "relay-text" }] },
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { stage: string; revision: number; selections: unknown[] };
    expect(accepted.stage).toBe("needs_spend_confirmation");
    expect(accepted.selections).toHaveLength(1);
    await expect(dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision,
      proposal: { candidates: [{ modelKey: "relay-text", kind: "text" }], selections: [{ modelKey: "relay-text" }] },
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never)).rejects.toThrow(/stale/);
  });

  it("rejects an invalid ComfyUI proposal before the CAS write", async () => {
    const sessions = service();
    const created = await dispatch(
      "integration.begin",
      { kind: "comfyui-workflow", name: "Workflow" },
      { integrationSessions: sessions, origin: { host: "codex" } } as never,
    ) as { id: string; revision: number };
    await expect(dispatch("integration.propose", {
      sessionId: created.id,
      expectedRevision: created.revision,
      proposal: { workflow: "{}" },
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never)).rejects.toThrow(/proposal\.workflow/);
    expect(sessions.get(created.id, "codex").revision).toBe(created.revision);
  });

  it("discovers a relay model list during propose and marks unmatched ids as plain text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "relay-chat" }, { id: "house-model" }] }), { status: 200 })));
    const sessions = service();
    const created = await dispatch("integration.begin", {
      kind: "http-api-provider", name: "Relay", baseUrl: "https://relay.example/v1", providerKind: "openai-compatible",
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { id: string; revision: number };
    const ready = sessions.markCredentialReady(created.id, "ref-never-returned", "codex");
    const discovered = await dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision, proposal: {},
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { candidates: Array<Record<string, unknown>>; stage: string; revision: number };
    expect(discovered.stage).toBe("needs_selection");
    expect(discovered.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "relay-chat", kind: "text", classification: "unknown" }),
      expect.objectContaining({ modelKey: "house-model", kind: "text", classification: "unknown" }),
    ]));
    expect(JSON.stringify(discovered)).toContain("纯文本");
    const selected = await dispatch("integration.propose", {
      sessionId: created.id,
      expectedRevision: discovered.revision,
      proposal: {
        candidates: discovered.candidates.map(({ modelKey, kind }) => ({ modelKey, kind })),
        selections: [{ modelKey: "relay-chat" }],
      },
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { revision: number; stage: string };
    expect(selected.stage).toBe("needs_spend_confirmation");
    const confirmation = await dispatch("integration.request_confirmation", {
      sessionId: created.id, expectedRevision: selected.revision, idempotencyKey: "relay-discovery-confirm",
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { challengeId: string };
    expect(confirmation.challengeId).toMatch(/^challenge-/);
  });

  it("returns a readable manual model-id fallback when the relay has no models route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "not found" }), { status: 404 })));
    const sessions = service();
    const created = await dispatch("integration.begin", {
      kind: "http-api-provider", name: "Relay", baseUrl: "https://relay.example", providerKind: "openai-compatible",
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { id: string; revision: number };
    const ready = sessions.markCredentialReady(created.id, "ref-never-returned", "codex");
    await expect(dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision, proposal: {},
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never)).rejects.toThrow(/手动填写 model ID|model ID/i);
  });

  it("derives media capability from OpenRouter architecture metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "openrouter/image", architecture: { input_modalities: ["text", "image"], output_modalities: ["image"], supported_parameters: ["temperature"] } },
      { id: "openrouter/video", architecture: { input_modalities: ["text"], output_modalities: ["video"] } },
    ] }), { status: 200 })));
    const sessions = service();
    const created = await dispatch("integration.begin", {
      kind: "http-api-provider", name: "OpenRouter relay", baseUrl: "https://relay.example/v1", providerKind: "openai-compatible",
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { id: string; revision: number };
    const ready = sessions.markCredentialReady(created.id, "ref-never-returned", "codex");
    const discovered = await dispatch("integration.propose", {
      sessionId: created.id, expectedRevision: ready.revision, proposal: {},
    }, { integrationSessions: sessions, origin: { host: "codex" } } as never) as { candidates: Array<Record<string, unknown>> };
    expect(discovered.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelKey: "openrouter/image", kind: "image", modes: ["text_to_image", "image_to_image"], classification: "supported" }),
      expect.objectContaining({ modelKey: "openrouter/video", kind: "video", modes: ["text_to_video"], classification: "supported" }),
    ]));
  });

  it("advertises every integration action to tools-only clients without reading a Skill resource", async () => {
    const sent: unknown[] = [];
    const transport: McpTransport = {
      send: (message) => { sent.push(message); },
      invoke: async () => { throw new Error("tools/list must not read skills"); },
      isAppOpen: () => false,
    };
    const protocol = createMcpProtocol(transport);
    protocol.handleIncoming({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const response = sent[0] as { result?: { tools?: Array<{ name: string }> } };
    const names = response.result?.tools?.map((tool) => tool.name) || [];
    // 面收敛：整族接入收进单个 nomi_integration 工具。
    expect(names).toContain(MCP_INTEGRATION_TOOL.name);
    expect(MCP_INTEGRATION_TOOL.name).toBe("nomi_integration");
    expect(MCP_TOOL_CATALOG.map((tool) => tool.name)).toContain("nomi_integration");
  });
});
