// 素材入口对拍表：同一组输入走每个主进程入口，记下「落没落、原件是哪份、来源记成什么、回执说什么」。
// 答案一律读落盘的 .meta（和外部助手拿到的回执），不读内存里的返回值当结论。
// 设 PARITY_OUT=<文件> 时把整张表写出来：改动前后各录一份、diff，只许预期的几行变。
//
// 只换掉出网和外壳：electron 目录、素材广播、TikHub 链接解析与媒体取回、钥匙解密；浏览器页面的取回由假 session 吐字节。
// 落盘、内容寻址、复用、清洗、sidecar、视频归一化（真 ffmpeg）都是真函数。没有网络、没有真 Key。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BrowserViewRecord } from "../browser/core/browserViewTypes";
import type { WindowProjectIssuance } from "./windowProjectCapture";

const roots = vi.hoisted(() => ({ documents: "", userData: "", handlers: new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>() }));
vi.mock("electron", () => ({
  app: { getPath: (name: string) => (name === "documents" ? roots.documents : roots.userData), getAppPath: () => process.cwd() },
  BrowserWindow: { fromId: () => null },
  ipcMain: { handle: (name: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => { roots.handlers.set(name, handler); } },
  clipboard: {},
  dialog: {},
}));
// 渲染层那扇门用真的 IPC 处理函数；只换掉发送方校验（测试里没有真窗口）。
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined, assertTrustedUiSender: () => undefined }));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));
vi.mock("./assetEvents", () => ({ broadcastAssetsUpdated: vi.fn(), broadcastAssetLocalizationStarted: vi.fn(async () => {}) }));
const hardenedFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../hardenedFetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hardenedFetch")>()),
  hardenedFetch: hardenedFetchMock,
}));
vi.mock("../catalog/secrets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog/secrets")>()),
  decryptApiKeyRecord: () => "parity-key-never-sent",
}));
const PLAY_URL = "http://127.0.0.1:39018/play/7300000000000000002.mp4";
vi.mock("../connectors/tikhubConnector", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../connectors/tikhubConnector")>()),
  resolveShareVideo: vi.fn(async () => ({ platform: "douyin", playUrl: PLAY_URL, videoId: "7300000000000000002" })),
}));

roots.documents = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-parity-documents-"));
roots.userData = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-parity-user-data-"));
const cleanup: string[] = [roots.documents, roots.userData];

const { createProject } = await import("../runtime");
const { importLocalFile } = await import("./localFileImport");
const { copyProjectAsset, importRemoteAsset, moveAssetFile } = await import("./projectAssetStore");
const { importBrowserMedia } = await import("../browser/media/browserViewMedia");
const { importTikhubShareUrl } = await import("../connectors/tikhubConnectorService");
const { importProjectAsset } = await import("../capabilityCore/core");
const { dispatchAssetImport } = await import("../capabilityCore/assetImportRoute");
const { resolveFfmpegPath } = await import("../export/ffmpegRunner");
const { registerAssetsIpc } = await import("./assetsIpc");
registerAssetsIpc((() => () => undefined) as never);

const MEDIA = path.join(__dirname, "..", "providerAdapter", "__fixtures__", "certification-media");
const OLD = path.join(__dirname, "..", "..", "tests", "fixtures", "old-user-data", "assets");
// 来源 sidecar 夹具单放一个根：`assets/` 下每个目录都被参考链接矩阵当成「带临时链接的生成图」遍历。
const OLD_SOURCES = path.join(__dirname, "..", "..", "tests", "fixtures", "old-user-data", "asset-sources");
const PNG = fs.readFileSync(path.join(MEDIA, "valid.png"));
const JPG = fs.readFileSync(path.join(MEDIA, "valid.jpg"));
const MP4 = fs.readFileSync(path.join(MEDIA, "valid.mp4"));

type Stored = { id?: string; data: { relativePath: string; absolutePath: string; contentType?: string; contentHash?: string; size?: number } };
type Row = Record<string, unknown>;
const table: Record<string, Row> = {};

