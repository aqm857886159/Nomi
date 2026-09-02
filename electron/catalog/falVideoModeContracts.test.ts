// fal 视频「每个模式一条自己的线缆」合同（U5）。
//
// 背景：`selectTaskMapping` 收紧前，单候选回落会把**另一个模式**的专属线缆递出去，于是
// fal 上 seedance-2.5 的 first/firstlast/omni 与 gemini-omni-1.1 的 firstlast 四个模式
// 全都在借 `i2v` / `reference` 的 body——首帧到得了、尾帧和多模态参考全掉地上，UI 却照常
// 显示「首尾帧」「全能参考」。本文件把「模式必须有自己的 modeId + body 与官方 schema 逐字段
// 一致 + 声明的槽真的送得出去」锁成结构测试，让借线缆**回不来**。
//
// 官方来源（2026-09-02 WebFetch 抓取，逐字段对账；无付费调用）：
//   https://fal.ai/models/bytedance/seedance-2.5/image-to-video/api
//     prompt* · image_url*(首帧) · end_image_url(选,尾帧) · resolution=720p · duration=auto ·
//     aspect_ratio=auto · generate_audio=true · bitrate_mode=standard · end_user_id
//     —— 无 image_urls / reference_*_urls。
//   https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api
//     prompt* · image_urls≤30 · video_urls≤10 · audio_urls≤10（跨模态合计≤50）· resolution ·
//     duration · aspect_ratio · generate_audio · bitrate_mode · end_user_id
//   https://fal.ai/models/google/gemini-omni-flash/v1.1/image-to-video/api
//     prompt* · image_url*("URL of the first frame to animate") ·
//     end_image_url(选,"interpolated into the optional end image") ·
//     aspect_ratio=16:9(16:9|9:16) · resolution=720p(360p|720p|1080p|4k) · duration=8
//     —— 无 image_urls / reference_video_urls。
import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import { FAL_OFFICIAL_MODELS, FAL_VENDOR_SEED } from "./falOfficial";
import { applyParamMap } from "./paramTranslate";
import { modeSlotReach } from "./referenceReachability";
import { taskTemplateParams } from "./taskParams";

/** 官方 schema 逐字段快照：endpoint → 该端点允许出现的 wire 键全集（我们 body 不得越界）。 */
const OFFICIAL_INPUT_KEYS: Record<string, string[]> = {
  "bytedance/seedance-2.5/image-to-video": [
    "prompt", "image_url", "end_image_url", "resolution", "duration", "aspect_ratio", "generate_audio", "bitrate_mode", "end_user_id",
  ],
  "bytedance/seedance-2.5/reference-to-video": [
    "prompt", "image_urls", "video_urls", "audio_urls", "resolution", "duration", "aspect_ratio", "generate_audio", "bitrate_mode", "end_user_id",
  ],
  "google/gemini-omni-flash/v1.1/image-to-video": [
    "prompt", "image_url", "end_image_url", "aspect_ratio", "resolution", "duration",
  ],
};

/**
 * 本轮补齐的四个 (modelKey, modeId) → 该模式必须命中的端点与必须送达的 wire 键。
 * `slots` 用档案里的 canonical 槽键（DEFAULT_SLOT_INPUT_KEY / 档案显式 inputKey），
 * 断言它们经 paramMap 之后真的落在 `wire` 上——这正是「借线缆」时会塌掉的那一段。
 */
const MODE_CONTRACTS = [
  {
    modelKey: "bytedance/seedance-2.5", modeId: "first",
    endpoint: "bytedance/seedance-2.5/image-to-video",
    slots: [{ kind: "first_frame", inputKey: "first_frame_url", url: "https://assets.test/first.png", wire: "image_url" }],
    absent: ["end_image_url", "image_urls"],
  },
  {
    modelKey: "bytedance/seedance-2.5", modeId: "firstlast",
    endpoint: "bytedance/seedance-2.5/image-to-video",
    slots: [
      { kind: "first_frame", inputKey: "first_frame_url", url: "https://assets.test/first.png", wire: "image_url" },
      { kind: "last_frame", inputKey: "last_frame_url", url: "https://assets.test/last.png", wire: "end_image_url" },
    ],
    absent: ["image_urls"],
  },
  {
    modelKey: "bytedance/seedance-2.5", modeId: "omni",
    endpoint: "bytedance/seedance-2.5/reference-to-video",
    slots: [
      { kind: "image_ref", inputKey: "reference_image_urls", url: ["https://assets.test/a.png", "https://assets.test/b.png"], wire: "image_urls" },
      { kind: "video_ref", inputKey: "reference_video_urls", url: ["https://assets.test/c.mp4"], wire: "video_urls" },
      { kind: "audio_ref", inputKey: "reference_audio_urls", url: ["https://assets.test/d.mp3"], wire: "audio_urls" },
    ],
    absent: ["image_url", "end_image_url"],
  },
  {
    modelKey: "google/gemini-omni-flash/v1.1", modeId: "firstlast",
    endpoint: "google/gemini-omni-flash/v1.1/image-to-video",
    slots: [
      { kind: "first_frame", inputKey: "first_frame_url", url: "https://assets.test/first.png", wire: "image_url" },
      { kind: "last_frame", inputKey: "last_frame_url", url: "https://assets.test/last.png", wire: "end_image_url" },
    ],
    absent: ["image_urls", "reference_video_urls"],
  },
] as const;

