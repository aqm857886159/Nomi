// 「同步回字节」的任务：结果没有地址可交，只能落成项目文件（2026-11-07 真付费：APIMart 配音扣了钱，
// 存不进项目，报 generated_output_expected_kind_required；0.23.2 起所有配音都这样）。
//
// 这一类的全部入口 × 全部形状都在这里走真的落盘关口，不桩资产库：
//   · 形状从内置目录里枚举（applyBuiltinSeeds 的真结果）：音频、不是转写、没有查询步 = 响应本身就是结果。
//     以后新加的内置配音 / 音乐 / 音效模型自动进矩阵。再加两格内置目录之外的：中转向导接出来的配音
//     （NEWAPI_AUDIO_TTS_OP）、没有声明映射时的缺省 /v1/audio/speech；以及同一判据下的「视频结果是文件流」。
//   · 有项目：本机回环假服务按声明回真音频字节（WAV / MP3、二进制 / JSON hex / NDJSON base64），
//     落盘走 generatedAssetStaging 的真校验（ffmpeg 解码），读回文件核类型。
//   · 没项目：三个入口（tasks:run 令牌路、画布单镜 Run 路、Agent 的 try_model）都在发生成请求之前拒——
//     零生成请求、令牌不扣、不弹付费卡、try_model 不开单；待复验凭据仅允许一次 GET 模型列表。
//   · 同一类的另两处入口（2026-11-09，计划表 A4d）：自定义调用脚本用 saveFile 存字节、进程类（即梦 CLI、
//     Codex 本机生图、Antigravity）的本地文件。有项目 → 走同一道生成产物关口、期望类型 = 任务种类；
//     没项目 → 和上面一样在付费前拒。进程声明从内置目录枚举；「请求数」把本机进程也算进去。
// 零花费：本机回环、合成凭据、合成项目目录；即梦 CLI 换成合成输出，Codex / Antigravity 从不真起进程。
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
const MP4 = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.mp4"));
const PNG = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.png"));
const processOutput = path.join(root, "process-download.mp4");
fs.writeFileSync(processOutput, MP4);

type Wire = { method: string; url: string; body: string };
const wire: Wire[] = [];
let base = "";
let server: http.Server;

