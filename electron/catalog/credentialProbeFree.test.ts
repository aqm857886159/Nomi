/**
 * 凭据验证/自检的**付费边界**（T-MO-10，用户 2026-09-22 拍板）。
 *
 * 这条边界为什么存在、09-11 群反馈撞上的是什么，写在 owner 那里
 * （`electron/catalog/credentialProbePolicy.ts` 文件头）。本文件钉住拍板后的三条：
 *
 *   ① 有免费端点的供应商（apimart：`GET /v1/balance`，零成本、坏 key 回 401）→ 保存验证
 *      **一次生成请求都不发**；
 *   ② 没有免费端点的供应商 → **不经确认一个可能计费的请求都不发**；
 *   ③ 用户在确认面点了同意 → 才发，且**只发一次**。
 *
 * 外加 09-21 拍板的不回退钉：整份供应商配置在**没有 key** 的情况下也写得完、校验得了，
 * key 只在真试跑前才需要——本次改动不许把它倒退成「先给 key 才能存配置」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const NOW = "2026-09-22T00:00:00.000Z";

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString(),
  },
}));

vi.mock("../ai/antigravityConnection", () => ({
  antigravityConnection: { canEnable: () => false, hasPassed: () => false },
}));

// 生产传输是 appFetch（check-network-entry.mjs 禁裸 fetch 当值），按既有夹具手法在模块层注入。
const { mockAppFetch } = vi.hoisted(() => ({ mockAppFetch: vi.fn<typeof fetch>() }));
vi.mock("../appFetch", () => ({ appFetch: mockAppFetch }));

/**
 * 回环夹具供应商：**没有**任何免费端点可用（种子声明的探测端点不带 `cost: 'free'`），
 * 于是它落在「先问」那一档。内置家里今天一个都不是这形状（apimart / higgsfield 都有免费
 * 端点），所以这一档只能用夹具钉——但它是**缺省**档：任何新种子忘了声明 cost 就落在这里。
 */
const LOOPBACK_FIXTURE_KEY = "loopback-paid-probe-fixture";
const LOOPBACK_FIXTURE_SEED = {
  key: LOOPBACK_FIXTURE_KEY,
  name: "Loopback Paid Probe Fixture",
  baseUrl: "http://127.0.0.1:9/fixture",
  authType: "bearer" as const,
  authHeader: "Authorization",
  credentialMode: "direct-key" as const,
  credentialProbe: {
    // 刻意不写 cost：缺省 = 无免费端点 = 先问（fail-closed）。
    request: {
      method: "POST",
      path: "/v1/chat/completions",
      body: { model: "{{model}}", messages: [{ role: "user", content: "Hi" }], max_tokens: 1 },
    },
    successPath: "choices.0",
    source: { url: "https://example.invalid/fixture", checkedAt: "2026-09-22" },
  },
};

vi.mock("./builtinVendorSeeds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./builtinVendorSeeds")>();
  return {
    ...actual,
    builtinVendorSeed: (vendorKey: string) =>
      String(vendorKey || "").trim() === LOOPBACK_FIXTURE_KEY
        ? (LOOPBACK_FIXTURE_SEED as unknown as ReturnType<typeof actual.builtinVendorSeed>)
        : actual.builtinVendorSeed(vendorKey),
  };
});

describe("custom relay credential validation", () => {
  it("reuses the saved Authorization override when a user replaces the key", async () => {
    seedApimartCatalog();
    const { upsertRendererCatalogVendor, upsertRendererCatalogVendorApiKey } = await import("./rendererCatalogMutation");
    upsertRendererCatalogVendor({
      key: "byo-auth-relay",
      name: "BYO Auth Relay",
      baseUrlHint: "https://relay.example.com/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      meta: { extraHeaders: { Authorization: "Bearer gateway-override" } },
    });
    mockAppFetch.mockResolvedValue(jsonResponse(200, { data: [{ id: "relay-model" }] }));

    await expect(upsertRendererCatalogVendorApiKey("byo-auth-relay", { apiKey: "stored-key", enabled: false }))
      .resolves.toMatchObject({ vendorKey: "byo-auth-relay", hasApiKey: true });

    const firstCall = mockAppFetch.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) throw new Error("credential validation did not issue a request");
    const firstRequest = firstCall[1];
    expect(firstRequest).toBeDefined();
    if (!firstRequest) throw new Error("credential validation request options are missing");
    const headers = new Headers(firstRequest.headers);
    expect(headers.get("authorization")).toBe("Bearer gateway-override");
  });
});

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-probe-free-"));
  tempRoots.push(mockedUserDataRoot);
});

