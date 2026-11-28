// 一个任务里，本地参考素材只在「提交」那一步换成供应商可达地址一次；之后的「查任务」「取结果」
// 一张都不再上传（2026-10-22 #1279 真付费样本：APIMart Seedance 2.0 fast 首尾帧两张图各上传 26 次 =
// 1 次创建 + 25 次轮询，每次查任务前都把两张图重传一遍）。
//
// 真 runTask + 真 fetchTaskResult + 本机回环假上游（上传 / 创建 / 查任务 / 成片下载都是真 HTTP），
// 零花费：合成凭据、模拟受理。只替换读盘器（给内存里的 PNG 字节）——被测的是上传次数，不是读盘。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const projectRoot = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "nomi-poll-reupload-"));
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media", name));
const PNG = fixture("valid.png");
const MP4 = fixture("valid.mp4");
const FIRST = "nomi-local://asset/project-1/assets/first.png";
const LAST = "nomi-local://asset/project-1/assets/last.png";
const POLLS_BEFORE_DONE = 5;

type Wire = { method: string; url: string; body?: string; uploadName?: string };
const wire: Wire[] = [];
const localFiles = new Map<string, Buffer>();
let base = "";
let server: http.Server;
let pollCount = 0;
let uploadSeq = 0;
/** 用例可以换掉查询步（模拟用户自配映射）；缺省是 APIMart 真查询步。 */
let queryOverride: import("../catalog/types").HttpOperation | null = null;

vi.mock("electron", () => ({
  app: { getPath: () => projectRoot, getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));
vi.mock("../projects/repository", async (importOriginal) => ({
  ...await importOriginal<typeof import("../projects/repository")>(),
  projectDirById: () => projectRoot,
  resolveProjectRelativePath: (_projectId: string, relativePath: string) => path.join(projectRoot, relativePath),
}));
vi.mock("../review/reviewTrace", () => ({ scheduleTechnicalReview: vi.fn() }));
vi.mock("../assets/assetEvents", async (importOriginal) => ({ ...await importOriginal<typeof import("../assets/assetEvents")>(), broadcastAssetLocalizationStarted: vi.fn(async () => {}), broadcastAssetsUpdated: vi.fn() }));
vi.mock("../assets/localAssetFile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../assets/localAssetFile")>();
  return {
    ...actual,
    readNomiLocalAsset: (url: string) => {
      const bytes = localFiles.get(url);
      return bytes ? { bytes, contentType: "image/png", fileName: path.posix.basename(url) } : null;
    },
  };
});
vi.mock("../catalog/executableModel", async (importOriginal) => ({
  ...await importOriginal<typeof import("../catalog/executableModel")>(),
  findExecutableModel: () => ({ vendor: vendor(), model: model(), apiKey: "synthetic-key", customConfig: {} }),
}));
vi.mock("../catalog/catalogStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../catalog/catalogStore")>();
  return {
    ...actual,
    readCatalog: () => ({ ...actual.readCatalog(), vendors: [vendor()], models: [model()], mappings: [seedanceMapping()], apiKeysByVendor: {} }),
  };
});

const { runTask } = await import("../runtime");
const { fetchTaskResult } = await import("./taskResultQuery");
const { writeWorkspaceManifest } = await import("../workspace/workspaceManifest");
const { APIMART_VIDEO_MODELS } = await import("../catalog/apimartVideos");
const { APIMART_STATUS_MAPPING, APIMART_VIDEO_QUERY_OP } = await import("../catalog/apimartVendor");
type Mapping = import("../catalog/types").Mapping;
type Model = import("../catalog/types").Model;
type Vendor = import("../catalog/types").Vendor;
type TaskAdmission = import("./taskSpend").TaskAdmission;

const FREE_ADMISSION = { spendGate: async () => {} } as unknown as TaskAdmission;