function newProject(name: string): { id: string; rootPath: string } {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-parity-project-"));
  cleanup.push(rootPath);
  const project = createProject({ rootPath, name, payload: {} }) as { id: string };
  return { id: project.id, rootPath };
}

/** 时间戳、日期目录、项目 id 换成占位：两次录制只比较「是什么」，不比较「什么时候」。 */
function stable(value: unknown, projectIds: string[]): unknown {
  const text = JSON.stringify(value ?? null, (_key, entry) => {
    if (typeof entry !== "string") return entry;
    let out = entry.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>").replace(/\/\d{4}-\d{2}-\d{2}\//g, "/<date>/");
    for (const [index, id] of projectIds.entries()) out = out.split(id).join(`<project-${index + 1}>`);
    return out;
  });
  return JSON.parse(text);
}

function readMeta(absolutePath: string): Row {
  return JSON.parse(fs.readFileSync(`${absolutePath}.meta`, "utf8")) as Row;
}

/** 一条落盘记录的「是什么」：落在哪、记成哪类、来源是什么。来源只看落盘 sidecar。 */
function observe(asset: Stored, projectIds: string[]): Row {
  const meta = readMeta(asset.data.absolutePath);
  return stable({
    relativePath: asset.data.relativePath,
    kind: meta.kind ?? null,
    sourceEvidence: meta.sourceEvidence ?? null,
  }, projectIds) as Row;
}

function browserRecord(pageUrl: string, bytes: Buffer, contentType: string): BrowserViewRecord {
  const fetch = vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } }));
  return { view: { webContents: { isDestroyed: () => false, getURL: () => pageUrl, session: { fetch } } } } as unknown as BrowserViewRecord;
}

function issuance(projectId: string): WindowProjectIssuance {
  return { binding: { projectId }, surfaceBinding: {}, assertCurrent: () => {} } as unknown as WindowProjectIssuance;
}

function plantFixture(fixtureDir: string, rootPath: string): void {
  const source = path.join(fixtureDir, "assets");
  fs.cpSync(source, path.join(rootPath, "assets"), { recursive: true });
}

// 进程级出网拦截：除本机回环外任何 fetch 一律抛（真函数里若漏了一处出网，在这里当场红，不会悄悄连出去）。
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const realFetch = globalThis.fetch;
function guardedFetch(input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  if ((url.protocol === "http:" || url.protocol === "https:") && !LOOPBACK.has(url.hostname)) {
    return Promise.reject(new Error(`parity network guard: blocked ${url.origin}`));
  }
  return realFetch(input, init);
}

