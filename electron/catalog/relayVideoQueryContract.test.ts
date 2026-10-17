// 中转视频「查询结果」合同夹具（#1213）。
//
// 病根：中转查询合同从来没按真实中转的返回形状验过——通用 new-api 查询照我们自己写的 mock 定
// （tests/transport-spike/newapi-mock.mjs 的 data[*].url），原生方舟查询只认方舟原始 JSON。于是官方
// new-api 的任务信封一律「完成但没有产物」（钱扣了、片在上游），查询报错又被找回面板吞掉。
//
// 这里把各中转**真实**会回的形状做成一组夹具（每个注明来源），**两条通道跑同一组**：
// 生产函数真跑（executeProfileOperation → buildProfileTaskResult → missingAsyncMediaOutput），只有 HTTP
// 是本机回环，零花费。期望表就是合同：任何形状对不上，这里先红。
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-relay-video-query-contract", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => v.toString() },
  webContents: { getAllWebContents: () => [] },
}));

import { buildProfileTaskResult, executeProfileOperation } from "../runtime";
import { missingAsyncMediaOutput } from "../tasks/taskResultQuery";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { newapiTransportFor } from "./newapiTransport";
import type { Mapping, Model, Vendor } from "./types";

const VIDEO_URL = "https://ark-content-generation.example.test/task/video.mp4?X-Tos-Signature=abc";
const ARK_TASK_ID = "cgt-20261017001118-abcde";
const RELAY_TASK_ID = "task_pub123";
/** 方舟查询任务的原始响应（docs.volcengine.com/docs/82379/1520757：id/model/status/content.video_url/usage）。 */
const ARK_RAW = {
  id: ARK_TASK_ID,
  model: "doubao-seedance-2-0-fast-260128",
  status: "succeeded",
  content: { video_url: VIDEO_URL },
  usage: { completion_tokens: 108900, total_tokens: 108900 },
};
/** 官方 new-api 的任务信封（relay/relay_task.go TaskModel2Dto + dto/task.go TaskDto，v1.0.0-rc.10 ~ rc.44）。 */
const newapiEnvelope = (status: string, extra: Record<string, unknown>) => ({
  code: "success",
  message: "",
  data: { id: 1, task_id: RELAY_TASK_ID, platform: "54", action: "generate", status, progress: "100%", fail_reason: "", data: ARK_RAW, ...extra },
});

type Fixture = {
  name: string;
  source: string;
  http: number;
  body: unknown;
  /** 两条通道共同的合同期望。 */
  expect: { status: "succeeded"; url: string } | { status: "running" } | { status: "failed"; error: RegExp } | { throws: RegExp };
};

const FIXTURES: Fixture[] = [
  { name: "方舟原始 JSON", source: "volcengine doc 82379/1520757 查询任务", http: 200, body: ARK_RAW, expect: { status: "succeeded", url: VIDEO_URL } },
  {
    name: "官方 new-api 信封（result_url）",
    source: "new-api v1.0.0-rc.10 relay/relay_task.go videoFetchByIDRespBodyBuilder + dto/task.go",
    http: 200,
    // 任务数据只剩提交时的回执（plugins/tasks/doubao/plugin.js taskCreated），地址只在 result_url。
    body: newapiEnvelope("SUCCESS", { result_url: VIDEO_URL, data: { id: ARK_TASK_ID } }),
    expect: { status: "succeeded", url: VIDEO_URL },
  },
  {
    name: "官方 new-api 信封（只在内层带方舟原始响应）",
    source: "new-api service/task_polling.go task.Data = 上游查询原文",
    http: 200,
    body: newapiEnvelope("SUCCESS", {}),
    expect: { status: "succeeded", url: VIDEO_URL },
  },
  {
    name: "旧版 new-api 信封（地址在 fail_reason）",
    source: "new-api model/task.go GetResultURL「旧数据回退到 FailReason」",
    http: 200,
    body: newapiEnvelope("SUCCESS", { fail_reason: VIDEO_URL, data: {} }),
    expect: { status: "succeeded", url: VIDEO_URL },
  },
  {
    name: "官方 new-api 信封（进行中）",
    source: "new-api model/task.go TaskStatusInProgress",
    http: 200,
    body: newapiEnvelope("IN_PROGRESS", { progress: "50%", data: { id: ARK_TASK_ID, status: "running" } }),
    expect: { status: "running" },
  },
  {
    name: "new-api Gemini/Vertex 简化形状 {status,url}",
    source: "new-api relay/relay_task.go tryRealtimeFetch",
    http: 200,
    body: { error: null, format: "mp4", metadata: null, status: "succeeded", task_id: RELAY_TASK_ID, url: VIDEO_URL },
    expect: { status: "succeeded", url: VIDEO_URL },
  },
  {
    // OpenAI-video 对象本身不带地址（片子在 /v1/videos/{id}/content，要鉴权）——上游说成了就不判失败：
    // 带 retrieval-parse 落「可找回」，原话进技术详情（#1213 原则 1）。
    name: "OpenAI-video 对象（completed、无地址）",
    source: "new-api dto/openai_video.go OpenAIVideo",
    http: 200,
    body: { id: RELAY_TASK_ID, object: "video", model: "doubao-seedance-2-0-fast-260128", status: "completed", progress: 100 },
    expect: { throws: /NOMI_ERR::retrieval-parse::[\s\S]*completed/ },
  },
  {
    name: "无可用渠道 503",
    source: "new-api middleware/distributor.go「当前分组 %s 下对于模型 %s 无可用渠道」",
    http: 503,
    body: { error: { message: "当前分组 default 下对于模型  无可用渠道", type: "new_api_error" } },
    expect: { throws: /HTTP 503[\s\S]*无可用渠道/ },
  },
  {
    name: "404 Invalid URL",
    source: "new-api controller/relay.go RelayNotFound",
    http: 404,
    body: { error: { message: "Invalid URL (GET /api/v3/contents/generations/tasks/x)", type: "invalid_request_error", param: "", code: "" } },
    expect: { throws: /HTTP 404[\s\S]*Invalid URL/ },
  },
];

