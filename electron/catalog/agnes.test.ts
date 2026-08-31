import { describe, expect, it } from "vitest";
import { AGNES_VENDOR_SEED, AGNES_VIDEO_QUERY_OP, AGNES_STATUS_MAPPING } from "./agnesVendor";
import { AGNES_IMAGE_MODELS } from "./agnesImages";
import { AGNES_VIDEO_MODELS } from "./agnesVideos";
import { AGNES_TEXT_MODELS } from "./agnesTexts";
import { applyParamMap, agnesVideoWidth, agnesVideoHeight, agnesVideoNumFrames } from "./paramTranslate";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";

// 形状锁：照 wiki.agnes-ai.com/en/docs/*.md 官方文档的真实响应形状（R5 抓）。mock 坐实线缆形状，
// 不需真 key——live E2E（需用户 AGNES key）另验数字字段被网关接受 + extra_body 嵌套解析。

describe("Agnes 供应商种子", () => {
  it("裸 baseUrl + bearer（避 joinUrl 双前缀，文本走 /v1 由 buildLanguageModelForVendor 补）", () => {
    expect(AGNES_VENDOR_SEED.key).toBe("agnes");
    expect(AGNES_VENDOR_SEED.baseUrl).toBe("https://apihub.agnes-ai.com"); // 裸，不带 /v1
    expect(AGNES_VENDOR_SEED.authType).toBe("bearer");
  });
});

describe("Agnes 文本大脑", () => {
  it("agnes-2.0-flash：免费 agent 大脑（无 mapping，直连 chat）", () => {
    expect(AGNES_TEXT_MODELS.map((m) => m.modelKey)).toEqual(["agnes-2.0-flash"]);
  });
});

describe("Agnes 图片（同步 create，形状锁）", () => {
  const SYNC_OK = { created: 1780000000, data: [{ url: "https://storage.googleapis.com/agnes-aigc/x.png", b64_json: null }] };

  it("2.0 + 2.1 两款，共用 agnes-image 档案；t2i/edit 两条 mapping，结果在 data.0.url", () => {
    expect(AGNES_IMAGE_MODELS.map((m) => m.modelKey)).toEqual(["agnes-image-2.1-flash", "agnes-image-2.0-flash"]);
    for (const model of AGNES_IMAGE_MODELS) {
      expect(model.archetypeId).toBe("agnes-image");
      expect(model.mappings.map((m) => m.taskKind)).toEqual(["text_to_image", "image_edit"]);
      for (const mp of model.mappings) {
        expect(mp.create.path).toBe("/v1/images/generations");
        expect(mp.create.response_mapping?.image_url).toBe("data.0.url");
        expect(mp.create.response_mapping?.task_id).toBeUndefined(); // 同步族，无轮询
      }
    }
  });

  it("AGNES quirk：response_format 在 extra_body 内；edit 参考图进 extra_body.image（非顶层）", () => {
    const model = AGNES_IMAGE_MODELS[0];
    const t2i = model.mappings[0].create.body as { size: unknown; extra_body: Record<string, unknown> };
    expect(t2i.extra_body.response_format).toBe("url");
    expect(t2i.extra_body.image).toBeUndefined(); // 文生图无输入图
    expect(t2i.size).toBe("{{request.params.size}}");

    const edit = model.mappings[1].create.body as { extra_body: Record<string, unknown> };
    expect(edit.extra_body.image).toBe("{{request.params.image}}"); // 输入图数组进 extra_body
    expect(edit.extra_body.response_format).toBe("url");
  });

  it("真实同步响应经 runtime 解析器：有图即 succeeded", () => {
    const rm = AGNES_IMAGE_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    const url = firstMappedString(SYNC_OK, rm, "image_url");
    expect(url).toBe("https://storage.googleapis.com/agnes-aigc/x.png");
    expect(taskStatusFromResponse(SYNC_OK, rm, undefined, [url])).toBe("succeeded");
  });
});

