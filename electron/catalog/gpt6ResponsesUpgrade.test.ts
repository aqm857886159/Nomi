// GPT-6 两行的声明写在目录里、经得起写入方和升级（设计卡 docs/plan/2026-11-22-gpt6-responses.md ★9）。
// 这两组要写目录（设置页改行、启动种子对账），按测试世界的规矩放在目录主人的家里；请求层那几组在 electron/agentLane/gpt6Responses.test.ts。
//   · 设置页带一份不含声明的 meta 改这一行：声明键按键合并留下，仍走 Responses；
//   · 升级前已落盘、缺 textProtocol 的行：启动种子对账后补上；
//   · 真实 v0.24.0 / v0.24.1 目录升级：两行带上声明、请求去 /v1/responses，原有文本行和连接协议一个不变。
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "./types";
import { buildWorld, seedOldUserData, type World } from "../../tests/world";

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

import { createHttpFixture, type CapturedRequest, type FixtureReply } from "../../tests/agent-runtime/httpFixture.mjs";
import { callModelOnce } from "../agentLane/laneModelCall.mjs";
import { nomiModelConfigFor } from "../ai/vendorModelConnection";
import { readModelDeclaration } from "./modelDeclaration";

/** 真实旧版落盘的、带内置 APIMart 连接的目录（v0.24.0 / v0.24.1）：里面还没有 GPT-6 的行。 */
const OLD_APIMART_DIRS = ["builtin-connection/v0.24.0-builtin-plain", "curated/v0.24.1-apimart"];
const API_KEY = "sk-gpt6-fake";
const RESPONSES_ROWS = ["gpt-6-astra", "gpt-6.1-sol"] as const;
const REASONING_KEYS = ["reasoning", "reasoning_effort", "thinking", "enable_thinking", "include"];
const worlds: Array<{ world: World; restore: () => void }> = [];

afterEach(() => {
  for (const { world, restore } of worlds.splice(0)) {
    restore();
    world.cleanup();
  }
});

type Catalog = typeof import("./catalogStore");
type SeededRow = { vendor: Vendor; model: Model };

/** 目录由测试世界的正门造：旧版目录经 seedOldUserData 整份拷进来，空目录经 buildWorld 建；启动种子由本家测试直接跑（和产品启动同一个口）。 */
async function seededCatalog(oldDirectory?: string, seed = true): Promise<Catalog> {
  const world = oldDirectory ? seedOldUserData(oldDirectory) : buildWorld({ builtinSeeds: false, projects: [] });
  worlds.push({ world, restore: world.activate() });
  vi.resetModules();
  const catalog = await import("./catalogStore");
  if (seed) catalog.ensureBuiltinModelSeeds();
  return catalog;
}

function textRows(catalog: Catalog): SeededRow[] {
  const state = catalog.readCatalog();
  return state.models.filter((model) => model.kind === "text").map((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    if (!vendor) throw new Error(`seeded row without its vendor: ${model.vendorKey}/${model.modelKey}`);
    return { vendor, model };
  });
}

function rowOf(rows: SeededRow[], modelKey: string): SeededRow {
  const row = rows.find((item) => item.model.modelKey === modelKey);
  if (!row) throw new Error(`seed catalog has no row ${modelKey}`);
  return row;
}

/** 同一行，地址换成本机假上游，保留原来的路径（`/v1`）。 */
function pointAt(vendor: Vendor, origin: string): Vendor {
  const original = new URL((vendor.baseUrlHint || "").trim());
  return { ...vendor, baseUrlHint: `${origin}${original.pathname.replace(/\/+$/, "")}` };
}

async function withServer<T>(replies: FixtureReply[], run: (server: Awaited<ReturnType<typeof createHttpFixture>> & { origin: string }) => Promise<T>) {
  const server = await createHttpFixture(replies);
  try { return await run(Object.assign(server, { origin: new URL(server.baseURL).origin })); } finally { await server.close(); }
}

function expectPlainResponsesRequest(request: CapturedRequest, label: string) {
  expect(request.method, `${label}: method`).toBe("POST");
  expect(request.path, `${label}: URL`).toBe("/v1/responses");
  expect(request.headers.authorization, `${label}: auth`).toBe(`Bearer ${API_KEY}`);
  for (const key of REASONING_KEYS) expect(request.body, `${label}: no ${key} (these rows declare no reasoning)`).not.toHaveProperty(key);
}

