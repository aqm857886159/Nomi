import { describe, it, expect } from "vitest";
import { executeMultipartOperation, runMultipartProfileOperation } from "./multipartOperation";
import { OPENAI_MULTIPART_IMAGE_EDIT_OP } from "./newapiTransport";
import { taskTemplateParams } from "./taskParams";
import { applyParamMap } from "./paramTranslate";
import { buildTemplateContext } from "../ai/requestPipeline";

type AnyRec = Record<string, unknown>;

const spec = OPENAI_MULTIPART_IMAGE_EDIT_OP.multipart!;

function contextFor(prompt: string, extras: AnyRec, modelKey = "gpt-image-2"): AnyRec {
  return buildTemplateContext({
    request: { prompt },
    // selected 必须给（与生产 profileHttpRequest.templateContext 同构）：multipart 的 model 字段读
    // `{{request.params.model}}`，而没选变体时那个键的回落正来自 selected.wireModelKey。不给 =
    // 测试里 model 恒缺席，量到的不是生产真发的那份表单。
    params: applyParamMap(
      OPENAI_MULTIPART_IMAGE_EDIT_OP.paramMap,
      taskTemplateParams({ extras }, { vendorKey: "self-hosted-relay", modelKey, wireModelKey: modelKey }),
    ),
    model: { modelKey },
    modelKey,
    apiKey: "sk-test",
  }) as AnyRec;
}

// 假字节解析器：每个 URL 回一段可辨认的 bytes，记录被取过哪些 URL。
function fakeResolver(seen: string[]) {
  return async (url: string) => {
    seen.push(url);
    return { bytes: Buffer.from(`bytes:${url}`), contentType: "image/png", fileName: url.split("/").pop() || "x.png" };
  };
}

async function readForm(form: FormData): Promise<{ text: Record<string, string>; files: Array<{ field: string; name: string; size: number; type: string }> }> {
  const text: Record<string, string> = {};
  const files: Array<{ field: string; name: string; size: number; type: string }> = [];
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") text[key] = value;
    else files.push({ field: key, name: value.name, size: value.size, type: value.type });
  }
  return { text, files };
}

describe("multipart 图生图（/v1/images/edits）请求装配", () => {
  it("多参考图 → 每张一个 image[] 文件项 + 文本字段齐全，且丢空字段", async () => {
    const seen: string[] = [];
    let sent: FormData | null = null;
    const context = contextFor("把背景换成夜晚", {
      referenceImages: ["https://x/a.png", "https://x/b.png"],
      aspect_ratio: "1:1",
      resolution: "1K",
    });
    await executeMultipartOperation({
      multipart: spec,
      context,
      resolveImage: fakeResolver(seen),
      send: async (form) => { sent = form; return { data: [{ url: "https://out/1.png" }] }; },
    });
    expect(seen).toEqual(["https://x/a.png", "https://x/b.png"]);
    const { text, files } = await readForm(sent!);
    expect(text.model).toBe("gpt-image-2");
    expect(text.prompt).toBe("把背景换成夜晚");
    expect(text.size).toBe("1024x1024"); // 比例+清晰度派生像素
    expect(text.response_format).toBe("url");
    // quality 未选 → 不发空字段
    expect(text).not.toHaveProperty("quality");
    expect(files.map((f) => f.field)).toEqual(["image[]", "image[]"]);
    expect(files.map((f) => f.name)).toEqual(["a.png", "b.png"]);
    expect(files.every((f) => f.size > 0 && f.type === "image/png")).toBe(true);
  });

  it("缺参考图 → 抛人话错误（不发无图的 edits）", async () => {
    const context = contextFor("画只猫", {});
    await expect(
      executeMultipartOperation({ multipart: spec, context, resolveImage: fakeResolver([]), send: async () => ({}) }),
    ).rejects.toThrow(/参考图/);
  });

  // 类级锁（2026-09-03）：multipart 路必须尊重调用方注入的 localAssetReader，与 JSON 路同口径
  // （runtime.ts 的 JSON 分支一直尊重它）。此前这里写死生产解析器，认证探针靠该注入口喂 fixture
  // 参考图（nomi-local://adapter-test/…）——被忽略 → 取不到字节 → multipart 改图通道永远认证不过
  // → 落库缺 image_edit mapping → 用户连参考图被拒发「该模型没有图生图通道」。
  it("尊重注入的 localAssetReader —— 认证探针的 fixture 参考图必须能喂进 multipart", async () => {
    let sentForm: FormData | undefined;
    await runMultipartProfileOperation(
      {
        vendor: { key: "v", baseUrlHint: "https://x" } as never,
        model: { modelKey: "gpt-image-2" } as never,
        apiKey: "k",
        request: { prompt: "改图", extras: { referenceImages: ["nomi-local://adapter-test/reference.png"] } } as never,
        operation: OPENAI_MULTIPART_IMAGE_EDIT_OP,
        localAssetReader: () => ({ bytes: Buffer.from([1, 2, 3, 4]), contentType: "image/png", fileName: "ref.png" }),
      },
      async (_u, _h, _q, form) => {
        sentForm = form;
        return {};
      },
    );
    const files = sentForm!.getAll("image[]") as File[];
    expect(files).toHaveLength(1);
    expect(files[0].size).toBe(4);
  });

  it("取字节失败（resolver 返 null）→ 抛，不静默丢图发半套", async () => {
    const context = contextFor("改图", { referenceImages: ["https://x/a.png"] });
    await expect(
      executeMultipartOperation({ multipart: spec, context, resolveImage: async () => null, send: async () => ({}) }),
    ).rejects.toThrow(/取字节失败/);
  });

  it("single 模式只取首图", async () => {
    const seen: string[] = [];
    const context = contextFor("改图", { referenceImages: ["https://x/a.png", "https://x/b.png"] });
    await executeMultipartOperation({
      multipart: { ...spec, multiple: false, imageField: "image" },
      context,
      resolveImage: fakeResolver(seen),
      send: async () => ({}),
    });
    expect(seen).toEqual(["https://x/a.png"]);
  });

  it("preview 只留形状不含字节（不泄原图）", async () => {
    const context = contextFor("改图", { referenceImages: ["https://x/a.png"] });
    const out = await executeMultipartOperation({
      multipart: spec,
      context,
      resolveImage: fakeResolver([]),
      send: async () => ({ data: [{ url: "https://out/1.png" }] }),
    });
    const req = out.request as AnyRec;
    expect(req.multipart).toBe(true);
    expect((req.images as AnyRec[])[0]).toMatchObject({ fileName: "a.png", contentType: "image/png" });
    expect(JSON.stringify(req)).not.toContain("bytes:"); // 字节内容不进 preview
  });

  it("generic file declaration supports audio multipart fields without image aliases", async () => {
    let sent: FormData | null = null;
    await executeMultipartOperation({
      multipart: {
        fields: { model_id: "scribe_v2", language_code: "en" },
        fileField: "file",
        fileSource: "data:audio/wav;base64,AAAA",
        fileKind: "audio",
      },
      context: {},
      resolveFile: async () => ({ bytes: Buffer.from([0, 1]), contentType: "audio/wav", fileName: "clip.wav" }),
      send: async (form) => { sent = form; return { text: "ok" }; },
    });

    const { text, files } = await readForm(sent!);
    expect(text).toEqual({ model_id: "scribe_v2", language_code: "en" });
    expect(files).toEqual([{ field: "file", name: "clip.wav", size: 2, type: "audio/wav" }]);
  });
});
