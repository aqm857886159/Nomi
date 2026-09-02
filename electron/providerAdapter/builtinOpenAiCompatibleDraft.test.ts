// 回归钉：填局域网/本机地址的自建端点必须能接入（issue #62 / #4 / #43）。
// 旧行为：把 IP 当域名截成 "18.254" → 拼 http://docs.18.254 → new URL 抛 Invalid URL → 接入判死。
import { describe, expect, it, vi } from "vitest";

import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { canHostPublicDocs, discoverProviderDocs } from "./docsDiscovery";
import { assertAdapterModeInvariants } from "./validator";

describe("canHostPublicDocs", () => {
  it("IP 字面量一律没有公开文档站（公网 IP 也没有 docs.203.0.113.5）", () => {
    for (const host of ["192.168.18.254", "127.0.0.1", "10.0.0.5", "172.16.3.9", "203.0.113.5", "::1", "fe80::1"]) {
      expect(canHostPublicDocs(host), host).toBe(false);
    }
  });

  it("本机/内网域名同样没有", () => {
    for (const host of ["localhost", "nas.local", "comfy.internal", "box.home.arpa"]) {
      expect(canHostPublicDocs(host), host).toBe(false);
    }
  });

  it("正常公网域名有（不能误伤正常供应商）", () => {
    for (const host of ["api.openai.com", "apimart.ai", "docs.example.co.uk"]) {
      expect(canHostPublicDocs(host), host).toBe(true);
    }
  });
});

