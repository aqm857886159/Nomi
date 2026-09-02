import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateToolArguments } from "./mcpArgValidation";
import { MCP_INTEGRATION_MANAGEMENT_TOOL } from "./mcpIntegrationManagementTools";

const state = vi.hoisted(() => ({ root: "", available: true }));
vi.mock("electron", () => ({
  app: { getPath: () => state.root, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8").replace(/^sealed:/, ""),
  },
}));

describe("MCP integration management contract", () => {
  beforeEach(() => {
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-mcp-management-"));
    fs.writeFileSync(path.join(state.root, "model-catalog.json"), JSON.stringify({
      version: 12,
      vendors: [{ key: "relay", name: "Relay", enabled: true, authType: "bearer", providerKind: "openai-compatible", baseUrlHint: "https://old.example/v1", network: { proxyUrl: "http://127.0.0.1:7890" }, createdAt: "t", updatedAt: "t" }],
      models: [{ vendorKey: "relay", modelKey: "old-model" }],
      mappings: [],
      apiKeysByVendor: {},
    }));
    vi.resetModules();
  });

  it("does not admit API keys and maps management verbs to backend routes", () => {
    expect(validateToolArguments(MCP_INTEGRATION_MANAGEMENT_TOOL.name, MCP_INTEGRATION_MANAGEMENT_TOOL.inputSchema, {
      action: "update_vendor", vendorKey: "relay", baseUrl: "https://new.example/v1", apiKey: "secret",
    })?.message).toContain("未知参数");
    expect(MCP_INTEGRATION_MANAGEMENT_TOOL.resolveMethod({ action: "set_proxy" })).toBe("integration.manage.set_proxy");
  });

  it("updates the connection, makes the proxy effective, and deletes model/vendor lineage", async () => {
    const { manageModelCatalogConnection } = await import("../catalog/catalogManagement");
    const { readCatalog } = await import("../catalog/catalogStore");
    const { providerProxyUrl } = await import("../providerNetwork");
    manageModelCatalogConnection({ action: "update_vendor", vendorKey: "relay", baseUrl: "https://new.example/v1", authType: "x-api-key" });
    expect(readCatalog().vendors[0].baseUrlHint).toBe("https://new.example/v1");
    manageModelCatalogConnection({ action: "set_proxy", vendorKey: "relay", enabled: true });
    expect(readCatalog().vendors[0].network?.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(providerProxyUrl(readCatalog().vendors[0])).toBe("http://127.0.0.1:7890");
    manageModelCatalogConnection({ action: "set_proxy", vendorKey: "relay", enabled: false });
    expect(providerProxyUrl(readCatalog().vendors[0])).toBeUndefined();
    expect(manageModelCatalogConnection({ action: "delete_model", vendorKey: "relay", modelKey: "old-model" })).toMatchObject({ deleted: true });
    expect(manageModelCatalogConnection({ action: "delete_vendor", vendorKey: "relay" })).toMatchObject({ deleted: true });
    expect(readCatalog().vendors).toHaveLength(0);
  });
});
