// 「同步回字节」的任务：结果没有地址可交，只能落成项目文件（2026-11-07 真付费：APIMart 配音扣了钱，
// 存不进项目，报 generated_output_expected_kind_required；0.23.2 起所有配音都这样）。
//
// 这一类的全部入口 × 全部形状都在这里走真的落盘关口，不桩资产库：
//   · 形状从内置目录里枚举（applyBuiltinSeeds 的真结果）：音频、不是转写、没有查询步 = 响应本身就是结果。
//     以后新加的内置配音 / 音乐 / 音效模型自动进矩阵。再加两格内置目录之外的：中转向导接出来的配音
//     （NEWAPI_AUDIO_TTS_OP）、没有声明映射时的缺省 /v1/audio/speech；以及同一判据下的「视频结果是文件流」。
//   · 有项目：本机回环假服务按声明回真音频字节（WAV / MP3、二进制 / JSON hex / NDJSON base64），
//     落盘走 generatedAssetStaging 的真校验（ffmpeg 解码），读回文件核类型。
//   · 没项目：三个入口（tasks:run 令牌路、画布单镜 Run 路、Agent 的 try_model）都在发请求之前拒——
//     一个请求都不发、令牌不扣、不弹付费卡、try_model 不开单。
// 零花费：本机回环、合成凭据、合成项目目录。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const root = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "nomi-sync-bytes-"));
const projectRoot = path.join(root, "project");
const settingsRoot = path.join(root, "settings");
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(settingsRoot, { recursive: true });
const WAV = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.wav"));
const MP3 = fs.readFileSync(path.join(__dirname, "../../tests/ux/fixtures/real-narration.mp3"));

type Wire = { method: string; url: string; body: string };
const wire: Wire[] = [];
let base = "";
let server: http.Server;

vi.mock("electron", () => ({
  app: { getPath: () => settingsRoot, getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
  ipcMain: { on: () => undefined, handle: () => undefined, removeHandler: () => undefined },
}));
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => projectRoot,
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(projectRoot, relativePath),
}));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));
vi.mock("../assets/assetEvents", async (importOriginal) => ({ ...await importOriginal<typeof import("../assets/assetEvents")>(), broadcastAssetLocalizationStarted: vi.fn(async () => {}), broadcastAssetsUpdated: vi.fn() }));
/** 付费确认卡：被叫到就记一笔（= 用户会看到一张卡）。这里替用户按「确认」，于是钱会不会花只看令牌和请求数。 */
const cards: string[] = [];
vi.mock("../capabilityCore/rendererBridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("../capabilityCore/rendererBridge")>(),
  requestRendererDecision: vi.fn(async (op: string) => { cards.push(op); return { confirmed: true }; }),
}));
/** 目录 = 内置目录的真种子 + 内置之外的几格，所有连接都指向本机回环。 */
vi.mock("../catalog/catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/catalogStore")>(),
  readCatalog: () => structuredClone(catalog()),
}));
vi.mock("../catalog/executableModel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/executableModel")>(),
  findExecutableModel: (vendorKey: string, modelKey: string) => {
    const state = catalog();
    const vendor = state.vendors.find((row) => row.key === vendorKey);
    const model = state.models.find((row) => row.vendorKey === vendorKey && (row.modelKey === modelKey || row.modelAlias === modelKey));
    if (!vendor || !model) throw new Error(`test catalog has no ${vendorKey}/${modelKey}`);
    return { vendor, model, apiKey: keyFor(vendorKey), customConfig: {} };
  },
}));

const { applyBuiltinSeeds } = await import("../catalog/seedBuiltins");
const { CURRENT_CATALOG_VERSION, billingKindForTaskKind } = await import("../catalog/types");
const { NEWAPI_AUDIO_TTS_OP, openAiVideoMode } = await import("../catalog/newapiTransport");
const { runTask } = await import("../runtime");
const { TOKEN_ADMISSION, RUN_APPROVED_ADMISSION } = await import("./taskSpend");
const { mintSpendGrant, __resetSpendGrantsForTests, __spendGrantCountForTests } = await import("../spendGrant");
const { tryModel } = await import("../capabilityCore/modelOnboarding/tryModel");
const { writeWorkspaceManifest } = await import("../workspace/workspaceManifest");
type CatalogState = import("../catalog/types").CatalogState;
type Mapping = import("../catalog/types").Mapping;
type HttpOperation = import("../catalog/types").HttpOperation;

const NOW = "2026-11-07T00:00:00.000Z";
const DOUBAO_KEY = "synthetic-app:synthetic-access";
let cachedCatalog: CatalogState | null = null;

function keyFor(vendorKey: string): string {
  return catalog().mappings.some((row) => row.vendorKey === vendorKey && row.create?.audioResponse === "ndjson-base64") ? DOUBAO_KEY : "synthetic-key";
}

