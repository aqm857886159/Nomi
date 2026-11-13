/**
 * 设置页亲手改接口地址（2026-09-29 用户反馈：新电脑上把 APIMart 改成国内地址，保存报
 * 「Certification-owned connection changes require a new integration session」；老电脑能改）。
 *
 * 走的是真目录（真内置种子、真写盘），只替换网络出口（appFetch）与 electron。每条都对应一条
 * 真实用户路径，并各有一条「改回旧行为就会红」的断言：
 *   ① 新装机点过「继续验证 → 自检」，连接带上了 meta.adapter——地址照样能存（老装机本来就能存）；
 *   ② 新装机主域被墙：key 存成「未验证」→ 改到官方国内线路 → 重新保存 key，验证发往国内域、模型回来；
 *   ③ 地址换成名单外的：用户这次保存就是确认，已存 key 的去向跟过去；程序那扇写门改同一个地址，key 不跟。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { upsertRendererCatalogVendor, upsertRendererCatalogVendorApiKey } from "./rendererCatalogMutation";
import { readCatalog, upsertModelCatalogVendor, upsertModelCatalogVendorApiKey } from "./catalogStore";
import { readCredentialBinding } from "./credentialBinding";
import { authorizeSubmitDestination } from "../vendor/vendorOutboundGuard";
import { matchNomiErrorCode } from "../shared/nomiErrorCodes";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const NOW = "2026-09-29T00:00:00.000Z";

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
const { mockAppFetch } = vi.hoisted(() => ({ mockAppFetch: vi.fn<typeof fetch>() }));
vi.mock("../appFetch", () => ({ appFetch: mockAppFetch }));

/** 主域被墙：连接从未建立（与 vendorBaseFallback 认的那一类同形）。国内域可达、这把 key 有效。 */
function blockedPrimaryNetwork(): void {
  mockAppFetch.mockImplementation(async (input) => {
    const url = String(input);
    if (url.startsWith("https://api.apimart.ai/")) {
      throw new TypeError("fetch failed", { cause: Object.assign(new Error("Connect Timeout Error"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });
    }
    return { ok: true, status: 200, json: async () => ({ remain_balance: 88.8 }) } as Response;
  });
}

/** 真实内置种子落盘（APIMart 行 = 新装机那一行，默认启用）。 */
function freshInstall(mutate?: (state: CatalogState) => void): void {
  const base = { version: 3, revision: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
  const seeded = applyBuiltinSeeds(base, NOW).state;
  mutate?.(seeded);
  fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(seeded), "utf8");
}

function apimart() {
  const vendor = readCatalog().vendors.find((item) => item.key === "apimart");
  if (!vendor) throw new Error("apimart vendor missing");
  return vendor;
}

function keyedRequest(url: string) {
  return authorizeSubmitDestination({ vendor: apimart(), url, carriesCredential: true });
}

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-settings-address-"));
  tempRoots.push(mockedUserDataRoot);
});

afterEach(() => {
  mockAppFetch.mockReset();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("设置页亲手改接口地址", () => {
  it("① 新装机点过「继续验证 → 自检」（连接带 meta.adapter）：地址照样能存，与老装机一致", () => {
    freshInstall((state) => {
      // 自检留下的那一行：用户手填的模型 id，带认证契约标记——老装机从来没有它。
      state.models.push({
        vendorKey: "apimart", modelKey: "gpt-image-1", labelZh: "gpt-image-1", kind: "image", enabled: true,
        meta: { adapter: { state: "failed", modes: [] } }, createdAt: NOW, updatedAt: NOW,
      } as CatalogState["models"][number]);
    });
    expect(() => upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://api.apib.ai" })).not.toThrow();
    expect(apimart().baseUrlHint).toBe("https://api.apib.ai");
  });

  it("② 新装机主域被墙：key 存成「未验证」→ 改到官方国内线路 → 重新保存 key，验证发往国内域、APIMart 重新可用", async () => {
    freshInstall();
    blockedPrimaryNetwork();
    await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "sk-fixture", enabled: false });
    expect(readCatalog().apiKeysByVendor.apimart).toMatchObject({ enabled: false, verificationPending: true });
    expect(apimart().enabled).toBe(false);

    upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://api.apib.ai" });
    await upsertRendererCatalogVendorApiKey("apimart", { apiKey: "sk-fixture", enabled: false });

    expect(String(mockAppFetch.mock.calls.at(-1)?.[0])).toBe("https://api.apib.ai/v1/balance");
    expect(readCatalog().apiKeysByVendor.apimart).toMatchObject({ enabled: true });
    expect(readCatalog().apiKeysByVendor.apimart.verificationPending).toBeUndefined();
    // 官方国内线路仍是同一条内置连接：凭据发布把整家重新发布（改回「只认主域」就停在 false）。
    expect(apimart().enabled).toBe(true);
    await expect(keyedRequest("https://api.apib.ai/v1/images/generations")).resolves.toBeNull();
  });

  it("③ 名单外的地址：用户这次保存就是确认——key 的去向跟到新地址；别的地址照样拦", async () => {
    freshInstall();
    upsertModelCatalogVendorApiKey("apimart", { apiKey: "sk-fixture", enabled: true });
    expect(readCredentialBinding(apimart())?.origin).toBe("https://api.apimart.ai");

    upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://apib.ai/v1" });

    expect(apimart().baseUrlHint).toBe("https://apib.ai/v1");
    expect(readCredentialBinding(apimart())?.origin).toBe("https://apib.ai");
    await expect(keyedRequest("https://apib.ai/v1/images/generations")).resolves.toBeNull();
    const elsewhere = await keyedRequest("https://collector.attacker.example/v1/images/generations");
    expect(matchNomiErrorCode(String(elsewhere))).toBe("outbound-blocked-credential-origin");
  });

  it("③ 对照：程序那扇写门（Agent / AI 接入在主进程里用的）改同一个地址，key 不跟过去，带 key 的请求被拦", async () => {
    freshInstall();
    upsertModelCatalogVendorApiKey("apimart", { apiKey: "sk-fixture", enabled: true });

    upsertModelCatalogVendor({ key: "apimart", baseUrlHint: "https://apib.ai/v1" });

    expect(readCredentialBinding(apimart())?.origin).toBe("https://api.apimart.ai");
    const refused = await keyedRequest("https://apib.ai/v1/images/generations");
    expect(matchNomiErrorCode(String(refused))).toBe("outbound-blocked-credential-origin");
  });

  it("官方线路之间来回切：key 本来就能去，绑定不动", async () => {
    freshInstall();
    upsertModelCatalogVendorApiKey("apimart", { apiKey: "sk-fixture", enabled: true });
    const before = readCredentialBinding(apimart());

    upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://api.apib.ai" });
    expect(readCredentialBinding(apimart())).toEqual(before);
    await expect(keyedRequest("https://api.apib.ai/v1/tasks/task-1")).resolves.toBeNull();

    upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://api.apimart.ai" });
    expect(readCredentialBinding(apimart())).toEqual(before);
  });

  it("老装机（key 在绑定出现之前存的，没有绑定）：地址照样能存，也不凭空造一份绑定", () => {
    freshInstall((state) => {
      state.apiKeysByVendor.apimart = { apiKey: "sk-fixture", enabled: true, createdAt: NOW, updatedAt: NOW } as CatalogState["apiKeysByVendor"][string];
    });
    upsertRendererCatalogVendor({ key: "apimart", baseUrlHint: "https://api.apib.ai" });
    expect(apimart().baseUrlHint).toBe("https://api.apib.ai");
    expect(readCredentialBinding(apimart())).toBeUndefined();
  });
});
