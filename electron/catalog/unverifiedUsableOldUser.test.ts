/**
 * 老用户升级：「验证」这一步整个删了（D-1117-delete-verification，docs/plan/2026-11-17-unverified-usable.md ★1c）。
 *
 * 三份目录都是 v0.24.1 真实落盘的（tests/fixtures/old-user-data/unverified-usable/v0.24.1，生成方法见 tests/fixtures/old-user-data/README.md）：
 * - saved-pending：密钥离线保存，0.24.1 把连接整个停用、密钥记着「待验证」；
 * - failed-disabled：自检 401，0.24.1 自动停掉了两个模型（一个有请求方式，一个没有）；
 * - manual-disabled：验证通过之后创作者自己停掉了一个模型。
 * 只裁掉了别的连接，密钥换成假的；读盘、迁移、可用性判定、状态词投影都是真代码。
 * 旧记录里的 meta.adapter.state 原样留在盘上，但没人再读——这里断言的是创作者看到的那个词。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { presentModelStatus } from "../shared/modelStatusPresentation";

vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
    ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
  };
});

const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/old-user-data/unverified-usable/v0.24.1", import.meta.url));
const VENDOR = "local-60634";
const roots: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function open(name: "saved-pending" | "failed-disabled" | "manual-disabled") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-unverified-usable-"));
  roots.push(root);
  const settings = path.join(root, "settings");
  fs.mkdirSync(settings);
  const file = path.join(settings, "model-catalog.json");
  fs.copyFileSync(path.join(FIXTURES, name, "model-catalog.json"), file);
  vi.stubEnv("NOMI_SETTINGS_DIR", settings);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.resetModules();
  const catalog = await import("./catalogStore");
  const listed = () => Object.fromEntries(catalog.listModelCatalogModels().filter((model) => model.vendorKey === VENDOR)
    .map((model) => [model.modelKey, { enabled: model.enabled, usable: model.availability.usable, status: presentModelStatus({ availability: model.availability }).state }]));
  const disk = () => JSON.parse(fs.readFileSync(file, "utf8"));
  return { catalog, listed, disk, file };
}

describe("v0.24.1 data after upgrade", () => {
  it("an offline-saved key turns its connection back on and its models read 「可使用」, no pending word anywhere", async () => {
    const dir = await open("saved-pending");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: true, usable: true, status: "ready" },
      "gpt-4o": { enabled: true, usable: true, status: "ready" },
    });
    const state = dir.catalog.readCatalog();
    expect(state.vendors.find((vendor) => vendor.key === VENDOR)?.enabled).toBe(true);
    expect(state.apiKeysByVendor[VENDOR]).toMatchObject({ enabled: true });
    expect(dir.catalog.listModelCatalogVendors().find((vendor) => vendor.key === VENDOR)).not.toHaveProperty("credentialVerificationPending");
  });

  it("a model switched off by a failed check comes back when it has a request format; one without stays off", async () => {
    const dir = await open("failed-disabled");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: true, usable: true, status: "ready" },
      // 没有请求格式：不打开；格式缺口排在「关了」之前，所以读成「待设置」（D-1117 定法：手动关 + 缺格式 = 待设置）。
      "MiniMax-H3": { enabled: false, usable: false, status: "needsSetup" },
    });
  });

  it("a model the creator switched off by hand stays off", async () => {
    const dir = await open("manual-disabled");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: false, usable: false, status: "disabled" },
      "gpt-4o": { enabled: true, usable: true, status: "ready" },
    });
  });

  it("the repair runs once: the format stays 13 for 0.24.1, and switching the model off again is not undone", async () => {
    const dir = await open("failed-disabled");
    dir.catalog.readCatalog();
    const written = dir.disk();
    expect(written.version).toBe(13);
    expect(written.unverifiedUsableRecovered).toBe(true);
    written.models = written.models.map((model: { modelKey: string; enabled: boolean }) => model.modelKey === "gpt-image-2" ? { ...model, enabled: false } : model);
    fs.writeFileSync(dir.file, JSON.stringify(written));
    expect(dir.listed()["gpt-image-2"]).toMatchObject({ enabled: false, usable: false });
  });
});
