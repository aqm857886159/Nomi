// Fixture user accepts the quote card; the real taskSpend guard still runs.
vi.mock("./capabilityCore/rendererBridge", () => ({
  requestRendererDecision: vi.fn(async (operation: string) => {
    if (operation !== "spend.confirm") throw new Error(`Unexpected renderer operation: ${operation}`);
    return { confirmed: true };
  }),
  requestRenderer: vi.fn(async (operation: string) => {
    throw new Error(`Spend confirmation must not use the timeout-bound bridge: ${operation}`);
  }),
}));

// 第一闸、第三闸照常执行，只是记下它们收到的参数。
vi.mock("./catalog/taskParams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./catalog/taskParams")>();
  return { ...actual, imageEditGuardError: vi.fn(actual.imageEditGuardError), applyHeadlessParamDefaults: vi.fn(actual.applyHeadlessParamDefaults) };
});

/**
 * 运行时第一闸、第三闸拿到的模型身份必须带连接自己的 meta（2026-10-25 #1331 独立验收；2026-10-27 第一闸）。
 *
 * 型号名认不出的模型（自建中转、用户接入）只能靠 meta 认档案与自写能力合同：第三闸据此判哪些键是参考、
 * 拒发时怎么说下一步；第一闸（applyHeadlessParamDefaults）据此在出网前按合同声明的上限拒超量参考。
 * runtime.ts 把身份交给这两闸时若丢了 meta，清单那条路照样对，两闸却悄悄退回键名推断——这里锁的就是这根线。
 * 2026-10-27 之前第一闸只收 archetypeId（递给投影边界的是 `{ archetypeId }` 缩减对象），自写合同的上限进不来。
 */

let mockedUserDataRoot = "";
const tempRoots: string[] = [];