let mkvPath = "";
beforeAll(() => {
  globalThis.fetch = guardedFetch as typeof fetch;
  // 外部助手的 MKV：由登记的认证 MP4 原样换封装得到（不重编码），导入时归一化成 MP4。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-parity-mkv-"));
  cleanup.push(dir);
  const mp4 = path.join(dir, "source.mp4");
  fs.writeFileSync(mp4, MP4);
  mkvPath = path.join(dir, "agent-clip.mkv");
  const remux = spawnSync(resolveFfmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", "-i", mp4, "-c", "copy", mkvPath]);
  expect(remux.status, String(remux.stderr)).toBe(0);
});

afterAll(() => {
  globalThis.fetch = realFetch;
  const out = String(process.env.PARITY_OUT || "").trim();
  if (out) fs.writeFileSync(out, `${JSON.stringify(Object.fromEntries(Object.keys(table).sort().map((key) => [key, table[key]])), null, 2)}\n`);
  for (const root of cleanup) fs.rmSync(root, { recursive: true, force: true });
});

const USER_SOURCE = { source: "user", usageStatus: "reference_only", capturedAt: "<ts>" };

describe("出网拦截金丝雀", () => {
  it("非回环地址的 fetch 被拦下", async () => {
    await expect(globalThis.fetch("https://example.com/canary")).rejects.toThrow(/parity network guard/);
  });
});

describe("素材入口对拍：本机导入（差异①）", () => {
  it("字节那条路（画布 / 素材库拖入）落盘记「本机导入」", async () => {
    const project = newProject("bytes");
    const asset = await importLocalFile({ projectId: project.id, bytes: PNG, fileName: "drop.png", contentType: "image/png" }) as Stored;
    const row = table["①-bytes"] = observe(asset, [project.id]);
    expect(row.kind).toBe("upload");
    expect(row.sourceEvidence).toEqual(USER_SOURCE);
  });

  it("原生路径那条路（访达复制粘贴）落盘记「本机导入」", async () => {
    const project = newProject("native");
    const source = path.join(project.rootPath, "..", `nomi-parity-native-${process.pid}.jpg`);
    fs.writeFileSync(source, JPG);
    cleanup.push(source);
    const asset = await importLocalFile({ projectId: project.id, sourcePath: source, fileName: "finder.jpg", contentType: "image/jpeg" }, { allowSourcePath: true }) as Stored;
    const row = table["①-native"] = observe(asset, [project.id]);
    expect(row.kind).toBe("upload");
    expect(row.sourceEvidence).toEqual(USER_SOURCE);
  });
});

describe("素材入口对拍：同字节复用（差异②）", () => {
  it("0.24.1 落的无来源老上传，再带来源导入同字节：复用老记录并补上来源，其余字段一个不少", async () => {
    const project = newProject("legacy");
    plantFixture(path.join(OLD_SOURCES, "v0.24.1-uploads"), project.rootPath);
    const manifest = JSON.parse(fs.readFileSync(path.join(OLD_SOURCES, "v0.24.1-uploads", "manifest.json"), "utf8")) as { assets: Array<{ how: string; relativePath: string }> };
    const legacy = manifest.assets.find((entry) => entry.how === "bytes")!;
    const legacyPath = path.join(project.rootPath, legacy.relativePath);
    const before = readMeta(legacyPath);
    const asset = await importLocalFile({ projectId: project.id, bytes: PNG, fileName: "again.png", contentType: "image/png" }) as Stored;
    const after = readMeta(asset.data.absolutePath);
    const row: Row = table["②-legacy-fill"] = { reusedLegacy: asset.data.absolutePath === legacyPath, ...observe(asset, [project.id]) };
    expect(row.reusedLegacy).toBe(true);
    const { sourceEvidence: _added, ...rest } = after;
    expect(rest).toMatchObject(before);
    expect(row.sourceEvidence).toEqual(USER_SOURCE);
  });

  it("同一份字节先后两次本机导入：同一条记录，来源（含时间）不被第二次改写", async () => {
    const project = newProject("twice");
    const first = await importLocalFile({ projectId: project.id, bytes: PNG, fileName: "one.png", contentType: "image/png" }) as Stored;
    const firstMeta = readMeta(first.data.absolutePath);
    const second = await importLocalFile({ projectId: project.id, bytes: PNG, fileName: "two.png", contentType: "image/png" }) as Stored;
    const row = table["②-same-source"] = { sameRecord: second.data.absolutePath === first.data.absolutePath, sourceUnchanged: JSON.stringify(readMeta(second.data.absolutePath).sourceEvidence ?? null) === JSON.stringify(firstMeta.sourceEvidence ?? null) };
    expect(row).toEqual({ sameRecord: true, sourceUnchanged: true });
  });
});

describe("素材入口对拍：浏览器捕获（差异③保持现状 + 有意差异ⓖ）", () => {
  it("同一页同一张图捕获两次：两条记录，都记浏览器来源、仅参考", async () => {
    const project = newProject("browser");
    const pageUrl = "https://example.com/gallery/1";
    const record = browserRecord(pageUrl, PNG, "image/png");
    const first = await importBrowserMedia(record, { url: "https://example.com/a.png", mediaType: "image" } as never, issuance(project.id)) as Stored;
    const second = await importBrowserMedia(record, { url: "https://example.com/a.png", mediaType: "image" } as never, issuance(project.id)) as Stored;
    const row = table["③-browser-twice"] = { distinctRecords: first.data.absolutePath !== second.data.absolutePath, first: observe(first, [project.id]), second: observe(second, [project.id]) };
    expect(row.distinctRecords).toBe(true);
    for (const side of [row.first, row.second] as Row[]) {
      expect(side.sourceEvidence).toEqual({ source: "browser", pageUrl, usageStatus: "reference_only", capturedAt: "<ts>" });
    }
  });
});

describe("素材入口对拍：连接器（有意差异ⓖ）与跨项目复制（有意差异ⓐ）", () => {
  it("分享链接导入：落成参考视频，来源记连接器证据，用途待核实", async () => {
    const project = newProject("connector");
    hardenedFetchMock.mockResolvedValueOnce({ bytes: MP4, contentType: "video/mp4", status: 200, finalUrl: PLAY_URL, truncated: false });
    const result = await importTikhubShareUrl({ projectId: project.id, shareUrl: "https://v.douyin.com/parity01/" }) as { asset: Stored };
    const row = table["ⓖ-connector-share"] = observe(result.asset, [project.id]);
    expect(row.kind).toBe("reference");
    expect(row.sourceEvidence).toEqual({
      source: "connector", connectorId: "tikhub", originalUrl: "https://v.douyin.com/parity01/", resolvedUrl: PLAY_URL,
      platform: "douyin", usageStatus: "rights_unknown", fetchedAt: "<ts>",
    });
  });

  it("0.24.1 连接器老素材跨项目复制：复制品落盘来源与源逐字段相同（时间不重盖）", async () => {
    const source = newProject("connector-old");
    const target = newProject("connector-target");
    plantFixture(path.join(OLD_SOURCES, "v0.24.1-connector"), source.rootPath);
    const manifest = JSON.parse(fs.readFileSync(path.join(OLD_SOURCES, "v0.24.1-connector", "manifest.json"), "utf8")) as { assets: Array<{ relativePath: string }> };
    const relativePath = manifest.assets[0].relativePath;
    const sourceMeta = readMeta(path.join(source.rootPath, relativePath));
    const copied = await copyProjectAsset({ sourceProjectId: source.id, targetProjectId: target.id, relativePath }) as Stored;
    const copiedMeta = readMeta(copied.data.absolutePath);
    table["ⓐ-copy-connector"] = { sameEvidence: JSON.stringify(copiedMeta.sourceEvidence) === JSON.stringify(sourceMeta.sourceEvidence), ...observe(copied, [source.id, target.id]) };
    expect(copiedMeta.sourceEvidence).toEqual(sourceMeta.sourceEvidence);
  });

  it("0.24.0 生成老素材跨项目复制：照旧无来源", async () => {
    const source = newProject("generated-old");
    const target = newProject("generated-target");
    plantFixture(path.join(OLD, "v0.24.0-generated"), source.rootPath);
    const manifest = JSON.parse(fs.readFileSync(path.join(OLD, "v0.24.0-generated", "manifest.json"), "utf8")) as { relativePath: string };
    const copied = await copyProjectAsset({ sourceProjectId: source.id, targetProjectId: target.id, relativePath: manifest.relativePath }) as Stored;
    const row = table["ⓐ-copy-generated"] = observe(copied, [source.id, target.id]);
    expect(row.sourceEvidence).toBeNull();
  });
});

describe("素材入口对拍：渲染层载荷自称来源（R7，已批的行为变化）", () => {
  it("渲染层载荷里自称连接器「已获授权」：来源只收主进程参数，落盘不带它", async () => {
    const project = newProject("renderer-claim");
    const handler = roots.handlers.get("nomi:assets:import-remote-url")!;
    const result = await handler({ sender: { id: 1 } }, {
      projectId: project.id, url: `data:image/png;base64,${PNG.toString("base64")}`, kind: "reference", expectedKind: "image", fileName: "claim.png",
      sourceEvidence: { source: "connector", connectorId: "tikhub", usageStatus: "cleared" },
    }) as { ok: boolean; asset: Stored };
    expect(result.ok).toBe(true);
    const asset = result.asset;
    const row = table["R7-renderer-claim"] = observe(asset, [project.id]);
    expect(row.sourceEvidence).toBeNull();
  });
});

describe("素材入口对拍：主进程调用方自称的来源也只过一道（R8 / R9）", () => {
  it("R8 浏览器族写入自称「已获授权」：落盘仍是浏览器来源、仅参考", async () => {
    const project = newProject("move-claim");
    const staged = path.join(project.rootPath, "..", `nomi-parity-move-${process.pid}.png`);
    fs.writeFileSync(staged, PNG);
    cleanup.push(staged);
    const asset = moveAssetFile(project.id, staged, "claim.png", "image/png", {
      kind: "browser-capture", originalUrl: "https://example.com/a.png",
      sourceEvidence: { source: "browser", pageUrl: "https://example.com/p", usageStatus: "cleared" } as unknown as import("./assetSourceEvidence").AssetSourceFact,
    }) as Stored;
    const row = table["R8-move-claims-cleared"] = observe(asset, [project.id]);
    expect(row.sourceEvidence).toEqual({ source: "browser", pageUrl: "https://example.com/p", usageStatus: "reference_only", capturedAt: "<ts>" });
    expect(readMeta(asset.data.absolutePath).originalUrl).toBeNull();
  });

  it("R9 同一份字节先本机导入、再由连接器带「已获授权」导入：另起一条，旧记录仍是仅参考", async () => {
    const project = newProject("reuse-other-source");
    const first = await importLocalFile({ projectId: project.id, bytes: PNG, fileName: "mine.png", contentType: "image/png" }) as Stored;
    const connector = { source: "connector" as const, connectorId: "parity-connector", originalUrl: "https://share.example/1", resolvedUrl: "", platform: "parity", usageStatus: "cleared" as const };
    const second = await importRemoteAsset(
      { projectId: project.id, url: `data:image/png;base64,${PNG.toString("base64")}`, kind: "upload", expectedKind: null, fileName: "licensed.png" },
      { sourceEvidence: connector },
    ) as Stored;
    const row = table["R9-reuse-other-source"] = {
      separateRecord: second.data.absolutePath !== first.data.absolutePath,
      first: observe(first, [project.id]),
      second: observe(second, [project.id]),
    };
    expect(row.separateRecord).toBe(true);
    expect((row.first as Row).sourceEvidence).toEqual(USER_SOURCE);
    expect((row.second as Row).sourceEvidence).toMatchObject({ source: "connector", connectorId: "parity-connector", usageStatus: "cleared" });
  });
});

describe("素材入口对拍：外部助手导入（差异④ + 有意差异ⓔⓕ）", () => {
  it("MKV 导入后归一成 MP4：回执的类型与大小取落库结果", async () => {
    const project = newProject("agent");
    const receipt = await importProjectAsset({ projectId: project.id, path: mkvPath }) as { url: string; contentType: string; sizeBytes: number; assetId: string; contentHash: string; name: string };
    const relativePath = decodeURIComponent(new URL(receipt.url).pathname).replace(/^\/[^/]+\//, "");
    const absolutePath = path.join(project.rootPath, relativePath);
    const row = table["④-agent-mkv"] = {
      receipt: stable({ contentType: receipt.contentType, sizeMatchesDisk: receipt.sizeBytes === fs.statSync(absolutePath).size, name: receipt.name }, [project.id]),
      stored: observe({ data: { relativePath, absolutePath } }, [project.id]),
    };
    expect((row.stored as Row).kind).toBe("imported");
    expect(row.receipt).toMatchObject({ contentType: "video/mp4", sizeMatchesDisk: true });
  });

  it("多余字段：外部助手路由当场拒", () => {
    expect(() => dispatchAssetImport({ projectId: "p", path: "/tmp/x.png", extra: 1 })).toThrow();
    table["ⓕ-agent-extra"] = { rejected: true };
  });

  it("本机导入拒生成产物（缺省是 upload）", async () => {
    const project = newProject("refuse");
    const error = await importLocalFile({
      projectId: project.id, bytes: PNG, fileName: "gen.png", contentType: "image/png",
      // @ts-expect-error 渲染层载荷不过类型系统；主进程里写不出 generated，这里模拟 IPC 送来的那一份
      kind: "generated",
    }).then(() => null, (reason: unknown) => reason);
    table["ⓔ-local-refuses-generated"] = { rejected: error instanceof Error };
    expect(error).toBeInstanceOf(Error);
  });
});