describe("Agnes 视频（异步 create→poll，形状锁 + 两个 quirk）", () => {
  const CREATE_OK = { id: "task_abc", task_id: "task_abc", video_id: "video_xyz", status: "queued" };
  // 成品 URL 在反常字段 remixed_from_video_id（非 video_url），status=completed。
  const QUERY_OK = {
    id: "task_abc", video_id: "video_xyz", status: "completed", progress: 100,
    remixed_from_video_id: "https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4", error: null,
  };

  it("单款 v2.0；t2v/i2v 两条 mapping；提交抓 video_id 进 providerMeta；frame_rate 字面量 24", () => {
    expect(AGNES_VIDEO_MODELS).toHaveLength(1);
    const model = AGNES_VIDEO_MODELS[0];
    expect(model).toMatchObject({ modelKey: "agnes-video-v2.0", archetypeId: "agnes-video" });
    expect(model.mappings.map((m) => [m.id, m.taskKind])).toEqual([
      ["seed-agnes-video-v2-text_to_video", "text_to_video"],
      ["seed-agnes-video-v2-image_to_video", "image_to_video"],
    ]);
    for (const mp of model.mappings) {
      expect(mp.create.path).toBe("/v1/videos");
      expect(mp.create.response_mapping?.task_id).toBe("video_id");
      expect(mp.create.provider_meta_mapping?.video_id).toBe("video_id");
      expect((mp.create.body as { frame_rate: unknown }).frame_rate).toBe(24); // 数字字面量，非模板
    }
    // i2v 多一个顶层 image 字段（单图首帧）。
    const i2v = model.mappings[1].create.body as Record<string, unknown>;
    expect(i2v.image).toBe("{{request.params.image}}");
  });

  it("quirk①：轮询 op 是 /agnesapi（非 /v1）+ video_id 走 query 参数", () => {
    expect(AGNES_VIDEO_QUERY_OP.method).toBe("GET");
    expect(AGNES_VIDEO_QUERY_OP.path).toBe("/agnesapi");
    expect((AGNES_VIDEO_QUERY_OP.query as Record<string, unknown>)?.video_id).toBe("{{providerMeta.video_id}}");
  });

  it("quirk②：成品 URL 从反常字段 remixed_from_video_id 取（extractAssetUrl 兜底不到，靠显式映射）", () => {
    const createMap = AGNES_VIDEO_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    expect(firstMappedString(CREATE_OK, createMap, "task_id")).toBe("video_xyz");

    const queryMap = AGNES_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    const video = firstMappedString(QUERY_OK, queryMap, "video_url");
    expect(video).toBe("https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4");
    expect(collectAssetUrls(video)).toEqual(["https://storage.googleapis.com/agnes-aigc/aigc/videos/out.mp4"]);
    // status "completed" 经 AGNES_STATUS_MAPPING 归一 succeeded。
    expect(taskStatusFromResponse(QUERY_OK, queryMap, AGNES_STATUS_MAPPING, [video])).toBe("succeeded");
  });

  it("status 归一：queued→queued、in_progress→running、failed→failed", () => {
    const queryMap = AGNES_VIDEO_QUERY_OP.response_mapping as Record<string, unknown>;
    expect(taskStatusFromResponse({ status: "queued" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("queued");
    expect(taskStatusFromResponse({ status: "in_progress" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("running");
    expect(taskStatusFromResponse({ status: "failed", error: "boom" }, queryMap, AGNES_STATUS_MAPPING, [])).toBe("failed");
  });
});

describe("Agnes 视频 paramMap 派生（D1：比例+清晰度+时长 → width/height/num_frames）", () => {
  // ⚠️ 返回**数字**：AGNES Go 后端 int 严格(发字符串 400,2026-06-30 live 实测)。
  it("transform：16:9 @720p → 1280×720；9:16 @720p → 720×1280；1:1 @1080p → 1080×1080（数字）", () => {
    expect([agnesVideoWidth(["16:9", "720p"]), agnesVideoHeight(["16:9", "720p"])]).toEqual([1280, 720]);
    expect([agnesVideoWidth(["9:16", "720p"]), agnesVideoHeight(["9:16", "720p"])]).toEqual([720, 1280]);
    expect([agnesVideoWidth(["1:1", "1080p"]), agnesVideoHeight(["1:1", "1080p"])]).toEqual([1080, 1080]);
  });

  it("transform：时长→num_frames 贴最近 8n+1（5s→121，10s→241，clamp ≤441，数字）", () => {
    expect(agnesVideoNumFrames(["5"])).toBe(121); // 5×24=120 → 8×15+1
    expect(agnesVideoNumFrames(["10"])).toBe(241);
    expect(agnesVideoNumFrames(["30"])).toBe(441); // clamp 上限
    expect(((Number(agnesVideoNumFrames(["3"])) - 1) % 8)).toBe(0); // 始终 8n+1
  });

  it("applyParamMap 套到 create.paramMap：注入数字 width/height/num_frames，原 canonical 键保留", () => {
    const paramMap = AGNES_VIDEO_MODELS[0].mappings[0].create.paramMap;
    const out = applyParamMap(paramMap, { aspect_ratio: "16:9", resolution: "1080p", duration: "5" });
    expect(out.width).toBe(1920);
    expect(out.height).toBe(1080);
    expect(out.num_frames).toBe(121);
  });
});
