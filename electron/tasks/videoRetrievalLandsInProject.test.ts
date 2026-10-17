// 闭环（V-1213 第 1 节缺口）：上游说成了 → 查询取到结果地址 → 真下载 → 落进项目资产 → 交回可放进节点的本地地址。
// 不是 URL 断言：回环服务器真给 MP4 字节，落盘后读回字节、核类型；全程零花费（本机回环、合成凭据）。
// 形状用 #1213 的那一种：自建中转（new-api 信封，地址在 data.result_url），任务号从磁盘重建（缓存已清）。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const projectRoot = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "nomi-retrieval-closure-"));
const MP4 = fs.readFileSync(path.join(__dirname, "../providerAdapter/__fixtures__/certification-media/valid.mp4"));
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

function relayMapping() {
  const generic = newapiTransportFor("video");
  return { vendorKey: "relay", taskKind: "image_to_video", name: "generic", enabled: true, create: generic.imageToVideo!.create, query: generic.query, statusMapping: generic.statusMapping, createdAt: "", updatedAt: "" };
}

beforeAll(async () => {
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "11111111-1111-4111-8111-111111111111", projectGeneration: 1, payload: {} });
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url?.startsWith("/v1/video/generations/task_pub123")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: "success", message: "", data: { task_id: "task_pub123", status: "SUCCESS", progress: "100%", result_url: `${base}/files/out.mp4` } }));
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
afterAll(() => {
  server?.close();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe("上游说成了 → 取回 → 下载 → 落进项目（#1213 闭环，零花费）", () => {
  it("缓存已清、只凭磁盘上的任务身份重建续查：真 MP4 字节落进项目资产，交回本地地址；全程没有任何提交请求", async () => {
    taskCache.delete("task_pub123");
    const recovered = await fetchTaskResult({
      taskId: "task_pub123",
      vendor: "relay",
      taskKind: "image_to_video",
      modelKey: "doubao-seedance-2-0-fast-260128",
      projectId: "project-1",
    });

    expect(recovered.result.status).toBe("succeeded");
    const asset = recovered.result.assets[0] as { type: string; url: string; providerUrl?: string | null };
    expect(asset.type).toBe("video");
    expect(asset.url).toMatch(/^nomi-local:\/\//);
    expect(asset.providerUrl).toBe(`${base}/files/out.mp4`);

    // 落盘的是那份 MP4 本身（逐字节），不是一张图、不是错误页。
    const landed = fs.readdirSync(path.join(projectRoot, "assets"), { recursive: true }).map(String).filter((name) => name.endsWith(".mp4"));
    expect(landed).toHaveLength(1);
    expect(fs.readFileSync(path.join(projectRoot, "assets", landed[0])).equals(MP4)).toBe(true);

    // 只查不交：没有任何 POST（不重复扣费），一次查询 + 一次下载。
    expect(requests.filter((line) => line.startsWith("POST"))).toEqual([]);
    expect(requests).toEqual(["GET /v1/video/generations/task_pub123", "GET /files/out.mp4"]);
  });
});
