import { describe, it, expect } from "vitest";
import { imageEditGuardError, reachableModeSuggestion } from "./taskParamsGuard";
import type { ModelModeBody } from "./referenceReachability";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { NEWAPI_VIDEO_CREATE_OP } from "./newapiTransport";

// 交付4 · 拒发建议：L3 闸拒发后附「可走的路」——从同一套 mapping 数据 derive，点名哪个模式带得动携带的参考，
// 或老实说没有。判据与 bodyReferenceSupport 同源，不 hardcode 任何 vendor 串。

const ROLE = "https://cdn.example.com/role-1.png";
const ROLE_2 = "https://cdn.example.com/role-2.png";
const VIDEO = "https://cdn.example.com/move.mp4";

// 真实 seedance 2.5：t2v（无参考）+ i2v（image_urls 数组 + video_urls + audio_urls，多图）。
const seedance = APIMART_VIDEO_MODELS.find((m) => m.modelKey === "doubao-seedance-2.5")!;
const seedanceModes: ModelModeBody[] = seedance.mappings.map((m) => ({ taskKind: m.taskKind, body: m.create.body }));
const SEEDANCE_I2V_BODY = seedance.mappings.find((m) => m.taskKind === "image_to_video")!.create.body;

describe("reachableModeSuggestion（纯函数）", () => {
  it("携带多张参考图、有 i2v(image_urls 多图)模式 → 点名该模式且标『支持多张参考图』", () => {
    // 当前走通用中转 body（发不出多图）被判拒；建议应指向 seedance 自己的 i2v。failedBody = 那条失败的 body。
    const suggestion = reachableModeSuggestion(
      { extras: { archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      NEWAPI_VIDEO_CREATE_OP.body,
      seedanceModes,
    );
    expect(suggestion).toContain("图生视频");
    expect(suggestion).toContain("支持多张参考图");
    expect(suggestion).toContain("参考图");
  });

  it("携带参考视频（运镜）→ 点名带 video_urls 的 i2v 模式", () => {
    const suggestion = reachableModeSuggestion(
      { extras: { archetypeInput: { video_urls: [VIDEO] } } },
      NEWAPI_VIDEO_CREATE_OP.body,
      seedanceModes,
    );
    expect(suggestion).toContain("图生视频");
    expect(suggestion).toContain("参考视频");
  });

  it("一个模式都带不动携带的参考 → 老实说没有 + 指路 list_models（不谎称有路）", () => {
    // 只有一个纯文生 body 的模型，携带参考图 → 无任何模式覆盖。
    const onlyTextMode: ModelModeBody[] = [{ taskKind: "text_to_image", body: { size: "{{request.params.size}}" } }];
    const suggestion = reachableModeSuggestion(
      { extras: { archetypeInput: { image_urls: [ROLE] } } },
      undefined,
      onlyTextMode,
    );
    expect(suggestion).toContain("没有任何模式");
    expect(suggestion).toContain("nomi_list_models");
    expect(suggestion).toContain("参考图");
  });

  it("没带任何参考 → 空建议（无可推荐、也无需推荐）", () => {
    expect(reachableModeSuggestion({ extras: { duration: 5 } }, NEWAPI_VIDEO_CREATE_OP.body, seedanceModes)).toBe("");
  });

  it("未注入 modeBodies → 空建议（保持既有拒发语义，不强行编）", () => {
    expect(reachableModeSuggestion({ extras: { archetypeInput: { image_urls: [ROLE] } } }, NEWAPI_VIDEO_CREATE_OP.body, undefined)).toBe("");
  });

  it("排除的是刚失败的那条 body 本身（按序列化相等），不是按 taskKind——同 taskKind 的其它可行 body 仍被推荐", () => {
    // 当前失败的是通用中转 i2v body；seedance 自己的 i2v body（同 taskKind）读得到多图 → 仍要推荐它。
    const suggestion = reachableModeSuggestion(
      { extras: { archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      NEWAPI_VIDEO_CREATE_OP.body,
      [{ taskKind: "image_to_video", body: SEEDANCE_I2V_BODY }],
    );
    expect(suggestion).toContain("图生视频");
    expect(suggestion).toContain("支持多张参考图");
  });

  it("唯一的可选 body 恰是刚失败的那条 → 排除后落到「没有任何模式」（不推荐失败者自己）", () => {
    const suggestion = reachableModeSuggestion(
      { extras: { archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      SEEDANCE_I2V_BODY,
      [{ taskKind: "image_to_video", body: SEEDANCE_I2V_BODY }],
    );
    expect(suggestion).toContain("没有任何模式");
  });
});

describe("imageEditGuardError — 拒发时附建议（第三闸，语义/零扣费不变）", () => {
  it("通用中转发不出多图 + 提供 seedance 各模式 body → 拒发文案后追加 i2v 多图建议", () => {
    // 当前走通用中转最小模板（只有单图聚合位），携带 2 张参考图 → 第 2 张发不出 → 拒发。
    const error = imageEditGuardError(
      "image_to_video",
      { extras: { referenceImages: [ROLE, ROLE_2], archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      true,
      "Seedance 2.5",
      NEWAPI_VIDEO_CREATE_OP.body,
      seedanceModes,
    );
    expect(error).toContain("发不出"); // 既有拒发主句仍在
    expect(error).toContain("Seedance 2.5");
    expect(error).toContain("图生视频"); // 追加的建议点名模式
    expect(error).toContain("支持多张参考图");
  });

  it("不提供 modeBodies → 拒发文案与旧版逐字不变（只在 body 读不到参考时触发）", () => {
    const error = imageEditGuardError(
      "image_to_video",
      { extras: { referenceImages: [ROLE, ROLE_2], archetypeInput: { image_urls: [ROLE, ROLE_2] } } },
      true,
      "某中转模型",
      NEWAPI_VIDEO_CREATE_OP.body,
    );
    expect(error).toBe(
      `模型「某中转模型」在这个接入方式下发不出：参考图。连上的这些素材不会进入请求——为免白扣费这次不发。请断开它们，或换一个支持这些参考的渠道/模型。`,
    );
  });
});
