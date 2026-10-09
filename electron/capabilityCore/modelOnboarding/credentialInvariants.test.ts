/**
 * 放开「用户的 AI 直接填 key」这个入口的**前提**（方案 §4，用户 09-21 拍板）。
 *
 * 两条不变量在这之前各自被守着，但**没有一条测试同时走完整条外部 AI 的路**去验它们。
 * 加这个入口而不加这两条，就是把一条安全不变量交给「没人会写错」来维持。
 *
 *   ① 已存 key 要发往**新域名**（或换一种放法），必须用户在 Nomi 里确认；
 *   ② Nomi **永不回显**已存 key——工具返回、错误信息、nextAction、轨迹四处都不许出现。
 *
 * 两条都按「会红」写：把对应的判据拿掉，这里立刻红（复验方式写在各自的注释里）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * vitest 里没有 Electron 的 `safeStorage`，所以钥匙串那一层按仓库既有的做法替身
 * （见 `generationProviderBootstrap.test.ts`）。**替身仍然加密**（可逆的 base64 包一层），
 * 因为这条测试要断言的正是「盘上不是明文」——换成直存明文的替身，第二条不变量就白测了。
 */
vi.mock("../../catalog/secrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../catalog/secrets")>();
  const wrap = (plain: string): string => `enc:${Buffer.from(plain, "utf8").toString("base64")}`;
  const unwrap = (value: string): string =>
    value.startsWith("enc:") ? Buffer.from(value.slice(4), "base64").toString("utf8") : value;
  return {
    ...actual,
    makeApiKeyRecordFromPlain: (plain: string, vendorKey: string, enabled: boolean, createdAt: string, updatedAt: string) =>
      ({ vendorKey, apiKey: wrap(plain), enc: "safeStorage" as const, enabled, createdAt, updatedAt }),
    decryptApiKeyRecord: (record?: { apiKey?: string }) => (record?.apiKey ? unwrap(record.apiKey) : ""),
    apiKeyDecryptStatus: (record?: { apiKey?: string }) => (record?.apiKey ? "ok" : "missing"),
  };
});

/** 哨兵：只要它在任何一处露头，第二条不变量就破了。 */
const SENTINEL_KEY = "nomi-sentinel-7Q4x-do-not-echo-9ZK2";
const BOUND = "https://api.example-relay.com";
const OTHER = "https://api.someone-elses-host.com";

function cardFor(baseUrl: string): string {
  const doc = "https://docs.example-relay.com/api";
  return JSON.stringify({
    provider: { baseUrl, authType: "bearer", authHeader: "Authorization" },
    sources: [{ url: doc, evidence: "POST /v1/images/generations returns data[0].url" }],
    assetIngestion: { strategy: "none", sourceUrl: doc },
    models: [{
      modelKey: "demo-image",
      labelZh: "Demo Image",
      kind: "image",
      modes: [{
        taskKind: "text_to_image",
        delivery: "synchronous",
        create: { method: "POST", path: "/v1/images/generations", body: { prompt: "{{request.prompt}}" }, response_mapping: { image_url: "data.0.url" } },
        sourceUrls: [doc],
      }],
    }],
  });
}