/** 内置之外的三格：中转向导接出来的配音、没有声明映射的配音、结果是文件流的中转视频。 */
const EXTRA_VENDORS = ["relay-tts", "bare-tts", "relay-video"] as const;
function catalog(): CatalogState {
  if (cachedCatalog) return cachedCatalog;
  const seeded = applyBuiltinSeeds({ version: CURRENT_CATALOG_VERSION, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, NOW).state;
  const stamp = { createdAt: NOW, updatedAt: NOW };
  const vendor = (key: string) => ({ key, name: key, enabled: true, baseUrlHint: base, authType: "bearer", authHeader: "Authorization", ...stamp });
  const video = openAiVideoMode();
  const state: CatalogState = {
    ...seeded,
    vendors: [...seeded.vendors, ...EXTRA_VENDORS.map(vendor)].map((row) => ({ ...row, enabled: true, baseUrlHint: base })) as CatalogState["vendors"],
    models: [
      ...seeded.models,
      { vendorKey: "relay-tts", modelKey: "seed-tts-2.0", labelZh: "中转配音", kind: "audio", enabled: true, ...stamp },
      { vendorKey: "bare-tts", modelKey: "tts-1", labelZh: "无映射配音", kind: "audio", enabled: true, ...stamp },
      { vendorKey: "relay-video", modelKey: "sora-2", labelZh: "中转视频", kind: "video", enabled: true, ...stamp },
    ].map((row) => ({ ...row, enabled: true })) as CatalogState["models"],
    mappings: [
      ...seeded.mappings,
      { id: "relay-tts-text_to_audio", vendorKey: "relay-tts", modelKey: "seed-tts-2.0", taskKind: "text_to_audio", name: "中转配音", enabled: true, create: NEWAPI_AUDIO_TTS_OP, ...stamp },
      { id: "relay-video-text_to_video", vendorKey: "relay-video", modelKey: "sora-2", taskKind: "text_to_video", name: "中转视频", enabled: true, create: video.create, query: video.query, result: video.result, statusMapping: video.statusMapping, ...stamp },
    ] as CatalogState["mappings"],
    apiKeysByVendor: {},
  };
  for (const row of state.vendors) state.apiKeysByVendor[row.key] = { apiKey: "synthetic-key", enabled: true } as never;
  cachedCatalog = state;
  return state;
}

/** 这一类的独立定义（不借被测的判据）：音频、不是转写、没有查询步——响应本身就是结果，没有地址可交。 */
function isSyncBytesAudio(mapping: Mapping): boolean {
  return mapping.enabled !== false && billingKindForTaskKind(mapping.taskKind) === "audio" && mapping.taskKind !== "transcribe" && !mapping.query;
}

type Cell = { name: string; vendorKey: string; modelKey: string; taskKind: string; create: HttpOperation | null };
function syncBytesCells(): Cell[] {
  const state = catalog();
  const cells: Cell[] = state.mappings.filter(isSyncBytesAudio).map((mapping) => ({
    name: `${mapping.vendorKey}/${mapping.modelKey}/${mapping.taskKind}`,
    vendorKey: mapping.vendorKey, modelKey: String(mapping.modelKey || ""), taskKind: mapping.taskKind, create: mapping.create,
  }));
  cells.push({ name: "bare-tts/tts-1（没有声明映射，走缺省 /v1/audio/speech）", vendorKey: "bare-tts", modelKey: "tts-1", taskKind: "text_to_audio", create: null });
  return cells;
}

/** 声明说上游回什么，假服务就回什么：真音频字节，按声明的编码包好。 */
function respond(create: HttpOperation | null, res: http.ServerResponse): void {
  const declared = create?.audioResponse;
  if (declared === "ndjson-base64") {
    res.writeHead(200, { "Content-Type": "application/json" });
    const half = Math.floor(MP3.byteLength / 2);
    res.end([MP3.subarray(0, half), MP3.subarray(half)].map((chunk) => JSON.stringify({ code: 0, data: chunk.toString("base64") })).concat(JSON.stringify({ code: 20000000, message: "ok" })).join("\n"));
    return;
  }
  if (declared && typeof declared === "object" && declared.type === "json") {
    const bytes = declared.contentType.includes("wav") ? WAV : MP3;
    const encoded = bytes.toString(declared.encoding === "hex" ? "hex" : "base64");
    const body: Record<string, unknown> = {};
    const keys = declared.dataPath.split(".");
    let cursor = body;
    keys.slice(0, -1).forEach((key) => { cursor[key] = {}; cursor = cursor[key] as Record<string, unknown>; });
    cursor[keys[keys.length - 1]] = encoded;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ...body, base_resp: { status_code: 0, status_msg: "success" } }));
    return;
  }
  const contentType = declared && typeof declared === "object" ? declared.contentType : "audio/mpeg";
  res.writeHead(200, { "Content-Type": contentType });
  res.end(contentType.includes("wav") ? WAV : MP3);
}

let responder: (res: http.ServerResponse) => void = (res) => { res.writeHead(500); res.end(); };

beforeAll(async () => {
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {} });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      wire.push({ method: String(req.method), url: String(req.url), body: Buffer.concat(chunks).toString("utf8") });
      responder(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cachedCatalog = null;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  wire.length = 0;
  cards.length = 0;
  __resetSpendGrantsForTests();
});

