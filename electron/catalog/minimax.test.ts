import { describe, expect, it } from "vitest";
import { MINIMAX_VENDOR_SEED, MINIMAX_VIDEO_QUERY_OP, MINIMAX_STATUS_MAPPING } from "./minimaxVendor";
import { MINIMAX_VIDEO_MODELS } from "./minimaxVideos";
import { MINIMAX_TEXT_MODELS } from "./minimaxTexts";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";

// 形状锁：照 platform.minimaxi.com 官方文档 + 2026-08-29 真 key curl 的真实请求/响应形状（R5 抓）。
// mock 坐实线缆形状，不需真 key——live E2E（需用户 MiniMax key）另验真实 mp4 落盘。

describe("MiniMax 供应商种子", () => {
  it("裸 baseUrl + bearer（避 joinUrl 双前缀；文本 /v1 由 buildLanguageModelForVendor 补，视频 op 自带 /v2 前缀）", () => {
    expect(MINIMAX_VENDOR_SEED.key).toBe("minimax");
    expect(MINIMAX_VENDOR_SEED.baseUrl).toBe("https://api.minimaxi.com"); // 裸，不带 /v1
    expect(MINIMAX_VENDOR_SEED.authType).toBe("bearer");
    expect(MINIMAX_VENDOR_SEED.authHeader).toBe("Authorization");
  });
});

describe("MiniMax 文本大脑", () => {
  it("MiniMax-M1：OpenAI 兼容 chat（无 mapping，直连 /v1/chat/completions）", () => {
    expect(MINIMAX_TEXT_MODELS.map((m) => m.modelKey)).toEqual(["MiniMax-M1"]);
  });
});

describe("MiniMax H3 视频（官方 V2 create→poll，形状锁）", () => {
  // V2 创建响应扁平 { task_id }；轮询结果在 task.content.url。
  const CREATE_OK = { task_id: "task_abc" };
  const QUERY_OK = {
    task: { id: "task_abc", status: "succeeded", content: { url: "https://cdn.minimaxi.com/out.mp4" }, error: null },
  };

  it("单款 H3；t2v 一条 mapping；V2 用 content 多模态数组（非扁平 prompt）+ ratio 比例字段", () => {
    expect(MINIMAX_VIDEO_MODELS).toHaveLength(1);
    const model = MINIMAX_VIDEO_MODELS[0];
    expect(model).toMatchObject({ modelKey: "MiniMax-H3", archetypeId: "hailuo-h3" });
    expect(model.mappings.map((m) => [m.id, m.taskKind])).toEqual([
      ["seed-minimax-hailuo-h3-text_to_video", "text_to_video"],
    ]);
    const create = model.mappings[0].create;
    expect(create.path).toBe("/v2/video_generation");
    expect(create.response_mapping?.task_id).toBe("task_id");
    expect(create.provider_meta_mapping?.task_id).toBe("task_id");

    const body = create.body as { model: unknown; content: Array<{ type: string; text: string }>; resolution: unknown; duration: unknown; ratio: unknown };
    expect(body.model).toBe("{{model.modelKey}}");
    expect(body.content).toEqual([{ type: "text", text: "{{request.prompt}}" }]);
    expect(body.resolution).toBe("{{request.params.resolution}}");
    expect(body.duration).toBe("{{request.params.duration}}");
    expect(body.ratio).toBe("{{request.params.ratio}}"); // V2 t2v ratio 必填非 adaptive
  });

  it("轮询 op：GET /v2/query/video_generation/{task_id}（task_id 走路径参数，非 query）", () => {
    expect(MINIMAX_VIDEO_QUERY_OP.method).toBe("GET");
    expect(MINIMAX_VIDEO_QUERY_OP.path).toBe("/v2/query/video_generation/{{providerMeta.task_id}}");
    const qm = MINIMAX_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    expect(qm.task_id).toBe("task.id");
    expect(qm.status).toBe("task.status");
    expect(qm.video_url).toBe("task.content.url");
  });

  it("真实 V2 响应经 runtime 解析器：task_id 抓任务、task.content.url 抓成品、status 归一 succeeded", () => {
    const createMap = MINIMAX_VIDEO_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    expect(firstMappedString(CREATE_OK, createMap, "task_id")).toBe("task_abc");

    const queryMap = MINIMAX_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    const video = firstMappedString(QUERY_OK, queryMap, "video_url");
    expect(video).toBe("https://cdn.minimaxi.com/out.mp4");
    expect(collectAssetUrls(video)).toEqual(["https://cdn.minimaxi.com/out.mp4"]);
    expect(taskStatusFromResponse(QUERY_OK, queryMap, MINIMAX_STATUS_MAPPING, [video])).toBe("succeeded");
  });

  it("status 归一：queued→queued、processing→running、failed→failed", () => {
    const queryMap = MINIMAX_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    expect(taskStatusFromResponse({ task: { status: "queued" } }, queryMap, MINIMAX_STATUS_MAPPING, [])).toBe("queued");
    expect(taskStatusFromResponse({ task: { status: "processing" } }, queryMap, MINIMAX_STATUS_MAPPING, [])).toBe("running");
    expect(taskStatusFromResponse({ task: { status: "failed", error: { message: "boom" } } }, queryMap, MINIMAX_STATUS_MAPPING, [])).toBe("failed");
  });
});
