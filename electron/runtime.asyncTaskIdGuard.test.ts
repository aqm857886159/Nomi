import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let userDataRoot = "";

vi.mock("electron", () => ({
  app: { getPath: () => userDataRoot, getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  webContents: { getAllWebContents: () => [] },
}));

beforeEach(() => {
  userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-async-task-id-"));
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(userDataRoot, { recursive: true, force: true });
});

async function seedAsyncVendor(): Promise<void> {
  const store = await import("./catalog/catalogStore");
  store.upsertModelCatalogVendor({
    key: "missing-id-provider",
    name: "Missing ID provider",
    enabled: true,
    authType: "bearer",
    baseUrlHint: "https://missing-id.example.test",
  });
  store.upsertModelCatalogVendorApiKey("missing-id-provider", { apiKey: "test-key" });
  store.upsertModelCatalogModel({
    vendorKey: "missing-id-provider",
    modelKey: "async-video",
    kind: "video",
    enabled: true,
  });
  store.upsertModelCatalogMapping({
    vendorKey: "missing-id-provider",
    modelKey: "async-video",
    taskKind: "text_to_video",
    name: "async video",
    create: {
      method: "POST",
      path: "/create",
      body: { prompt: "{{request.prompt}}" },
      response_mapping: { status: "status" },
    },
    query: {
      method: "GET",
      path: "/tasks/{{providerMeta.task_id}}",
      response_mapping: { status: "status" },
    },
  });
}

describe("async provider request-id guard", () => {
  it("fails closed after one create when the provider omits its remote task id", async () => {
    await seedAsyncVendor();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "IN_QUEUE" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchFn);

    const { mintSpendGrant } = await import("./spendGrant");
    const { runTask } = await import("./runtime");
    const result = await runTask({
      vendor: "missing-id-provider",
      request: {
        kind: "text_to_video",
        prompt: "one request only",
        extras: { modelKey: "async-video", grantId: mintSpendGrant({ nodeIds: [] }) },
      },
    });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/task ID|任务编号/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("/create");
  });
});
