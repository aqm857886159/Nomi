// 视频通道「查询结果」合同矩阵 + 普查门岗（#1213 原则 5：用真实返回来验证）。
//
// 目录里**每一条**内置视频查询映射（applyBuiltinSeeds 播下的全部，外加中转的通用 / 原生两种）按「查询合同形状」
// 分组（家 + query.response_mapping + result.response_mapping），每种形状登记一份**真实返回**夹具：成功、进行中。
// 每条映射都过同一组断言，走唯一读法 tasks/taskResultReading.readTaskResponse：
//   ① 成功夹具 → succeeded，且取到的正是那个结果地址（有 result 二跳的：query 判成功、result 取地址）；
//   ② 进行中夹具 → 非终态（queued / running），绝不取地址；
//   ③ 状态字段换成没人认得的词 → 不判失败（原则 1）。
// 普查：出现一种没登记夹具的新形状，这里直接红并列出它——新通道接进来，必须先交它的真实返回。
// 夹具来源逐条写在 source 里（官方文档 / 官方源码 / 仓库里的真实录制）。
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/nomi-video-query-matrix", getAppPath: () => process.cwd() },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: { getAllWebContents: () => [] },
}));

import { applyBuiltinSeeds } from "./seedBuiltins";
import { nativeWireProfileForArchetype } from "./nativeWireProfiles";
import { newapiTransportFor } from "./newapiTransport";
import { readTaskResponse, requestEchoUrls } from "../tasks/taskResultReading";
import { resolveTaskStatus } from "../tasks/responseParsing";
import { createCatalogGenerationProvider } from "../capabilityCore/apimartGenerationProvider";
import { isJsonRecord, type JsonRecord } from "../jsonUtils";
import higgsfieldDopTerminal from "./fixtures/higgsfield/dop-terminal.json";
import type { CatalogState, Mapping } from "./types";

const MP4 = "https://result-cdn.example.test/out/video.mp4";

type ShapeFixture = {
  source: string;
  /** query 的成功响应（没有 result 二跳时，地址就在这里）。 */
  success: unknown;
  /** result 二跳的成功响应（有 result op 的家才填）。 */
  result?: unknown;
  /** query 的进行中响应。 */
  running: unknown;
  /** 成功响应里的结果地址（缺省 = MP4；真机录制的夹具带它自己的地址）。 */
  url?: string;
};

/** 形状签名：家 + query 的 response_mapping + result 的 response_mapping（与普查同一个键）。 */
function shapeKey(mapping: Pick<Mapping, "vendorKey" | "query" | "result">): string {
  return `${mapping.vendorKey}|Q=${JSON.stringify(mapping.query?.response_mapping ?? {})}|R=${JSON.stringify(mapping.result?.response_mapping ?? null)}`;
}

const KIE_SUCCESS = { code: 200, msg: "success", data: { taskId: "kie-task-1", state: "success", resultJson: JSON.stringify({ resultUrls: [MP4] }), failMsg: "" } };
const KIE_RUNNING = { code: 200, msg: "success", data: { taskId: "kie-task-1", state: "generating", resultJson: "", failMsg: "" } };
const KIE_SOURCE = "docs.kie.ai GET /api/v1/jobs/recordInfo（resultJson 是 JSON 字符串、内含 resultUrls；结果域实测 tempfile.aiquickdraw.com）";

