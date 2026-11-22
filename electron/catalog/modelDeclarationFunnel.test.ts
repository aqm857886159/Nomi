/**
 * 写入口：经 upsert 漏斗（设置页、导入包、接入向导、声明卡登记、AI 接入、改类型、Antigravity 同步都走它）写下的文本行带声明初值。
 * 设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★2「谁写」。目录由测试世界 buildWorld 造，真落盘真读。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWorld, type World } from "../../tests/world";

vi.mock("electron", () => ({ app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() }, safeStorage: { isEncryptionAvailable: () => false } }));
import { readCatalog, upsertModelCatalogModel } from "./catalogStore";

const VENDOR = { key: "relay", name: "Relay", authType: "bearer", enabled: true } as const;

let world: World;
let restoreEnv: () => void;
beforeEach(() => {
  // 目录由测试世界的正门造（真落盘、真读），不再用内存替身顶掉 configFileStore。
  world = buildWorld({ builtinSeeds: false, projects: [], catalog: { vendors: [{ ...VENDOR }] } });
  restoreEnv = world.activate();
});
afterEach(() => {
  restoreEnv();
  world.cleanup();
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

// 声明键按键合并（设计卡 docs/plan/2026-11-22-gpt6-responses.md ★2）：写入方带了 meta 也不冲掉行上原有的声明键。
describe("upsert 漏斗：声明键按键合并，写入方没带的键不被冲掉", () => {
  const DECLARED = { textProtocol: "openai-responses", reasoning: true, thinkingLevelMap: { off: "none" }, compat: { sessionAffinityFormat: "openai-nosession" }, inputModalities: ["audio"] };

  // 行上原有的声明由测试世界的正门种下（换一个带这行的世界），不经被测的 upsert 漏斗。
  function seedDeclared(extra: Record<string, unknown> = {}) {
    restoreEnv();
    world.cleanup();
    world = buildWorld({ builtinSeeds: false, projects: [], catalog: { vendors: [{ ...VENDOR }], models: [
      { vendorKey: "relay", modelKey: "declared", labelZh: "Declared", kind: "text", enabled: true, meta: { ...DECLARED, supportsImageInput: true, ...extra } },
    ] } });
    restoreEnv = world.activate();
    expect(metaOf("declared")).toEqual({ ...DECLARED, supportsImageInput: true, ...extra });
  }

  it("设置页 / 导入包这类写入方手搭一份不带声明的 meta：五个声明键全部留着，别的键归写入方", () => {
    seedDeclared();
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "declared", meta: { note: "edited in settings" } });
    expect(metaOf("declared")).toEqual({ ...DECLARED, note: "edited in settings" });
  });

  it("写入方只带了其中一个声明键：带了的照写，没带的留着", () => {
    seedDeclared();
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "declared", meta: { textProtocol: "anthropic", inputModalities: [] } });
    expect(metaOf("declared")).toEqual({ ...DECLARED, textProtocol: "anthropic", inputModalities: [] });
  });

  it("没带 meta：整份沿用（和以前一样）", () => {
    seedDeclared();
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "declared", labelZh: "Renamed" });
    expect(metaOf("declared")).toMatchObject({ ...DECLARED, supportsImageInput: true });
  });

  it("全新的行带着自己的 meta：照写，没有可保留的", () => {
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "fresh", labelZh: "Fresh", kind: "text", meta: { textProtocol: "openai-responses" } });
    expect(metaOf("fresh")).toEqual({ textProtocol: "openai-responses" });
  });

  it("非声明键仍整份归写入方：supportsImageInput 没带就没了（只有声明键按键合并）", () => {
    seedDeclared();
    upsertModelCatalogModel({ vendorKey: "relay", modelKey: "declared", meta: { reasoning: false } });
    expect(metaOf("declared")).toEqual({ ...DECLARED, reasoning: false });
  });
});
