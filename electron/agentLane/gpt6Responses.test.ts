// GPT-6 两行改走官方 Responses 协议（设计卡 docs/plan/2026-11-22-gpt6-responses.md ★9）。
//
// 行都从**种子目录读出来**（空设置目录 → 启动种子 → `readCatalog`），不手搭带 meta 的行：手搭的行在主线上本来就绿，
// 「什么都不做」红不了。每条断言都走真门：目录行 → `nomiModelConfigFor` → Agent lane（`openLane`）/ 单发（`callModelOnce`）→ 真 pi → 真 HTTP 打到本机假上游。
//   · 请求层：两行的每一次请求都去 `/v1/responses`，鉴权头不变，没有推理参数、没有 `include`（这两行没声明推理，不开推理——第 3 刀的事）；
//   · 多步回放：Agent 一轮 3 次请求、2 次工具调用；第 1、2 次响应里的推理条目（`encrypted_content`）在第 2、3 次请求里**原样**带回，
//     顺序是「推理条目 → 它同一响应里的工具调用 → 工具结果」，工具调用的 `fc_` 条目 id 还在；整轮走完（两个工具结果都不是错误、最后一句话到了）；
//   · 其余内置文本行的协议一个都不变（只有这两行行上带 `textProtocol`）。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import { buildWorld, type World } from "../../tests/world";

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
import { createDocumentPort } from "../../tests/agent-runtime/laneFixture.mjs";
import { createDocumentLaneTools } from "./laneDocumentTools";
import { openLane } from "./laneHost.mjs";
import { callModelOnce } from "./laneModelCall.mjs";
import { nomiModelConfigFor } from "../ai/vendorModelConnection";
import { readModelDeclaration } from "../catalog/modelDeclaration";

const API_KEY = "sk-gpt6-fake";
/** 官方文档写明「工具调用必须走 Responses」的两行（迁移指南 migrate-to-responses：GPT-6 Astra 与 GPT-6.1 Sol）。 */
const RESPONSES_ROWS = ["gpt-6-astra", "gpt-6.1-sol"] as const;
/** 同族但文档没写必须走 Responses 的两行：不改。 */
const UNCHANGED_SIBLINGS = ["gpt-6.1-terra", "gpt-6-luna"] as const;
const REASONING_KEYS = ["reasoning", "reasoning_effort", "thinking", "enable_thinking", "include"];
const roots: string[] = [];
const worlds: Array<{ world: World; restore: () => void }> = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  for (const { world, restore } of worlds.splice(0)) {
    restore();
    world.cleanup();
  }
});

type SeededRow = { vendor: Vendor; model: Model };

/** 内置种子目录由测试世界的正门造（空世界跑启动种子、真落盘），这里只读；写目录的用例在目录主人的家里。 */
async function seededCatalog() {
  const world = buildWorld({ builtinSeeds: true, projects: [] });
  worlds.push({ world, restore: world.activate() });
  vi.resetModules();
  return import("../catalog/catalogStore");
}

function textRows(catalog: Awaited<ReturnType<typeof seededCatalog>>): SeededRow[] {
  const state = catalog.readCatalog();
  return state.models.filter((model) => model.kind === "text").map((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    if (!vendor) throw new Error(`seeded row without its vendor: ${model.vendorKey}/${model.modelKey}`);
    return { vendor, model };
  });
}

