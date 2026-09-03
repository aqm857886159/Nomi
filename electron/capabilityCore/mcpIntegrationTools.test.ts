import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

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

function service() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-integration-"));
  return new IntegrationSessionService({
    filePath: path.join(dir, "sessions.json"),
    save: (target, state) => fs.writeFileSync(target, JSON.stringify(state)),
  });
}

describe("MCP integration tool contract", () => {
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
