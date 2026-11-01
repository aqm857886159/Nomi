// 试探和上传不是付费派发：一笔没发给模型，就不能说「可能已被服务商收下」。
// 真提交出口 / 真 Run 仓库 / 真 observeSubmissionHandoffs / 真试探 / 真上传 / 真 vendorHttp → appFetch 账本 → 本机回环。
// 只有 runTask 外壳换成它里面那段 executeProfileOperation。矩阵 referenceLinkDelivery 只测到决定点，看不到这一层。
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ catalog: { current: null as unknown } }));
vi.mock("electron", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    app: { getPath: () => String(process.env.NOMI_SETTINGS_DIR), getAppPath: () => process.cwd(), isPackaged: false },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() },
  };
});
vi.mock("../catalog/catalogStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../catalog/catalogStore")>()),
  readCatalog: () => structuredClone(hoisted.catalog.current),
}));

import { setupCanvasShots, CANVAS_TEST_PROJECT } from "../capabilityCore/canvasShotTestUtils";
import type { CanvasTaskResult, CanvasTransport } from "../capabilityCore/canvasTransportProvider";
import { setLabTrustedPrivateOrigins } from "../networkOutboundPolicy";
import { resetProviderLinkProbes } from "../assets/providerMediaFetch";
import { executeProfileOperation } from "../runtime";
import { canvasRunIdFor } from "./canvasShotRunIndex";
import { runTaskIpcGuard } from "../tasks/taskIpcGuard";
import { classifyGenerationError } from "../../src/workbench/observability/classifyError";
import type { LocalAsset } from "../catalog/assetLocalization";
import type { AssetIngestion, Model, Vendor } from "../catalog/types";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const LOCAL_REF = `nomi-local://asset/${CANVAS_TEST_PROJECT}/gen.png`;
const OVER_WINDOW_MS = 49 * 3600 * 1000;

