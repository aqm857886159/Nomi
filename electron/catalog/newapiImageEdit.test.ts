import { describe, it, expect } from "vitest";
import { NEWAPI_IMAGE_EDIT_OP, NEWAPI_IMAGE_CREATE_OP, NEWAPI_IMAGE_PARAM_MAP, NEWAPI_VIDEO_CREATE_OP, NEWAPI_VIDEO_QUERY_OP, NEWAPI_AUDIO_TTS_OP, newapiImageEditProfileForModel } from "./newapiTransport";
import { taskTemplateParams } from "./taskParams";
import { applyParamMap } from "./paramTranslate";
import { valuesFromMapping } from "../tasks/responseParsing";
import { renderTemplateValue, buildTemplateContext } from "../ai/requestPipeline";
import type { HttpOperation } from "./types";

type AnyRec = Record<string, unknown>;

function renderBody(op: HttpOperation, prompt: string, params: AnyRec): AnyRec {
  const ctx = buildTemplateContext({
    request: { prompt },
    params,
    model: {},
    modelKey: "gemini-2.5-flash-image",
    apiKey: "sk-test",
  });
  return renderTemplateValue(op.body, ctx) as AnyRec;
}

describe("通用中转 image_edit（chat/completions 多模态）请求装配", () => {
  it("多张参考图 → content 扁平 = [text 项, image_url 项×N]", () => {
    const params = taskTemplateParams({ extras: { referenceImages: ["https://x/a.png", "https://x/b.png"] } });
    const body = renderBody(NEWAPI_IMAGE_EDIT_OP, "把背景换成夜晚", params);
    expect(body.model).toBe("gemini-2.5-flash-image");
    expect(body.stream).toBe(false);
    const content = (body.messages as AnyRec[])[0].content;
    expect(content).toEqual([
      { type: "text", text: "把背景换成夜晚" },
      { type: "image_url", image_url: { url: "https://x/a.png" } },
      { type: "image_url", image_url: { url: "https://x/b.png" } },
    ]);
  });

  it("无参考图 → content 只剩 text 项（无空 image_url 残留）", () => {
    const params = taskTemplateParams({ extras: {} });
    const body = renderBody(NEWAPI_IMAGE_EDIT_OP, "画只猫", params);
    expect((body.messages as AnyRec[])[0].content).toEqual([{ type: "text", text: "画只猫" }]);
  });
});

describe("通用中转 image_edit 按模型协议精确分流", () => {
  it("Grok Imagine 单参考图 → JSON /v1/images/edits + image（不是 chat/completions）", () => {
    const profile = newapiImageEditProfileForModel("grok-imagine-image-quality");
    expect(profile.protocol).toBe("xai-json-edits");
    expect(profile.operation.path).toBe("/v1/images/edits");
    const body = renderBody(
      profile.operation,
      "把背景换成夜晚",
      taskTemplateParams({ extras: { referenceImages: ["https://x/a.png"] } }),
    );
    expect(body).toMatchObject({
      model: "gemini-2.5-flash-image",
      prompt: "把背景换成夜晚",
      image: { type: "image_url", url: "https://x/a.png" },
      response_format: "url",
    });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("images");
  });

  it("Grok Imagine 多参考图 → images 有序数组，最多取官方支持的 3 张", () => {
    const profile = newapiImageEditProfileForModel("xai/grok-imagine-image");
    const body = renderBody(
      profile.operation,
      "合成一张图",
      taskTemplateParams({ extras: { referenceImages: ["https://x/1.png", "https://x/2.png", "https://x/3.png", "https://x/4.png"] } }),
    );
    expect(body.images).toEqual([
      { type: "image_url", url: "https://x/1.png" },
      { type: "image_url", url: "https://x/2.png" },
      { type: "image_url", url: "https://x/3.png" },
    ]);
    expect(body).not.toHaveProperty("image");
  });

  it("Nano Banana 保留 chat/completions 多模态协议", () => {
    const profile = newapiImageEditProfileForModel("google/nano-banana-edit");
    expect(profile.protocol).toBe("chat-completions-image-url");
    expect(profile.operation).toBe(NEWAPI_IMAGE_EDIT_OP);
  });

  it("GPT Image 2 → OpenAI multipart /v1/images/edits（image[] 文件字段，非 chat/非 JSON）", () => {
    const profile = newapiImageEditProfileForModel("gpt-image-2");
    expect(profile.protocol).toBe("openai-multipart-edits");
    expect(profile.operation.path).toBe("/v1/images/edits");
    expect(profile.operation.multipart?.imageField).toBe("image[]");
    expect(profile.operation.multipart?.multiple).toBe(true);
    // 不设 Content-Type（multipart 由 fetch 加 boundary）；body 走 multipart.fields 不走 JSON body。
    expect(profile.operation.body).toBeUndefined();
    expect(profile.operation.headers?.["Content-Type"]).toBeUndefined();
  });

  it("dall-e-2 也走 multipart edits；带路径前缀的 gpt-image 仍命中", () => {
    expect(newapiImageEditProfileForModel("dall-e-2").protocol).toBe("openai-multipart-edits");
    expect(newapiImageEditProfileForModel("openai/gpt-image-1").protocol).toBe("openai-multipart-edits");
  });

  it("override（探测/手动选）压过智能默认：把 gpt-image 强判成 chat", () => {
    const profile = newapiImageEditProfileForModel("gpt-image-2", null, "chat-completions-image-url");
    expect(profile.protocol).toBe("chat-completions-image-url");
    expect(profile.operation).toBe(NEWAPI_IMAGE_EDIT_OP);
  });

  it("非法 override 被忽略，回落智能默认", () => {
    const profile = newapiImageEditProfileForModel("gpt-image-2", null, "bogus" as never);
    expect(profile.protocol).toBe("openai-multipart-edits");
  });
});

