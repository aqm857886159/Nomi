import { describe, expect, it } from "vitest";
import {
  WAN_3_0_CREATE_OP,
  WAN_3_0_MODEL_SEED,
  WAN_3_0_PRIME_MODEL_KEY,
  WAN_3_0_QUERY_OP,
  WAN_3_0_IMAGE_TO_VIDEO_MAPPING,
  WAN_3_0_TEXT_TO_VIDEO_MAPPING,
} from "./kieWan30";
import { WAN_3_0_ARCHETYPE } from "../shared/videoCapabilities/wan30";
import { collectAssetUrls, firstMappedString, taskStatusFromResponse } from "../tasks/responseParsing";
import { applyBuiltinSeeds } from "./seedBuiltins";
import type { CatalogState } from "./types";

// ---------------------------------------------------------------------------
// Wan 3.0（kie）报文形状锁。契约自 docs.kie.ai/market/wan/3-0-video{,-prime}.md（2026-08-26）。
// 重点验的是**结果取得出来**：kie 的 recordInfo 把结果塞在 `data.resultJson` 里，而它是一个
// **JSON 字符串**而不是对象。若路径遍历不解字符串，video_url 会恒为空 —— 任务显示成功、产物却没有，
// 是最难查的一类坏法。这里用真实形状的响应跑一遍生产解析器，把它钉死。
// ---------------------------------------------------------------------------

const body = () => WAN_3_0_CREATE_OP.body as { model: string; input: Record<string, unknown> };

describe("Wan 3.0 create 报文", () => {
  it("端点与 kie job API 一致，参数全部嵌在 input 下", () => {
    expect(WAN_3_0_CREATE_OP.method).toBe("POST");
    expect(WAN_3_0_CREATE_OP.path).toBe("/api/v1/jobs/createTask");
    expect(Object.keys(body())).toEqual(["model", "input"]);
  });

  it("model 走变体通道（不写死标准版，否则选了高速仍发标准）", () => {
    expect(body().model).toBe("{{request.params.model}}");
  });

  it("input 的键与官方字段表逐项对齐（拼错=静默丢，不报错）", () => {
    expect(Object.keys(body().input).sort()).toEqual(
      [
        "audio",
        "aspect_ratio",
        "duration",
        "first_frame_url",
        "last_frame_url",
        "prompt",
        "reference_audio_urls",
        "reference_image_urls",
        "reference_video_urls",
        "resolution",
        "seed",
      ].sort(),
    );
  });

  it("首/尾帧是裸串占位符（不是数组包装）", () => {
    expect(body().input.first_frame_url).toBe("{{request.params.first_frame_url}}");
    expect(body().input.last_frame_url).toBe("{{request.params.last_frame_url}}");
  });
});

