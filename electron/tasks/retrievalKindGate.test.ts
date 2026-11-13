// V-1213 第 2 次复验阻断的收口：两台引擎取回的产物都经同一道落盘关口，关口按「任务期望的类型」核字节。
//
// 复现照验收线写（V1213.scope2-landing.test.ts 与 A 的残余反例）：
//   · 引擎 B：参考地址只在授权快照里（合同参数只有 duration）、地址没有扩展名；新建 provider（内存里没有这笔）
//     凭生产同形的上下文取产物 → 读取层认不出它是回显（上下文里没有那个地址、扩展名也判不了类型），交出 kind=video；
//     真回环服务器给 PNG 字节 → 以前落盘成功、回执标 video；现在落盘关口拒收，项目里没有新文件。
//   · 引擎 A：缓存已清、凭磁盘任务身份无状态重建（重建的请求里没有参考地址），合同位置给同一类无扩展名地址 →
//     以前落进项目；现在同一道关口拒收，取回失败带 retrieval-download 码（可找回）。
// 两条都是真下载、真暂存、真校验；零花费：本机回环、合成凭据、模拟受理。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const projectRoot = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "nomi-retrieval-kind-gate-"));
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media", name));
const PNG = fixture("valid.png");
const MP4 = fixture("valid.mp4");
const requests: string[] = [];
let base = "";
let server: http.Server;

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
vi.mock("../runtime", async () => {
  const actual = await vi.importActual<typeof import("../runtime")>("../runtime");
  return {
    ...actual,
    findExecutableModel: () => ({
      vendor: { key: "relay", name: "relay", enabled: true, baseUrlHint: `${base}/v1`, authType: "bearer", authHeader: "Authorization" },
      model: { modelKey: "doubao-seedance-2-0-fast-260128", vendorKey: "relay", kind: "video" },
      apiKey: "synthetic-key",
    }),
    findTaskMapping: () => relayMapping(),
  };
});

const { writeWorkspaceManifest } = await import("../workspace/workspaceManifest");
const { fetchTaskResult } = await import("./taskResultQuery");
const { taskCache } = await import("../runtime");
const { newapiTransportFor } = await import("../catalog/newapiTransport");
const { createCatalogGenerationProvider } = await import("../capabilityCore/apimartGenerationProvider");
const { createGenerationOutputMaterializer, GenerationOutputRetrievalError } = await import("../capabilityCore/generationOutputMaterializer");
const { APIMART_VIDEO_MODELS } = await import("../catalog/apimartVideos");
const { APIMART_STATUS_MAPPING, APIMART_VENDOR_SEED } = await import("../catalog/apimartVendor");
const { spendReferenceKey } = await import("../shared/contracts/pendingSpendConfirm");
const { matchNomiErrorCode } = await import("../shared/nomiErrorCodes");
type CatalogState = import("../catalog/types").CatalogState;

function relayMapping() {
  const generic = newapiTransportFor("video");
  return { vendorKey: "relay", taskKind: "image_to_video", name: "generic", enabled: true, create: generic.imageToVideo!.create, query: generic.query, statusMapping: generic.statusMapping, createdAt: "", updatedAt: "" };
}