describe("通用中转 text_to_image 分辨率派生（治「只能出 1K」）", () => {
  const derive = (aspect: string, res: string): unknown => {
    const params = applyParamMap(NEWAPI_IMAGE_PARAM_MAP, taskTemplateParams({ extras: { aspect_ratio: aspect, resolution: res } }));
    const body = renderBody(NEWAPI_IMAGE_CREATE_OP, "一只小猪", params);
    return body.size;
  };
  it("1:1 · 1K → 1024x1024", () => expect(derive("1:1", "1K")).toBe("1024x1024"));
  it("16:9 · 2K → 长边 2048", () => expect(derive("16:9", "2K")).toBe("2048x1152"));
  it("9:16 · 4K → 竖版长边 3840（受像素预算内）", () => {
    const size = derive("9:16", "4K") as string;
    const [w, h] = size.split("x").map(Number);
    expect(h).toBeGreaterThan(w); // 竖版
    expect(h).toBeGreaterThanOrEqual(2048); // 确实比 1K/2K 大
  });
  it("body 不再钉死 1024：2K/4K 能选出", () => {
    expect(derive("1:1", "2K")).not.toBe("1024x1024");
  });
});

describe("通用中转路径夯实（输出多资产 + 参数广度 + i2v 断链）", () => {
  it("图片 n>1：response_mapping data[*].url 取回全部图(不再只落第一张)", () => {
    const resp = { data: [{ url: "https://x/1.png" }, { url: "https://x/2.png" }] };
    expect(valuesFromMapping(resp, NEWAPI_IMAGE_CREATE_OP.response_mapping ?? null, "image_url")).toEqual([
      "https://x/1.png",
      "https://x/2.png",
    ]);
  });

  it("n 强制为数字发出(UI 存字符串 '3' → body.n === 3)", () => {
    const body = renderBody(NEWAPI_IMAGE_CREATE_OP, "x", taskTemplateParams({ extras: { n: "3" } }));
    expect(body.n).toBe(3);
  });

  it("视频 i2v：节点填的首帧(firstFrameUrl)到达 body.image(此前断链到不了 wire)", () => {
    const body = renderBody(NEWAPI_VIDEO_CREATE_OP, "走起来", taskTemplateParams({ extras: { firstFrameUrl: "https://x/f.png" } }));
    expect(body.image).toBe("https://x/f.png");
  });

  it("视频 t2v：无首帧 → body 不带空的 image 字段(不误发 image:'')", () => {
    const body = renderBody(NEWAPI_VIDEO_CREATE_OP, "一片森林", taskTemplateParams({ extras: {} }));
    expect("image" in body).toBe(false);
  });

  it("视频轮询 data[*].url 取回全部视频", () => {
    const resp = { data: [{ url: "https://x/a.mp4" }, { url: "https://x/b.mp4" }] };
    expect(valuesFromMapping(resp, NEWAPI_VIDEO_QUERY_OP.response_mapping ?? null, "video_url")).toEqual([
      "https://x/a.mp4",
      "https://x/b.mp4",
    ]);
  });

  it("音频 speed(OpenAI 标准)到达 body", () => {
    const body = renderBody(NEWAPI_AUDIO_TTS_OP, "念一段", taskTemplateParams({ extras: { voice: "v1", speed: 1.5 } }));
    expect(body.speed).toBe(1.5);
    expect(body.voice).toBe("v1");
  });

  it("音频无 speed → body 不带空 speed 字段", () => {
    const body = renderBody(NEWAPI_AUDIO_TTS_OP, "念", taskTemplateParams({ extras: { voice: "v1" } }));
    expect("speed" in body).toBe(false);
  });
});