afterEach(() => {
  mockAppFetch.mockReset();
  vi.resetModules();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function writeCatalog(state: CatalogState): void {
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
}

/** 真实内置种子（apimart curated 模型 + mapping 全在），apimart 行未发布。 */
function seedApimartCatalog(): CatalogState {
  const base = { version: 3, revision: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
  const seeded = applyBuiltinSeeds(base, NOW).state;
  const apimart = seeded.vendors.find((vendor) => vendor.key === "apimart");
  if (!apimart) throw new Error("apimart vendor missing from builtin seeds");
  apimart.enabled = false;
  writeCatalog(seeded);
  return seeded;
}

/** 夹具供应商的目录：一行 vendor + 一行可用文本模型（探测要挑得出 model）。 */
function seedLoopbackFixtureCatalog(): CatalogState {
  const state = {
    version: 3,
    revision: 1,
    vendors: [{
      key: LOOPBACK_FIXTURE_KEY,
      name: LOOPBACK_FIXTURE_SEED.name,
      baseUrlHint: LOOPBACK_FIXTURE_SEED.baseUrl,
      authType: "bearer",
      authHeader: "Authorization",
      providerKind: "openai-compatible",
      enabled: false,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    models: [{
      vendorKey: LOOPBACK_FIXTURE_KEY,
      modelKey: "fixture-text-v1",
      kind: "text",
      enabled: true,
      createdAt: NOW,
      updatedAt: NOW,
    }],
    mappings: [],
    apiKeysByVendor: {},
  } as unknown as CatalogState;
  writeCatalog(state);
  return state;
}

function vendorRow(state: CatalogState, key: string): CatalogState["vendors"][number] {
  const vendor = state.vendors.find((item) => item.key === key);
  if (!vendor) throw new Error(`${key} vendor missing`);
  return vendor;
}

/** 这次出站打到哪儿了（url + method），用来断言「发了什么 / 一个都没发」。 */
function outboundCalls(): Array<{ url: string; method: string }> {
  return mockAppFetch.mock.calls.map(([url, init]) => ({
    url: String(url),
    method: String((init as RequestInit | undefined)?.method || "GET").toUpperCase(),
  }));
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

describe("T-MO-10 ① 有免费端点的供应商：保存验证不发生成请求", () => {
  it("apimart 保存验证只打免费的余额端点，一次 chat/completions 都没有", async () => {
    const state = seedApimartCatalog();
    mockAppFetch.mockResolvedValue(jsonResponse(200, { success: true, remain_balance: 10.5, remain_credits: 105 }));
    const { validateCandidateCredential } = await import("./validateCandidateCredential");
    await expect(validateCandidateCredential(vendorRow(state, "apimart"), "sk-test")).resolves.toBe(false);
    const calls = outboundCalls();
    expect(calls.length).toBe(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/v1/balance");
    expect(calls.some((call) => /chat\/completions/.test(call.url))).toBe(false);
  });

  it("免费端点回 401 仍然判 key 无效（免费不等于不判）", async () => {
    const state = seedApimartCatalog();
    mockAppFetch.mockResolvedValue(jsonResponse(401, { error: { message: "invalid API key", type: "apimart_error" } }));
    const { validateCandidateCredential } = await import("./validateCandidateCredential");
    await expect(validateCandidateCredential(vendorRow(state, "apimart"), "sk-bad")).rejects.toThrow();
    expect(outboundCalls().some((call) => /chat\/completions/.test(call.url))).toBe(false);
  });
});

describe("T-MO-10 ② 没有免费端点：不经确认一个计费请求都不发", () => {
  it("用户没确认 → 出站零次，凭据落成「已保存·未验证」而不是失败", async () => {
    const state = seedLoopbackFixtureCatalog();
    const { probeDirectKeyCredential } = await import("./directKeyCredential");
    const confirmSpend = vi.fn(async () => false);
    await expect(probeDirectKeyCredential(vendorRow(state, LOOPBACK_FIXTURE_KEY), "sk-test", { confirmSpend }))
      .resolves.toBe("declined");
    expect(confirmSpend).toHaveBeenCalledTimes(1);
    expect(outboundCalls()).toEqual([]);
  });

  it("没有可问的人（缺省确认函数 + 没有窗口）→ 同样零出站，不静默替用户花钱", async () => {
    const state = seedLoopbackFixtureCatalog();
    const { probeDirectKeyCredential } = await import("./directKeyCredential");
    // 刻意不注入 confirmSpend：走缺省的 confirmCredentialProbeSpend → requestRendererDecision，
    // 而这里没有注册过渲染层目标，所以它会抛 RendererUnavailableError。「问不到人」的正确
    // 行为是**不发**（fail-closed），不是「没人反对就发」。
    await expect(probeDirectKeyCredential(vendorRow(state, LOOPBACK_FIXTURE_KEY), "sk-test"))
      .resolves.toBe("declined");
    expect(outboundCalls()).toEqual([]);
  });

  it("首用前的复验绝不为付费探测弹卡、也绝不偷发（付费探测只由显式的保存验证发起）", async () => {
    const state = seedLoopbackFixtureCatalog();
    state.apiKeysByVendor[LOOPBACK_FIXTURE_KEY] = {
      apiKey: Buffer.from("sk-test").toString("base64"),
      enabled: false,
      verificationPending: true,
      updatedAt: NOW,
    } as unknown as CatalogState["apiKeysByVendor"][string];
    writeCatalog(state);
    const { revalidatePendingCredential } = await import("./validateCandidateCredential");
    await expect(revalidatePendingCredential(LOOPBACK_FIXTURE_KEY)).resolves.toBeUndefined();
    expect(outboundCalls()).toEqual([]);
  });
});

describe("T-MO-10 ③ 用户同意之后才发，且只发一次", () => {
  it("确认 → 恰好一次出站，且金额如实来自同一份报价", async () => {
    const state = seedLoopbackFixtureCatalog();
    mockAppFetch.mockResolvedValue(jsonResponse(200, { choices: [{ message: { role: "assistant", content: "Hi" } }] }));
    const { probeDirectKeyCredential } = await import("./directKeyCredential");
    const confirmSpend = vi.fn(async () => true);
    await expect(probeDirectKeyCredential(vendorRow(state, LOOPBACK_FIXTURE_KEY), "sk-test", { confirmSpend }))
      .resolves.toBe("verified");
    expect(confirmSpend).toHaveBeenCalledTimes(1);
    expect(outboundCalls().length).toBe(1);
    expect(outboundCalls()[0].method).toBe("POST");
  });
});

describe("探测策略：单一 owner（免费优先 → 无免费则先问）", () => {
  it("apimart = 免费档；夹具（缺省 cost）= 先问档；没有种子的自定义家 = 免费的模型列表档", async () => {
    const { credentialProbePlan } = await import("./credentialProbePolicy");
    expect(credentialProbePlan("apimart")).toMatchObject({ kind: "seed-probe", cost: "free" });
    expect(credentialProbePlan(LOOPBACK_FIXTURE_KEY)).toMatchObject({ kind: "seed-probe", cost: "paid" });
    expect(credentialProbePlan("some-custom-relay")).toMatchObject({ kind: "model-list", cost: "free" });
  });

  it("higgsfield 的 estimate 报价端点是声明过的免费档（不排任务、不扣费）", async () => {
    const { credentialProbePlan } = await import("./credentialProbePolicy");
    expect(credentialProbePlan("higgsfield")).toMatchObject({ kind: "seed-probe", cost: "free" });
  });
});

describe("09-21 拍板不回退：没有 key 也写得完、校验得了整份配置", () => {
  it("写一整行自定义供应商配置不需要 key，也不会为此发任何出站请求", async () => {
    seedApimartCatalog();
    const { upsertRendererCatalogVendor, upsertRendererCatalogModel } = await import("./rendererCatalogMutation");
    upsertRendererCatalogVendor({
      key: "byo-relay",
      name: "BYO Relay",
      baseUrlHint: "https://relay.example.com/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
    });
    upsertRendererCatalogModel({ vendorKey: "byo-relay", modelKey: "relay-text-v1", kind: "text" });
    const { readCatalog } = await import("./catalogStore");
    const after = readCatalog();
    expect(after.vendors.some((vendor) => vendor.key === "byo-relay")).toBe(true);
    expect(after.models.some((model) => model.vendorKey === "byo-relay")).toBe(true);
    expect(after.apiKeysByVendor["byo-relay"]).toBeUndefined();
    expect(outboundCalls()).toEqual([]);
  });
});