async function seededRows(): Promise<SeededRow[]> {
  return textRows(await seededCatalog());
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

type InputItem = { type?: string; role?: string; id?: string; call_id?: string; encrypted_content?: string };
const inputOf = (request: CapturedRequest) => request.body.input as InputItem[];

function expectPlainResponsesRequest(request: CapturedRequest, label: string) {
  expect(request.method, `${label}: method`).toBe("POST");
  expect(request.path, `${label}: URL`).toBe("/v1/responses");
  expect(request.headers.authorization, `${label}: auth`).toBe(`Bearer ${API_KEY}`);
  for (const key of REASONING_KEYS) expect(request.body, `${label}: no ${key} (these rows declare no reasoning)`).not.toHaveProperty(key);
}

describe("GPT-6 Astra / 6.1 Sol：Agent 文本请求走 Responses 协议", () => {
  it.each(RESPONSES_ROWS)("%s · Agent lane 多步任务：3 次请求都去 /v1/responses，推理条目原样回放，整轮走完", async (modelKey) => {
    const { vendor, model } = rowOf(await seededRows(), modelKey);
    await withServer([
      { type: "message", parts: [
        { type: "responsesReasoning", id: "rs_step_1", encryptedContent: "ENC_STEP_ONE", summary: "plan the read" },
        { type: "toolCall", id: "call_step_1", name: "read_script", arguments: { scope: "full" } }] },
      { type: "message", parts: [
        { type: "responsesReasoning", id: "rs_step_2", encryptedContent: "ENC_STEP_TWO" },
        { type: "toolCall", id: "call_step_2", name: "read_script", arguments: { scope: "full" } }] },
      { type: "text", text: "All steps done." },
    ], async (server) => {
      const config = nomiModelConfigFor(pointAt(vendor, server.origin), model, API_KEY);
      expect(config.kind, "protocol the row resolves to").toBe("openai-responses");
      const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-gpt6-responses-lane-"));
      roots.push(projectDir);
      const lane = await openLane({ fetch: globalThis.fetch, projectDir, systemPrompt: "NOMI_GPT6_SYSTEM", model: config,
        tools: createDocumentLaneTools(createDocumentPort()) });
      try {
        await lane.execute({ kind: "prompt", text: "Read the script twice, then say you are done." });
        // 整轮成没成：3 次请求、两个工具结果都不是错误、最后一句话到了。
        expect(server.requests, "requests of one multi-step turn").toHaveLength(3);
        server.requests.forEach((request, index) => expectPlainResponsesRequest(request, `request ${index + 1}`));
        const parts = lane.projection().parts;
        const results = parts.filter((part) => part.kind === "tool-result");
        expect(results, "tool results").toHaveLength(2);
        for (const result of results) expect(result, "tool result is not an error").toMatchObject({ isError: false });
        expect(parts.filter((part) => part.kind === "assistant-text").at(-1), "final reply").toMatchObject({ text: "All steps done." });

        // 回放：第 2 次起，上一轮的推理条目原样在场，且排在它同一响应的工具调用前面。
        const shape = (request: CapturedRequest) => inputOf(request).filter((item) => item.type && item.type !== "message")
          .map((item) => `${item.type}:${item.id ?? item.call_id}`);
        expect(inputOf(server.requests[0]!).some((item) => item.type === "reasoning"), "request 1 has nothing to replay").toBe(false);
        expect(shape(server.requests[1]!)).toEqual(["reasoning:rs_step_1", "function_call:fc_call_step_1", "function_call_output:call_step_1"]);
        expect(shape(server.requests[2]!)).toEqual(["reasoning:rs_step_1", "function_call:fc_call_step_1", "function_call_output:call_step_1",
          "reasoning:rs_step_2", "function_call:fc_call_step_2", "function_call_output:call_step_2"]);
        const replayed = (request: CapturedRequest, id: string) => inputOf(request).find((item) => item.type === "reasoning" && item.id === id);
        expect(replayed(server.requests[1]!, "rs_step_1"), "request 2 replays step 1 reasoning").toMatchObject({ encrypted_content: "ENC_STEP_ONE" });
        expect(replayed(server.requests[2]!, "rs_step_1"), "request 3 replays step 1 reasoning").toMatchObject({ encrypted_content: "ENC_STEP_ONE" });
        expect(replayed(server.requests[2]!, "rs_step_2"), "request 3 replays step 2 reasoning").toMatchObject({ encrypted_content: "ENC_STEP_TWO" });
      } finally {
        await lane.close();
      }
    });
  });

  it.each(RESPONSES_ROWS)("%s · 单发（拆镜头等）也走 /v1/responses，pi 的协议是 openai-responses", async (modelKey) => {
    const { vendor, model } = rowOf(await seededRows(), modelKey);
    await withServer([{ type: "text", text: "Shot list." }], async (server) => {
      const config = nomiModelConfigFor(pointAt(vendor, server.origin), model, API_KEY);
      const { message } = await callModelOnce({ model: config, fetch: globalThis.fetch, content: "Split this into shots." as never,
        systemPrompt: "NOMI_GPT6_SYSTEM", signal: new AbortController().signal });
      expect(server.requests).toHaveLength(1);
      expectPlainResponsesRequest(server.requests[0]!, "single shot");
      expect(message.api, "pi api").toBe("openai-responses");
    });
  });
});

describe("协议只写在行声明一处，别的行不被带着变", () => {
  it("全部内置文本行：只有 Astra / Sol 带 textProtocol，且只有它们的协议和连接默认不同", async () => {
    const rows = await seededRows();
    expect(rows.length).toBeGreaterThan(30);
    const declared = rows.filter((row) => readModelDeclaration(row.model.meta).textProtocol !== undefined).map((row) => row.model.modelKey).sort();
    expect(declared, "rows that carry a textProtocol declaration").toEqual([...RESPONSES_ROWS].sort());
    for (const row of rows) {
      const { textProtocol: _declared, ...rest } = (row.model.meta ?? {}) as Record<string, unknown>;
      const connectionDefault = nomiModelConfigFor(row.vendor, { ...row.model, meta: rest }, API_KEY).kind;
      const actual = nomiModelConfigFor(row.vendor, row.model, API_KEY).kind;
      const label = `${row.model.vendorKey}/${row.model.modelKey}`;
      if ((RESPONSES_ROWS as readonly string[]).includes(row.model.modelKey)) {
        expect(connectionDefault, `${label}: the connection default differs, so the declaration is what moved it`).not.toBe("openai-responses");
        expect(actual, label).toBe("openai-responses");
      } else {
        expect.soft(actual, `${label}: unchanged protocol`).toBe(connectionDefault);
      }
    }
  });

  it.each(UNCHANGED_SIBLINGS)("%s：同族但文档没写必须走 Responses，仍走连接的协议（Chat）", async (modelKey) => {
    const { vendor, model } = rowOf(await seededRows(), modelKey);
    expect(readModelDeclaration(model.meta).textProtocol).toBeUndefined();
    expect(nomiModelConfigFor(vendor, model, API_KEY).kind).toBe("openai-compatible");
  });
});

describe("没有第二个家：协议不按名字认", () => {
  it.each(RESPONSES_ROWS)("自建中转上名字也叫 %s、但没写声明的行：照连接的协议（Chat）走——名字撞上不算数", async (modelKey) => {
    const { vendor } = rowOf(await seededRows(), modelKey);
    const relay = { ...vendor, key: "my-relay", name: "My relay" } as Vendor;
    const mine = { vendorKey: "my-relay", modelKey, labelZh: modelKey, kind: "text", enabled: true, createdAt: "", updatedAt: "" } as Model;
    expect(nomiModelConfigFor(relay, mine, API_KEY).kind).toBe("openai-compatible");
  });
});

// 写目录的两组（设置页改行后声明还在、老用户升级后补上声明）在目录主人的家里：electron/catalog/gpt6ResponsesUpgrade.test.ts。
