// 回归钉：填局域网/本机地址的自建端点必须能接入（issue #62 / #4 / #43）。
// 旧行为：把 IP 当域名截成 "18.254" → 拼 http://docs.18.254 → new URL 抛 Invalid URL → 接入判死。
import { describe, expect, it, vi } from "vitest";

import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import { runMultipartProfileOperation } from "../catalog/multipartOperation";
import { buildOpenAiCompatibleDraft } from "./builtinOpenAiCompatibleDraft";
import { canHostPublicDocs, discoverProviderDocs } from "./docsDiscovery";
import { MANUAL_CONTRACT_ERROR, compileErrorBanner, genericCompilation } from "./serviceFallback";
import { initialVerificationState, persistedModeResult } from "./serviceVerificationResults";
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

  // 端到端闭合：光声明对了不算数，得证明「探针注进去的那个值真的出现在最终报文」。
  // 表里的 image 两个模型族分别穿过 JSON chat 与 multipart；video 穿过 JSON i2v。
  // multipart 的真实 wire 是文件字节而不是 URL，所以 fake reader 把可辨识 URL 写进 fixture
  // 字节，再从真正组出的 FormData 文件读回；这同时证明 imageSource 读到了声明的键。
  const referenceDraftCases = [
    { kind: "image", modelKey: "nano-banana", expectedModes: ["image_edit"] },
    { kind: "image", modelKey: "gpt-image-2", expectedModes: ["image_edit"] },
    { kind: "video", modelKey: "m-1", expectedModes: ["image_to_video"] },
    { kind: "audio", modelKey: "m-audio", expectedModes: [] },
    { kind: "text", modelKey: "m-text", expectedModes: [] },
    { kind: "model3d", modelKey: "m-3d", expectedModes: [] },
  ] as const;

  it.each(referenceDraftCases)("$kind/$modelKey：每个参考模式的注入 URL 都进入最终报文（空集也显式钉住）", async ({ kind, modelKey, expectedModes }) => {
    const model = buildOpenAiCompatibleDraft({
      baseUrl: "http://192.168.18.254:3000",
      authType: "bearer",
      models: [{ modelKey, labelZh: modelKey, kind }],
    }).models[0];
    const referenceModes = model.modes.filter((mode) => mode.referenceParam !== undefined);
    expect(referenceModes.map((mode) => mode.taskKind)).toEqual(expectedModes);

    for (const mode of referenceModes) {
      const injected = `https://example.test/${kind}-${mode.taskKind}-reference.png`;
      const extras: Record<string, unknown> = { modelKey };
      // 与 verifier.ts:149 同一条注入规则：按声明的键与形状放参考。
      extras[mode.referenceParam!] = mode.referenceShape === "array" ? [injected] : injected;
      const request = { kind: mode.taskKind, prompt: "p", extras } as never;
      const label = `${kind}/${modelKey}/${mode.taskKind} referenceParam=${mode.referenceParam}`;

      if (mode.create.multipart) {
        let sent: FormData | undefined;
        const resolved: string[] = [];
        await runMultipartProfileOperation(
          {
            vendor: { key: "relay", name: "relay", baseUrlHint: "http://192.168.18.254:3000", authType: "bearer" } as never,
            model: { modelKey, labelZh: modelKey, kind } as never,
            apiKey: "k",
            request,
            operation: mode.create,
            localAssetReader: (url) => {
              resolved.push(url);
              return url === injected
                ? { bytes: Buffer.from(`fixture:${url}`), contentType: "image/png", fileName: "reference.png" }
                : null;
            },
          },
          async (_url, _headers, _query, form) => {
            sent = form;
            return {};
          },
        );
        expect(resolved, label).toEqual([injected]);
        let filePayload = "";
        for (const [, value] of sent!.entries()) {
          if (typeof value !== "string") filePayload += await value.text();
        }
        expect(filePayload, label).toContain(injected);
      } else {
        const built = buildProfileHttpRequest({
          vendor: { key: "relay", name: "relay", baseUrlHint: "http://192.168.18.254:3000", authType: "bearer" } as never,
          model: { modelKey, labelZh: modelKey, kind } as never,
          apiKey: "k",
          request,
          operation: mode.create,
        });
        expect(JSON.stringify(built.body), label).toContain(injected);
      }
    }
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

  // 零通道那一刻用户看到什么，才是这个缺口的真实代价。原先他拿到的是一句生英文技术串
  // （MANUAL_CONTRACT_ERROR）——恰好在他最需要指引的时候，而 3D 其实**接得上**（直接脚本 / ComfyUI）。
  // 所以生产者必须带出结构化原因，界面据它说人话并指路；判据不是 error 文案里的关键词。
  it("3D 的零通道失败带结构化原因 no_generic_contract（界面据它说人话，不是拿英文原文糊用户脸上）", () => {
    const compilation = genericCompilation(
      { vendor: { baseUrlHint: "http://192.168.18.254:3000", authType: "bearer" }, models: [] } as never,
      [{ modelKey: "m-3d", labelZh: "三维模型", kind: "model3d" }] as never,
    );
    expect(compilation.draft.models).toEqual([]);
    expect(compilation.failures).toEqual([
      { modelKey: "m-3d", error: MANUAL_CONTRACT_ERROR, reason: "no_generic_contract" },
    ]);
  });

  // run.error 那条红色横幅是原样渲染的（无 i18n）。3D 这类已经在模型卡上用用户的语言讲清楚了，
  // 再以英文技术串重复到横幅上就只是噪音；而「没读懂文档」那类不针对某个模型，仍必须留在横幅上。
  it("零通道不再往无 i18n 的红色横幅上糊英文，但读不懂文档那类仍要报", () => {
    expect(compileErrorBanner([
      { modelKey: "m-3d", error: MANUAL_CONTRACT_ERROR, reason: "no_generic_contract" },
    ])).toBeUndefined();
    expect(compileErrorBanner([
      { modelKey: "m-3d", error: MANUAL_CONTRACT_ERROR, reason: "no_generic_contract" },
      { modelKey: "paint-v2", error: "No documented image mode", reason: "docs_not_understood" },
    ])).toBe("paint-v2: No documented image mode");
  });

  // 结构化原因必须一路活到模型卡上：断在中途 = 界面又只剩 error 文案可读，等于退回关键词匹配。
  it("结构化原因活到模型卡的 mode 上（stage=compile 且 compileFailureReason 不丢）", () => {
    const { models } = initialVerificationState({
      connection: { models: [{ modelKey: "m-3d", labelZh: "三维模型", kind: "model3d" }] } as never,
      draft: { provider: {}, sources: [], models: [] } as never,
      compileFailures: [{ modelKey: "m-3d", error: MANUAL_CONTRACT_ERROR, reason: "no_generic_contract" }],
      attempt: 1,
    });
    expect(models[0].modes[0]).toMatchObject({
      state: "failed",
      stage: "compile",
      compileFailureReason: "no_generic_contract",
    });
    // 持久化投影同样不许把它丢掉（落库后重开面板还得能说人话）。
    expect(persistedModeResult({ ...models[0].modes[0], modelKey: "m-3d" } as never))
      .toMatchObject({ compileFailureReason: "no_generic_contract" });
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
