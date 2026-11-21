/**
 * 内置供应商种子的**装配期不变量**（2026-09-10 类根因修复，R21 合同
 * docs/fixes/2026-09-10-vendor-key-publish-class.root-cause.json）。
 *
 * 守的类：「填 key 却不解锁模型」。这一类不是某家的 bug，而是两条判据被写成了
 * 硬编码而非种子声明——发布判据按 vendor 名（seedBuiltins 里的 apimart 白名单）、
 * 验证判据按单一 HTTP 路由（/v1/models）。只要还这么分派，下一家新接的供应商
 * 就会以同样方式再掉进来。三条不变量把「新加一家」的正确性搬到装配期：
 *
 *   (a) 声明 direct-key ⇒ 必须带 credentialProbe（带出处 + 显式 cost），否则会掉回 /v1/models 判据；
 *   (b) 有 curated 模型 + curated mapping ⇒ 发布判据必须能对它返回 true；
 *   (c) 用户要填凭据的内置家 ⇒ 必须有一条不当场 throw 的验证分支。
 *
 * 三条都对一份**真播种**的 catalog 断言（applyBuiltinSeeds 真实产物），不用夹具编的行。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";
import { BUILTIN_VENDOR_SEEDS } from "./builtinVendorSeeds";
import { applyBuiltinSeeds, hasBuiltinCuratedExecution } from "./seedBuiltins";

import { upsertRendererCatalogVendorApiKey } from "./rendererCatalogMutation";
import { readCatalog, listModelCatalogVendors, listModelCatalogModels, mutateCatalog } from "./catalogStore";

let mockedUserDataRoot = "";
const tempRoots: string[] = [];
const NOW = "2026-09-10T00:00:00.000Z";

vi.mock("electron", () => ({
  app: { getPath: () => mockedUserDataRoot, getAppPath: () => process.cwd() },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));

vi.mock("../ai/antigravityConnection", () => ({
  antigravityConnection: { canEnable: () => false, hasPassed: () => false },
}));

// credentialProbe 走生产传输 appFetch（check-network-entry 禁裸 fetch 当值），按既有夹具手法在模块层注入。
const { mockAppFetch } = vi.hoisted(() => ({ mockAppFetch: vi.fn<typeof fetch>() }));
vi.mock("../appFetch", () => ({ appFetch: mockAppFetch }));

beforeEach(() => {
  mockedUserDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-seed-invariants-"));
  tempRoots.push(mockedUserDataRoot);
});

afterEach(() => {
  mockAppFetch.mockReset();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

const EMPTY = { version: 3, revision: 1, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;

function seededCatalog(): CatalogState {
  return applyBuiltinSeeds(EMPTY, NOW).state;
}

/**
 * 一份真播种的 catalog 里，哪些家带着「代码拥有的执行契约」：
 * 要么同时有 curated 模型与 curated mapping，要么在种子里声明了主进程专用路径（Replicate 拆解）。
 */
function vendorsWithCodeOwnedExecution(state: CatalogState): string[] {
  return BUILTIN_VENDOR_SEEDS
    .filter((seed) => seed.bespokeExecution
      || (state.models.some((model) => model.vendorKey === seed.key)
        && state.mappings.some((mapping) => mapping.vendorKey === seed.key)))
    .map((seed) => seed.key);
}

