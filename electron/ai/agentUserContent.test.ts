import { describe, expect, it } from "vitest";
import {
  buildAgentUserContent,
  modelSupportsImageInput,
  modelSupportsPdfInput,
} from "./agentUserContent";

const bytes = (): Uint8Array => new Uint8Array([1, 2, 3]);

describe("modelSupportsImageInput", () => {
  it("honors explicit meta.supportsImageInput", () => {
    expect(modelSupportsImageInput("whatever", null, { supportsImageInput: true })).toBe(true);
    expect(modelSupportsImageInput("gpt-4o", null, { supportsImageInput: false })).toBe(false);
  });
  it("detects known vision families by name", () => {
    expect(modelSupportsImageInput("gpt-4o", null, undefined)).toBe(true);
    expect(modelSupportsImageInput("claude-3-5-sonnet", null, undefined)).toBe(true);
    expect(modelSupportsImageInput("gemini-2.0-flash", null, undefined)).toBe(true);
  });
  it("returns false for plain text models", () => {
    expect(modelSupportsImageInput("deepseek-chat", null, undefined)).toBe(false);
    expect(modelSupportsImageInput("moonshot-v1-8k", null, undefined)).toBe(false);
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
    supportsImageInput: true,
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

  it("drops images + notes when model lacks image support", async () => {
    const content = await buildAgentUserContent({
      prompt: "看图",
      attachments: [{ url: "u", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
      supportsImageInput: false,
    });
    expect(content as string).toContain("不支持图片输入");
  });

  it("drops media when resolveBytes returns null", async () => {
    const content = await buildAgentUserContent({
      prompt: "p",
      attachments: [{ url: "missing", contentType: "image/png", fileName: "a.png", kind: "image" }],
      ...base,
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