let current: Fixture = FIXTURES[0];
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      req.resume();
      req.on("end", () => {
        res.writeHead(200);
        res.end(JSON.stringify({ id: ARK_TASK_ID, task_id: RELAY_TASK_ID }));
      });
      return;
    }
    res.writeHead(current.http);
    res.end(JSON.stringify(current.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

const native = nativeWireProfileForArchetype("volcengine-seedance-2")!;
const generic = newapiTransportFor("video");
const WIRES: Array<{ wire: string; mapping: Mapping }> = [
  {
    wire: "中转上的方舟原生通道",
    mapping: { vendorKey: "relay", taskKind: "image_to_video", name: "native", enabled: true, create: native.create.image_to_video!, query: native.query, statusMapping: native.statusMapping, createdAt: "", updatedAt: "" } as Mapping,
  },
  {
    wire: "通用 new-api 通道",
    mapping: { vendorKey: "relay", taskKind: "image_to_video", name: "generic", enabled: true, create: generic.imageToVideo!.create, query: generic.query, statusMapping: generic.statusMapping, createdAt: "", updatedAt: "" } as Mapping,
  },
];

async function queryOnce(mapping: Mapping) {
  const vendor = { key: "relay", name: "relay", enabled: true, baseUrlHint: `${base}/v1`, authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" } as Vendor;
  const model = { modelKey: "doubao-seedance-2-0-fast-260128", vendorKey: "relay", labelZh: "Seedance", kind: "video", enabled: true, createdAt: "", updatedAt: "" } as Model;
  const request = { kind: "image_to_video", prompt: "cat", extras: { modelKey: model.modelKey, model: model.modelKey, ratio: "16:9", resolution: "720p", duration: 4 } } as never;
  const created = await executeProfileOperation({ vendor, model, apiKey: "k", request, operation: mapping.create });
  const accepted = await buildProfileTaskResult({ response: created.response, mapping, operation: mapping.create, request, taskIdFallback: "", wantedKind: "video", vendor, model });
  const providerMeta = { ...accepted.providerMeta, task_id: accepted.result.id, query_id: accepted.result.id };
  const polled = await executeProfileOperation({ vendor, model, apiKey: "k", request, operation: mapping.query!, providerMeta });
  const normalized = await buildProfileTaskResult({ response: polled.response, mapping, operation: mapping.query!, request, taskIdFallback: accepted.result.id, wantedKind: "video", vendor, model });
  const missing = missingAsyncMediaOutput(normalized.result, "video", polled.response);
  if (missing) throw missing;
  return normalized.result;
}

describe.each(WIRES)("$wire：真实中转形状合同", ({ mapping }) => {
  it.each(FIXTURES)("$name（来源：$source）", async (fixture) => {
    current = fixture;
    const expected = fixture.expect;
    if ("throws" in expected) {
      // 查询本身失败：主进程如实抛出带上游原话的错误（渲染层据此落「可找回」并把原话显示出来）。
      await expect(queryOnce(mapping)).rejects.toThrow(expected.throws);
      return;
    }
    const result = await queryOnce(mapping);
    expect(result.status).toBe(expected.status);
    if (expected.status === "succeeded") expect(result.assets.map((asset) => asset.providerUrl ?? asset.url)).toEqual([expected.url]);
    if (expected.status === "failed") expect(result.error).toMatch(expected.error);
  });
});
