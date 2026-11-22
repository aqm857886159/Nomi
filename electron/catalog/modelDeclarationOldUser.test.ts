/**
 * 老用户升级：文本模型行的能力声明（设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★1c / ★9「修正测试」）。
 *
 * 六份目录都是 v0.24.0、v0.24.1 真实落盘的（tests/fixtures/old-user-data/text-quirks，生成方法见 tests/fixtures/old-user-data/README.md）：
 * 每版各接三家中转（Chat / Anthropic / Responses 三条协议各一家），模型名覆盖旧名字表里每一条怪癖和 PDF 名单的每一族，
 * 外加对照行；Chat 那一份里还有 Antigravity 同步写下的行（旧版里唯一显式写 `supportsPdfInput: false` 的写入方）。
 * 读盘、迁移、数据修正都是真代码。下面的期望是按旧名字表**手抄**的，不调初值函数：
 *   · `^(o1|o3)(-|$)` → 温度只收 1；`^kimi-k2` → 温度 1 + `enable_thinking: false`（名字表里其余条目在请求里没有效果）；
 *   · PDF 名单撞上 → `['pdf']`；显式 `supportsPdfInput: false` → `[]`；撞不上 → 不写。
 * 协议、推理三格一律不写（老用户的请求必须和升级前一样）。
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seedOldUserData, type World } from "../../tests/world";

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

const DIRECTORIES = ["v0.24.0/chat", "v0.24.0/anthropic", "v0.24.0/responses", "v0.24.1/chat", "v0.24.1/anthropic", "v0.24.1/responses"];
const DECLARATION_KEYS = ["textProtocol", "reasoning", "thinkingLevelMap", "compat", "inputModalities", "requestBodyOverrides"];
const PDF = { inputModalities: ["pdf"] };
const NO_PDF = { inputModalities: [] };
const TEMPERATURE_ONE = { requestBodyOverrides: { temperature: 1 } };

type Declaration = { inputModalities?: string[]; requestBodyOverrides?: Record<string, unknown> };
/** 每份目录里每一行文本模型（`vendorKey/modelKey`）读完之后应有的声明；不在表里 = 什么都不写。 */
const EXPECTED: Record<string, Record<string, Declaration>> = {
  chat: {
    "local-39017/o1-mini": { ...PDF, ...TEMPERATURE_ONE },
    "local-39017/o3-mini": { ...PDF, ...TEMPERATURE_ONE },
    "local-39017/kimi-k2-0905-preview": { requestBodyOverrides: { temperature: 1, enable_thinking: false } },
    "local-39017/gpt-4o-mini": PDF,
    "local-39017/claude-3-5-haiku-20241022": PDF,
    "local-39017/gemini-2.5-flash": PDF,
    // moonshot-v1-8k / kimi-latest / kimi-thinking-preview / gpt-5-mini / deepseek-chat：名字表里有条目，但在请求里没有效果。
    "antigravity-cli/auto": NO_PDF,
    "antigravity-cli/gemini-3-pro": NO_PDF,
    "antigravity-cli/claude-sonnet-4-5": NO_PDF,
  },
  anthropic: {
    "local-39017/claude-3-5-sonnet-20241022": PDF,
    "local-39017/claude-3-7-sonnet-20250219": PDF,
    "local-39017/claude-opus-4-1": PDF,
    "local-39017/claude-sonnet-4-5": PDF,
    "local-39017/claude-haiku-4-5": PDF,
    // claude-3-haiku-20240307：不在 PDF 名单里。
  },
  responses: {
    "local-39017/gpt-4o": PDF,
    "local-39017/gpt-4.1": PDF,
    "local-39017/o1": { ...PDF, ...TEMPERATURE_ONE },
    "local-39017/o3": { ...PDF, ...TEMPERATURE_ONE },
    "local-39017/o4-mini": PDF,
    "local-39017/gemini-2.5-pro": PDF,
    // gpt-5：不在 PDF 名单里。
  },
};