/** 项目里落下的媒体文件（不含 sidecar）。 */
const landed = () => fs.existsSync(path.join(projectRoot, "assets"))
  ? fs.readdirSync(path.join(projectRoot, "assets"), { recursive: true }).map(String).filter((name) => /\.\w+$/.test(name) && !name.endsWith(".meta"))
  : [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    const relayTask = /^\/v1\/video\/generations\/(task_\w+)/.exec(req.url || "")?.[1];
    if (relayTask) {
      const resultUrl = relayTask === "task_video" ? `${base}/files/out.mp4` : `${base}/files/signed-reference`;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "success", message: "", data: { task_id: relayTask, status: "SUCCESS", progress: "100%", result_url: resultUrl } }));
      return;
    }
    if (req.url === "/files/signed-reference") {
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": String(PNG.length) });
      res.end(PNG);
      return;
    }
    if (req.url === "/files/out.mp4") {
      res.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": String(MP4.length) });
      res.end(MP4);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(() => {
  requests.length = 0;
  fs.rmSync(path.join(projectRoot, "assets"), { recursive: true, force: true });
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {} });
});
afterAll(() => {
  server?.close();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe("引擎 A：无状态重建后，无扩展名的回显参考图不进项目", () => {
  it("合同位置给参考 PNG（无扩展名、octet-stream）→ 取回失败带 retrieval-download，项目里没有新文件，没有提交请求", async () => {
    taskCache.delete("task_echo");
    const error = await fetchTaskResult({ taskId: "task_echo", vendor: "relay", taskKind: "image_to_video", modelKey: "doubao-seedance-2-0-fast-260128", projectId: "project-1" })
      .then(() => null, (caught: Error) => caught);
    expect(error, "video task must not land the reference PNG").toBeInstanceOf(Error);
    expect(matchNomiErrorCode(error!.message)).toBe("retrieval-download");
    expect(landed()).toEqual([]);
    expect(requests.filter((line) => line.startsWith("POST"))).toEqual([]);
  });

  it("对照：同一条路上真 MP4 照常落进项目", async () => {
    taskCache.delete("task_video");
    const recovered = await fetchTaskResult({ taskId: "task_video", vendor: "relay", taskKind: "image_to_video", modelKey: "doubao-seedance-2-0-fast-260128", projectId: "project-1" });
    expect(recovered.result.assets).toMatchObject([{ type: "video" }]);
    expect(landed().filter((name) => name.endsWith(".mp4"))).toHaveLength(1);
  });
});

function videoCatalog(): CatalogState {
  const now = "now";
  return {
    version: 11,
    vendors: [{ key: "v1213", name: APIMART_VENDOR_SEED.name, enabled: true, baseUrlHint: APIMART_VENDOR_SEED.baseUrl, authType: APIMART_VENDOR_SEED.authType, authHeader: APIMART_VENDOR_SEED.authHeader, createdAt: now, updatedAt: now }],
    models: APIMART_VIDEO_MODELS.map((model) => ({ modelKey: model.modelKey, vendorKey: "v1213", labelZh: model.labelZh, kind: "video" as const, enabled: true, meta: { archetypeId: model.archetypeId }, createdAt: now, updatedAt: now })),
    mappings: APIMART_VIDEO_MODELS.flatMap((model) => model.mappings.map((mapping) => ({
      ...mapping, vendorKey: "v1213", modelKey: model.modelKey, enabled: true, statusMapping: APIMART_STATUS_MAPPING, createdAt: now, updatedAt: now,
      query: { method: "GET" as const, path: "/v1/tasks/{{providerMeta.task_id}}", response_mapping: { status: "status", video_url: "output" } },
    }))),
    apiKeysByVendor: {},
  } as CatalogState;
}

describe("引擎 B：授权快照里的无扩展名参考地址，provider 重建后也落不进项目", () => {
  it("复现 V-1213 第 2 次复验：取产物交出 kind=video，落盘关口按字节拒收，项目里没有新文件", async () => {
    const reference = { assetId: "synthetic-ref", contentHash: "c".repeat(64), version: 1, kind: "image", role: "character" };
    const url = `${base}/files/signed-reference`;
    const state = videoCatalog();
    const posts: unknown[] = [];
    const make = () => createCatalogGenerationProvider({ vendorKey: "v1213", resolveConnection: () => ({ apiKey: "synthetic" }), catalogReader: () => state,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        posts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ code: 200, data: [{ status: "submitted", task_id: "snapshot-task" }] }), { status: 200 });
      }) as unknown as typeof fetch });
    const semantic = {
      moduleId: "generation.single-shot", providerId: "v1213", modelId: "kling-v3", mode: "image_to_video", prompt: "a paper crane",
      parameters: { duration: 4 }, references: [reference],
      referenceUrls: { [spendReferenceKey(reference as Parameters<typeof spendReferenceKey>[0])]: url },
      contractHash: "a".repeat(64), idempotencyKey: "stable", requestFingerprint: "b".repeat(64),
      executionBinding: { immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, runId: "run-1", shotId: "shot-1", contractHash: "a".repeat(64),
        runtimeTaskId: "runtime-1", providerNamespace: "v1213", providerIdempotencyKey: "stable", requestFingerprint: "b".repeat(64), runtimeEnvelopeRef: ".nomi/runs/run-1/runtime.json", fencingEpoch: 1 },
    };
    const first = make();
    const contextual = (first as typeof first & { submitWithContext: (request: unknown, key: string, input: typeof semantic) => Promise<unknown> }).submitWithContext;
    await contextual(first.buildRequest(semantic as never), "synthetic", semantic);
    expect(posts).toHaveLength(1);

    const context = { modelId: semantic.modelId, mode: semantic.mode, parameters: semantic.parameters };
    const outputs = (await make().materialize!({ providerTaskId: "snapshot-task", raw: { status: "success", output: url }, context })).outputs;
    expect(outputs, "读取层在重建后认不出这条回显（这正是落盘关口要兜住的那一种）").toMatchObject([{ kind: "video", url }]);

    const materializer = createGenerationOutputMaterializer({ attachPreview: async (record) => record });
    const error = await materializer.materialize({ projectId: "project-1", providerTaskId: "snapshot-task", output: outputs[0] }).then(() => null, (caught: Error) => caught);
    expect(error, "video task must not publish the reference PNG").toBeInstanceOf(GenerationOutputRetrievalError);
    expect((error as InstanceType<typeof GenerationOutputRetrievalError>).deterministic).toBe(true);
    expect(landed()).toEqual([]);
    expect(posts).toHaveLength(1);
  });
});
