// 一笔四张走「查询 + 结果」两跳的通道（Runway 图片：查询 `output.0`、结果 `output`，同一个地址）：
// 四张都落进项目，每张只下载一次——查询那一跳只读状态，产物在结果那一跳落盘（否则一笔四张会先下四张、再下四张）。
// 回环服务器真给 PNG 字节；全程零花费（本机回环、合成凭据），没有任何提交请求。
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const projectRoot = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), "nomi-multi-output-hop-"));
const requests: string[] = [];
let base = "";
let flakyDown = true;
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
      vendor: { key: "runway", name: "runway", enabled: true, baseUrlHint: base, authType: "bearer", authHeader: "Authorization" },
      model: { modelKey: "gen4_image", vendorKey: "runway", kind: "image" },
      apiKey: "synthetic-key",
    }),
    findTaskMapping: () => runwayImageMapping(),
  };
});

const { writeWorkspaceManifest } = await import("../workspace/workspaceManifest");
const { fetchTaskResult } = await import("./taskResultQuery");
const { taskCache } = await import("../runtime");
const { runwayImagePoll, runwayImageResult, STATUS } = await import("../catalog/runwayShared");

function runwayImageMapping() {
  return {
    vendorKey: "runway", taskKind: "text_to_image", name: "Runway · 文生图", enabled: true,
    create: { method: "POST", path: "/v1/text_to_image", response_mapping: { task_id: "id" }, provider_meta_mapping: { task_id: "id" } },
    query: runwayImagePoll, result: runwayImageResult, statusMapping: STATUS, createdAt: "", updatedAt: "",
  };
}

/** 合法 PNG（能过落盘解码校验）；每张宽度不同，字节各不相同。 */
function png(width: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.alloc(64 * (1 + width * 4)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

beforeAll(async () => {
  writeWorkspaceManifest(projectRoot, { id: "project-1", name: "project", version: 2, createdAt: 1, updatedAt: 1, savedAt: 1, revision: 0,
    immutableProjectUuid: "22222222-2222-4222-8222-222222222222", projectGeneration: 1, payload: {} });
  server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    if (req.url === "/v1/tasks/task-four") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "task-four", status: "SUCCEEDED", output: [0, 1, 2, 3].map((index) => `${base}/files/out-${index}.png`) }));
      return;
    }
    if (req.url === "/v1/tasks/task-flaky") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "task-flaky", status: "SUCCEEDED", output: [0, 1, 2, 3].map((index) => `${base}/files/flaky-${index}.png`) }));
      return;
    }
    const flaky = req.url?.match(/^\/files\/flaky-(\d)\.png$/);
    if (flaky && flaky[1] === "1" && flakyDown) {
      res.writeHead(503);
      res.end();
      return;
    }
    const file = req.url?.match(/^\/files\/(?:out|flaky)-(\d)\.png$/);
    if (file) {
      const bytes = png(64 + Number(file[1]));
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(bytes.length) });
      res.end(bytes);
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

describe("一笔四张、查询 + 结果两跳：四张都落、每张只下一次", () => {
  it("查询读状态、结果那一跳落四张；没有提交请求，每个文件地址只取一次", async () => {
    taskCache.delete("task-four");
    const recovered = await fetchTaskResult({ taskId: "task-four", vendor: "runway", taskKind: "text_to_image", modelKey: "gen4_image", projectId: "project-1" });

    expect(recovered.result.status).toBe("succeeded");
    const assets = recovered.result.assets as Array<{ type: string; url: string; providerUrl?: string | null }>;
    expect(assets.map((asset) => asset.providerUrl)).toEqual([0, 1, 2, 3].map((index) => `${base}/files/out-${index}.png`));
    for (const asset of assets) {
      expect(asset.type).toBe("image");
      expect(asset.url).toMatch(/^nomi-local:\/\//);
    }
    expect(new Set(assets.map((asset) => asset.url)).size).toBe(4);

    const landed = fs.readdirSync(path.join(projectRoot, "assets"), { recursive: true }).map(String).filter((name) => name.endsWith(".png") && !/thumb|preview/i.test(path.basename(name)));
    expect(landed).toHaveLength(4);

    expect(requests.filter((line) => line.startsWith("POST"))).toEqual([]);
    const downloads = requests.filter((line) => line.startsWith("GET /files/out-"));
    expect(downloads.sort()).toEqual([0, 1, 2, 3].map((index) => `GET /files/out-${index}.png`));
  });

  it("第 2 张下载失败：这一笔落「可找回」（不判生成失败、不重新下单）；再取回一次四张都落，仍然没有提交请求", async () => {
    taskCache.delete("task-flaky");
    const input = { taskId: "task-flaky", vendor: "runway", taskKind: "text_to_image", modelKey: "gen4_image", projectId: "project-1" };
    await expect(fetchTaskResult(input)).rejects.toThrow(/NOMI_ERR::retrieval-download/);
    flakyDown = false;

    const recovered = await fetchTaskResult(input);
    expect(recovered.result.status).toBe("succeeded");
    const assets = recovered.result.assets as Array<{ url: string; providerUrl?: string | null }>;
    expect(assets.map((asset) => asset.providerUrl)).toEqual([0, 1, 2, 3].map((index) => `${base}/files/flaky-${index}.png`));
    expect(new Set(assets.map((asset) => asset.url)).size).toBe(4);
    expect(requests.filter((line) => line.startsWith("POST"))).toEqual([]);
  });
});