/** 登记表：形状签名 → 真实返回夹具。键由 shapeKey 生成（与普查同源），值注明来源。 */
const FIXTURES: Record<string, ShapeFixture> = {
  [`kie|Q={"task_id":"data.taskId","status":"data.state","video_url":"data.resultJson.resultUrls.0","error_message":"data.failMsg"}|R=null`]: { source: KIE_SOURCE, success: KIE_SUCCESS, running: KIE_RUNNING },
  [`kie|Q={"task_id":"data.taskId","status":"data.state","video_url":"data.resultJson.resultUrls[*]","error_message":"data.failMsg"}|R=null`]: { source: KIE_SOURCE, success: KIE_SUCCESS, running: KIE_RUNNING },
  [`apimart|Q={"task_id":"data.id","status":"data.status","video_url":["data.result.videos.0.url.0","data.result.videos.0.url"],"error_message":"data.error.message"}|R=null`]: {
    source: "APIMart GET /v1/tasks/{id}：2026-08-25 真付费验收录下的形状（videos[0].url 是字符串数组，见 apimartGenerationProvider.test.ts）",
    success: { code: 200, data: { id: "task_01", status: "completed", progress: 100, actual_time: 128, result: { videos: [{ url: [MP4], expires_at: 1787722735 }] } } },
    running: { code: 200, data: { id: "task_01", status: "processing", progress: 40 } },
  },
  [`agnes|Q={"task_id":"video_id","status":"status","video_url":["url","metadata.url"],"error_message":"error"}|R=null`]: {
    source: "Agnes /agnesapi?video_id=：2026-08-26 实查，真实响应顶层 url，文档写 metadata.url（agnesVendor.ts 注释）",
    success: { video_id: "v-1", status: "completed", url: MP4, remixed_from_video_id: null },
    running: { video_id: "v-1", status: "in_progress" },
  },
  [`volcengine|Q={"task_id":"id","status":"status","video_url":"content.video_url","error_message":"error.message"}|R=null`]: {
    source: "方舟 GET /api/v3/contents/generations/tasks/{id}（docs.volcengine.com/docs/82379/1520757）",
    success: { id: "cgt-1", model: "doubao-seedance-2-0-260128", status: "succeeded", content: { video_url: MP4, last_frame_url: "https://result-cdn.example.test/out/last.png" }, usage: { completion_tokens: 108900 } },
    running: { id: "cgt-1", status: "running" },
  },
  [`dreamina|Q={"task_id":"submit_id","status":"gen_status","video_url":"video_url"}|R=null`]: {
    source: "即梦 CLI 结果经 processOperation 归一后的「类 HTTP 响应」（processOperation.ts ProcessResponse）",
    success: { submit_id: "s-1", gen_status: "success", fail_reason: "", queue_info: null, video_url: [MP4], _stdout: "", _stderr: "" },
    running: { submit_id: "s-1", gen_status: "querying", fail_reason: "", queue_info: null, video_url: [], _stdout: "", _stderr: "" },
  },
  [`runninghub|Q={"task_id":"taskId","status":"status","model_url":"results.0.fileUrl","error_message":"errorMessage"}|R=null`]: {
    source: "RunningHub OpenAPI 查询任务结果（results[].fileUrl / outputType；runninghubVideos.ts 的 sources）",
    success: { taskId: "rh-1", status: "SUCCESS", errorMessage: "", results: [{ fileUrl: MP4, outputType: "mp4" }] },
    running: { taskId: "rh-1", status: "RUNNING", errorMessage: "", results: null },
  },
  [`minimax|Q={"task_id":"task.id","status":"task.status","video_url":"task.content.url","error_message":"task.error.message"}|R=null`]: {
    source: "MiniMax 官方 GET /v2/query/video_generation/{task_id}（minimaxOfficial.ts）",
    success: { task: { id: "mm-1", status: "succeeded", content: { url: MP4 } } },
    running: { task: { id: "mm-1", status: "running" } },
  },
  [`fal|Q={"task_id":"request_id","status":"status"}|R={"assets":"video.url"}`]: {
    source: "fal 队列 API：GET .../requests/{id}/status 只给状态，GET .../requests/{id} 给 {video:{url}}（docs.fal.ai/model-endpoints/queue）",
    success: { request_id: "fal-1", status: "COMPLETED" },
    result: { video: { url: MP4, content_type: "video/mp4" } },
    running: { request_id: "fal-1", status: "IN_PROGRESS", queue_position: 0 },
  },
  [`runway|Q={"task_id":"id","status":"status","video_url":"output.0","error_message":"failure"}|R={"task_id":"id","status":"status","assets":"output","error_message":"failure"}`]: {
    source: "Runway GET /v1/tasks/{id}（docs.dev.runwayml.com：status SUCCEEDED + output[]）",
    success: { id: "rw-1", status: "SUCCEEDED", output: [MP4] },
    result: { id: "rw-1", status: "SUCCEEDED", output: [MP4] },
    running: { id: "rw-1", status: "RUNNING", progress: 0.4 },
  },
  [`higgsfield|Q={"task_id":"request_id","status":"status","video_url":"video.url","error_message":"detail"}|R=null`]: {
    source: "Higgsfield DoP 终态真机录制（fixtures/higgsfield/dop-terminal.json，2026-09-17）",
    success: higgsfieldDopTerminal,
    url: higgsfieldDopTerminal.video.url,
    running: { status: "in_progress", request_id: "3f6596b7-a489-4225-ba3d-17544bc3658e" },
  },
};

function builtinVideoMappings(): Mapping[] {
  const empty = { version: 13, vendors: [], models: [], mappings: [], apiKeysByVendor: {} } as unknown as CatalogState;
  const { state } = applyBuiltinSeeds(empty, "2026-10-16T00:00:00.000Z");
  return state.mappings.filter((mapping) => /video/.test(mapping.taskKind) && Boolean(mapping.query));
}