describe("密钥两入口并存的两条不变量", () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-cred-inv-"));
    vi.stubEnv("NOMI_SETTINGS_DIR", root);
    vi.resetModules();
  });
  afterEach(() => {
    vi.stubEnv("NOMI_SETTINGS_DIR", undefined);
    fs.rmSync(root, { recursive: true, force: true });
  });

  /**
   * 不变量 ①。复验它会红：把 `declaredProviderRegistration.ts` 里那句
   * `if (binding?.origin && binding.origin !== declaredOrigin) throw` 删掉 → 第一段断言当场红；
   * 把 `judgeCredentialDestination` 的 origin 判据删掉 → 第二段当场红。
   */
  it("AI 填完 key 之后，一张改了域名的卡既登记不进去，出站也发不出去", async () => {
    const { dispatchModelSetup } = await import("./dispatch");
    const { registerDeclaredProvider, DeclaredOriginRewriteError } = await import("../../catalog/declaredProviderRegistration");
    const { readCatalog } = await import("../../catalog/catalogStore");
    const { judgeCredentialDestination, readCredentialBinding } = await import("../../catalog/credentialBinding");
    const { validateProviderAdapterDraft } = await import("../../providerAdapter/validator");

    const deps = {
      sessions: {} as never,
      owner: "claude" as never,
      withCredentialElicitationTicket: (projection: Record<string, unknown>) => projection,
    };
    // 卡先进来（无 key 也能写完并通过整套静态校验——顺序耦合本来就是墙，不是安全）。
    const submitted = await dispatchModelSetup(deps, { action: "submit_declaration", name: "Example Relay", declaration: cardFor(BOUND) });
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true);
    const vendorKey = (submitted as { vendorKey?: string }).vendorKey!;

    // 用户的 AI 直接填 key——走的是和贴 key 页**同一扇**写门，绑定因此自动生成。
    const keyed = await dispatchModelSetup(deps, { action: "set_key", vendorKey, apiKey: SENTINEL_KEY });
    expect(keyed.ok, JSON.stringify(keyed)).toBe(true);
    const binding = readCredentialBinding(readCatalog().vendors.find((vendor) => vendor.key === vendorKey));
    expect(binding?.origin).toBe(BOUND);

    // ① 登记门这一端：同一条连接、改了域名的卡 → 拒，并且说得出绑在哪。
    const rewritten = validateProviderAdapterDraft(JSON.parse(cardFor(OTHER)), {
      providerBaseUrl: OTHER,
      selectedModelKeys: ["demo-image"],
    });
    expect(() => registerDeclaredProvider({ card: rewritten, vendorKey })).toThrow(DeclaredOriginRewriteError);

    // 工具面这一端给的是同一个答案，而不是一句让 AI 去改字段的话。
    const viaTool = await dispatchModelSetup(deps, { action: "submit_declaration", vendorKey, declaration: cardFor(OTHER) });
    expect(viaTool.ok).toBe(false);
    expect((viaTool as { code: string }).code).toBe("credential_origin_mismatch");

    // ② 出站这一端：就算有人绕过登记门，带 key 的请求也到不了别的 origin。
    expect(judgeCredentialDestination({ binding, url: `${OTHER}/v1/images/generations`, codeDeclaredOrigins: [] }))
      .toMatchObject({ allowed: false, changed: "origin" });
    expect(judgeCredentialDestination({ binding, url: `${BOUND}/v1/images/generations`, codeDeclaredOrigins: [] }))
      .toEqual({ allowed: true });
  });

  /**
   * 不变量 ②。复验它会红：在 `setKey` 的返回里把 `apiKey` 原样塞回 `state`（一行），
   * 或让 `try_model` 的失败分支直接透传未脱敏的 message → 这条当场红。
   *
   * 为什么要一条「整面扫描」而不是各处各自的脱敏测试：工具返回、错误信息、nextAction、
   * 轨迹四处**各有各的脱敏**，从来没有人一起查。漏的那一处不会有任何东西报错。
   */
  it("哨兵 key 填进去之后，整条路上一个字都不回显", async () => {
    const { dispatchModelSetup, dispatchModelOnboarding } = await import("./dispatch");
    const deps = {
      sessions: {} as never,
      owner: "claude" as never,
      withCredentialElicitationTicket: (projection: Record<string, unknown>) => projection,
    };
    const replies: unknown[] = [];
    replies.push(await dispatchModelSetup(deps, { action: "submit_declaration", name: "Example Relay", declaration: cardFor(BOUND) }));
    const vendorKey = (replies[0] as { vendorKey?: string }).vendorKey!;
    replies.push(await dispatchModelSetup(deps, { action: "set_key", vendorKey, apiKey: SENTINEL_KEY }));
    // 读一眼自己的状态（宿主每一跳都会做的事）。
    replies.push(await dispatchModelSetup(deps, { action: "show_models", vendorKey, modelKeys: ["demo-image"], visible: true }));
    // 一次**失败**的试跑：失败分支最容易把上游原文连同请求头一起吐出来。
    replies.push(await dispatchModelOnboarding("model.onboarding.try", { vendorKey, modelKey: "demo-image", prompt: "ping" }, {
      owner: "claude" as never,
      runTask: async () => { throw new Error(`upstream refused: Authorization: Bearer ${SENTINEL_KEY}`); },
    }));

    for (const reply of replies) {
      expect(JSON.stringify(reply)).not.toContain(SENTINEL_KEY);
    }
    // 盘上也不是明文（「回显」的上游：别处读到的那一份也不该是它）。
    const disk = fs.readFileSync(path.join(root, "model-catalog.json"), "utf8");
    expect(disk).not.toContain(SENTINEL_KEY);
  });
});
