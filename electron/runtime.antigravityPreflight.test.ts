// Fixture user accepts the quote card; the real taskSpend guard still runs.
vi.mock("./capabilityCore/rendererBridge", () => ({
  // 付费确认等的是**人**，走没有墙钟期限的那条（2026-09-11 拍板：审批卡永不因空闲超时）。
  requestRendererDecision: vi.fn(async (operation: string) => {
    if (operation !== "spend.confirm") throw new Error(`Unexpected renderer operation: ${operation}`);
    return { confirmed: true };
  }),
  // 带超时的那条是给「渲染层自己干活」用的。付费路径再走到它就是回归，所以这里直接炸。
  requestRenderer: vi.fn(async (operation: string) => {
    throw new Error(`Spend confirmation must not use the timeout-bound bridge: ${operation}`);
  }),
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(), run: vi.fn(), requested: vi.fn(), completed: vi.fn(), admitted: vi.fn(),
}));

let userDataRoot = "";
vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock("./ai/antigravityTask", () => ({
  prepareAntigravityTask: (...args: unknown[]) => mocks.preflight(...args),
  runPreparedAntigravityTask: (...args: unknown[]) => mocks.run(...args),
  assertPreparedAntigravityTaskMatches: vi.fn(),
  consumePreparedAntigravityTask: vi.fn(),
}));
vi.mock("./events/vendorCallTrace", () => ({
  traceVendorRequested: (...args: unknown[]) => mocks.requested(...args),
  traceVendorCompleted: (...args: unknown[]) => mocks.completed(...args),
}));
vi.mock("./tasks/taskAdmission", () => ({
  markTaskAdmitted: (...args: unknown[]) => mocks.admitted(...args),
  wasTaskAdmitted: () => false,
}));

const prepared = {
  discovery: { version: "1.1.21", models: [{ id: "real-model", label: "Real" }] },
  invocation: { command: "/probe/A/agy", args: [] },
  identity: { realpath: "/probe/A/agy", dev: "1", ino: "2", size: "3", mtimeNs: "4", ctimeNs: "5" },
  env: {}, capability: "image", modelId: "auto", prompt: "draw", model: "auto", images: [],
};

async function writeCatalog(mutate?: (mapping: Record<string, unknown>) => Record<string, unknown>) {
  const [{ antigravityImageMappings }, { CURRENT_CATALOG_VERSION }] = await Promise.all([
    import("./catalog/antigravityCatalog"), import("./catalog/types"),
  ]);
  const status = { state: "ready" as const, version: "1.1.21", checkedAt: Date.now(), loginCommand: "agy", models: [],
    checks: [{ capability: "image" as const, modelId: "auto", state: "passed" as const, version: "1.1.21", checkedAt: Date.now() }] };
  const mapping = antigravityImageMappings(status)[0] as unknown as Record<string, unknown>;
  fs.writeFileSync(path.join(userDataRoot, "model-catalog.json"), JSON.stringify({
    version: CURRENT_CATALOG_VERSION,
    vendors: [{ key: "antigravity-cli", name: "Antigravity CLI", authType: "none", enabled: true, baseUrlHint: "local://antigravity" }],
    models: [{ vendorKey: "antigravity-cli", modelKey: "generate_image", labelZh: "Antigravity image", kind: "image", enabled: true,
      createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }],
    mappings: [mutate ? mutate(mapping) : mapping], apiKeysByVendor: {},
  }), "utf8");
}

async function request(grantId: string) {
  const { runTask } = await import("./runtime");
  return runTask({ vendor: "antigravity-cli", request: { kind: "text_to_image", prompt: "draw",
    extras: { modelKey: "generate_image", projectId: "project", nodeId: "node", grantId } } });
}

describe("runTask Antigravity create preflight", () => {
  beforeEach(() => {
    userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-runtime-antigravity-preflight-"));
    vi.resetModules(); vi.clearAllMocks();
    mocks.preflight.mockResolvedValue(prepared);
    mocks.run.mockResolvedValue({ text: "done", conversationId: "c", usage: {}, artifacts: [] });
  });
  afterEach(async () => {
    (await import("./spendGrant")).__resetSpendGrantsForTests();
    fs.rmSync(userDataRoot, { recursive: true, force: true });
  });

  it.each([
    ["missing proof", () => new Error("ANTIGRAVITY_TEST_REQUIRED")],
    ["wrong proof", () => new Error("ANTIGRAVITY_TEST_REQUIRED")],
  ])("rejects %s before spend, admission, trace, or queued response", async (_name, failure) => {
    await writeCatalog(); mocks.preflight.mockRejectedValueOnce(failure());
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId)).rejects.toThrow("ANTIGRAVITY_TEST_REQUIRED");
    expect(spend.__spendGrantCountForTests()).toBe(1);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.admitted).not.toHaveBeenCalled(); expect(mocks.requested).not.toHaveBeenCalled();
  });

  it("rejects a poisoned create envelope before spend or job admission", async () => {
    await writeCatalog((mapping) => ({ ...mapping, create: { ...(mapping.create as object), body: { prompt: "tampered" } } }));
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId)).rejects.toThrow("ANTIGRAVITY_INVALID_CONFIG");
    expect(spend.__spendGrantCountForTests()).toBe(1);
    expect(mocks.preflight).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.admitted).not.toHaveBeenCalled(); expect(mocks.requested).not.toHaveBeenCalled();
  });

  it("consumes once, queues once, and passes the same prepared invocation to execution", async () => {
    await writeCatalog();
    const spend = await import("./spendGrant");
    const grantId = spend.mintSpendGrant({ nodeIds: ["node"], maxAttemptsPerNode: 1 });
    await expect(request(grantId)).resolves.toMatchObject({ status: "queued" });
    expect(spend.__spendGrantCountForTests()).toBe(0);
    expect(mocks.preflight).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledWith(prepared, { signal: expect.any(AbortSignal) });
    expect(mocks.admitted).toHaveBeenCalledOnce(); expect(mocks.requested).toHaveBeenCalledOnce();
  });
});
