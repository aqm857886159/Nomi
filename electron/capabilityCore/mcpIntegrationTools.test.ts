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

// 面收敛（surface-16-collapse）：10 个 integration_* 工具塌成 1 个 nomi_integration（action 枚举 + expectedRevision 单锁）。
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