let server: http.Server;
let origin = "";
let closedOrigin = "";
const hits = new Map<string, number>();
const generatePosts: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const pathname = (req.url || "/").split("?")[0];
    hits.set(pathname, (hits.get(pathname) ?? 0) + 1);
    if (pathname === "/gen/alive.png") return void res.writeHead(206, { "Content-Type": "image/png", "Content-Length": PNG.length }).end(PNG);
    if (pathname === "/gen/expired.png") return void res.writeHead(403, { "Content-Type": "application/xml" }).end("<Error><Code>AccessDenied</Code></Error>");
    if (pathname === "/v1/uploads-ok") {
      req.resume();
      req.on("end", () => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ url: `${origin}/fixture/uploaded.png` })));
      return;
    }
    if (pathname === "/v1/uploads-fail") {
      req.resume();
      req.on("end", () => res.writeHead(500, { "Content-Type": "application/json" }).end('{"message":"nope"}'));
      return;
    }
    if (pathname === "/v1/generate") {
      // 模型收下了请求，然后连接断了：这一笔才是真的「结果不明」。
      req.resume();
      req.on("end", () => { generatePosts.push(pathname); req.socket.destroy(); });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const closed = http.createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", resolve));
  closedOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let settingsRoot = "";
beforeEach(() => {
  settingsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-reference-ledger-"));
  vi.stubEnv("NOMI_SETTINGS_DIR", settingsRoot);
  vi.stubEnv("NOMI_TEST_NETWORK_GUARD", "1");
  resetProviderLinkProbes();
  hits.clear();
  generatePosts.length = 0;
  setLabTrustedPrivateOrigins([origin, closedOrigin]);
});
afterEach(() => {
  setLabTrustedPrivateOrigins([]);
  vi.unstubAllEnvs();
  fs.rmSync(settingsRoot, { recursive: true, force: true });
});

const vendorOf = (base: string): Vendor => {
  const now = "2026-11-01T00:00:00.000Z";
  return { key: "acme", name: "acme", enabled: true, baseUrlHint: `${base}/v1`, authType: "bearer", createdAt: now, updatedAt: now } as Vendor;
};
const modelOf = (): Model => ({ vendorKey: "acme", modelKey: "img-model", labelZh: "Paint", kind: "image", enabled: true, createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" } as Model);
const uploadsTo = (endpoint: string): AssetIngestion => ({ strategy: "upload-multipart", endpoint, fileField: "file", urlPath: "url", authType: "bearer", accepts: ["image", "video", "audio"], visibility: "provider-private" } as AssetIngestion);

function transportFor(vendor: Vendor, link: string, operationIngestion?: AssetIngestion, assetAgeMs = 60_000): CanvasTransport {
  const model = modelOf();
  hoisted.catalog.current = { version: 13, vendors: [vendor], models: [model], mappings: [], apiKeysByVendor: {} };
  const asset: LocalAsset = { bytes: Buffer.concat([PNG, Buffer.from("x")]), contentType: "image/png", fileName: "gen.png", originalUrl: link, ageMs: assetAgeMs };
  return {
    networkTransport: "app-fetch",
    execute: async (payload): Promise<CanvasTaskResult> => {
      const out = await executeProfileOperation({
        vendor,
        model,
        apiKey: "sk-test",
        stage: "create",
        operation: { method: "POST", path: "/generate", body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", image: "{{request.params.image_url}}" }, ...(operationIngestion ? { assetIngestion: operationIngestion } : {}) },
        request: payload.request,
        localAssetReader: (url: string) => (url === LOCAL_REF ? asset : null),
      } as Parameters<typeof executeProfileOperation>[0]) as { response: { data: Array<{ task_id: string }> } };
      return { id: out.response.data[0].task_id, kind: payload.request.kind, status: "queued", assets: [], raw: out.response };
    },
    fetchResult: async (input) => ({ result: { id: String(input.taskId), kind: "text_to_image", status: "running", assets: [], raw: {} } as CanvasTaskResult }),
  };
}

async function clickGenerate(transport: CanvasTransport) {
  const fx = setupCanvasShots({ transport });
  const extras = { referenceImages: [LOCAL_REF] };
  let message = "";
  try {
    await runTaskIpcGuard({}, async () => fx.submit("node-1", "rr-1", "keep the boat", extras));
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const run = fx.repository.read(CANVAS_TEST_PROJECT, canvasRunIdFor("rr-1"));
  const job = run ? [...run.jobs].sort((a, b) => b.attempt - a.attempt)[0] : undefined;
  const reservation = run ? Object.values(fx.repository.readBudgetLedger(run.projectId, run.runId).reservations)[0]?.status : undefined;
  const card = classifyGenerationError(message).kind;
  // 再点一次生成：这一下被拒绝（要先去任务中心对账）就是这张假卡的代价。
  const retry = await fx.submit("node-1", "rr-2", "keep the boat", extras).then(() => "sent", (error: { code?: string; reason?: string }) => `${error.code}:${error.reason}`);
  return { jobStatus: job?.status, errorCode: job?.errorCode, reservation, card, retry };
}

const SIGNED = "?X-Amz-Signature=abc&X-Amz-Expires=3600";

describe("一笔没发给模型：不说「结果不明」，可以直接重试", () => {
  it.each([
    ["带查询串的活链接（试探留下过一笔）+ 模型接口连不上", () => transportFor(vendorOf(closedOrigin), `${origin}/gen/alive.png${SIGNED}`)],
    ["失效链接，上传成功 + 模型接口连不上", () => transportFor(vendorOf(closedOrigin), `${origin}/gen/expired.png`, uploadsTo(`${origin}/v1/uploads-ok`))],
    ["超过 48 小时，上传成功 + 模型接口连不上", () => transportFor(vendorOf(closedOrigin), `${origin}/gen/alive.png`, uploadsTo(`${origin}/v1/uploads-ok`), OVER_WINDOW_MS)],
  ])("%s", async (_label, make) => {
    const result = await clickGenerate(make());
    expect(generatePosts).toEqual([]);
    expect(result).toMatchObject({ jobStatus: "needs_attention", errorCode: "provider_not_reached", reservation: "released" });
    expect(result.retry).not.toContain("needs_reconcile");
  });

  it.each([
    ["失效链接，上传回 500", () => transportFor(vendorOf(origin), `${origin}/gen/expired.png`, uploadsTo(`${origin}/v1/uploads-fail`))],
    ["带查询串的失效链接，上传回 500", () => transportFor(vendorOf(origin), `${origin}/gen/expired.png${SIGNED}`, uploadsTo(`${origin}/v1/uploads-fail`))],
    ["超过 48 小时，上传回 500", () => transportFor(vendorOf(origin), `${origin}/gen/alive.png`, uploadsTo(`${origin}/v1/uploads-fail`), OVER_WINDOW_MS)],
  ])("%s：卡片说上传没成功，不说可能已被收下", async (_label, make) => {
    const result = await clickGenerate(make());
    expect(generatePosts).toEqual([]);
    expect(result).toMatchObject({ jobStatus: "needs_attention", errorCode: "provider_not_reached", reservation: "released", card: "asset-upload-failed" });
    expect(result.retry).not.toContain("needs_reconcile");
  });
});

describe("真交给了模型的那一笔还在账上（防双扣）", () => {
  it("带查询串的活链接 + 模型收下后连接断了：结果未知，重试被拒，等对账", async () => {
    const result = await clickGenerate(transportFor(vendorOf(origin), `${origin}/gen/alive.png${SIGNED}`));
    expect(generatePosts).toEqual(["/v1/generate"]);
    expect(result).toMatchObject({ jobStatus: "submission_unknown", reservation: "unsettled", card: "submission-unknown", retry: "production_shot_claimed:needs_reconcile" });
  });
});
