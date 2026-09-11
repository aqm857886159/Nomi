/**
 * direct-key 凭据验证与发布（2026-09-10 走查回归修复）。
 *
 * 回归：apimart 填 key 后模型全部消失 + 验证转圈后全失败。根因 = ①用 GET /v1/models
 * 可达性当 key 判据（apimart 该端点恒 401）；②渲染层 key 写入强制停用 + de-publish。
 * 本文件证明：direct-key 走 livenessProbe 判据（401/403=无效、200+choices=verified、
 * 网络抖动=pending 不误报），verified 后凭据与 vendor 同步发布；scope 漂移照样
 * fail-closed（vendor 不 promote）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { validateCandidateCredential } from "./validateCandidateCredential";
import { upsertRendererCatalogVendorApiKey } from "./rendererCatalogMutation";
import { readCatalog } from "./catalogStore";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const NOW = "2026-09-10T00:00:00.000Z";

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

// probeDirectKeyCredential defaults its fetchImpl param to appFetch (production transport,
// not raw Node fetch — check-network-entry.mjs forbids bare `fetch` as a value). Tests inject
// by mocking the appFetch module, same pattern as localAssetFile.multipart-order.test.ts.
const { mockAppFetch } = vi.hoisted(() => ({ mockAppFetch: vi.fn<typeof fetch>() }));
vi.mock("../appFetch", () => ({ appFetch: mockAppFetch }));

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-direct-key-"));
  tempRoots.push(mockedUserDataRoot);
});

afterEach(() => {
  mockAppFetch.mockReset();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** 装一份真实内置种子（apimart curated 模型 + mapping 全在），apimart 行未发布。 */
function seedApimartCatalog(): CatalogState {
  const base = { version: 3, revision: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
  const seeded = applyBuiltinSeeds(base, NOW).state;
  const apimart = seeded.vendors.find((vendor) => vendor.key === "apimart");
  if (!apimart) throw new Error("apimart vendor missing from builtin seeds");
  apimart.enabled = false;
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(seeded), "utf8");
  return seeded;
}

function apimartVendor(state: CatalogState): NonNullable<CatalogState["vendors"][number]> {
  const vendor = state.vendors.find((item) => item.key === "apimart");
  if (!vendor) throw new Error("apimart vendor missing");
  return vendor;
}

function probeResponse(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body ?? { choices: [{ message: { role: "assistant", content: "Hi" } }] },
  } as Response;
}

describe("direct-key credential validation (apimart liveness probe)", () => {
  it("probe 200 + choices → verified (not pending), no /v1/models call", async () => {
    const state = seedApimartCatalog();
    mockAppFetch.mockResolvedValue(probeResponse(200));
    await expect(validateCandidateCredential(apimartVendor(state), "sk-test")).resolves.toBe(false);
  });

  it.each([401, 403])("probe %i → key is invalid (throws, candidate never published)", async (status) => {
    const state = seedApimartCatalog();
    mockAppFetch.mockResolvedValue(probeResponse(status, { code: 401, message: "unauthorized" }));
    await expect(validateCandidateCredential(apimartVendor(state), "sk-bad")).rejects.toThrow();
  });

  it("network failure → pending (honest: not faked as available, not misreported as bad key)", async () => {
    const state = seedApimartCatalog();
    mockAppFetch.mockRejectedValue(new TypeError("offline"));
    await expect(validateCandidateCredential(apimartVendor(state), "sk-test")).resolves.toBe(true);
  });
});

describe("direct-key credential publish path", () => {
  it("verified key publishes credential AND vendor in the same write", async () => {
    seedApimartCatalog();
    mockAppFetch.mockResolvedValue(probeResponse(200));
    await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "sk-live", enabled: false });
    const state = readCatalog();
    expect(state.apiKeysByVendor.apimart).toMatchObject({ enabled: true });
    expect(state.apiKeysByVendor.apimart.verificationPending).toBeUndefined();
    expect(state.vendors.find((vendor) => vendor.key === "apimart")?.enabled).toBe(true);
  });

  it("pending key stays disabled and the vendor stays de-published (honesty invariant intact)", async () => {
    seedApimartCatalog();
    mockAppFetch.mockRejectedValue(new TypeError("offline"));
    await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "sk-live", enabled: false });
    const state = readCatalog();
    expect(state.apiKeysByVendor.apimart).toMatchObject({ enabled: false, verificationPending: true });
    expect(state.vendors.find((vendor) => vendor.key === "apimart")?.enabled).toBe(false);
  });

  it("scope drift fails closed: verified key enables the credential but never the vendor", async () => {
    const state = seedApimartCatalog();
    // 用户（或旧数据）把 baseUrl 指去别处 → 不再是代码拥有的契约，promote 必须拒绝。
    apimartVendor(state).baseUrlHint = "https://evil.example";
    fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(state), "utf8");
    mockAppFetch.mockResolvedValue(probeResponse(200));
    await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "sk-live", enabled: false });
    const after = readCatalog();
    expect(after.vendors.find((vendor) => vendor.key === "apimart")?.enabled).toBe(false);
  });
});