type DiskModel = { vendorKey: string; modelKey: string; kind: string; meta?: Record<string, unknown> };
type Disk = { version: number; models: DiskModel[]; [key: string]: unknown };
const worlds: World[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const world of worlds.splice(0)) world.cleanup();
});

async function open(directory: string) {
  // 老用户的真实落盘数据经测试世界的正门拷进来（占位符换成这个世界的位置），不手搓目录文件。
  const world = seedOldUserData(`text-quirks/${directory}`);
  worlds.push(world);
  const settings = world.settingsDir;
  const file = path.join(settings, "model-catalog.json");
  const original = fs.readFileSync(file, "utf8");
  vi.stubEnv("NOMI_SETTINGS_DIR", settings);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  vi.resetModules();
  const catalog = await import("./catalogStore");
  const disk = () => JSON.parse(fs.readFileSync(file, "utf8")) as Disk;
  return { catalog, disk, file, settings, original: JSON.parse(original) as Disk, originalBytes: original };
}

function declarationOf(model: DiskModel): Declaration {
  return Object.fromEntries(DECLARATION_KEYS.filter((key) => model.meta && key in model.meta).map((key) => [key, model.meta![key]]));
}

function withoutDeclaration(disk: Disk): Disk {
  const { modelDeclarationDefaultsApplied: _receipt, ...rest } = disk;
  return { ...rest, models: disk.models.map((model) => {
    if (!model.meta) return model;
    const meta = Object.fromEntries(Object.entries(model.meta).filter(([key]) => !DECLARATION_KEYS.includes(key)));
    return { ...model, meta };
  }) };
}

describe.each(DIRECTORIES)("saved by %s, read by this release", (directory) => {
  const protocol = directory.split("/")[1]!;

  it("every text model row carries the declaration the old name table implied, and nothing else", async () => {
    const dir = await open(directory);
    dir.catalog.readCatalog();
    const written = dir.disk();
    const seen = Object.fromEntries(written.models.filter((model) => model.kind === "text")
      .map((model) => [`${model.vendorKey}/${model.modelKey}`, declarationOf(model)]));
    const wanted = Object.fromEntries(Object.keys(seen).map((id) => [id, EXPECTED[protocol]![id] ?? {}]));
    expect(Object.keys(EXPECTED[protocol]!).filter((id) => !(id in seen)), "every expected row is in the fixture").toEqual([]);
    expect(seen).toEqual(wanted);
  });

  it("the repair writes its receipt, keeps format 13, leaves every other cell as it was and backs up the original bytes", async () => {
    const dir = await open(directory);
    dir.catalog.readCatalog();
    const written = dir.disk();
    expect(written.version).toBe(13);
    expect(written.modelDeclarationDefaultsApplied).toBe(true);
    // 0.24.x 的目录还没有「验证删掉之后的修正」收据，那一次修正同时跑、只加它自己的收据（这些行都开着，不动）。
    expect(withoutDeclaration(written)).toEqual({ ...dir.original, unverifiedUsableRecovered: true });
    expect(fs.readFileSync(path.join(dir.settings, "model-catalog.v13.bak.json"), "utf8")).toBe(dir.originalBytes);
  });

  it("the repair runs once: with the receipt on disk a later read leaves the rows alone", async () => {
    const dir = await open(directory);
    dir.catalog.readCatalog();
    const written = dir.disk();
    const target = written.models.find((model) => model.meta && "inputModalities" in model.meta);
    expect(target, "the fixture has a row the repair declared").toBeDefined();
    if (!target) return;
    // 把声明拿掉这一步走主人的写口（事务里直接改它落盘的那份状态），不手写目录文件。
    dir.catalog.mutateCatalog((_tx, state) => {
      const row = state.models.find((model) => model.vendorKey === target.vendorKey && model.modelKey === target.modelKey)!;
      delete (row.meta as Record<string, unknown>).inputModalities;
    });
    dir.catalog.readCatalog();
    const again = dir.disk().models.find((model) => model.vendorKey === target.vendorKey && model.modelKey === target.modelKey)!;
    expect(again.meta).not.toHaveProperty("inputModalities");
  });
});