function vendor(): Vendor {
  return {
    key: "apimart-loopback", name: "APIMart", enabled: true, baseUrlHint: base, authType: "bearer", authHeader: "Authorization",
    assetIngestion: { strategy: "upload-multipart", endpoint: `${base}/v1/uploads/images`, fileField: "file", urlPath: "url", authType: "bearer", accepts: ["image"], visibility: "public-provider", ttlSeconds: 72 * 3600 },
    createdAt: "now", updatedAt: "now",
  } as Vendor;
}
function model(): Model {
  return { modelKey: "doubao-seedance-2.0", vendorKey: "apimart-loopback", labelZh: "Seedance 2.0", kind: "video", enabled: true, meta: { archetypeId: "seedance-2-apimart" }, createdAt: "now", updatedAt: "now" } as Model;
}
function seedanceMapping(): Mapping {
  const seedance = APIMART_VIDEO_MODELS.find((m) => m.modelKey === "doubao-seedance-2.0")!;
  const i2v = seedance.mappings.find((m) => m.taskKind === "image_to_video")!;
  return { ...i2v, vendorKey: "apimart-loopback", modelKey: seedance.modelKey, enabled: true, query: queryOverride ?? APIMART_VIDEO_QUERY_OP, statusMapping: APIMART_STATUS_MAPPING, createdAt: "now", updatedAt: "now" } as Mapping;
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const url = req.url || "";
    const json = (payload: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(payload)); };
    if (req.method === "POST" && url === "/v1/uploads/images") {
      const uploadName = /filename="([^"]+)"/.exec(body.toString("latin1"))?.[1] || "unknown";
      wire.push({ method: "POST", url, uploadName });
      uploadSeq += 1;
      return json({ url: `${base}/hosted/${uploadSeq}-${uploadName}`, filename: uploadName });
    }
    if (req.method === "POST" && url === "/v1/videos/generations") {
      wire.push({ method: "POST", url, body: body.toString("utf8") });
      return json({ code: 200, data: [{ status: "submitted", task_id: "task_loop" }] });
    }
    if (req.method === "GET" && url === "/v1/tasks/task_loop") {
      wire.push({ method: "GET", url });
      pollCount += 1;
      const done = pollCount > POLLS_BEFORE_DONE;
      return json({ code: 200, data: { id: "task_loop", status: done ? "completed" : "processing", ...(done ? { result: { videos: [{ url: [`${base}/files/out.mp4`] }] } } : {}) } });
    }
    if (req.method === "GET" && url === "/files/out.mp4") {
      wire.push({ method: "GET", url });
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(MP4.length) });
      return res.end(MP4);
    }
    wire.push({ method: req.method || "", url });
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  wire.length = 0;
  pollCount = 0;
  uploadSeq = 0;
  queryOverride = null;
  localFiles.clear();
  localFiles.set(FIRST, PNG);
  localFiles.set(LAST, PNG);
  fs.rmSync(path.join(projectRoot, "assets"), { recursive: true, force: true });
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {} });
});
afterAll(() => {
  server?.close();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

let runSeq = 0;
function firstLastFrameRequest(first: string, last: string) {
  runSeq += 1; // 每条用例一个新配方：同配方会命中指纹缓存，直接拿上一条的成片、不再提交
  return {
    vendor: "apimart-loopback",
    request: {
      kind: "image_to_video" as const,
      prompt: `一只橘猫从书桌上跳下 #${runSeq}`,
      extras: {
        modelKey: "doubao-seedance-2.0",
        projectId: "project-1",
        nodeId: "node-1",
        grantId: "test-grant",
        resolution: "480p",
        duration: 4,
        archetypeInput: {
          model: "doubao-seedance-2.0-fast",
          image_with_roles: [{ url: first, role: "first_frame" }, { url: last, role: "last_frame" }],
        },
      },
    },
  };
}

/** 跑到终态：创建一次，然后一直查到 succeeded（查询次数 = POLLS_BEFORE_DONE + 1）。 */
async function createThenPollToDone(payload: ReturnType<typeof firstLastFrameRequest>) {
  const created = await runTask(payload, FREE_ADMISSION);
  expect(created.status).toBe("queued");
  const uploadsAtCreate = wire.filter((w) => w.url === "/v1/uploads/images").length;
  for (let i = 0; i < POLLS_BEFORE_DONE; i += 1) {
    const polled = await fetchTaskResult({ taskId: created.id });
    expect(polled.result.status).toBe("running");
  }
  const done = await fetchTaskResult({ taskId: created.id });
  return { created, done, uploadsAtCreate };
}

const uploads = () => wire.filter((w) => w.url === "/v1/uploads/images");
const createBody = () => JSON.parse(wire.find((w) => w.url === "/v1/videos/generations")!.body!) as Record<string, unknown>;

describe("查任务不重传参考素材（#1279 真付费样本复现：每次查任务前都把首尾帧重传一遍）", () => {
  it("首尾帧两张本地图：整个任务各上传一次，且只在创建之前；查任务一次都不上传；创建请求用的就是那次上传返回的地址", async () => {
    const { done, uploadsAtCreate } = await createThenPollToDone(firstLastFrameRequest(FIRST, LAST));
    expect(done.result.status).toBe("succeeded");
    expect(done.result.assets).toMatchObject([{ type: "video" }]);

    const sequence = wire.map((w) => (w.url === "/v1/uploads/images" ? "U" : w.url === "/v1/videos/generations" ? "C" : w.url.startsWith("/v1/tasks/") ? "P" : "D")).join("");
    expect(sequence, "U=上传 C=创建 P=查任务 D=取成片").toBe(`UUC${"P".repeat(POLLS_BEFORE_DONE + 1)}D`);
    expect(uploadsAtCreate).toBe(2);
    expect(uploads().map((w) => w.uploadName).sort()).toEqual(["first.png", "last.png"]);

    const hosted = uploads().map((_, index) => `${base}/hosted/${index + 1}-${uploads()[index].uploadName}`);
    const roles = createBody().image_with_roles as Array<{ url: string; role: string }>;
    expect(roles.map((r) => r.url).sort()).toEqual([...hosted].sort());
    expect(JSON.stringify(createBody())).not.toContain("nomi-local://");
  });

  it("类：调用方直接给内联字节（MCP / headless 的 data: 参考）——同样只在创建时上传一次", async () => {
    const inline = `data:image/png;base64,${PNG.toString("base64")}`;
    await createThenPollToDone(firstLastFrameRequest(inline, LAST));
    expect(uploads()).toHaveLength(2);
    const lastUpload = wire.map((w) => w.url).lastIndexOf("/v1/uploads/images");
    expect(wire.findIndex((w) => w.url.startsWith("/v1/tasks/"))).toBeGreaterThan(lastUpload);
  });

  it("症状 2：提交之后参考图被删掉 / 随项目搬走——已付费的任务照样查得到、成片照样落地（查任务不再依赖参考文件）", async () => {
    const created = await runTask(firstLastFrameRequest(FIRST, LAST), FREE_ADMISSION);
    expect(created.status).toBe("queued");
    localFiles.clear();
    const firstPoll = await fetchTaskResult({ taskId: created.id }).then(() => null, (caught: Error) => caught);
    // 修前：轮询抛 NOMI_ERR::asset-upload-failed，人话说「所以还没请求这次选的服务商」——钱已经花了，这句是假的，
    // 而那一族错误在界面上的主动作是「重试」= 再生成、再扣一次。
    expect(firstPoll?.message ?? "", "已提交任务的查询不能报「参考没送到 / 还没请求服务商」").not.toMatch(/NOMI_ERR::asset-|还没请求/);
    expect(firstPoll).toBeNull();
    for (let i = 1; i < POLLS_BEFORE_DONE; i += 1) await fetchTaskResult({ taskId: created.id });
    const done = await fetchTaskResult({ taskId: created.id });
    expect(done.result.status, String(done.result.error)).toBe("succeeded");
    expect(done.result.assets).toMatchObject([{ type: "video" }]);
    expect(uploads()).toHaveLength(2);
  });

  it("类：用户自配映射把参考写进查询步——查询当场拦下，不发本机地址、不重传参考，也不说「还没请求服务商」", async () => {
    queryOverride = { method: "POST", path: "/v1/tasks/{{providerMeta.task_id}}", body: { first: "{{request.params.first_frame_image}}", refs: "{{request.params.image_with_roles}}" }, response_mapping: { status: "data.status" } } as import("../catalog/types").HttpOperation;
    const created = await runTask(firstLastFrameRequest(FIRST, LAST), FREE_ADMISSION);
    const error = await fetchTaskResult({ taskId: created.id }).then(() => null, (caught: Error) => caught);
    expect(error?.message ?? "").toMatch(/查任务[\s\S]*任务已经提交/);
    expect(error?.message ?? "").not.toMatch(/NOMI_ERR::asset-|还没请求/);
    expect(wire.filter((w) => w.url.startsWith("/v1/tasks/"))).toEqual([]);
    expect(uploads()).toHaveLength(2);
  });
});
