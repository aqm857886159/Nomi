/**
 * 写入口：经 upsert 漏斗（设置页、导入包、接入向导、声明卡登记、AI 接入、改类型、Antigravity 同步都走它）写下的文本行带声明初值。
 * 设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★2「谁写」。目录读写用内存替身（照 catalogLivenessPersistence.test.ts）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogState } from "./types";

const memory = vi.hoisted(() => ({ catalog: null as CatalogState | null }));
vi.mock("electron", () => ({ app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("../runtimePaths", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), getSettingsRoot: () => "/synthetic-catalog" }));
vi.mock("../configFileStore", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readConfigFile: () => (memory.catalog ? { status: "ok", value: structuredClone(memory.catalog) } : { status: "missing" }),
  configReadFailure: () => null,
  configQuarantineNotice: () => null,
  quarantineUnreadableConfigFile: () => null,
  snapshotConfigVersion: () => null,
  writeConfigFileAtomic: (_path: string, value: CatalogState) => { memory.catalog = structuredClone(value); },
}));
import { readCatalog, upsertModelCatalogModel } from "./catalogStore";
import { CURRENT_CATALOG_VERSION } from "./types";

const VENDOR = { key: "relay", name: "Relay", authType: "bearer", enabled: true, createdAt: "a", updatedAt: "a" } as const;

beforeEach(() => {
  memory.catalog = { version: CURRENT_CATALOG_VERSION, unverifiedUsableRecovered: true, modelDeclarationDefaultsApplied: true,
    vendors: [{ ...VENDOR }], models: [], mappings: [], apiKeysByVendor: {} };
});

function metaOf(modelKey: string): unknown {
  return readCatalog().models.find((model) => model.modelKey === modelKey)?.meta;
}

describe("upsert 漏斗写文本行的声明初值", () => {
  it("新接一行 o1-mini：写下温度覆盖和 PDF", () => {
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "o1-mini", labelZh: "o1 mini", kind: "text" });
    expect(metaOf("o1-mini")).toEqual({ inputModalities: ["pdf"], requestBodyOverrides: { temperature: 1 } });
  });

  it("改了别名：覆盖按新名字重算（没了），PDF 已声明不重算", () => {
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "o1-mini", labelZh: "o1 mini", kind: "text" });
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "o1-mini", modelAlias: "deepseek-chat" });
    expect(metaOf("o1-mini")).toEqual({ inputModalities: ["pdf"] });
  });

  it("写入方自己声明了 inputModalities：原样留下，不被名单改", () => {
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "gemini-2.5-pro", labelZh: "Gemini", kind: "text", meta: { inputModalities: [] } });
    expect(metaOf("gemini-2.5-pro")).toEqual({ inputModalities: [] });
  });

  it("不是文本行：meta 原样", () => {
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "gemini-image", labelZh: "Gemini image", kind: "image", meta: { supportsImageInput: true } });
    expect(metaOf("gemini-image")).toEqual({ supportsImageInput: true });
  });
});