describe("discoverProviderDocs 对无文档主机", () => {
  it("直接返回空，既不抛 Invalid URL 也不发任何请求", async () => {
    const fetchText = vi.fn();
    const docs = await discoverProviderDocs({
      baseUrl: "http://192.168.18.254:3000/v1",
      modelKeys: ["MiniMax-M3"],
      fetchText: fetchText as never,
    });
    expect(docs).toEqual({ sources: [], corpus: "" });
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe("buildOpenAiCompatibleDraft", () => {
  const draftFor = (kind: "text" | "image" | "video" | "audio") =>
    buildOpenAiCompatibleDraft({
      baseUrl: "http://192.168.18.254:3000",
      authType: "bearer",
      models: [{ modelKey: "m-1", labelZh: "m-1", kind }],
    }).models[0];

  it("文本给出 chat 通道", () => {
    expect(draftFor("text").modes.map((mode) => mode.taskKind)).toEqual(["chat"]);
  });

  it("图片同时给出文生图与图生图通道（缺图生图会让连了参考图的节点被拒发）", () => {
    expect(draftFor("image").modes.map((mode) => mode.taskKind)).toEqual(["text_to_image", "image_edit"]);
  });

  // 类级锁（2026-09-03 自建中转 gpt-image-2 实测）：改图协议必须**按模型族 derive**，与落库路径
  // （catalogCommit → newapiImageEditProfileForModel）同源。此前这里恒用不分族的
  // newapiTransportFor('image').edit（chat/completions），gpt-image 系发过去被上游 400
  // 「This model is not supported on the Chat Completions endpoint」→ image_edit 认证必败
  // → 落库缺 mapping → 用户连参考图被拒发「该模型没有图生图通道」，而这家中转其实支持改图。
  const editModeFor = (modelKey: string) =>
    buildOpenAiCompatibleDraft({
      baseUrl: "http://192.168.18.254:3000",
      authType: "bearer",
      models: [{ modelKey, labelZh: modelKey, kind: "image" }],
    }).models[0].modes.find((mode) => mode.taskKind === "image_edit");

  it("gpt-image 系改图走 multipart /v1/images/edits，不塞进 chat/completions", () => {
    const edit = editModeFor("gpt-image-2");
    expect(edit?.create.path).toBe("/v1/images/edits");
    expect(edit?.create.multipart).toBeDefined();
  });

  it("非 multipart 族改图仍回落 chat 多模态（不误伤 gemini/nano-banana 系）", () => {
    const edit = editModeFor("nano-banana");
    expect(edit?.create.path).toBe("/v1/chat/completions");
    expect(edit?.create.multipart).toBeUndefined();
  });

  // 参考类模式必须声明参考输入契约：认证探针据此注入参考图（verifier.ts:144）。不声明 = 拿「零参考图」
  // 去验一条改图通道，multipart 端点直接抛「缺参考图」。键必须是该 op 真实读的那个——改图读聚合的
  // reference_images（数组），图生视频读首帧 image_url（单值，见 newapiTransport.ts:211）。
  it("改图声明 reference_images/array —— 探针据此注参考图，否则 multipart 端点必报缺图", () => {
    const edit = editModeFor("gpt-image-2");
    expect(edit?.referenceParam).toBe("reference_images");
    expect(edit?.referenceShape).toBe("array");
  });

  it("图生视频声明首帧 image_url/single —— 与改图不同键，写错等于参考进不了报文", () => {
    const i2v = draftFor("video").modes.find((mode) => mode.taskKind === "image_to_video");
    expect(i2v?.referenceParam).toBe("image_url");
    expect(i2v?.referenceShape).toBe("single");
  });

  // 端到端闭合：光声明对了不算数，得证明「探针注进去的那个值真的出现在报文里」。
  // 这条把 声明(referenceParam) → 探针注入(verifier 的 verificationRequest 同一份逻辑)
  // → 模板渲染(buildProfileHttpRequest) 三段串起来。断言的是**注入的那个 URL 本身**出现在
  // body.image，而不是「image 键存在」——键在但值是空模板串正是此前 i2v 首帧发不出去的样子。
  it("图生视频：探针注入的参考图真的落进报文 body.image（声明对≠报文对）", () => {
    const i2v = draftFor("video").modes.find((mode) => mode.taskKind === "image_to_video");
    const injected = "https://example.test/reference.png";
    const extras: Record<string, unknown> = { modelKey: "m-1" };
    // 与 verifier.ts:149 同一条注入规则：按声明的键与形状放参考。
    extras[i2v!.referenceParam!] = i2v!.referenceShape === "array" ? [injected] : injected;

    const built = buildProfileHttpRequest({
      vendor: { key: "relay", name: "relay", baseUrlHint: "http://192.168.18.254:3000", authType: "bearer" } as never,
      model: { modelKey: "m-1", labelZh: "m-1", kind: "video" } as never,
      apiKey: "k",
      request: { kind: "image_to_video", prompt: "p", extras } as never,
      operation: i2v!.create,
    });

    expect((built.body as Record<string, unknown>).image).toBe(injected);
  });

  // Task 2 的另一半：自建中转**根本接不了**音频参考类与 3D 模型。这不是「没问题」，是缺口——
  // 明着钉住（D4 缺口标出来），别让「没有这条 mode」被误读成「已验证正常」。
  // 音频：newapiTransportFor('audio') 只给 text_to_audio，没有 edit/imageToVideo → 没有 image_to_audio。
  // 3D：modesForKind 对 model3d 直接返回 []（没有通用 OpenAI 兼容契约，不编造）。
  it("音频只有文生音频通道——自建中转接不了 image_to_audio（缺口，不是正常）", () => {
    expect(draftFor("audio").modes.map((mode) => mode.taskKind)).toEqual(["text_to_audio"]);
  });

  it("3D 模型零通道——自建中转根本接不了，验证阶段如实报「没有可用通道」", () => {
    const model3d = buildOpenAiCompatibleDraft({
      baseUrl: "http://192.168.18.254:3000",
      authType: "bearer",
      models: [{ modelKey: "m-3d", labelZh: "m-3d", kind: "model3d" }],
    }).models[0];
    expect(model3d.modes).toEqual([]);
  });

  // 结构闸（R17 已验红）：内置草稿与 AI 编译路共用同一份语义校验。此前这条路一次都没被校验过，
  // 「参考类模式必须声明 referenceParam/referenceShape」对它结构性失效 —— image_edit 漏声明多年
  // 没人拦。把 image_to_video 的 referenceParam 删掉，构建期就该当场炸，不是等运行期静默失败。
  it("参考类模式漏声明 referenceParam 时构建期当场抛（不是运行期静默失败）", () => {
    expect(() =>
      assertAdapterModeInvariants({
        modelKey: "m-1",
        kind: "video",
        modes: [{
          taskKind: "image_to_video",
          create: { method: "POST", path: "/v1/video/generations", response_mapping: { video_url: "url" } },
          referenceShape: "single",
          sourceUrls: [],
        }],
      }),
    ).toThrow(/requires referenceParam/);
  });

  it("参考类模式漏声明 referenceShape 时同样当场抛", () => {
    expect(() =>
      assertAdapterModeInvariants({
        modelKey: "m-1",
        kind: "image",
        modes: [{
          taskKind: "image_edit",
          create: { method: "POST", path: "/v1/images/edits", response_mapping: { image_url: "url" } },
          referenceParam: "reference_images",
          sourceUrls: [],
        }],
      }),
    ).toThrow(/requires referenceShape/);
  });

  it("视频同时给出文生视频与图生视频通道，并带轮询", () => {
    const video = draftFor("video");
    expect(video.modes.map((mode) => mode.taskKind)).toEqual(["text_to_video", "image_to_video"]);
    expect(video.modes[0].query).toBeDefined();
    expect(video.modes[0].statusMapping).toBeDefined();
  });

  it("参数沿用中转那套标准控件，且丢掉说明卡形状不支持的 image-url 类", () => {
    const video = draftFor("video");
    expect(video.parameters?.map((param) => param.key)).toEqual(["duration", "size"]);
  });

  it("没有文档出处就如实留空，不编造来源", () => {
    const draft = buildOpenAiCompatibleDraft({
      baseUrl: "http://127.0.0.1:8188",
      authType: "none",
      models: [{ modelKey: "m-1", labelZh: "m-1", kind: "image" }],
    });
    expect(draft.sources).toEqual([]);
    expect(draft.models[0].modes.every((mode) => mode.sourceUrls.length === 0)).toBe(true);
  });

  it("uses the Anthropic Messages contract when the provider declares Anthropic", () => {
    const mode = buildOpenAiCompatibleDraft({
      baseUrl: "https://api.anthropic.com",
      authType: "x-api-key",
      providerKind: "anthropic",
      models: [{ modelKey: "claude-test", labelZh: "Claude", kind: "text" }],
    }).models[0].modes[0];

    expect(mode.create.path).toBe("/v1/messages");
    expect(mode.create.headers?.["anthropic-version"]).toBe("2023-06-01");
    expect(mode.create.headers?.["x-api-key"]).toBe("{{user_api_key}}");
    expect(mode.create.headers?.Authorization).toBeUndefined();
    expect((mode.create.body as Record<string, unknown>).max_tokens).toBe(16);
  });

  it("keeps the OpenAI-compatible contract for other providers", () => {
    const mode = buildOpenAiCompatibleDraft({
      baseUrl: "https://api.example.com/v1",
      authType: "bearer",
      providerKind: "openai-compatible",
      models: [{ modelKey: "gpt-test", labelZh: "GPT", kind: "text" }],
    }).models[0].modes[0];

    expect(mode.create.path).toBe("/v1/chat/completions");
    expect(mode.create.headers?.Authorization).toBe("Bearer {{user_api_key}}");
    expect(mode.create.headers?.["anthropic-version"]).toBeUndefined();
  });
});