describe("Wan 3.0 结果解析（resultJson 是 JSON 字符串这一坑）", () => {
  // 真实形状：官方回调/查询示例里 resultJson 是被转义过的 JSON 字符串。
  const RECORD_OK = {
    code: 200,
    data: {
      taskId: "task_wan_1765180586443",
      model: "wan/3-0-video",
      state: "success",
      resultJson: JSON.stringify({ resultUrls: ["https://tempfile.aiquickdraw.com/wan30-video.mp4"] }),
    },
  };

  it("video_url 能从 JSON 字符串里穿出来（不是恒空）", () => {
    const rm = WAN_3_0_QUERY_OP.response_mapping as Record<string, unknown>;
    expect(rm.video_url).toBe("data.resultJson.resultUrls.0");
    const url = firstMappedString(RECORD_OK, rm, "video_url");
    expect(url).toBe("https://tempfile.aiquickdraw.com/wan30-video.mp4");
    expect(collectAssetUrls(url)).toEqual(["https://tempfile.aiquickdraw.com/wan30-video.mp4"]);
  });

  // kie 全家**刻意不各自声明 statusMapping**（见 kieKling.ts 注释：kie 的状态词一致，
  // 统一并进 responseParsing 的通用词表，避免每家一份并行映射）。故这里传 undefined 是对的。
  it("状态归一：success → succeeded", () => {
    const rm = WAN_3_0_QUERY_OP.response_mapping as Record<string, unknown>;
    const url = firstMappedString(RECORD_OK, rm, "video_url");
    expect(taskStatusFromResponse(RECORD_OK, rm, undefined, [url])).toBe("succeeded");
  });

  // 负例：证明状态**真的是从 data.state 读出来的**，而不是「有产物就算成功」那条兜底在替它及格。
  // 没有这条，把 status 映射写错也照样绿——那是假绿。
  it("状态归一：fail → failed（且失败原因取 data.failMsg）", () => {
    const rm = WAN_3_0_QUERY_OP.response_mapping as Record<string, unknown>;
    const RECORD_FAIL = {
      code: 200,
      data: { taskId: "task_wan_x", model: "wan/3-0-video", state: "fail", failMsg: "内容审核未通过" },
    };
    expect(taskStatusFromResponse(RECORD_FAIL, rm, undefined, [])).toBe("failed");
    expect(rm.error_message).toBe("data.failMsg");
    expect(firstMappedString(RECORD_FAIL, rm, "error_message")).toBe("内容审核未通过");
  });

  it("排队态不被误判成终态（waiting → queued）", () => {
    const rm = WAN_3_0_QUERY_OP.response_mapping as Record<string, unknown>;
    const RECORD_WAIT = { code: 200, data: { taskId: "task_wan_x", state: "waiting" } };
    expect(taskStatusFromResponse(RECORD_WAIT, rm, undefined, [])).toBe("queued");
  });

  it("轮询按 taskId 查询（kie 的 recordInfo 用 query 参数不是路径段）", () => {
    expect(WAN_3_0_QUERY_OP.path).toBe("/api/v1/jobs/recordInfo");
    expect((WAN_3_0_QUERY_OP.query as Record<string, string>).taskId).toBe("{{providerMeta.task_id}}");
  });
});

describe("Wan 3.0 种子与档案对齐", () => {
  it("档案变体的 model id 与 catalog 常量一致（改一处漏另一处 = 选了高速仍发标准）", () => {
    const ids = WAN_3_0_ARCHETYPE.variants!.map((v) => v.modelKey);
    expect(ids).toContain(WAN_3_0_MODEL_SEED.modelKey);
    expect(ids).toContain(WAN_3_0_PRIME_MODEL_KEY);
  });

  it("两条 mapping（文生 / 图生）都种进 kie 且带轮询", () => {
    for (const mapping of [WAN_3_0_TEXT_TO_VIDEO_MAPPING, WAN_3_0_IMAGE_TO_VIDEO_MAPPING]) {
      expect(mapping.vendorKey).toBe("kie");
      expect(mapping.modelKey).toBe("wan/3-0-video");
      expect(mapping.query).toBeDefined();
    }
    expect(WAN_3_0_TEXT_TO_VIDEO_MAPPING.taskKind).toBe("text_to_video");
    expect(WAN_3_0_IMAGE_TO_VIDEO_MAPPING.taskKind).toBe("image_to_video");
  });

  it("种子跑完后 catalog 里确有 Wan 3.0 行 + 两条 mapping", () => {
    const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const state = applyBuiltinSeeds(empty, "2026-08-27T00:00:00.000Z").state;
    const model = state.models.find((m) => m.vendorKey === "kie" && m.modelKey === "wan/3-0-video");
    expect(model?.meta).toMatchObject({ archetypeId: "wan-3.0" });
    const kinds = state.mappings
      .filter((m) => m.vendorKey === "kie" && m.modelKey === "wan/3-0-video")
      .map((m) => m.taskKind)
      .sort();
    expect(kinds).toEqual(["image_to_video", "text_to_video"]);
    // 高速版**不该**另起一行（它是变体，不是独立模型）——多种一行就会在下拉里冒出重复项。
    expect(state.models.some((m) => m.modelKey === WAN_3_0_PRIME_MODEL_KEY)).toBe(false);
  });
});