function relayVideoMappings(): Mapping[] {
  const generic = newapiTransportFor("video");
  const native = nativeWireProfileForArchetype("volcengine-seedance-2")!;
  return [
    { vendorKey: "relay-generic", taskKind: "image_to_video", name: "generic", enabled: true, create: generic.imageToVideo!.create, query: generic.query, statusMapping: generic.statusMapping } as Mapping,
    { vendorKey: "relay-native", taskKind: "image_to_video", name: "native", enabled: true, create: native.create.image_to_video!, query: native.query, statusMapping: native.statusMapping } as Mapping,
  ];
}

// 中转两种通道的形状另有一组 8 种真实形状夹具（relayVideoQueryContract.test.ts，走真 HTTP）；
// 这里只把它们挂进同一组断言，夹具取官方 new-api 信封与方舟原始 JSON。
const NEWAPI_ENVELOPE = { code: "success", message: "", data: { task_id: "task_pub", status: "SUCCESS", progress: "100%", result_url: MP4, data: { id: "cgt-1", status: "succeeded" } } };
const NEWAPI_RUNNING = { code: "success", message: "", data: { task_id: "task_pub", status: "IN_PROGRESS", progress: "50%" } };
function relayFixtureFor(mapping: Mapping): ShapeFixture {
  return mapping.vendorKey === "relay-generic"
    ? { source: "new-api v1.0.0-rc.10 relay/relay_task.go TaskModel2Dto", success: NEWAPI_ENVELOPE, running: NEWAPI_RUNNING }
    : FIXTURES[`volcengine|Q={"task_id":"id","status":"status","video_url":"content.video_url","error_message":"error.message"}|R=null`];
}

function responseMappingOf(op: Mapping["query"]): JsonRecord | null {
  return op && isJsonRecord(op.response_mapping) ? (op.response_mapping as JsonRecord) : null;
}

/** 把响应里「状态字段」换成一个没人认得的词（按这条映射自己声明的状态路径）。 */
function withUnknownStatus(response: unknown, statusPath: string): unknown {
  const copy = structuredClone(response) as JsonRecord;
  const parts = statusPath.split(".");
  let node: JsonRecord = copy;
  for (const part of parts.slice(0, -1)) {
    if (!isJsonRecord(node[part])) node[part] = {};
    node = node[part] as JsonRecord;
  }
  node[parts[parts.length - 1]] = "marinating";
  return copy;
}

const builtin = builtinVideoMappings();
const all = [...builtin, ...relayVideoMappings()];

describe("视频查询合同普查：每种查询形状都登记了真实返回夹具", () => {
  it("内置视频查询映射全部有夹具（新形状必须先交真实返回）", () => {
    expect(builtin.length).toBeGreaterThan(50);
    const missing = Array.from(new Set(builtin.map(shapeKey).filter((key) => !FIXTURES[key])));
    expect(missing).toEqual([]);
  });

  it("登记表里没有死夹具（每份夹具都对应一种还在用的形状）", () => {
    const live = new Set(builtin.map(shapeKey));
    expect(Object.keys(FIXTURES).filter((key) => !live.has(key))).toEqual([]);
  });
});

describe.each(all.map((mapping) => [`${mapping.vendorKey} · ${mapping.modelKey || mapping.name} · ${mapping.taskKind}`, mapping] as const))(
  "%s",
  (_label, mapping) => {
    const fixture = mapping.vendorKey.startsWith("relay-") ? relayFixtureFor(mapping) : FIXTURES[shapeKey(mapping)];
    const read = (response: unknown, op: Mapping["query"]) => readTaskResponse({
      response,
      responseMapping: responseMappingOf(op),
      statusMapping: mapping.statusMapping,
      wantedKind: "video",
    });

    it("成功：判成功，并取到那个结果地址", () => {
      const queried = read(fixture.success, mapping.query);
      expect(queried.status).toBe("succeeded");
      // 「成功」必须是**状态词本身**认出来的（通道 statusMapping 或共享词表），不能只靠「有产物」这条硬证据兜着：
      // 不然词表漏了这家的「成功」写法，有地址时看不出来，没地址时就成了「认不出」。
      expect(resolveTaskStatus(fixture.success, responseMappingOf(mapping.query), mapping.statusMapping, [])).toEqual({ status: "succeeded", unrecognizedStatus: "" });
      if (mapping.result) {
        const fetched = read(fixture.result, mapping.result);
        expect(fetched.assetUrls).toEqual([fixture.url ?? MP4]);
      } else {
        expect(queried.assetUrls).toEqual([fixture.url ?? MP4]);
      }
    });

    it("进行中：非终态，不取地址", () => {
      const running = read(fixture.running, mapping.query);
      expect(["queued", "running"]).toContain(running.status);
      expect(running.assetUrls).toEqual([]);
    });

    it("状态词认不出：不判失败", () => {
      const statusPath = String(responseMappingOf(mapping.query)?.status ?? "status");
      const unknown = read(withUnknownStatus(fixture.running, statusPath), mapping.query);
      expect(unknown.status).not.toBe("failed");
    });
  },
);