vi.mock("electron", () => ({
  app: { getPath: () => settingsRoot, getAppPath: () => process.cwd(), isPackaged: false },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
  BrowserWindow: { getAllWindows: () => [] },
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
/**
 * 本机进程：每起一次（= 跑一次 CLI / 本机生图，会员积分或额度可能就扣了）记一笔，和 HTTP 请求一起算进「请求数」。
 * 即梦交给真的执行器，CLI 本身换成合成输出（结果是一个本地下载的真 MP4）；Codex / Antigravity 永远不真起进程。
 */
const processRuns: string[] = [];
vi.mock("../catalog/dreaminaCli", () => ({
  resolveDreaminaBin: () => "/synthetic/dreamina",
  runDreaminaCli: async () => ({ code: 0, stderr: "", stdout: JSON.stringify({ submit_id: "process-1", gen_status: "success", results: [{ file_path: processOutput }] }) }),
}));
vi.mock("../catalog/processOperation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../catalog/processOperation")>();
  return {
    ...actual,
    prepareAntigravityCreateOperation: async () => undefined,
    executeProcessOperation: async (input: import("../catalog/processOperation").ProcessOperationInput) => {
      processRuns.push(input.process.parser);
      if (input.process.parser !== "dreamina-cli") throw new Error("synthetic: this test never starts a real local process");
      return actual.executeProcessOperation(input);
    },
  };
});
/** 目录 = 内置目录的真种子 + 内置之外的几格，所有连接都指向本机回环。 */
vi.mock("../catalog/catalogStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/catalogStore")>(),
  readCatalog: () => structuredClone(catalog()),
  mutateCatalog: (fn: Parameters<typeof import("../catalog/catalogStore").mutateCatalog>[0]) => fn({} as never, catalog()),
}));
vi.mock("../catalog/secrets", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/secrets")>(),
  decryptStoredApiKeyRecord: () => "synthetic-key",
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
const { resultOnlyLandsAsProjectFile } = await import("./projectFileResult");
const { DREAMINA_CURATED_MAPPINGS } = await import("../catalog/dreaminaVideos");
const { antigravityImageMappings } = await import("../catalog/antigravityCatalog");
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

/**
 * 内置之外的几格：中转向导接出来的配音、没有声明映射的配音、结果是文件流的中转视频；
 * Agent 接出来的脚本模型（存字节的配音 / 视频、只回地址的视频）；一条走即梦 CLI 解析器的进程声明。
 */
const EXTRA_VENDORS = ["relay-tts", "bare-tts", "relay-video", "script-relay", "process-video", "antigravity-cli"] as const;
/** Antigravity 不在内置种子里：连上、自检过之后由 syncAntigravityCatalog 投影进目录（生图、改图两条映射）。这里照同一个投影函数放进来。 */
const ANTIGRAVITY_READY = { state: "ready" as const, version: "1.1.21", checkedAt: Date.parse(NOW), loginCommand: "agy", models: [],
  checks: (["image", "edit"] as const).map((capability) => ({ capability, modelId: "auto", state: "passed" as const, version: "1.1.21", checkedAt: Date.parse(NOW) })) };
/** Agent 按 customCallContract 写的脚本：上游只回字节就 saveFile，回地址就直接 return。 */
const SAVE_AUDIO_SCRIPT = "const r = await http.post('/script-bytes', { prompt }); return await saveFile(r.bytes, 'mp3', 'audio/mpeg');";
const SAVE_VIDEO_SCRIPT = "const r = await http.post('/script-bytes', { prompt }); return await saveFile(r.bytes, 'mp4', 'video/mp4');";
const URL_VIDEO_SCRIPT = "const r = await http.post('/script-url', { prompt }); return r.url;";
/** 脚本模型的映射只是声明卡写下的（脚本接管传输）：配音这条看起来像同步配音，视频这两条是普通的地址式提交。 */
const SCRIPT_DECLARED_OP = { method: "POST", path: "/declared-by-card" } as HttpOperation;
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
      { vendorKey: "script-relay", modelKey: "script-tts", labelZh: "脚本配音", kind: "audio", enabled: true, customCall: { script: SAVE_AUDIO_SCRIPT, updatedAt: NOW }, ...stamp },
      { vendorKey: "script-relay", modelKey: "script-video", labelZh: "脚本视频", kind: "video", enabled: true, customCall: { script: SAVE_VIDEO_SCRIPT, updatedAt: NOW }, ...stamp },
      { vendorKey: "script-relay", modelKey: "script-video-url", labelZh: "脚本视频（回地址）", kind: "video", enabled: true, customCall: { script: URL_VIDEO_SCRIPT, updatedAt: NOW }, ...stamp },
      { vendorKey: "process-video", modelKey: "process-video", labelZh: "进程视频", kind: "video", enabled: true, ...stamp },
      { vendorKey: "antigravity-cli", modelKey: "generate_image", labelZh: "Antigravity image", kind: "image", enabled: true, ...stamp },
    ].map((row) => ({ ...row, enabled: true })) as CatalogState["models"],
    mappings: [
      ...seeded.mappings,
      { id: "relay-tts-text_to_audio", vendorKey: "relay-tts", modelKey: "seed-tts-2.0", taskKind: "text_to_audio", name: "中转配音", enabled: true, create: NEWAPI_AUDIO_TTS_OP, ...stamp },
      { id: "relay-video-text_to_video", vendorKey: "relay-video", modelKey: "sora-2", taskKind: "text_to_video", name: "中转视频", enabled: true, create: video.create, query: video.query, result: video.result, statusMapping: video.statusMapping, ...stamp },
      { id: "script-tts-text_to_audio", vendorKey: "script-relay", modelKey: "script-tts", taskKind: "text_to_audio", name: "脚本配音", enabled: true, create: SCRIPT_DECLARED_OP, ...stamp },
      { id: "script-video-text_to_video", vendorKey: "script-relay", modelKey: "script-video", taskKind: "text_to_video", name: "脚本视频", enabled: true, create: SCRIPT_DECLARED_OP, ...stamp },
      { id: "script-video-url-text_to_video", vendorKey: "script-relay", modelKey: "script-video-url", taskKind: "text_to_video", name: "脚本视频（回地址）", enabled: true, create: SCRIPT_DECLARED_OP, ...stamp },
      { id: "process-video-text_to_video", vendorKey: "process-video", modelKey: "process-video", taskKind: "text_to_video", name: "进程视频", enabled: true, ...stamp,
        create: { ...DREAMINA_CURATED_MAPPINGS[0].create, process: { bin: "dreamina", parser: "dreamina-cli", args: ["text2video", "--prompt={{request.prompt}}"] } },
        statusMapping: DREAMINA_CURATED_MAPPINGS[0].statusMapping },
      ...antigravityImageMappings(ANTIGRAVITY_READY),
    ].map((row) => (declaresLocalProcess(row as Mapping) ? { ...row, enabled: true } : row)) as CatalogState["mappings"],
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

