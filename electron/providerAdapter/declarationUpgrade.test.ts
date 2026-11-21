/**
 * 收件变严之后，老用户已经接进来的模型照旧能用；接到一半的旧会话恢复时给一句能照做的话。
 *
 * 收件口（validateProviderAdapterDraft）在 2026-11-17 变严了两格：外部卡必须写 assetIngestion、
 * 参数键必须是 Nomi 的中性键。它只管「新交的卡」——已登记的声明在启动、读目录、发请求时都不再过它
 * （declarationSource 只写不读）。这里用已发版本会写下的数据形状证明这一点：
 *
 * - 形状 A：v0.24.x 的整卡提交收下过不写 assetIngestion 的卡（那时外部卡这一格可省）。
 * - 形状 B：v0.24.x 的认证路把参数键是线缆名（seconds）的卡发布进了目录（那时认证路不查中性键）。
 *
 * 两种形状都由**真实的写入口**写出来（registerDeclaredProvider / 认证发布 defaultCatalog.promote），
 * 不是手拼目录 JSON：这两个写入口与 v0.24.1 标签上的代码相比，只差 promotionMeta 里中性键判据的
 * 两行（archetype 清单的取法）和本次拿掉的那一行登记期中性键判断——写出来的形状与旧版一致。
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { relayDeclaration } from "../../tests/ux/_relayVideoFixture.mjs";
import { registerDeclaredProvider } from "../catalog/declaredProviderRegistration";
import { readCatalog } from "../catalog/catalogStore";
import { executeProfileOperation } from "../runtime";
import { defaultCatalog } from "./serviceCatalog";
import { ProviderAdapterStore } from "./store";
import { ProviderAdapterService, type ProviderAdapterServiceDependencies } from "./service";
import { verifyAdapterMode } from "./verifier";
import type { ProviderAdapterDraft, ProviderAdapterRun } from "./types";

let settingsDir = "";
vi.mock("electron", () => ({ app: { getPath: () => settingsDir, getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(`enc:${value}`, "utf8"), decryptString: (value: Buffer) => value.toString("utf8").replace(/^enc:/, "") } }));

const hits: Array<{ method: string; path: string; body: Record<string, unknown> }> = [];
let server: http.Server;
let baseUrl = "";
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      hits.push({ method: req.method || "", path: req.url || "", body: raw ? JSON.parse(raw) : {} });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id: "task-1", data: [{ url: `${baseUrl}/out.mp4` }] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
beforeEach(() => {
  hits.length = 0;
  settingsDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-upgrade-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsDir);
  vi.stubEnv("NOMI_CAPABILITY_DIR", settingsDir);
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(settingsDir, { recursive: true, force: true }); });

/** 「升级后」：重新从盘上读目录，用登记好的那条路由真的发一次请求。 */
async function sendFromCatalog(vendorKey: string, modelKey: string, params: Record<string, unknown>) {
  const catalog = readCatalog();
  const vendor = catalog.vendors.find((row) => row.key === vendorKey)!;
  const model = catalog.models.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey)!;
  const mapping = catalog.mappings.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey && row.enabled !== false)!;
  expect(vendor && model && mapping, "registered model is still in the catalog").toBeTruthy();
  await executeProfileOperation({
    vendor,
    model,
    apiKey: "sk-loopback",
    request: { kind: mapping.taskKind, prompt: "a red kite", extras: { modelKey, ...params } } as never,
    operation: mapping.create!,
    stage: "create",
  });
  return hits.at(-1);
}

