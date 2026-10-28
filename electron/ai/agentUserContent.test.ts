import { encodeMention } from '../shared/storyboard/promptMentions'
import { describe, expect, it, vi } from "vitest";
import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import type { CatalogState, Model } from "../catalog/types";
import {
  buildAgentUserContent,
  projectAgentPromptForSend,
  modelImageInputSupport,
  modelSupportsPdfInput,
  type ImageInputSupport,
} from "./agentUserContent";

const bytes = (): Uint8Array => new Uint8Array([1, 2, 3]);
const row = (vendorKey: string, modelKey: string, overrides: Partial<Model> = {}): Model =>
  ({ vendorKey, modelKey, labelZh: modelKey, kind: "text", enabled: true, createdAt: "", updatedAt: "", ...overrides });

// 读图能力只认声明（设计卡 docs/plan/2026-10-27-vision-capability-declared.md，A5–A8）。
// 起因：没声明的行拿名字撞正则，撞不上就当不能——用户自起名的中转模型（my-gpt）附图被静默丢掉。
describe("modelImageInputSupport：能 / 不能 / 不知道，只认声明", () => {
  // 名字矩阵：旧正则会判「能」的、会判「不能」的、撞不上的新型号和自起名，判定一律与名字无关。
  const NAMES = [
    "gpt-4o", "claude-3-5-sonnet", "gemini-2.0-flash", "llava-v1.6", "qwen2.5-vl", "grok-4-vision",
    "my-gpt", "deepseek-chat", "gpt-5.5", "claude-opus-5", "glm-4.5v", "doubao-seed-1.6",
  ];
  it.each(NAMES)("自配行 %s：没声明 = 不知道；声明 true / false = 能 / 不能", (name) => {
    expect(modelImageInputSupport(row("my-relay", name))).toBe("unknown");
    expect(modelImageInputSupport(row("my-relay", name, { meta: { supportsImageInput: true } }))).toBe("supported");
    expect(modelImageInputSupport(row("my-relay", name, { meta: { supportsImageInput: false } }))).toBe("unsupported");
  });

  it("别名不参与判定：自起名的行挂一个像能读图的别名，仍是不知道", () => {
    expect(modelImageInputSupport(row("my-relay", "my-gpt", { modelAlias: "gpt-4o" }))).toBe("unknown");
  });

  it.each([["字符串 \"true\"", "true"], ["数字 1", 1], ["null", null]])("声明值不是布尔（%s）按没声明算", (_label, value) => {
    expect(modelImageInputSupport(row("my-relay", "my-gpt", { meta: { supportsImageInput: value } }))).toBe("unknown");
    expect(modelImageInputSupport(row("apimart", "deepseek-v4-pro", { meta: { supportsImageInput: value } }))).toBe("unsupported");
  });

  it("渲染层写得动的 meta（catalogLifecycle）不能把自配行盖章成种子行", () => {
    expect(modelImageInputSupport(row("my-relay", "my-gpt", { meta: { catalogLifecycle: "flagship" } }))).toBe("unknown");
  });

  it("种子按这一行的身份判，不按 vendor：内置 vendor 下自加的行、兄弟连接下的同名行都是不知道", () => {
    expect(modelImageInputSupport(row("apimart", "deepseek-v4-pro"))).toBe("unsupported");
    expect(modelImageInputSupport(row("apimart", "gpt-5.5"))).toBe("unknown");
    expect(modelImageInputSupport(row("apimart--mini", "deepseek-v4-pro"))).toBe("unknown");
  });

  // 种子矩阵：从真目录取数（applyBuiltinSeeds），不手抄——内置目录增删行，这一格自动跟着核。
  it("内置目录的每一条文本行都有确定答案：能 ⇔ 显式声明 true，其余是不能，没有一条是不知道", () => {
    const empty: CatalogState = { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
    const texts = applyBuiltinSeeds(empty, "2026-10-27T00:00:00.000Z").state.models.filter((model) => model.kind === "text");
    expect(texts.length).toBeGreaterThan(0);
    const verdicts = texts.map((model) => ({
      id: `${model.vendorKey}/${model.modelKey}`,
      verdict: modelImageInputSupport(model),
      declaredTrue: (model.meta as { supportsImageInput?: unknown } | undefined)?.supportsImageInput === true,
    }));
    expect(verdicts.filter((entry) => entry.verdict === "unknown")).toEqual([]);
    for (const entry of verdicts) expect(entry.verdict === "supported", entry.id).toBe(entry.declaredTrue);
    expect(verdicts.filter((entry) => entry.verdict === "supported").map((entry) => entry.id)).toEqual(expect.arrayContaining([
      "apimart/gemini-3.5-flash", "agnes/agnes-2.0-flash", "agnes/agnes-2.5-flash", "agnes/agnes-2.5-pro-alpha",
      "agnes/agnes-2.5-pro-beta", "agnes/agnes-2.5-pro", "minimax/MiniMax-M3",
    ]));
  });
});

describe("modelSupportsPdfInput", () => {
  it("honors meta + detects pdf-capable families", () => {
    expect(modelSupportsPdfInput("x", null, { supportsPdfInput: true })).toBe(true);
    expect(modelSupportsPdfInput("claude-3-5-sonnet", null, undefined)).toBe(true);
    expect(modelSupportsPdfInput("gpt-4o", null, undefined)).toBe(true);
    expect(modelSupportsPdfInput("claude-3-haiku", null, undefined)).toBe(false);
    expect(modelSupportsPdfInput("deepseek-chat", null, undefined)).toBe(false);
  });
});

describe("buildAgentUserContent", () => {
  const base = {
    imageInput: "supported" as ImageInputSupport,
    supportsPdfInput: true,
    resolveBytes: bytes,
    extractText: async () => null,
  };

  it("returns plain string when no attachments", async () => {
    expect(await buildAgentUserContent({ prompt: "hi", ...base })).toBe("hi");
  });

  it("builds text + image part when model supports image", async () => {
    const content = await buildAgentUserContent({
      prompt: "看这张图",
      attachments: [{ url: "u", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
    });
    const parts = content as Array<{ type: string }>;
    expect(parts[0]).toMatchObject({ type: "text", text: "看这张图" });
    expect(parts[1]).toMatchObject({ type: "image", mimeType: "image/png" });
  });

  it("builds file part for PDF when supported", async () => {
    const content = await buildAgentUserContent({
      prompt: "读这份 PDF",
      attachments: [{ url: "u", contentType: "application/pdf", fileName: "s.pdf", kind: "file" }],
      ...base,
    });
    const parts = content as Array<{ type: string }>;
    expect(parts[1]).toMatchObject({ type: "file", mimeType: "application/pdf" });
  });

  it("keeps a PDF filename with its bytes when a preceding attachment cannot be read", async () => {
    const content = await buildAgentUserContent({
      prompt: "read",
      ...base,
      attachments: [
        { url: "missing", contentType: "application/pdf", fileName: "missing.pdf", kind: "file" },
        { url: "present", contentType: "application/pdf", fileName: "actual.pdf", kind: "file" },
      ],
      resolveBytes: (url) => url === "present" ? bytes() : null,
    });
    expect(content).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "file", data: bytes(), mimeType: "application/pdf", fileName: "actual.pdf" },
    ]);
  });

  it("drops PDF + notes when model lacks pdf support", async () => {
    const content = await buildAgentUserContent({
      prompt: "读这份 PDF",
      attachments: [{ url: "u", contentType: "application/pdf", fileName: "s.pdf", kind: "file" }],
      ...base,
      supportsPdfInput: false,
    });
    expect(typeof content).toBe("string");
    expect(content as string).toContain("不支持 PDF");
  });

  it("drops images + notes when the model cannot read images", async () => {
    const content = await buildAgentUserContent({
      prompt: "看图",
      attachments: [{ url: "u", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
      imageInput: "unsupported",
    });
    expect(content as string).toContain("不支持图片输入");
  });

  it("sends the image when nobody declared whether the model reads images (the real backend decides)", async () => {
    const content = await buildAgentUserContent({
      prompt: "看图",
      attachments: [{ url: "u", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
      imageInput: "unknown",
    });
    expect(content).toEqual([{ type: "text", text: "看图" }, { type: "image", image: bytes(), mimeType: "image/png" }]);
  });

  it.each(["supported", "unknown"] as const)("drops media when resolveBytes returns null (verdict %s)", async (imageInput) => {
    const content = await buildAgentUserContent({
      prompt: "p",
      attachments: [{ url: "missing", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
      imageInput,
      resolveBytes: () => null,
    });
    expect(content as string).toContain("读取失败");
  });

  it("injects extracted document text into the prompt", async () => {
    const content = await buildAgentUserContent({
      prompt: "读这个",
      attachments: [{ url: "u", contentType: "text/plain", fileName: "note.txt", kind: "file" }],
      ...base,
      extractText: async () => "这是文档正文",
    });
    expect(typeof content).toBe("string");
    expect(content as string).toContain("[附件文档内容]");
    expect(content as string).toContain("〈note.txt〉");
    expect(content as string).toContain("这是文档正文");
  });

  it("notes documents that fail to extract", async () => {
    const content = await buildAgentUserContent({
      prompt: "读这个",
      attachments: [{ url: "u", contentType: "application/octet-stream", fileName: "a.bin", kind: "file" }],
      ...base,
      extractText: async () => null,
    });
    expect(content as string).toContain("未能读取");
  });
});


describe('original media reference identity', () => {
  it('carries video/audio ids for generation reuse without claiming to analyze their content', async () => {
    const extractText = vi.fn(async () => null)
    const content = await buildAgentUserContent({ prompt: 'Use these references', imageInput: 'supported', supportsPdfInput: true, resolveBytes: bytes, extractText, attachments: [
      { assetId: 'asset-video', url: 'nomi-local://v', contentType: 'video/mp4', fileName: 'take.mp4', kind: 'file' },
      { assetId: 'asset-audio', url: 'nomi-local://a', contentType: 'audio/wav', fileName: 'rain.wav', kind: 'file' },
    ] })
    expect(content).toContain('asset-video')
    expect(content).toContain('asset-audio')
    expect(content).toContain('not been watched or listened to')
    expect(extractText).not.toHaveBeenCalled()
  })
  it('retains an executable image identity even for a text-only model', async () => {
    const content = await buildAgentUserContent({ prompt: 'Use this identity', imageInput: 'unsupported', supportsPdfInput: false, resolveBytes: bytes, extractText: async () => null, attachments: [
      { assetId: 'asset-image', url: 'nomi-local://i', contentType: 'image/png', fileName: 'portrait.png', kind: 'image' },
    ] })
    expect(content).toContain('asset-image')
  })
})

describe('Agent inline reference projection', () => {
  const attachments = [
    { assetId:'image-a', url:'nomi-local://p/a.png', fileName:'a.png', contentType:'image/png', kind:'image' as const },
    { assetId:'video-v', url:'nomi-local://p/v.mp4', fileName:'v.mp4', contentType:'video/mp4', kind:'file' as const },
    { assetId:'image-b', url:'nomi-local://p/b.png', fileName:'b.png', contentType:'image/png', kind:'image' as const },
    { assetId:'audio-s', url:'nomi-local://p/s.wav', fileName:'s.wav', contentType:'audio/wav', kind:'file' as const },
  ]
  it('binds each clause to its original while keeping per-kind numbering and repeated mentions', async () => {
    const raw = `${encodeMention(attachments[2].url)} change background; ${encodeMention(attachments[0].url)} keep the face.\n${encodeMention(attachments[1].url)} animate to ${encodeMention(attachments[3].url)}; keep ${encodeMention(attachments[2].url)}.`
    const prompt = projectAgentPromptForSend(raw,attachments)
    expect(prompt).toBe('@image2 change background; @image1 keep the face.\n@video1 animate to @audio1; keep @image2.')
    const content = await buildAgentUserContent({ prompt,attachments,imageInput:'supported',supportsPdfInput:false,resolveBytes:bytes,extractText:async()=>null })
    const text = (content as {type:string;text:string}[])[0].text
    const manifest = JSON.parse(text.split('[Selected original media references]\n')[1].split('\n')[0])
    expect(manifest.map((item:{reference:string;assetId:string})=>[item.reference,item.assetId])).toEqual([
      ['@image1','image-a'],['@video1','video-v'],['@image2','image-b'],['@audio1','audio-s'],
    ])
    expect((content as {type:string}[]).filter(item=>item.type==='image')).toHaveLength(2)
  })
  const MEDIA_REFERENCE_MATRIX = attachments.flatMap(attachment => (['supported', 'unknown', 'unsupported'] as const).map(imageInput => ({ attachment, imageInput })))
  it.each(MEDIA_REFERENCE_MATRIX)('keeps $attachment.fileName canonical identity with vision=$imageInput', async ({attachment,imageInput}) => {
    const prompt = projectAgentPromptForSend(encodeMention(attachment.url), [attachment])
    const content = await buildAgentUserContent({ prompt, attachments:[attachment], imageInput, supportsPdfInput:false, resolveBytes:bytes, extractText:async()=>null })
    const text = typeof content === 'string' ? content : (content[0] as {text:string}).text
    const manifest = JSON.parse(text.split('[Selected original media references]\n')[1].split('\n')[0])
    expect(manifest).toHaveLength(1)
    expect(manifest[0]).toMatchObject({assetId:attachment.assetId,name:attachment.fileName,contentType:attachment.contentType})
    if (attachment.kind === 'image') expect(typeof content !== 'string' && content.some(part=>part.type==='image')).toBe(imageInput !== 'unsupported')
    if (attachment.contentType.startsWith('video/') || attachment.contentType.startsWith('audio/')) expect(text).toContain('have not been watched or listened to')
  })
  it('refuses a pasted marker without a canonical attachment instead of silently dropping it', () => {
    expect(()=>projectAgentPromptForSend(encodeMention('nomi-local://p/missing.png'),attachments)).toThrow('project_agent_attachment_invalid')
    expect(()=>projectAgentPromptForSend(encodeMention(attachments[0].url),[{...attachments[0],assetId:undefined}])).toThrow('project_agent_attachment_invalid')
  })
})