vi.mock("electron", () => ({
  app: {
    getPath: () => mockedUserDataRoot,
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor, upsertModelCatalogVendorApiKey } from "./catalog/catalogStore";
import { applyHeadlessParamDefaults, imageEditGuardError } from "./catalog/taskParams";
import { setSubmitOutboundDepsForTests } from "./vendor/vendorOutboundGuard";
import { desktopT } from "./desktopStrings";
import { mintSpendGrant } from "./spendGrant";
import { runTask } from "./runtime";

const META = { archetypeId: "rh-seedream-4.5" };

describe("runTask × 第三闸的模型身份", () => {
  beforeEach(() => {
    mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-reference-selection-"));
    tempRoots.push(mockedUserDataRoot);
    vi.mocked(imageEditGuardError).mockClear();
  });
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("型号名认不出、只靠 meta.archetypeId 认档案的模型：第三闸收到的身份带着这份 meta 和这次的 kind", async () => {
    upsertModelCatalogVendor({ key: "custom-ref", name: "Ref", baseUrlHint: "https://ref.example/v1", authType: "bearer", enabled: true });
    upsertModelCatalogVendorApiKey("custom-ref", { apiKey: "sk-ref-1", enabled: true });
    upsertModelCatalogModel({
      vendorKey: "custom-ref",
      modelKey: "relay-custom-edit",
      kind: "image",
      enabled: true,
      meta: META,
      customCall: { modes: { edit: { script: "return 'data:image/png;base64,eA=='" } } },
    });
    const grantId = mintSpendGrant({ nodeIds: ["n1"] });

    const result = await runTask({
      vendor: "custom-ref",
      request: {
        kind: "image_edit",
        prompt: "keep the subject",
        extras: {
          modelKey: "relay-custom-edit",
          nodeId: "n1",
          grantId,
          archetype: { id: META.archetypeId, modeId: "edit" },
          referenceImages: ["https://cdn.example.com/reference.png"],
        },
      },
    });

    expect(result.status).toBe("succeeded");
    const calls = vi.mocked(imageEditGuardError).mock.calls;
    expect(calls).toHaveLength(1);
    // 第 7 个参数：交给第三闸的模型身份（selected）。
    expect(calls[0]?.[6]).toMatchObject({
      vendorKey: "custom-ref",
      modelKey: "relay-custom-edit",
      modelMeta: META,
      taskKind: "image_edit",
    });
  });
});

describe("runTask × 第一闸（applyHeadlessParamDefaults）：自写能力合同的参考上限在出网前拒", () => {
  const customCapabilityContract = {
    version: 1,
    kind: "video",
    defaultModeId: "references",
    transportTaskKind: "image_to_video",
    modes: [{
      id: "references", intent: "character", vendorTerm: "Multi reference", hint: "One to eight ordered reference images",
      promptRequired: true, transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "Reference images", min: 1, max: 8, inputKey: "image_urls", asArray: true }],
      params: [],
    }],
  };
  // 出网口换成进程内记账的 fetch（不出网、不花钱）；提交侧出站授权的 DNS 事实钉成「公网、无代理」（同 vendorHttp.test.ts）。
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];

  beforeEach(() => {
    mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-first-gate-"));
    tempRoots.push(mockedUserDataRoot);
    sent.length = 0;
    vi.mocked(imageEditGuardError).mockClear();
    vi.mocked(applyHeadlessParamDefaults).mockClear();
    setSubmitOutboundDepsForTests({
      resolve: async () => [{ address: "93.184.216.34", family: 4 as const }],
      readEnvironment: async () => ({ syntheticResolver: false, syntheticSample: "" }),
      isApplicationProxyActive: () => false,
    });
    // 上游回 400：只为数清「发没发、发了几张」，任务不进入轮询。
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input instanceof Request ? input.url : input), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return new Response(JSON.stringify({ error: { message: "fixture stops here" } }), { status: 400, headers: { "content-type": "application/json" } });
    }));
    upsertModelCatalogVendor({ key: "custom-relay", name: "Relay", baseUrlHint: "https://relay.example/v1", authType: "bearer", enabled: true });
    upsertModelCatalogVendorApiKey("custom-relay", { apiKey: "sk-relay-1", enabled: true });
    upsertModelCatalogModel({ vendorKey: "custom-relay", modelKey: "custom-video-v1", kind: "video", enabled: true, meta: { customCapabilityContract } });
    upsertModelCatalogMapping({
      id: "custom-relay-image_to_video", vendorKey: "custom-relay", modelKey: "custom-video-v1", taskKind: "image_to_video", name: "Custom references", enabled: true,
      create: { method: "POST", path: "/videos", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image_urls: "{{request.params.image_urls}}" }, response_mapping: { task_id: "id" } },
    });
  });
  afterEach(() => {
    setSubmitOutboundDepsForTests(null);
    vi.unstubAllGlobals();
    for (const dir of tempRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (count: number) => runTask({
    vendor: "custom-relay",
    request: {
      kind: "image_to_video",
      prompt: "the same character walks in",
      extras: {
        modelKey: "custom-video-v1",
        nodeId: "n1",
        grantId: mintSpendGrant({ nodeIds: ["n1"] }),
        referenceImages: Array.from({ length: count }, (_, index) => `https://cdn.example/reference-${index + 1}.png`),
      },
    },
  });

  it("9 张参考：以「这个模型最多收 8张图片参考。」拒，上游一次都没收到", async () => {
    await expect(run(9)).rejects.toThrow(desktopT("modelConstraints.imageReferenceCapacity", { max: 8 }));
    expect(sent).toHaveLength(0);
    // 第一闸收到的就是这次连接的完整身份（带自写合同）。
    expect(vi.mocked(applyHeadlessParamDefaults).mock.calls[0]?.[1]).toMatchObject({
      vendorKey: "custom-relay", modelKey: "custom-video-v1", modelMeta: { customCapabilityContract }, taskKind: "image_to_video",
    });
  });

  it("阳性对照：8 张照常发出一次，请求体 image_urls 恰 8 张；第一闸与第三闸收到的是同一份身份", async () => {
    await run(8).catch(() => undefined);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.image_urls).toHaveLength(8);
    const first = vi.mocked(applyHeadlessParamDefaults).mock.calls[0]?.[1];
    expect(first).toMatchObject({ modelMeta: { customCapabilityContract } });
    expect(vi.mocked(imageEditGuardError).mock.calls[0]?.[6]).toBe(first);
  });
});
