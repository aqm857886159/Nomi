/**
 * 老用户升级：「没验证的也能用」（docs/plan/2026-11-17-unverified-usable.md ★1c）。
 *
 * 三份目录都是 v0.24.1 真实落盘的（tests/fixtures/old-user-data/catalogs/v0.24.1-unverified-usable，生成方法见同目录上一级 README）：
 * - saved-pending：密钥离线保存，0.24.1 把连接整个停用、密钥记着「待验证」；
 * - failed-disabled：自检 401，0.24.1 自动停掉了两个模型（一个有请求方式，一个没有）；
 * - manual-disabled：验证通过之后创作者自己停掉了一个模型。
 * 只裁掉了别的连接，密钥换成假的；读盘、迁移、可用性判定都是真代码。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const FIXTURES = fileURLToPath(new URL("../../tests/fixtures/old-user-data/catalogs/v0.24.1-unverified-usable", import.meta.url));
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
    .map((model) => [model.modelKey, { enabled: model.enabled, usable: model.availability.usable, state: (model.meta as { adapter?: { state?: string } })?.adapter?.state }]));
  const disk = () => JSON.parse(fs.readFileSync(file, "utf8"));
  return { catalog, listed, disk, file };
}

describe("v0.24.1 data after upgrade", () => {
  it("an offline-saved key turns its connection back on and its models are usable, verification left as a hint", async () => {
    const dir = await open("saved-pending");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: true, usable: true, state: "unverified" },
      "gpt-4o": { enabled: true, usable: true, state: "unverified" },
    });
    const state = dir.catalog.readCatalog();
    expect(state.vendors.find((vendor) => vendor.key === VENDOR)?.enabled).toBe(true);
    expect(state.apiKeysByVendor[VENDOR]).toMatchObject({ enabled: true, verificationPending: true });
  });

  it("a model switched off by a failed check comes back when it has a request format; one without stays off", async () => {
    const dir = await open("failed-disabled");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: true, usable: true, state: "failed" },
      "MiniMax-H3": { enabled: false, usable: false, state: "failed" },
    });
  });

  it("a model the creator switched off by hand stays off", async () => {
    const dir = await open("manual-disabled");
    expect(dir.listed()).toEqual({
      "gpt-image-2": { enabled: false, usable: false, state: "verified" },
      "gpt-4o": { enabled: true, usable: true, state: "verified" },
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
