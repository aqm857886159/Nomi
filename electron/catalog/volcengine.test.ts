import { describe, expect, it } from "vitest";
import { VOLCENGINE_VENDOR_SEED } from "./volcengineVendor";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { VOLCENGINE_SEEDANCE_QUERY_OP, VOLCENGINE_VIDEO_MODELS } from "./volcengineVideos";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";
import { hostRootJoin, joinUrl } from "../ai/requestPipeline";
import { deriveVendorKeyFromBaseUrl } from "./catalogCommit";

// 形状锁：来自 2026-06-19 真实 API 验证（用户 key，doubao-seedream-5-0-260128 出图）。
// 真实成功响应（同步，无 task_id）：
const SYNC_OK = { model: "doubao-seedream-5-0-260128", created: 1, data: [{ url: "https://tos/x.jpeg", size: "2048x2048" }], usage: {} };

describe("火山 Seedream 接入（真实 API 形状锁·同步）", () => {
  // baseUrl 从裸 host 改成官方口径 `.../api/v3`（2026-08-26），与 providerPresets 的火山那条统一
  // —— 两份地址各说各话时，向导接入会按 hostname 另立 `ark-cn-beijing-volces-com` 供应商，
  // 同一家劈成两个柜子、向导那半个拿不到任何内置 mapping（症状：接了火山但没有图生图）。
  // 断言落在**解析出来的 URL**上而不是 baseUrl 字面串：真正要保证的是端点落位，不是地址怎么写。
  it("vendor 种子：官方口径 baseUrl + bearer，且原生端点仍精确落位", () => {
    expect(VOLCENGINE_VENDOR_SEED.key).toBe("volcengine");
    expect(VOLCENGINE_VENDOR_SEED.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/v3");
    expect(VOLCENGINE_VENDOR_SEED.authType).toBe("bearer");
    // 原生（host-root）：不出现 /api/api/v3。
    expect(hostRootJoin(VOLCENGINE_VENDOR_SEED.baseUrl, "/api/v3/images/generations")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
    expect(hostRootJoin(VOLCENGINE_VENDOR_SEED.baseUrl, "/api/v3/contents/generations/tasks")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks",
    );
    // 文本（普通 /v1 命名空间）：不出现 /api/v3/v1。
    expect(joinUrl(VOLCENGINE_VENDOR_SEED.baseUrl, "/v1/chat/completions")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    );
  });

  it("向导接入火山不再另立一个供应商（同一 host → 内置 volcengine）", () => {
    expect(deriveVendorKeyFromBaseUrl("https://ark.cn-beijing.volces.com/api/v3")).toBe("volcengine");
    expect(deriveVendorKeyFromBaseUrl("https://ark.cn-beijing.volces.com")).toBe("volcengine");
    // 语音是**另一条产品线、另一套凭证**，必须仍然分家（别被 host 别名顺手合并了）。
    expect(deriveVendorKeyFromBaseUrl("https://openspeech.bytedance.com")).toBe("volcengine-speech");
    // 不认得的 host 仍走 hostname 派生（别名表不改变通用行为）。
    expect(deriveVendorKeyFromBaseUrl("https://relay.example.com/v1")).toBe("relay-example-com");
  });

  it("Seedream 全 family（5.0 pro/5.0 lite/4.5/4.0）：同步 create（无 query），结果在 data.0.url", () => {
    expect(VOLCENGINE_IMAGE_MODELS).toHaveLength(4);
    expect(VOLCENGINE_IMAGE_MODELS.map((m) => m.modelKey)).toEqual([
      "doubao-seedream-5-0-pro-260628",
      "doubao-seedream-5-0-260128",
      "doubao-seedream-4-5-251128",
      "doubao-seedream-4-0-250828",
    ]);
    // pro 与 lite/4.x 必须分档：像素域几乎不重叠（[921600,4624220] vs [3686400,16777216]），
    // 共用一份 size 清单必然有一边 400。见 seedreamVolcengine5Pro.ts。
    expect(VOLCENGINE_IMAGE_MODELS[0].archetypeId).toBe("volcengine-seedream-5-pro");
    // pro 独有 background（透明底）；lite/4.x 那条不发它。
    const proEdit = VOLCENGINE_IMAGE_MODELS[0].mappings[1].create.body as Record<string, unknown>;
    expect(proEdit.background).toBe("{{request.params.background}}");
    expect(proEdit.image).toBe("{{request.params.image_urls}}");
    expect(proEdit.sequential_image_generation).toBeUndefined();
    // 档案分工：pro 一档、lite/4.x 共一档（像素域不同，见上）。
    expect(VOLCENGINE_IMAGE_MODELS.map((m) => m.archetypeId)).toEqual([
      "volcengine-seedream-5-pro",
      "volcengine-seedream",
      "volcengine-seedream",
      "volcengine-seedream",
    ]);
    // 端点/响应/同步族形状全 family 一致（这才是「共用一条已验证 wire」的真正含义）。
    for (const model of VOLCENGINE_IMAGE_MODELS) {
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
    expect(VOLCENGINE_VIDEO_MODELS.map((m) => m.modelKey)).toEqual([
      "doubao-seedance-2-0-260128",
      "doubao-seedance-2-5-260628",
    ]);
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

  // 2026-08-26 照官方 doc 1520757 参数表逐项对账后**反转**了 2026-07-31 那次判断：
  // seed / camera_fixed 的支持列只列 1.5 pro / 1.0 pro / 1.0 pro fast，**2.0 系列与 2.5 都不支持**。
  // （那次是拿中转的交付文档对的账，中转文档把全 family 的字段并成了一张表 —— 一手出处才算数。）
  // 故两条 mapping 都不再发 seed；watermark 恒 false（官方视频默认就是 false，显式发保证不漂）。
  it("create body 不发 2.x 不支持的 seed / camera_fixed，watermark 恒 false", () => {
    for (const model of VOLCENGINE_VIDEO_MODELS) {
      for (const mapping of model.mappings) {
        const body = mapping.create.body as Record<string, unknown>;
        expect(body.seed, `${model.modelKey}/${mapping.id}`).toBeUndefined();
        expect(body.camera_fixed, `${model.modelKey}/${mapping.id}`).toBeUndefined();
        expect(body.watermark).toBe(false);
      }
    }
  });

  it("Seedance 2.5：独立 catalog 行 + 独有 output_format，共用异步轮询形状", () => {
    const model = VOLCENGINE_VIDEO_MODELS.find((m) => m.modelKey === "doubao-seedance-2-5-260628")!;
    expect(model.archetypeId).toBe("volcengine-seedance-2-5");
    expect(model.mappings.map((m) => [m.id, m.taskKind])).toEqual([
      ["seed-volcengine-seedance-2-5-text_to_video", "text_to_video"],
      ["seed-volcengine-seedance-2-5-image_to_video", "image_to_video"],
    ]);
    for (const mapping of model.mappings) {
      const body = mapping.create.body as Record<string, unknown>;
      expect(mapping.create.path).toBe("/api/v3/contents/generations/tasks");
      // 2.5 独有；2.0 那条不发（发了会被当未知字段）。
      expect(body.output_format).toBe("{{request.params.output_format}}");
      // 本轮不发 omni_reference_task_type：缺省 auto 即覆盖 reference 语义，edit/extend 下轮再做。
      expect(body.omni_reference_task_type).toBeUndefined();
    }
    for (const mapping of VOLCENGINE_VIDEO_MODELS[0].mappings) {
      expect((mapping.create.body as Record<string, unknown>).output_format).toBeUndefined();
    }
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