function payload(cell: Pick<Cell, "vendorKey" | "modelKey" | "taskKind">, extras: Record<string, unknown>) {
  return { vendor: cell.vendorKey, request: { kind: cell.taskKind, prompt: "海风轻拂，旁白开始。", extras: { modelKey: cell.modelKey, nodeId: "node-1", ...extras } } };
}
const posts = () => wire.filter((row) => row.method === "POST").length;
const publishedAudio = () => {
  const dir = path.join(projectRoot, "assets");
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((name) => /\.(wav|mp3|mpeg|m4a|ogg|aac|flac)$/i.test(name)) : [];
};

describe("内置目录里的同步回字节任务确实被枚举到（矩阵不是空的）", () => {
  it("至少覆盖二进制 WAV、二进制 MP3、JSON hex、NDJSON base64 四种形状", () => {
    const shapes = new Set(syncBytesCells().map((cell) => {
      const declared = cell.create?.audioResponse;
      if (!declared) return "undeclared";
      if (declared === "ndjson-base64") return "ndjson-base64";
      if (typeof declared === "object" && declared.type === "json") return `json-${declared.encoding}`;
      return `binary-${(declared as { contentType: string }).contentType}`;
    }));
    expect([...shapes].sort()).toEqual(expect.arrayContaining(["binary-audio/mpeg", "binary-audio/wav", "json-hex", "ndjson-base64", "undeclared"]));
  });
});

describe.each(syncBytesCells())("有项目：$name 的结果落进项目", (cell) => {
  it("一次请求，结果是项目里能读回的音频文件", async () => {
    responder = (res) => respond(cell.create, res);
    const before = new Set(publishedAudio());
    const result = await runTask(payload(cell, { projectId: "project-1" }), RUN_APPROVED_ADMISSION);
    expect(posts()).toBe(1);
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].type).toBe("audio");
    expect(result.assets[0].url).toMatch(/^nomi-local:\/\//);
    const landed = publishedAudio().filter((name) => !before.has(name));
    expect(landed).toHaveLength(1);
    const meta = JSON.parse(fs.readFileSync(path.join(projectRoot, "assets", `${landed[0]}.meta`), "utf8")) as { kind?: string };
    expect(meta.kind).toBe("generated");
  });
});

/** 没项目时：同一判据下的视频「结果是文件流」也在这里（它在 2026-10 就有专门的一句英文拒绝，现在和配音共用一处）。 */
function noProjectCells(): Cell[] {
  const video = catalog().mappings.find((row) => row.vendorKey === "relay-video")!;
  return [...syncBytesCells(), { name: "relay-video/sora-2（结果是文件流的视频）", vendorKey: "relay-video", modelKey: "sora-2", taskKind: "text_to_video", create: video.create }];
}

describe.each(noProjectCells())("没项目：$name 一个请求都不发、一分钱不扣", (cell) => {
  it("tasks:run（令牌路）：发请求前拒，令牌原样留着，不弹付费卡", async () => {
    responder = (res) => respond(cell.create, res);
    const grantId = mintSpendGrant({ nodeIds: ["node-1"], maxAttemptsPerNode: 1 });
    const error = await runTask(payload(cell, { grantId }), TOKEN_ADMISSION).then(() => null, (caught: Error) => caught);
    expect(error, "must refuse").toBeInstanceOf(Error);
    expect(error!.message).toMatch(/项目|project/i);
    expect(posts()).toBe(0);
    expect(__spendGrantCountForTests(), "the spend token was not consumed").toBe(1);
    expect(cards).toEqual([]);
  });

  it("画布单镜（Run 已批准）：发请求前拒", async () => {
    responder = (res) => respond(cell.create, res);
    await expect(runTask(payload(cell, {}), RUN_APPROVED_ADMISSION)).rejects.toThrow(/项目|project/i);
    expect(posts()).toBe(0);
  });

  it("Agent 的 try_model：回 needs_input，不开单、不铸令牌、不弹卡、不发请求", async () => {
    responder = (res) => respond(cell.create, res);
    const intents = path.join(settingsRoot, "app-executions");
    const filesBefore = fs.existsSync(intents) ? fs.readdirSync(intents, { recursive: true }).length : 0;
    const result = await tryModel({ runTask: (input) => runTask(input) }, { vendorKey: cell.vendorKey, modelKey: cell.modelKey, taskKind: cell.taskKind });
    expect(result.ok).toBe(false);
    // try_model 只试「声明了映射」的模式；没有映射的那格它本来就在更早一步回 not_found——同样一个请求都不发。
    expect((result as { code?: string }).code).toBe(cell.create ? "needs_input" : "not_found");
    if (cell.create) expect((result as { message?: string }).message).toMatch(/project/i);
    expect(posts()).toBe(0);
    expect(__spendGrantCountForTests()).toBe(0);
    expect(cards).toEqual([]);
    expect(fs.existsSync(intents) ? fs.readdirSync(intents, { recursive: true }).length : 0, "no trial order was opened").toBe(filesBefore);
  });
});