describe("声明不会被写入方冲掉、老用户升级后补上", () => {
  it.each(RESPONSES_ROWS)("%s：设置页改这一行（带一份不含声明的 meta）后仍走 Responses——漏斗按键合并", async (modelKey) => {
    const catalog = await seededCatalog();
    const before = rowOf(textRows(catalog), modelKey);
    catalog.upsertModelCatalogModel({ vendorKey: before.model.vendorKey, modelKey, meta: { userNote: "edited in settings" } });
    const after = rowOf(textRows(catalog), modelKey);
    expect(after.model.meta, "writer's own key is written").toMatchObject({ userNote: "edited in settings" });
    expect(readModelDeclaration(after.model.meta).textProtocol, "declaration survives the writer's meta").toBe("openai-responses");
    expect(nomiModelConfigFor(after.vendor, after.model, API_KEY).kind).toBe("openai-responses");
  });

  it.each(RESPONSES_ROWS)("%s：升级前已落盘的行（没有 textProtocol）读目录 + 启动种子对账后补上", async (modelKey) => {
    const catalog = await seededCatalog();
    const { vendor, model } = rowOf(textRows(catalog), modelKey);
    const { textProtocol: _declared, ...withoutProtocol } = model.meta as Record<string, unknown>;
    // 用「写入方显式不带这一键」之外的路写不出缺键的行（漏斗会保留），所以直接改盘上的目录，等价于升级前主线落下的行。
    catalog.mutateCatalog((_tx, state) => {
      const row = state.models.find((item) => item.vendorKey === vendor.key && item.modelKey === modelKey)!;
      row.meta = withoutProtocol;
    });
    expect(readModelDeclaration(rowOf(textRows(catalog), modelKey).model.meta).textProtocol, "row as the old main wrote it").toBeUndefined();
    catalog.ensureBuiltinModelSeeds();
    const healed = rowOf(textRows(catalog), modelKey);
    expect(nomiModelConfigFor(healed.vendor, healed.model, API_KEY).kind).toBe("openai-responses");
  });
});

describe("老用户升级（真实 v0.24.0 / v0.24.1 目录）", () => {
  it.each(OLD_APIMART_DIRS)("%s：升级后 GPT-6 两行带 Responses 声明、请求去 /v1/responses；原有文本行的协议一个不变", async (directory) => {
    const catalog = await seededCatalog(directory, false);
    const before = textRows(catalog);
    expect(before.map((row) => row.model.modelKey), "the old directory predates the GPT-6 rows").not.toContain("gpt-6-astra");
    const kindBefore = new Map(before.map((row) => [`${row.model.vendorKey}/${row.model.modelKey}`, nomiModelConfigFor(row.vendor, row.model, API_KEY).kind]));
    const connectionKind = () => catalog.readCatalog().vendors.find((vendor) => vendor.key === "apimart")?.providerKind;
    const vendorBefore = connectionKind();
    catalog.ensureBuiltinModelSeeds();
    const after = textRows(catalog);
    for (const row of after) {
      const key = `${row.model.vendorKey}/${row.model.modelKey}`;
      if (kindBefore.has(key)) expect.soft(nomiModelConfigFor(row.vendor, row.model, API_KEY).kind, `${key}: pre-existing row keeps its protocol`).toBe(kindBefore.get(key));
    }
    expect(connectionKind(), "connection protocol untouched").toBe(vendorBefore);
    for (const modelKey of RESPONSES_ROWS) {
      const { vendor, model } = rowOf(after, modelKey);
      expect(readModelDeclaration(model.meta).textProtocol, `${modelKey} declaration after upgrade`).toBe("openai-responses");
      await withServer([{ type: "text", text: "Upgraded." }], async (server) => {
        const config = nomiModelConfigFor(pointAt(vendor, server.origin), model, API_KEY);
        await callModelOnce({ model: config, fetch: globalThis.fetch, content: "Hi." as never, signal: new AbortController().signal });
        expectPlainResponsesRequest(server.requests[0]!, `${directory} ${modelKey}`);
      });
    }
  });

  it("用户在设置里手选过连接协议（Anthropic）：没声明的行照手选走，只有声明了的两行走 Responses，连接本身不动", async () => {
    const catalog = await seededCatalog(OLD_APIMART_DIRS[0], false);
    catalog.mutateCatalog((_tx, state) => { state.vendors.find((vendor) => vendor.key === "apimart")!.providerKind = "anthropic"; });
    catalog.ensureBuiltinModelSeeds();
    const state = catalog.readCatalog();
    expect(state.vendors.find((vendor) => vendor.key === "apimart")!.providerKind, "hand-picked connection protocol").toBe("anthropic");
    for (const row of textRows(catalog).filter((item) => item.model.vendorKey === "apimart")) {
      const expected = (RESPONSES_ROWS as readonly string[]).includes(row.model.modelKey) ? "openai-responses" : "anthropic";
      expect.soft(nomiModelConfigFor(row.vendor, row.model, API_KEY).kind, row.model.modelKey).toBe(expected);
    }
  });
});