describe("已登记的旧数据：收件变严不影响已经接进来的模型", () => {
  it("形状 A：整卡提交收下的、没写 assetIngestion 的卡——升级后照旧读得出、发得出请求", async () => {
    const card = relayDeclaration(baseUrl) as ProviderAdapterDraft;
    delete card.assetIngestion;
    const registered = registerDeclaredProvider({ card, vendorKey: "relay-old" });
    const sent = await sendFromCatalog(registered.vendorKey, card.models[0].modelKey, { duration: 1, resolution: "360p" });
    expect(sent).toMatchObject({ method: "POST", body: { prompt: "a red kite", duration: 1 } });
  });

  it("形状 B：认证路发布的、参数键是线缆名 seconds 的卡——升级后照旧读得出、发得出请求", async () => {
    const draft: ProviderAdapterDraft = {
      provider: { baseUrl, authType: "bearer" },
      sources: [],
      models: [{
        modelKey: "clip-old", labelZh: "Clip Old", kind: "video",
        parameters: [{ key: "seconds", label: "Seconds", type: "number", default: 5 }],
        modes: [{ taskKind: "text_to_video", create: { method: "POST", path: "/v1/videos", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", seconds: "{{request.params.seconds}}" }, response_mapping: { video_url: "data.0.url" } }, sourceUrls: [] }],
      }],
    };
    const staged = defaultCatalog.stage({ vendorKey: "relay-cert", catalogVendorKey: "relay-cert", runId: "run-old", vendorName: "Relay", baseUrl, authType: "bearer", apiKey: "sk-loopback", models: [{ modelKey: "clip-old", kind: "video" }] });
    const verifiedModes = [{ modelKey: "clip-old", taskKind: "text_to_video" as const }];
    const run: ProviderAdapterRun = { id: "run-old", vendorKey: staged.vendor.key, vendorName: "Relay", connectionFingerprint: "old", selectedModelKeys: ["clip-old"], stage: "completed", repairAttempt: 0, models: [{ modelKey: "clip-old", labelZh: "Clip Old", kind: "video", modes: [{ taskKind: "text_to_video", state: "verified", attempts: 1 }] }], sourceUrls: [], createdAt: "", updatedAt: "" };
    expect(defaultCatalog.promote({ run, draft, verifiedModes, revision: { id: "run-old", vendorKey: staged.vendor.key, digest: "old", draft, verifiedModes, createdAt: "" } }).status).toBe("committed");
    const sent = await sendFromCatalog(staged.vendor.key, "clip-old", { seconds: 5 });
    expect(sent).toMatchObject({ method: "POST", path: "/v1/videos", body: { prompt: "a red kite", seconds: 5 } });
  });
});

describe("接到一半的旧会话恢复：缺 assetIngestion 的卡给一句能照做的话", () => {
  it("恢复后 run 收在 failed（不崩、不挂在处理中），原因带码、字段路径和合法取值", async () => {
    const store = new ProviderAdapterStore(path.join(settingsDir, "provider-adapters.json"));
    const card = relayDeclaration("http://127.0.0.1:9000") as ProviderAdapterDraft;
    delete card.assetIngestion;
    const now = new Date().toISOString();
    const vendor = { key: "relay-half", name: "Relay", enabled: false, baseUrlHint: "http://127.0.0.1:9000", authType: "bearer" as const, createdAt: now, updatedAt: now };
    const rows = [{ vendorKey: vendor.key, modelKey: card.models[0].modelKey, labelZh: card.models[0].labelZh, kind: "video" as const, enabled: false, createdAt: now, updatedAt: now }];
    const scheduled: string[] = [];
    const deps = (): ProviderAdapterServiceDependencies => ({
      catalog: {
        register: () => ({ vendor, models: rows }),
        stage: () => ({ vendor, models: rows, lineageRootVendorKey: vendor.key, supersededVendorKeys: [] }),
        findStagedRun: () => ({ vendorKey: vendor.key, lineageRootVendorKey: vendor.key }),
        load: () => ({ vendor, models: rows, apiKey: "sk-loopback" }),
        promote: () => { throw new Error("must not promote a card without assetIngestion"); },
        fail: () => {},
      },
      schedule: (id) => { scheduled.push(id); },
      discover: async () => ({ sources: [], corpus: "" }),
      resolveLanguageModels: () => [],
      compile: async () => { throw new Error("never compiles"); },
      verify: (input) => verifyAdapterMode(input),
      now: () => new Date().toISOString(),
      id: () => "run-half",
    });
    // 旧版本落盘：run 开了、卡进了边表，进程在跑之前退出（schedule 没执行）。
    const before = new ProviderAdapterService(store, deps());
    await before.start({
      vendorName: "Relay", baseUrl: "http://127.0.0.1:9000", apiKey: "sk-loopback", authType: "bearer", providerKind: "openai-compatible", headers: {},
      models: rows.map(({ modelKey, labelZh, kind }) => ({ modelKey, labelZh, kind })),
      adapterDraft: card,
      certification: { contractDigest: "0".repeat(64), idempotencyKey: "half-1", remoteIdempotency: "unknown" },
    });
    expect(store.getRun("run-half")?.stage).not.toBe("failed");
    // 升级后的新进程：恢复中断的 run。
    scheduled.length = 0;
    const after = new ProviderAdapterService(store, deps());
    after.resumeInterrupted();
    expect(scheduled).toEqual(["run-half"]);
    await after.executeRun("run-half");
    const run = store.getRun("run-half")!;
    expect(run.stage).toBe("failed");
    expect(run.error).toMatch(/^upload_strategy_unsupported: assetIngestion is required/);
    expect(run.error).toMatch(/none, inline-base64, upload-url/);
  });
});
