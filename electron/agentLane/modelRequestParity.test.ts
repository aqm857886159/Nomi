// 出网请求逐字节对拍（设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★9「保险」）。
//
// 抓在出网那一层：本机假上游收到的原始请求——网址（路径 + 查询）、方法、请求头（只去掉下面 EXCLUDED_HEADERS 里
// 机器相关的几格）、请求体原字节。金样在主线上录（`recordedFrom` 写主线提交），之后每次跑都必须一字不差。
//
// 每一行都从**目录读出来的那一行**进门（`readCatalog` → `nomiModelConfigFor`），不手搭配置：
//   · 内置：空设置目录跑一次启动种子，全部内置文本行；
//   · 旧版：`tests/fixtures/old-user-data/text-quirks/` 下 v0.24.0、v0.24.1 自己落的目录（读的时候跑升级修正），
//     名字表里每一条怪癖至少一行，外加对照行。Antigravity 那一家的行不进对拍：它的文本任务走本机 CLI，不经这台发动机。
// 三个调用方：Agent lane（带工具定义，第二个请求带「前面一轮助手调用工具」的历史）、单发文本任务（`executeTextTask`，
// 拆解读图那一格：3 帧 + 温度 + 上限 + 不重试）、流式文本（`nomi:tasks:text:stream`，画布文本节点连图那一格：3 帧 + 温度 + 上限）；
// 另有 PDF 附件一组（Agent 一次性提问的真门 `runLaneSingleShot`）。
//
// 录：NOMI_RECORD_MODEL_REQUEST_PARITY=<金样文件绝对路径> NOMI_RECORD_COMMIT=<主线完整提交号>，只在干净主线检出上录。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, Vendor } from "../catalog/types";
import { makeTempDir } from "../../scripts/_test-temp.mjs";
import { buildWorld, seedOldUserData, worldRows, type World } from "../../tests/world";

