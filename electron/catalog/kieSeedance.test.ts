import { describe, it, expect } from "vitest";
import { appendQueryParams, buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import {
  KIE_VENDOR_SEED,
  SEEDANCE_2_CREATE_OP,
  SEEDANCE_2_MODEL_SEED,
  SEEDANCE_2_QUERY_OP,
} from "./kieSeedance";

// C1 薄垂直片：离线锁定 Seedance「首帧」经 kie.ai 的传输契约 —— 在不花额度、不打真实
// API 的前提下，证明我们 curated 的 mapping 渲染出的请求是对的。真实生成那一步另走（需用户 key）。
//
// 这份测试同时是 M4（轮询端点 + joinUrl 双前缀坑）的回归网兜：断言最终 URL 不出现
// ".../api/v1/api/v1/..."。

// 模拟 taskTemplateParams 对一个「首帧」请求产出的 params（first_frame_url + 标量）。
const FIRST_FRAME_URL = "https://example.com/first-frame.png";
const context = buildTemplateContext({
  request: { prompt: "一只猫在草地上奔跑" },
  params: {
    first_frame_url: FIRST_FRAME_URL,
    resolution: "720p",
    aspect_ratio: "16:9",
    duration: "5",
    generate_audio: false,
  },
  model: { modelKey: SEEDANCE_2_MODEL_SEED.modelKey },
  modelKey: SEEDANCE_2_MODEL_SEED.modelKey,
  apiKey: "SECRET",
  providerMeta: { task_id: "task_bytedance_123" },
});

describe("Seedance 2.0 · 首帧 — createTask 请求", () => {
  const built = buildHttpRequest({
    baseUrl: KIE_VENDOR_SEED.baseUrl,
    authType: KIE_VENDOR_SEED.authType,
    apiKey: "SECRET",
    context,
    operation: SEEDANCE_2_CREATE_OP,
  });

  it("URL 拼接正确，无双 /api/v1 前缀（M4）", () => {
    expect(built.url).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(built.url).not.toContain("/api/v1/api/v1");
  });

  it("body 用 model enum + 嵌套 input，首帧/标量都到位", () => {
    expect(built.body).toEqual({
      model: "bytedance/seedance-2",
      input: {
        prompt: "一只猫在草地上奔跑",
        first_frame_url: FIRST_FRAME_URL,
        resolution: "720p",
        aspect_ratio: "16:9",
        duration: "5",
        generate_audio: false,
      },
    });
  });

  it("鉴权头解析正确（不出现空 Bearer），预览里脱敏", () => {
    expect(built.headers.Authorization).toBe("Bearer SECRET");
    expect(built.preview.headers.Authorization).toBe("[redacted]");
  });
});

describe("Seedance 2.0 · 互斥投影（M2：首帧不发 last_frame_url）", () => {
  const inputOf = (op: typeof SEEDANCE_2_CREATE_OP, ctx: ReturnType<typeof buildTemplateContext>) => {
    const built = buildHttpRequest({ baseUrl: KIE_VENDOR_SEED.baseUrl, authType: KIE_VENDOR_SEED.authType, apiKey: "SECRET", context: ctx, operation: op });
    return (built.body as { input: Record<string, unknown> }).input;
  };

  it("首帧（params 无 last_frame_url）→ body 不含 last_frame_url（undefined 被丢弃）", () => {
    // 复用顶部 context（其 params 不含 last_frame_url）
    expect(inputOf(SEEDANCE_2_CREATE_OP, context)).not.toHaveProperty("last_frame_url");
  });

  it("首尾帧（params 有 last_frame_url）→ body 含 first/last 两帧", () => {
    const ctx = buildTemplateContext({
      request: { prompt: "过渡" },
      params: {
        first_frame_url: FIRST_FRAME_URL,
        last_frame_url: "https://example.com/last-frame.png",
        resolution: "720p",
        aspect_ratio: "16:9",
        duration: "5",
        generate_audio: false,
      },
      model: { modelKey: SEEDANCE_2_MODEL_SEED.modelKey },
      modelKey: SEEDANCE_2_MODEL_SEED.modelKey,
      apiKey: "SECRET",
    });
    const input = inputOf(SEEDANCE_2_CREATE_OP, ctx);
    expect(input.first_frame_url).toBe(FIRST_FRAME_URL);
    expect(input.last_frame_url).toBe("https://example.com/last-frame.png");
  });
});

describe("Seedance 2.0 · 全能参考（C3 数组槽 + §2 坑1 尾随空格键）", () => {
  const inputOf = (params: Record<string, unknown>) => {
    const ctx = buildTemplateContext({
      request: { prompt: "三个角色同框" },
      params,
      model: { modelKey: SEEDANCE_2_MODEL_SEED.modelKey },
      modelKey: SEEDANCE_2_MODEL_SEED.modelKey,
      apiKey: "SECRET",
    });
    const built = buildHttpRequest({ baseUrl: KIE_VENDOR_SEED.baseUrl, authType: KIE_VENDOR_SEED.authType, apiKey: "SECRET", context: ctx, operation: SEEDANCE_2_CREATE_OP });
    return (built.body as { input: Record<string, unknown> }).input;
  };

  it("数组按序透传；reference_video_urls 输出键带尾随空格（逐字符照抄 kie 文档）", () => {
    const input = inputOf({
      reference_image_urls: ["c1.png", "c2.png", "c3.png"],
      reference_video_urls: ["v1.mp4"],
      resolution: "720p", aspect_ratio: "16:9", duration: "5", generate_audio: true,
    });
    // character 顺序必须保留（①②③ = character1/2/3）
    expect(input.reference_image_urls).toEqual(["c1.png", "c2.png", "c3.png"]);
    // 关键：键名是 "reference_video_urls "（带尾随空格），不是 "reference_video_urls"
    expect(input).toHaveProperty("reference_video_urls ", ["v1.mp4"]);
    expect(input).not.toHaveProperty("reference_video_urls");
    // 空的音频数组没传 → 不出现该键
    expect(input).not.toHaveProperty("reference_audio_urls");
    // omni 与首/尾帧互斥：没有帧键
    expect(input).not.toHaveProperty("first_frame_url");
    expect(input).not.toHaveProperty("last_frame_url");
  });
});

describe("Seedance 2.0 · 首帧 — recordInfo 轮询请求", () => {
  const built = buildHttpRequest({
    baseUrl: KIE_VENDOR_SEED.baseUrl,
    authType: KIE_VENDOR_SEED.authType,
    apiKey: "SECRET",
    context,
    operation: SEEDANCE_2_QUERY_OP,
  });

  it("轮询 URL 无双前缀，taskId 用真实 providerMeta（不是本地伪造）", () => {
    expect(appendQueryParams(built.url, built.query)).toBe(
      "https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_bytedance_123",
    );
    expect(built.url).not.toContain("/api/v1/api/v1");
  });

  it("GET 无 body 时不应附加 Content-Type", () => {
    expect(Object.keys(built.headers).some((k) => k.toLowerCase() === "content-type")).toBe(false);
  });
});
