// 协调 2026-11-17 裁定：种子声明的凭据端点明确回 401/403 =「验证了，不对」——拒绝、不保存、原密钥保留；
// 离线 / 超时 / 5xx 不是这一类，照存、标未验证、可用。
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as store from "./catalogStore";
import { decryptStoredApiKeyRecord } from "./secrets";
import { upsertRendererCatalogVendorApiKey } from "./rendererCatalogMutation";

const fixture = vi.hoisted(() => ({ root: "", respond: (() => Promise.resolve(new Response("{}"))) as () => Promise<Response> }));
vi.mock("electron", () => ({ app: { getPath: () => fixture.root, getAppPath: () => process.cwd() }, BrowserWindow: { getAllWindows: () => [] }, safeStorage: { isEncryptionAvailable: () => true, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() } }));
vi.mock("../ai/antigravityConnection", () => ({ antigravityConnection: { canEnable: () => false, hasPassed: () => false } }));
vi.mock("../appFetch", () => ({ appFetch: vi.fn(() => fixture.respond()) }));

const t = "2026-11-17T00:00:00.000Z";
function seedApimart(oldKey?: string) {
  store.upsertModelCatalogVendor({ key: "apimart", name: "APIMart", enabled: Boolean(oldKey), baseUrlHint: "http://127.0.0.1:54331" });
  store.upsertModelCatalogModel({ vendorKey: "apimart", modelKey: "gpt-4o", kind: "text", enabled: true, createdAt: t, updatedAt: t });
  if (oldKey) store.upsertModelCatalogVendorApiKey("apimart", { apiKey: oldKey, enabled: true });
}
const savedKey = () => {
  const record = store.readCatalog().apiKeysByVendor.apimart;
  return record ? decryptStoredApiKeyRecord(record) : undefined;
};
const vendorEnabled = () => store.readCatalog().vendors.find((vendor) => vendor.key === "apimart")?.enabled;

beforeEach(() => { fixture.root = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "seed-probe-rejection-")); });
afterEach(() => { fs.rmSync(fixture.root, { recursive: true, force: true }); });

describe("provider explicitly rejects the new key (401/403)", () => {
  for (const status of [401, 403]) {
    it(`${status}: refuses, keeps the previous key, publishes nothing new`, async () => {
      seedApimart("old-good-key");
      fixture.respond = () => Promise.resolve(new Response(JSON.stringify({ error: { message: "invalid API key" } }), { status }));
      await expect(upsertRendererCatalogVendorApiKey("apimart", { apiKey: "new-rejected-key" })).rejects.toThrow();
      expect(savedKey()).toBe("old-good-key");
      expect(store.readCatalog().apiKeysByVendor.apimart.verificationPending).toBeUndefined();
    });
  }
  it("401 on a first connection: no key stored, connection not published", async () => {
    seedApimart();
    fixture.respond = () => Promise.resolve(new Response("{}", { status: 401 }));
    await expect(upsertRendererCatalogVendorApiKey("apimart", { apiKey: "new-rejected-key" })).rejects.toThrow();
    expect(savedKey()).toBeUndefined();
    expect(vendorEnabled()).toBe(false);
  });
});

describe("could not verify (offline / timeout / 5xx): saved, enabled, marked not verified", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["offline", () => Promise.reject(new TypeError("fetch failed"))],
    ["timeout", () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"))],
    ["5xx", () => Promise.resolve(new Response("{}", { status: 503 }))],
  ];
  for (const [name, respond] of cases) {
    it(name, async () => {
      seedApimart("old-good-key");
      fixture.respond = respond;
      await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "new-unverified-key" });
      expect(savedKey()).toBe("new-unverified-key");
      expect(store.readCatalog().apiKeysByVendor.apimart).toMatchObject({ enabled: true, verificationPending: true });
      expect(vendorEnabled()).toBe(true);
    });
  }
});