describe("(a) direct-key 必须带零成本凭据探测", () => {
  it("每个 credentialMode==='direct-key' 的种子都声明了 credentialProbe（带官方出处 + 显式 cost）", () => {
    for (const seed of BUILTIN_VENDOR_SEEDS) {
      if (seed.credentialMode !== "direct-key") continue;
      expect(seed.credentialProbe, `${seed.key} 声明了 direct-key 却没有 credentialProbe`).toBeTruthy();
      expect(seed.credentialProbe?.source.url).toMatch(/^https:\/\//);
      expect(seed.credentialProbe?.source.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 花不花钱必须**写在声明里**（T-MO-10，用户 2026-09-22 拍板）。09-11 群反馈撞上的正是
      // 「注释说零成本、实际是一次真实生成」——没写下来的免费不算免费。缺省虽然 fail-closed
      // 判 paid，内置家也不许靠缺省：靠缺省就等于每次接入都多一张确认卡。
      expect(
        seed.credentialProbe?.cost,
        `${seed.key} 的 credentialProbe 没说自己花不花钱；免费要有出处，付费要走确认面`,
      ).toMatch(/^(free|paid)$/);
    }
  });

  /**
   * 「验证不花钱」的机器判据（TODO T-MO-10 09-17 裁决原话：任何 credential 探测路径出现
   * `POST /chat/completions` 即红）。声明成 free 的端点不许长成一次生成提交。
   */
  it("声明为 free 的探测端点，不许是一次生成提交（chat/completions、*/generations、messages…）", () => {
    const GENERATION_LIKE = /(chat\/completions|\/completions|\/generations|\/v1\/messages|\/responses|\/images|\/videos|\/audio)/i;
    let checkedFree = 0;
    for (const seed of BUILTIN_VENDOR_SEEDS) {
      if (seed.credentialProbe?.cost !== "free") continue;
      checkedFree += 1;
      expect(
        GENERATION_LIKE.test(seed.credentialProbe.request.path),
        `${seed.key} 把一个长得像生成提交的端点声明成了免费凭据探测：${seed.credentialProbe.request.path}`,
      ).toBe(false);
    }
    // 采不到样本的扫描会以「全绿」的样子通过，和真绿长得一模一样。
    expect(checkedFree, "一个 free 探测端点都没采到——选择器失效了").toBeGreaterThanOrEqual(2);
  });
});

describe("(b) 有代码拥有执行契约的家，发布判据必须能返回 true", () => {
  it("逐家断言：代码拥有执行契约的家，一个都不能被判成不可发布", () => {
    const state = seededCatalog();
    const withContract = vendorsWithCodeOwnedExecution(state);
    // 先证明这份清单不是空的：一个采不到样本的扫描会以「全绿」的样子通过，
    // 和真绿长得一模一样（docs/lessons 「死选择器同时造假红和假绿」）。
    expect(withContract.length).toBeGreaterThanOrEqual(14);
    const failing = withContract.filter((key) => !hasBuiltinCuratedExecution(state, key));
    expect(failing, `这些家带着代码拥有的执行契约，却永远不会被发布：${failing.join(", ")}`).toEqual([]);
  });
});

describe("(c) 填 key → 凭据落盘 + 该家发布（逐家参数化，用户反馈的原话）", () => {
  /** src/config/knownVendors.ts 里出现的 vendorKey（文本读取，避开渲染层 i18n / 资源 import）。 */
  function knownVendorKeys(): Set<string> {
    const source = fs.readFileSync(path.join(process.cwd(), "src/config/knownVendors.ts"), "utf8");
    return new Set([...source.matchAll(/vendorKey:\s*'([^']+)'/g)].map((match) => match[1]));
  }

  /**
   * 接入卡里真的要用户粘一段凭据的内置家。
   * 排除本地 CLI / 本地无鉴权后端：dreamina 走设备码登录态，ComfyUI / Codex / 本地文本 / Antigravity
   * 是本机后端，接入卡里没有 key 输入框（它们不经 upsertRendererCatalogVendorApiKey）。
   */
  function credentialVendorKeys(): string[] {
    const known = knownVendorKeys();
    return BUILTIN_VENDOR_SEEDS
      .map((seed) => seed.key)
      .filter((key) => known.has(key))
      .filter((key) => !/^(dreamina|comfyui|local-|codex|antigravity)/.test(key));
  }

  it("每一家都存得进 key，并且存完之后这家是已发布的", async () => {
    // 同上：文本读取的 vendorKey 正则一旦失效就会采到空清单，然后以「全绿」的样子通过。
    expect(knownVendorKeys().size).toBeGreaterThanOrEqual(10);
    expect(credentialVendorKeys()).toEqual(expect.arrayContaining(["kie", "apimart", "volcengine-speech", "replicate"]));

    const seeded = seededCatalog();
    for (const vendor of seeded.vendors) vendor.enabled = false;
    fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(seeded), "utf8");

    const modelListProbe = await import("../ai/onboarding/modelListProbe");
    vi.spyOn(modelListProbe, "fetchModelList").mockResolvedValue({ ok: true, models: [], statuses: [200] });
    // 探测型（apimart 的 `GET /v1/balance` / higgsfield 的 estimate）：两家的免费端点各回各的
    // 成功字段，一条响应体同时满足两个 successPath（`remain_balance` / `credits`）即可
    // ——这里要钉的是「每家都存得进、存完就发布」，不是各家的响应形状。
    mockAppFetch.mockResolvedValue(new Response(JSON.stringify({ success: true, remain_balance: 10.5, credits: "0.050" }), { status: 200 }));

    const failures: string[] = [];
    for (const vendorKey of credentialVendorKeys()) {
      try {
        await upsertRendererCatalogVendorApiKey(vendorKey, { apiKey: "sk-invariant-probe" });
      } catch (error) {
        failures.push(`${vendorKey}: 存 key 直接抛错 —— ${(error as Error).message}`);
        continue;
      }
      const state = readCatalog();
      if (!state.apiKeysByVendor[vendorKey]) failures.push(`${vendorKey}: 凭据没落盘`);
      else if (!state.vendors.find((item) => item.key === vendorKey)?.enabled) {
        failures.push(`${vendorKey}: 凭据存进去了，但这家仍未发布（模型会从选择器与 agent 清单里消失）`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("每一类各自的正路（用户反馈里被点名的四种情形）", () => {
  async function saveKey(vendorKey: string, apiKey = "sk-case"): Promise<void> {
    const seeded = seededCatalog();
    for (const vendor of seeded.vendors) vendor.enabled = false;
    fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(seeded), "utf8");
    await upsertRendererCatalogVendorApiKey(vendorKey, { apiKey });
  }

  it("kie（上游没有 /v1/models）：不打任何预检就存 key 并发布，模型回到投影里", async () => {
    await saveKey("kie");
    const dto = listModelCatalogVendors().find((vendor) => vendor.key === "kie");
    // 「能用」= vendor.enabled && hasApiKey（usableVendorModel 的判据），两者都要真。
    expect(dto).toMatchObject({ enabled: true, hasApiKey: true });
    expect(listModelCatalogModels().filter((model) => model.vendorKey === "kie" && model.enabled).length).toBeGreaterThan(0);
    // 不挂任何「待验证」标记（D-1117-delete-verification：这一档整个删了）。
    expect(readCatalog().apiKeysByVendor.kie).not.toHaveProperty("verificationPending");

    // 存量装机里遗留的 pending 记录不再有人读：模型照样可用，执行前不打任何预检。
    mutateCatalog((_tx, current) => { (current.apiKeysByVendor.kie as Record<string, unknown>).verificationPending = true; });
    const modelListProbe = await import("../ai/onboarding/modelListProbe");
    const probe = vi.spyOn(modelListProbe, "fetchModelList");
    expect(listModelCatalogModels().filter((model) => model.vendorKey === "kie" && model.availability.usable).length).toBeGreaterThan(0);
    expect(probe).not.toHaveBeenCalled();
    probe.mockRestore();
  });

  it("火山豆包语音（authType:'none' + 三头鉴权）：App ID:Access Token 存得进并发布", async () => {
    await saveKey("volcengine-speech", "6123456789:AccessTokenValue");
    expect(readCatalog().apiKeysByVendor["volcengine-speech"]).toBeTruthy();
    expect(listModelCatalogVendors().find((vendor) => vendor.key === "volcengine-speech"))
      .toMatchObject({ enabled: true, hasApiKey: true });
  });

  it("replicate（多输出的专用路径）：发布后「元素拆解」的前置满足", async () => {
    await saveKey("replicate", "r8_decompose_token");
    const state = readCatalog();
    // decomposeLayers.ts 的第一道前置逐字就是这句；凭据槽是第二道。
    expect(state.vendors.find((vendor) => vendor.key === "replicate" && vendor.enabled)).toBeTruthy();
    expect(state.apiKeysByVendor.replicate?.apiKey).toBeTruthy();
  });

  it("apimart（种子带 credentialProbe）：401 仍然判 key 无效，不发布", async () => {
    mockAppFetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(saveKey("apimart", "sk-bad")).rejects.toThrow();
    expect(readCatalog().vendors.find((vendor) => vendor.key === "apimart")?.enabled).toBe(false);
  });

  it("自定义中转保存 key 后连接启用，模型仍需请求格式", async () => {
    const seeded = seededCatalog();
    seeded.vendors.push({
      key: "my-relay", name: "自建中转", enabled: false, baseUrlHint: "https://relay.example",
      authType: "bearer", providerKind: "openai-compatible", createdAt: NOW, updatedAt: NOW,
    } as CatalogState["vendors"][number]);
    fs.writeFileSync(path.join(mockedUserDataRoot, "model-catalog.json"), JSON.stringify(seeded), "utf8");
    const modelListProbe = await import("../ai/onboarding/modelListProbe");
    vi.spyOn(modelListProbe, "fetchModelList").mockResolvedValue({ ok: true, models: [], statuses: [200] });
    await upsertRendererCatalogVendorApiKey("my-relay", { apiKey: "sk-relay" });
    expect(readCatalog().vendors.find((vendor) => vendor.key === "my-relay")?.enabled).toBe(true);
  });
});