const FRAME_PNG = vi.hoisted(() => Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const PDF = vi.hoisted(() => Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n", "latin1"));

vi.mock("electron", async () => ({
  ...(await import("../../tests/fixtures/textTasks/textTaskCallerState")).electronMock(),
  app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../events/vendorCallTrace", () => ({ traceVendorCompleted: () => undefined, traceVendorRequested: () => undefined }));
vi.mock("../assets/localAssetFile", async (importOriginal) => ({
  ...await importOriginal<typeof import("../assets/localAssetFile")>(),
  readNomiLocalAsset: (url: string) => url.startsWith("nomi-local://frame") ? { bytes: FRAME_PNG, contentType: "image/png" }
    : url.endsWith(".pdf") ? { bytes: PDF, contentType: "application/pdf" } : null,
}));
vi.mock("../assets/projectAssetStore", () => ({
  resolveProjectAgentAttachmentClaims: (_projectId: string, claims: ReadonlyArray<{ assetId: string }>) => claims.map((claim) => ({
    assetId: claim.assetId, contentHash: `hash-${claim.assetId}`, version: 1,
    display: { url: `nomi-local://asset/parity/${claim.assetId}.pdf`, fileName: `${claim.assetId}.pdf`,
      contentType: "application/pdf", sizeBytes: PDF.byteLength, kind: "file" },
  })),
}));

import { harnessState, type Sender } from "../../tests/fixtures/textTasks/textTaskCallerState";
import { createHttpFixture, type CapturedRequest, type FixtureReply } from "../../tests/agent-runtime/httpFixture.mjs";
import { createDocumentPort } from "../../tests/agent-runtime/laneFixture.mjs";
import { createDocumentLaneTools } from "./laneDocumentTools";
import { openLane } from "./laneHost.mjs";
import { runLaneSingleShot } from "./laneSingleShot.mjs";
import { createDesktopLaneInput } from "./laneDesktopInput";
import { makeApiKeyRecordFromPlain } from "../catalog/secrets";
import { nomiModelConfigFor } from "../ai/vendorModelConnection";
import { registerTextStreamIpc } from "../ai/textStreamIpc";
import { executeTextTask } from "../textTaskRunner";
import { ANTIGRAVITY_VENDOR_KEY } from "../shared/antigravity";

const GOLDEN = fileURLToPath(new URL("../../tests/fixtures/model-request-parity/requests.json", import.meta.url));
const OLD_DIRS = ["v0.24.0/chat", "v0.24.0/anthropic", "v0.24.0/responses", "v0.24.1/chat", "v0.24.1/anthropic", "v0.24.1/responses"];
const API_KEY = "sk-parity-fake";
const FRAMES = ["nomi-local://frame-1.png", "nomi-local://frame-2.png", "nomi-local://frame-3.png"];

/** 不比的请求头，每格写明为什么（其余全部逐字比）。 */
const EXCLUDED_HEADERS: Record<string, string> = {
  host: "本机假上游的随机端口",
  "x-stainless-os": "SDK 报的操作系统（Mac / Linux CI 不同）",
  "x-stainless-arch": "SDK 报的 CPU 架构（arm64 / x64 不同）",
  "x-stainless-runtime-version": "SDK 报的 Node 小版本（本机与 CI 不同）",
  "user-agent": "pi 报的操作系统版本与 CPU 架构（本机与 CI 不同）",
};
/** 每次跑都会变、但结构要比的值：换成占位符再比（同一次运行里同一个值始终换成同一个号，复用关系照样在比）。 */
const PLACEHOLDERS: Record<string, string> = {
  "{{uuid-N}}": "每次开 lane 新起的会话号（请求头 session_id / x-client-request-id、请求体 prompt_cache_key）",
  "{{projectDir}}": "每次新建的临时项目目录",
};
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

type Row = { id: string; vendor: Vendor; model: Model };
type Wire = { method: string; path: string; headers: Record<string, string>; body: string };
type CallerName = "lane" | "one-shot" | "stream" | "pdf";
const observed: Record<string, Partial<Record<CallerName, Wire[]>>> = {};
const worlds: World[] = [];
const roots: string[] = [];

/** 一次运行（一个调用方跑一行）抓到的全部请求，按 EXCLUDED_HEADERS / PLACEHOLDERS 规整。 */
function wires(requests: CapturedRequest[], projectDir?: string): Wire[] {
  const ids = new Map<string, string>();
  const scrub = (text: string) => {
    const local = projectDir ? text.split(projectDir).join("{{projectDir}}") : text;
    return local.replace(UUID, (id) => {
      if (!ids.has(id.toLowerCase())) ids.set(id.toLowerCase(), `{{uuid-${ids.size + 1}}}`);
      return ids.get(id.toLowerCase())!;
    });
  };
  return requests.map((request) => {
    const headers: Record<string, string> = {};
    for (const name of Object.keys(request.headers).sort()) {
      if (name in EXCLUDED_HEADERS) continue;
      const value = request.headers[name];
      headers[name] = scrub(Array.isArray(value) ? value.join(", ") : String(value));
    }
    return { method: request.method, path: request.path, headers, body: scrub(request.raw) };
  });
}

function catalogRows(prefix: string, fixture: string | null): Row[] {
  // 目录由测试世界的正门造：内置行 = 空世界跑启动种子；旧版行 = 老用户真实落盘的那份（读的时候跑升级修正）。
  const world = fixture ? seedOldUserData(`text-quirks/${fixture}`) : buildWorld({ builtinSeeds: true, projects: [] });
  worlds.push(world);
  const state = worldRows(world) as { vendors: Vendor[]; models: Model[] };
  return state.models.filter((model) => model.kind === "text" && model.vendorKey !== ANTIGRAVITY_VENDOR_KEY).map((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey);
    if (!vendor) throw new Error(`fixture row without its vendor: ${model.vendorKey}/${model.modelKey}`);
    return { id: `${prefix}/${model.vendorKey}/${model.modelKey}`, vendor, model };
  });
}

/** 同一行，地址换成本机假上游，保留原来的路径（`/v1`、`/claude/v1`…）——路径本身也在对拍里。 */
function pointAt(vendor: Vendor, origin: string): Vendor {
  const original = new URL((vendor.baseUrlHint || "").trim() || "https://api.anthropic.com/v1");
  return { ...vendor, baseUrlHint: `${origin}${original.pathname.replace(/\/+$/, "")}` };
}

/** 凭据绑定只在存 key 时由主人写，不属于 vendor 的 upsert 载荷。 */
function withoutCredentialBinding(vendor: Vendor): Vendor {
  const { credentialBinding: _binding, ...rest } = vendor as Vendor & { credentialBinding?: unknown };
  return rest as Vendor;
}

async function withServer<T>(replies: FixtureReply[], run: (server: Awaited<ReturnType<typeof createHttpFixture>> & { origin: string }) => Promise<T>) {
  const server = await createHttpFixture(replies);
  try { return await run(Object.assign(server, { origin: new URL(server.baseURL).origin })); } finally { await server.close(); }
}

async function runLane(row: Row): Promise<Wire[]> {
  return withServer([
    { type: "tool", calls: [{ id: "call_parity_1", name: "read_script", arguments: { scope: "full" } }] },
    { type: "text", text: "Read it." },
  ], async (server) => {
    const projectDir = makeTempDir("nomi-request-parity-lane-");
    roots.push(projectDir);
    const config = nomiModelConfigFor(pointAt(row.vendor, server.origin), row.model, API_KEY);
    const lane = await openLane({ fetch: globalThis.fetch, projectDir, systemPrompt: "NOMI_PARITY_SYSTEM", model: config,
      tools: createDocumentLaneTools(createDocumentPort()) });
    try { await lane.execute({ kind: "prompt", text: "Read the script, then summarise it." }); } finally { await lane.close(); }
    expect(server.requests, row.id).toHaveLength(2);
    return wires(server.requests, projectDir);
  });
}

async function runOneShot(row: Row): Promise<Wire[]> {
  return withServer([{ type: "text", text: "A frame." }], async (server) => {
    const vendor = pointAt(row.vendor, server.origin);
    const request = { kind: "image_to_prompt" as const, prompt: "Describe these frames.",
      extras: { modelKey: row.model.modelKey, temperature: 0.2, maxTokens: 1200, maxRetries: 0, referenceImages: FRAMES } };
    const result = await executeTextTask({ vendor, model: row.model, apiKey: API_KEY, kind: request.kind, request, taskId: "task-parity" });
    expect(result.status, row.id).toBe("succeeded");
    expect(server.requests, row.id).toHaveLength(1);
    return wires(server.requests);
  });
}

const sender = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) as Sender;
let streamSeq = 0;
async function runStream(row: Row): Promise<Wire[]> {
  return withServer([{ type: "text", text: "A frame." }], async (server) => {
    const streamId = `text-parity-stream-${++streamSeq}`;
    harnessState.events.set(streamId, []);
    const request = { kind: "image_to_prompt", prompt: "Describe these frames.",
      extras: { modelKey: row.model.modelKey, temperature: 0.35, maxTokens: 1600, referenceImages: FRAMES } };
    const settled = new Promise<void>((resolve) => {
      const tick = () => {
        if (!harnessState.events.get(streamId)!.some((event) => event.type === "done" || event.type === "error")) return;
        harnessState.listeners.delete(tick);
        resolve();
      };
      harnessState.listeners.add(tick);
    });
    // 流式入口自己去目录里解析这一行：给这一行造一个小世界（假上游地址 + 加密好的 key 都经 buildWorld 的声明进去），走真解析。
    const now = new Date().toISOString();
    const world = buildWorld({ builtinSeeds: false, projects: [],
      catalog: { vendors: [withoutCredentialBinding(pointAt(row.vendor, server.origin))], models: [{ ...row.model, selectable: true }] },
      encryptedApiKeys: { [row.vendor.key]: makeApiKeyRecordFromPlain(API_KEY, row.vendor.key, true, now, now) } });
    const restore = world.activate();
    try {
      await harnessState.handlers.get("nomi:tasks:text:stream")!({ sender }, { vendor: row.vendor.key, request, streamId });
      await settled;
    } finally {
      restore();
      world.cleanup();
    }
    expect(harnessState.events.get(streamId)!.find((event) => event.type === "error"), row.id).toBeUndefined();
    expect(server.requests, row.id).toHaveLength(1);
    return wires(server.requests);
  });
}

async function runPdf(row: Row): Promise<Wire[]> {
  return withServer([{ type: "text", text: "Read." }], async (server) => {
    const config = nomiModelConfigFor(pointAt(row.vendor, server.origin), row.model, API_KEY);
    const context = { approvalPolicy: { mode: "request" as const }, attachments: [{ assetId: "brief", version: 1 }] };
    const input = createDesktopLaneInput({ projectId: "parity", capture: () => context as never, activate: () => undefined,
      prepare: async (captured) => captured, model: () => ({ model: row.model, kind: config.kind }) });
    await runLaneSingleShot({ model: config, fetch: globalThis.fetch, prompt: "Summarise the attached brief.", input,
      signal: new AbortController().signal, systemPrompt: "NOMI_PARITY_SYSTEM" });
    expect(server.requests, row.id).toHaveLength(1);
    return wires(server.requests);
  });
}

const CALLERS: Record<CallerName, (row: Row) => Promise<Wire[]>> = { lane: runLane, "one-shot": runOneShot, stream: runStream, pdf: runPdf };

let rows: Row[] = [];
// 每个用例都开网络守卫（配置里 unstubEnvs 每个用例后还原环境变量，所以放 beforeEach）。
beforeEach(() => { vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1"); });
beforeAll(async () => {
  registerTextStreamIpc();
  rows = [...catalogRows("builtin", null)];
  for (const dir of OLD_DIRS) rows.push(...catalogRows(dir, dir));
});

afterAll(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
  for (const world of worlds.splice(0)) world.cleanup();
  const target = process.env.NOMI_RECORD_MODEL_REQUEST_PARITY;
  if (!target) return;
  const commit = process.env.NOMI_RECORD_COMMIT ?? "";
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("NOMI_RECORD_COMMIT must be the full main commit");
  const golden = pack(commit);
  for (const row of rows) for (const caller of Object.keys(CALLERS) as CallerName[]) {
    if (JSON.stringify(unpack(golden, row.id, caller)) !== JSON.stringify(observed[row.id]?.[caller])) throw new Error(`pack is lossy: ${caller} · ${row.id}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(golden, null, 1)}\n`);
});

describe("出网请求与主线逐字节一样", () => {
  it("行数：全部内置文本行 + 旧版目录里每一行文本模型（Antigravity 除外）都在", () => {
    const golden = recording() ? null : readGolden();
    expect(rows.length).toBeGreaterThan(0);
    if (golden) expect(rows.map((row) => row.id).sort()).toEqual(Object.keys(golden.rows).sort());
  });

  for (const caller of Object.keys(CALLERS) as CallerName[]) {
    it(`${caller}：每一行的请求与金样一字不差`, async () => {
      const golden = recording() ? null : readGolden();
      for (const row of rows) {
        const got = await CALLERS[caller](row);
        (observed[row.id] ??= {})[caller] = got;
        // soft：一次跑完报出每一行的差异，不在第一行就停（数得清哪几行变了）。
        if (golden) expect.soft(got, `${caller} · ${row.id}`).toEqual(unpack(golden, row.id, caller));
      }
    }, 300_000);
  }
});

function recording(): boolean {
  return Boolean(process.env.NOMI_RECORD_MODEL_REQUEST_PARITY);
}

// 金样存法：同一份请求体 / 请求头在 82 行里大量重复（只差模型名），按内容去重成表，行里只记引用。
// 比的时候还原成完整请求再比，失败时看到的是完整字符串的差异。
type PackedWire = { method: string; path: string; headers: string; contentLength?: string; body: string };
type Golden = {
  recordedFrom: string;
  excludedHeaders: Record<string, string>;
  placeholders: Record<string, string>;
  headerSets: Record<string, Record<string, string>>;
  bodies: Record<string, string>;
  rows: Record<string, { model: string } & Partial<Record<CallerName, PackedWire[]>>>;
};

function modelIdOf(row: Row): string {
  return (row.model.modelAlias || row.model.modelKey).trim();
}

function ref(table: Record<string, unknown>, value: unknown): string {
  const key = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
  table[key] = value;
  return key;
}

function pack(commit: string): Golden {
  const golden: Golden = { recordedFrom: commit, excludedHeaders: EXCLUDED_HEADERS,
    placeholders: { ...PLACEHOLDERS, "{{model}}": "这一行发出去的模型名（行里 model 那一格）" }, headerSets: {}, bodies: {}, rows: {} };
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const model = modelIdOf(row);
    const entry: Golden["rows"][string] = { model };
    for (const caller of Object.keys(CALLERS) as CallerName[]) {
      entry[caller] = (observed[row.id]?.[caller] ?? []).map((item) => {
        const { "content-length": contentLength, ...headers } = item.headers;
        return { method: item.method, path: item.path, headers: ref(golden.headerSets, headers), contentLength,
          body: ref(golden.bodies, item.body.split(`"model":${JSON.stringify(model)}`).join('"model":"{{model}}"')) };
      });
    }
    golden.rows[row.id] = entry;
  }
  return golden;
}

function unpack(golden: Golden, id: string, caller: CallerName): Wire[] | undefined {
  const entry = golden.rows[id];
  return entry?.[caller]?.map((item) => {
    const headers: Record<string, string> = { ...golden.headerSets[item.headers] };
    if (item.contentLength !== undefined) headers["content-length"] = item.contentLength;
    const sorted = Object.fromEntries(Object.keys(headers).sort().map((name) => [name, headers[name]]));
    return { method: item.method, path: item.path, headers: sorted,
      body: golden.bodies[item.body].split('"model":"{{model}}"').join(`"model":${JSON.stringify(entry.model)}`) };
  });
}

function readGolden(): Golden {
  return JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
}
