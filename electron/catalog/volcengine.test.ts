import { describe, expect, it } from "vitest";
import { VOLCENGINE_VENDOR_SEED } from "./volcengineVendor";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";

// 形状锁：来自 2026-06-19 真实 API 验证（用户 key，doubao-seedream-5-0-260128 出图）。
// 真实成功响应（同步，无 task_id）：
const SYNC_OK = { model: "doubao-seedream-5-0-260128", created: 1, data: [{ url: "https://tos/x.jpeg", size: "2048x2048" }], usage: {} };

describe("火山 Seedream 接入（真实 API 形状锁·同步）", () => {
  it("vendor 种子：裸 baseUrl + bearer", () => {
    expect(VOLCENGINE_VENDOR_SEED.key).toBe("volcengine");
    expect(VOLCENGINE_VENDOR_SEED.baseUrl).toBe("https://ark.cn-beijing.volces.com");
    expect(VOLCENGINE_VENDOR_SEED.authType).toBe("bearer");
  });

  it("Seedream 全 family（5.0/4.5/4.0）：同步 create（无 query），结果在 data.0.url", () => {
    expect(VOLCENGINE_IMAGE_MODELS).toHaveLength(3);
    expect(VOLCENGINE_IMAGE_MODELS.map((m) => m.modelKey)).toEqual([
      "doubao-seedream-5-0-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828",
    ]);
    for (const model of VOLCENGINE_IMAGE_MODELS) {
      expect(model.archetypeId).toBe("volcengine-seedream");
      const create = model.mappings[0].create;
      expect(model.mappings[0].taskKind).toBe("text_to_image");
      expect(create.path).toBe("/api/v3/images/generations");
      expect(create.response_mapping?.image_url).toBe("data.0.url");
      // 同步族：create 不声明 task_id（无轮询）。
      expect(create.response_mapping?.task_id).toBeUndefined();
      const body = create.body as Record<string, unknown>;
      expect(body.size).toBe("{{request.params.size}}");
      expect(body.watermark).toBe(false); // 默认去「AI生成」角标
    }
  });

  it("真实同步响应经 runtime 解析器：有图即 succeeded（无 status 字段也不卡 queued）", () => {
    const rm = VOLCENGINE_IMAGE_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    // assetUrls 传入提取到的图 → taskStatusFromResponse 命中「有图即成」兜底（responseParsing line99）。
    expect(taskStatusFromResponse(SYNC_OK, rm, undefined, ["https://tos/x.jpeg"])).toBe("succeeded");
  });
});

describe("火山 Seedance 接入（官方 Video Generation API 形状锁·异步）", () => {
  const CREATE_OK = { id: "cgt-2025-abc" };
  const QUERY_OK = {
    id: "cgt-2025-abc",
    model: "doubao-seedance-2-0-260128",
    status: "succeeded",
    content: { video_url: "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/out.mp4" },
  };

  it("Seedance 2.0：一个 catalog 行 + text/image 两条 mapping，轮询读 content.video_url", () => {
    expect(VOLCENGINE_VIDEO_MODELS).toHaveLength(1);
    const model = VOLCENGINE_VIDEO_MODELS[0];
    expect(model).toMatchObject({
      modelKey: "doubao-seedance-2-0-260128",
      labelZh: "Seedance 2.0",
      archetypeId: "volcengine-seedance-2",
    });
    expect(model.mappings.map((m) => [m.id, m.taskKind])).toEqual([
      ["seed-volcengine-seedance-2-text_to_video", "text_to_video"],
      ["seed-volcengine-seedance-2-image_to_video", "image_to_video"],
    ]);
    for (const mapping of model.mappings) {
      expect(mapping.create.path).toBe("/api/v3/contents/generations/tasks");
      expect(mapping.create.response_mapping?.task_id).toBe("id");
      expect(mapping.create.provider_meta_mapping?.task_id).toBe("id");
    }
    expect(VOLCENGINE_SEEDANCE_QUERY_OP.path).toBe("/api/v3/contents/generations/tasks/{{providerMeta.task_id}}");
    expect(VOLCENGINE_SEEDANCE_QUERY_OP.response_mapping?.video_url).toBe("content.video_url");
  });

  it("图生 create：content 由文本 + 当前模式 content item 占位符组成", () => {
    const i2v = VOLCENGINE_VIDEO_MODELS[0].mappings.find((m) => m.id.endsWith("image_to_video"))!;
    const content = ((i2v.create.body as { content: unknown[] }).content) as Array<Record<string, unknown> | string>;
    expect(content).toEqual([
      { type: "text", text: "{{request.prompt}}" },
      "{{request.params.volcengine_first_image_content}}",
      "{{request.params.volcengine_first_role_image_content}}",
      "{{request.params.volcengine_last_role_image_content}}",
      "{{request.params.volcengine_image_contents}}",
      "{{request.params.volcengine_video_contents}}",
      "{{request.params.volcengine_audio_contents}}",
    ]);
  });

  it("创建响应用 id 作为 task_id；查询响应 content.video_url → succeeded video asset", () => {
    const createMap = VOLCENGINE_VIDEO_MODELS[0].mappings[0].create.response_mapping as Record<string, unknown>;
    expect(firstMappedString(CREATE_OK, createMap, "task_id")).toBe("cgt-2025-abc");

    const queryMap = VOLCENGINE_SEEDANCE_QUERY_OP.response_mapping as Record<string, unknown>;
    const video = firstMappedString(QUERY_OK, queryMap, "video_url");
    expect(video).toBe("https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/out.mp4");
    expect(collectAssetUrls(video)).toEqual(["https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/out.mp4"]);
    expect(taskStatusFromResponse(QUERY_OK, queryMap, undefined, [video])).toBe("succeeded");
  });
});