function findMapping(modelKey: string, modeId: string) {
  const model = FAL_OFFICIAL_MODELS.find((item) => item.modelKey === modelKey);
  return model?.mappings.find((item) => item.modeId === modeId);
}

describe("fal video modes each own a mode-specific wire (never borrowed)", () => {
  it("declares an explicit modeId on every fal mapping so no mode can silently borrow a sibling", () => {
    const missing = FAL_OFFICIAL_MODELS.flatMap((model) =>
      model.mappings.filter((item) => !item.modeId.trim()).map((item) => `${model.modelKey}/${item.name}`),
    );
    expect(missing).toEqual([]);
  });

  it("gives each (model, mode) in this unit its own mapping bound to the documented endpoint", () => {
    const violations: string[] = [];
    for (const contract of MODE_CONTRACTS) {
      const found = findMapping(contract.modelKey, contract.modeId);
      if (!found) {
        violations.push(`${contract.modelKey}/${contract.modeId}: no mapping`);
        continue;
      }
      if (found.create.path !== `/${contract.endpoint}`) {
        violations.push(`${contract.modelKey}/${contract.modeId}: endpoint ${found.create.path} != /${contract.endpoint}`);
      }
      // 两条模式不得共用同一条 mapping 对象（借线缆的物理形态）。
      if (found.modeId !== contract.modeId) {
        violations.push(`${contract.modelKey}/${contract.modeId}: modeId drifted to ${found.modeId}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps every fal create body inside the official input schema for its endpoint", () => {
    const violations: string[] = [];
    for (const model of FAL_OFFICIAL_MODELS) {
      for (const item of model.mappings) {
        const endpoint = item.create.path.replace(/^\//, "");
        const allowed = OFFICIAL_INPUT_KEYS[endpoint];
        if (!allowed) continue; // 只对本单元逐字段抓过官方文档的端点设防，不空口断言别的端点。
        const body = item.create.body as Record<string, unknown>;
        const extra = Object.keys(body).filter((key) => !allowed.includes(key));
        if (extra.length > 0) violations.push(`${endpoint}/${item.modeId}: undocumented wire keys ${extra.join(",")}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("carries every declared reference slot all the way to the documented wire key", () => {
    const violations: string[] = [];
    for (const contract of MODE_CONTRACTS) {
      const found = findMapping(contract.modelKey, contract.modeId);
      if (!found) continue;

      // ① 静态承载力：每个槽都必须 full（single = 挤单图聚合位 = 多图/尾帧塌掉的那种假绿）。
      const reach = modeSlotReach(
        contract.slots.map((slot) => ({ kind: slot.kind, inputKey: slot.inputKey })),
        found.create.body,
      );
      reach.forEach((value, index) => {
        if (value !== "full") violations.push(`${contract.modelKey}/${contract.modeId}: slot ${contract.slots[index]!.kind} reach=${value}`);
      });

      // ② 干跑：真的构造一次请求，逐字段比对官方键（本地假服务器不校验形状，干跑才抓得住）。
      const extras: Record<string, unknown> = { modelKey: contract.modelKey };
      for (const slot of contract.slots) extras[slot.inputKey] = slot.url;
      const request = { kind: found.taskKind, prompt: "a quiet sunrise", extras };
      const context = buildTemplateContext({
        request,
        params: applyParamMap(found.create.paramMap, taskTemplateParams(request)),
        model: { modelKey: contract.modelKey },
        modelKey: contract.modelKey,
        apiKey: "TEST_SECRET",
      });
      const built = buildHttpRequest({
        baseUrl: FAL_VENDOR_SEED.baseUrl,
        authType: "bearer",
        apiKey: "TEST_SECRET",
        context,
        operation: found.create,
      });
      const body = built.body as Record<string, unknown>;

      for (const slot of contract.slots) {
        expect.soft(body[slot.wire], `${contract.modelKey}/${contract.modeId} → ${slot.wire}`).toEqual(slot.url);
        if (body[slot.wire] === undefined) violations.push(`${contract.modelKey}/${contract.modeId}: ${slot.wire} not delivered`);
      }
      for (const key of contract.absent) {
        if (body[key] !== undefined) violations.push(`${contract.modelKey}/${contract.modeId}: ${key} must not appear on this endpoint`);
      }
      if (built.headers.Authorization !== "Key TEST_SECRET") {
        violations.push(`${contract.modelKey}/${contract.modeId}: fal auth header drifted`);
      }
      if (JSON.stringify(body).includes("TEST_SECRET")) {
        violations.push(`${contract.modelKey}/${contract.modeId}: secret leaked into body`);
      }
    }
    expect(violations).toEqual([]);
  });
});