// V-1213 验收反例（合并阻断：花钱生成视频却拿到一张图）。三条都在 merge-base 上取对、在修复前的 HEAD 上取错——
// 期望媒体类型优先，明确的视频结果字段压过顶层辅助地址；回显的参考图一律排除，合同字段也不例外。
// 合同读到的地址与通用规则过同一道筛（回显 + 类型），两台引擎经同一个 readTaskResponse；引擎 B 的同一用例见
// capabilityCore/apimartGenerationProvider.test.ts「引擎 B 取产物：合同字段回显的参考图不当产物」。
describe("结果误选反例（V-1213）：两台引擎同一组", () => {
  const REF = "https://fixture.invalid/reference.png";
  const VIDEO = "https://fixture.invalid/paid-result.mp4";
  const cases: Array<{ name: string; response: unknown; mapping: JsonRecord | null; expected: string[] }> = [
    {
      name: "顶层 poster（无扩展名）+ data.result.videos 里的真 mp4 → 取 mp4",
      response: { status: "completed", url: "https://fixture.invalid/poster", data: { result: { videos: [{ url: [VIDEO] }] } } },
      mapping: null,
      expected: [VIDEO],
    },
    {
      name: "合同 video_url 指向回显的参考图 → 不当产物",
      response: { status: "success", output: REF },
      mapping: { video_url: "output" },
      expected: [],
    },
    {
      name: "顶层无扩展名辅助 url + 明确的 video_url → 取 video_url",
      response: { status: "success", url: "https://fixture.invalid/poster", video_url: VIDEO },
      mapping: null,
      expected: [VIDEO],
    },
    {
      name: "类型证据先于字段名：result_url 是看不出类型的辅助地址、output.url 是明确的 mp4 → 取 mp4",
      response: { status: "success", result_url: "https://fixture.invalid/landing", output: { url: VIDEO } },
      mapping: null,
      expected: [VIDEO],
    },
  ];

  it.each(cases)("引擎 A（readTaskResponse）：$name", ({ response, mapping, expected }) => {
    expect(readTaskResponse({ response, responseMapping: mapping, statusMapping: undefined, wantedKind: "video", echoUrls: new Set([REF]) }).assetUrls).toEqual(expected);
  });

  // 引擎 A 的回显来源照 runtime.buildProfileTaskResult 的组法：requestEchoUrls(request.extras)。
  const ECHO_RESPONSE = { status: "success", output: REF };
  const ECHO_CONTRACT = { status: "status", video_url: "output" };
  it("引擎 A 同一用例（进程内，请求 extras 里带着参考图）：合同位置回显 → 不当产物", () => {
    const extras = { modelKey: "kling-v3", imageUrls: [REF] };
    expect(readTaskResponse({ response: ECHO_RESPONSE, responseMapping: ECHO_CONTRACT, statusMapping: undefined, wantedKind: "video", echoUrls: requestEchoUrls(extras) }).assetUrls).toEqual([]);
  });
  it("引擎 A 同一用例（重启后无状态重建，extras 里没有参考图）：视频任务的合同位置给 .png → 按类型不收", () => {
    const rebuiltExtras = { modelKey: "kling-v3", archetype: { modeId: "i2v" } };
    expect(readTaskResponse({ response: ECHO_RESPONSE, responseMapping: ECHO_CONTRACT, statusMapping: undefined, wantedKind: "video", echoUrls: requestEchoUrls(rebuiltExtras) }).assetUrls).toEqual([]);
  });

  it("引擎 B（制作 Run 的 provider.materialize，没有上下文、不知道期望类型）：顶层 poster 不抢真 mp4，产物种类是 video", async () => {
    const provider = createCatalogGenerationProvider({
      vendorKey: "v1213",
      resolveConnection: () => ({ apiKey: "synthetic" }),
      catalogReader: () => ({ vendors: [], models: [], mappings: [], apiKeysByVendor: {} }) as unknown as CatalogState,
    });
    const result = await provider.materialize!({ providerTaskId: "synthetic-task", raw: cases[0].response });
    expect(result.outputs.map((output) => ({ url: output.url, kind: output.kind }))).toEqual([{ url: VIDEO, kind: "video" }]);
  });
});