/** 这一类的独立定义：映射声明了本机进程（提交或查询任何一步）。 */
function declaresLocalProcess(mapping: Mapping): boolean {
  return Boolean(mapping.create?.process || mapping.query?.process);
}

type Cell = { name: string; vendorKey: string; modelKey: string; taskKind: string; create: HttpOperation | null };
function syncBytesCells(): Cell[] {
  const state = catalog();
  // 脚本模型的映射只是声明，传输归脚本，单独成格（scriptSaveCells）。
  const scripted = (mapping: Mapping) => state.models.some((model) => model.vendorKey === mapping.vendorKey && model.modelKey === mapping.modelKey && model.customCall);
  const cells: Cell[] = state.mappings.filter((mapping) => isSyncBytesAudio(mapping) && !scripted(mapping)).map((mapping) => ({
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
      if (req.method === "GET" && req.url === "/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "synthetic-model" }] }));
        return;
      }
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
  processRuns.length = 0;
  cards.length = 0;
  __resetSpendGrantsForTests();
  cachedCatalog = null;
});

function payload(cell: Pick<Cell, "vendorKey" | "modelKey" | "taskKind">, extras: Record<string, unknown>) {
  return { vendor: cell.vendorKey, request: { kind: cell.taskKind, prompt: "海风轻拂，旁白开始。", extras: { modelKey: cell.modelKey, nodeId: "node-1", ...extras } } };
}
/** 有项目用例的生成次数（POST + 本机进程）；无项目断言另数全部 HTTP 方法。 */
const posts = () => wire.filter((row) => row.method === "POST").length + processRuns.length;
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

type ScriptCell = Cell & { bytes: Buffer; assetType: "audio" | "video" };
/** 脚本用 saveFile 存字节的两格：配音（映射看起来也像同步配音）、视频（映射是普通的地址式提交，只有脚本说明它存文件）。 */
function scriptSaveCells(): ScriptCell[] {
  return [
    { name: "script-relay/script-tts（脚本 saveFile 存配音）", vendorKey: "script-relay", modelKey: "script-tts", taskKind: "text_to_audio", create: SCRIPT_DECLARED_OP, bytes: MP3, assetType: "audio" },
    { name: "script-relay/script-video（脚本 saveFile 存视频）", vendorKey: "script-relay", modelKey: "script-video", taskKind: "text_to_video", create: SCRIPT_DECLARED_OP, bytes: MP4, assetType: "video" },
  ];
}
/** 目录里每一条进程声明（内置的即梦、Codex，连上后投影进来的 Antigravity），外加一条合成的即梦解析器声明。 */
function processCells(): Cell[] {
  return catalog().mappings.filter(declaresLocalProcess).map((mapping) => ({
    name: `${mapping.vendorKey}/${mapping.modelKey}/${mapping.taskKind}（本机进程 ${mapping.create?.process?.parser || mapping.query?.process?.parser}）`,
    vendorKey: mapping.vendorKey, modelKey: String(mapping.modelKey || ""), taskKind: mapping.taskKind, create: mapping.create,
  }));
}
const jsonResponder = (body: unknown) => (res: http.ServerResponse) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const bytesResponder = (bytes: Buffer) => jsonResponder({ bytes: [...bytes] });
const publishedMedia = () => {
  const dir = path.join(projectRoot, "assets");
  // 落盘边界顺手派生的画布预览（视频 poster、图片缩略，*.preview.*）不是这次的产物本身，不算。
  return fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String)
    .filter((name) => /\.(wav|mp3|mpeg|m4a|ogg|aac|flac|mp4|mov|webm|png|jpe?g|webp)$/i.test(name) && !/\.preview\.[a-z]+$/i.test(name)) : [];
};
const sidecarKind = (name: string) => (JSON.parse(fs.readFileSync(path.join(projectRoot, "assets", `${name}.meta`), "utf8")) as { kind?: string }).kind;

describe("内置目录里的进程声明确实被枚举到（矩阵不是空的）", () => {
  it("即梦 CLI、Codex 本机生图、Antigravity 三种解析器都在", () => {
    const parsers = new Set(processCells().map((cell) => cell.create?.process?.parser));
    expect([...parsers]).toEqual(expect.arrayContaining(["dreamina-cli", "codex-cli-image", "antigravity-cli-image"]));
  });
});

describe.each(scriptSaveCells())("有项目：$name 的字节走生成产物关口落进项目", (cell) => {
  it("一次请求，结果是项目里能读回的生成产物，类型 = 任务种类", async () => {
    responder = bytesResponder(cell.bytes);
    const before = new Set(publishedMedia());
    const result = await runTask(payload(cell, { projectId: "project-1" }), RUN_APPROVED_ADMISSION);
    expect(posts()).toBe(1);
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({ type: cell.assetType, url: expect.stringMatching(/^nomi-local:\/\//) });
    const landed = publishedMedia().filter((name) => !before.has(name));
    expect(landed).toHaveLength(1);
    expect(fs.readFileSync(path.join(projectRoot, "assets", landed[0]))).toEqual(cell.bytes);
    expect(sidecarKind(landed[0])).toBe("generated");
  });
});

describe("脚本 saveFile 只信任务种类，不信脚本给的后缀", () => {
  it("视频任务里脚本把图片字节存成 .mp4：关口拒，项目里不多文件", async () => {
    responder = bytesResponder(PNG);
    const before = publishedMedia();
    const video = scriptSaveCells().find((cell) => cell.assetType === "video")!;
    // 换一句提示词：同模型同参数的上一格结果在任务缓存里，不换就直接命中缓存、根本不跑脚本。
    const base = payload(video, { projectId: "project-1", nodeId: "wrong-kind" });
    // 拒的是落盘关口的「类型不符」（tasks.outputKindMismatch），不是别的什么错。
    await expect(runTask({ ...base, request: { ...base.request, prompt: "上游回错了类型的字节。" } }, RUN_APPROVED_ADMISSION))
      .rejects.toThrow(/这笔任务要的是|but this task asked for/);
    expect(posts()).toBe(1);
    expect(publishedMedia()).toEqual(before);
  });

  it("没项目、脚本只回地址：照常跑，不因为是脚本就多拒", async () => {
    responder = jsonResponder({ url: "https://cdn.example.com/script-result.mp4" });
    const result = await runTask(payload({ vendorKey: "script-relay", modelKey: "script-video-url", taskKind: "text_to_video" }, {}), RUN_APPROVED_ADMISSION);
    expect(posts()).toBe(1);
    expect(result.status).toBe("succeeded");
    expect(result.assets.map((asset) => asset.url)).toEqual(["https://cdn.example.com/script-result.mp4"]);
  });
});

describe("有项目：进程本地下载的文件走生成产物关口落进项目", () => {
  it("起一次进程，本地下载的视频成为项目里的生成产物", async () => {
    const before = new Set(publishedMedia());
    const result = await runTask(payload({ vendorKey: "process-video", modelKey: "process-video", taskKind: "text_to_video" }, { projectId: "project-1" }), RUN_APPROVED_ADMISSION);
    expect(processRuns).toEqual(["dreamina-cli"]);
    expect(result.status).toBe("succeeded");
    expect(result.assets[0]).toMatchObject({ type: "video", url: expect.stringMatching(/^nomi-local:\/\//) });
    const landed = publishedMedia().filter((name) => !before.has(name));
    expect(landed).toHaveLength(1);
    expect(fs.readFileSync(path.join(projectRoot, "assets", landed[0]))).toEqual(MP4);
    expect(sidecarKind(landed[0])).toBe("generated");
  });
});

describe("判据本身：走脚本只看脚本存不存文件，声明了进程就只能写进项目", () => {
  const declared = { create: SCRIPT_DECLARED_OP } as Mapping;
  it("脚本用 saveFile：映射看起来是地址式也算", () => {
    expect(resultOnlyLandsAsProjectFile("text_to_video", declared, SAVE_VIDEO_SCRIPT)).toBe(true);
    expect(resultOnlyLandsAsProjectFile("text_to_video", declared, undefined)).toBe(false);
  });
  it("脚本不用 saveFile：映射看起来像同步配音也不算（脚本接管了传输，交回的是地址）", () => {
    expect(resultOnlyLandsAsProjectFile("text_to_audio", declared, URL_VIDEO_SCRIPT)).toBe(false);
    expect(resultOnlyLandsAsProjectFile("text_to_audio", declared, undefined)).toBe(true);
  });
  it.each(["dreamina-cli", "codex-cli-image", "antigravity-cli-image"] as const)("声明了 %s 进程：提交或查询任何一步都算", (parser) => {
    const process = { bin: "synthetic", parser, args: [] };
    expect(resultOnlyLandsAsProjectFile("text_to_image", { create: { method: "PROCESS", path: "p", process } } as unknown as Mapping, undefined)).toBe(true);
    expect(resultOnlyLandsAsProjectFile("text_to_image", { create: { method: "POST", path: "p" }, query: { method: "PROCESS", path: "q", process } } as unknown as Mapping, undefined)).toBe(true);
  });
  it("转写、普通地址结果、有查询步的音频不扩大拒绝", () => {
    expect(resultOnlyLandsAsProjectFile("transcribe", null, undefined)).toBe(false);
    expect(resultOnlyLandsAsProjectFile("text_to_image", null, undefined)).toBe(false);
    expect(resultOnlyLandsAsProjectFile("text_to_audio", { query: {} } as Mapping, undefined)).toBe(false);
  });
});

/** 没项目时：同一判据下的视频「结果是文件流」也在这里（它在 2026-10 就有专门的一句英文拒绝，现在和配音共用一处）。 */
function noProjectCells(): Cell[] {
  const video = catalog().mappings.find((row) => row.vendorKey === "relay-video")!;
  return [...syncBytesCells(), { name: "relay-video/sora-2（结果是文件流的视频）", vendorKey: "relay-video", modelKey: "sora-2", taskKind: "text_to_video", create: video.create },
    ...scriptSaveCells(), ...processCells()];
}
/** 上游照常回真字节（脚本格回 saveFile 要的那种），所以拒绝只能来自「没项目就不发」，不能来自上游回了坏东西。 */
/** 改图 / 图生视频这几格带上参考图：不带的话会先被「缺参考图」拦下，0 请求就证明不了「没项目不发」。 */
const NEEDS_REFERENCE = new Set(["image_edit", "image_to_video"]);
const noProjectPayload = (cell: Cell, extras: Record<string, unknown>) =>
  payload(cell, NEEDS_REFERENCE.has(cell.taskKind) ? { referenceImages: ["https://cdn.example.com/reference.png"], ...extras } : extras);
const noProjectResponder = (cell: Cell | ScriptCell) => ("bytes" in cell ? bytesResponder(cell.bytes) : (res: http.ServerResponse) => respond(cell.create, res));

describe.each([
  ...noProjectCells().map((cell) => ({ ...cell, pending: false })),
  ...[...scriptSaveCells(), ...processCells()].map((cell) => ({ ...cell, pending: true })),
])("没项目（凭据待复验=$pending）：$name 零生成请求 / 进程、一分钱不扣", (cell) => {
  beforeEach(() => {
    if (cell.pending) catalog().apiKeysByVendor[cell.vendorKey].verificationPending = true;
  });

  function expectNoGeneration(tryModelEntry = false) {
    // 只豁免模型列表的 GET；生成 GET、其他 HTTP 方法和重试都不能混进来。
    expect(wire.filter((row) => !(cell.pending && row.method === "GET" && row.url === "/models"))).toEqual([]);
    expect(wire.length).toBeLessThanOrEqual(cell.pending && !tryModelEntry ? 1 : 0);
    if (cell.pending && !tryModelEntry && cell.vendorKey === "script-relay") expect(wire).toHaveLength(1);
    expect(processRuns).toEqual([]);
    expect(cards).toEqual([]);
  }

  it("tasks:run（令牌路）：发生成请求前拒，令牌原样留着，不弹付费卡", async () => {
    responder = noProjectResponder(cell);
    const grantId = mintSpendGrant({ nodeIds: ["node-1"], maxAttemptsPerNode: 1 });
    const error = await runTask(noProjectPayload(cell, { grantId }), TOKEN_ADMISSION).then(() => null, (caught: Error) => caught);
    expect(error, "must refuse").toBeInstanceOf(Error);
    expect(error!.message).toMatch(/项目|project/i);
    expectNoGeneration();
    expect(__spendGrantCountForTests(), "the spend token was not consumed").toBe(1);
    expect(cards).toEqual([]);
  });

  it("画布单镜（Run 已批准）：发生成请求前拒", async () => {
    responder = noProjectResponder(cell);
    await expect(runTask(noProjectPayload(cell, {}), RUN_APPROVED_ADMISSION)).rejects.toThrow(/项目|project/i);
    expectNoGeneration();
    expect(__spendGrantCountForTests()).toBe(0);
  });

  it("Agent 的 try_model：回 needs_input，不开单、不铸令牌、不弹卡、不发请求", async () => {
    responder = noProjectResponder(cell);
    const intents = path.join(settingsRoot, "app-executions");
    const filesBefore = fs.existsSync(intents) ? fs.readdirSync(intents, { recursive: true }).length : 0;
    const result = await tryModel({ runTask: (input) => runTask(input) }, { vendorKey: cell.vendorKey, modelKey: cell.modelKey, taskKind: cell.taskKind });
    expect(result.ok).toBe(false);
    // try_model 只试「声明了映射」的模式；没有映射的那格它本来就在更早一步回 not_found——同样一个请求都不发。
    expect((result as { code?: string }).code).toBe(cell.create ? "needs_input" : "not_found");
    if (cell.create) expect((result as { message?: string }).message).toMatch(/project/i);
    expectNoGeneration(true);
    expect(__spendGrantCountForTests()).toBe(0);
    expect(cards).toEqual([]);
    expect(fs.existsSync(intents) ? fs.readdirSync(intents, { recursive: true }).length : 0, "no trial order was opened").toBe(filesBefore);
  });
});
