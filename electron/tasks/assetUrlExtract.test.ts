import { describe, it, expect } from "vitest";
import { extractAssetUrl, extractChatImageUrl } from "./assetUrlExtract";

describe("extractAssetUrl — 既有 images 端点口径（不回归）", () => {
  it("顶层 url", () => {
    expect(extractAssetUrl({ url: "https://x/a.png" })).toBe("https://x/a.png");
  });
  it("data[0].url", () => {
    expect(extractAssetUrl({ data: [{ url: "https://x/b.png" }] })).toBe("https://x/b.png");
  });
  it("audio_url at the top level or inside result", () => {
    expect(extractAssetUrl({ audio_url: "https://x/a.mp3" })).toBe("https://x/a.mp3");
    expect(extractAssetUrl({ result: { audio_url: "https://x/b.wav" } })).toBe("https://x/b.wav");
  });
  it("data[0].b64_json → data URL", () => {
    expect(extractAssetUrl({ data: [{ b64_json: "AAAA" }] })).toBe("data:image/png;base64,AAAA");
  });
  it("非对象 → 空", () => {
    expect(extractAssetUrl(null)).toBe("");
    expect(extractAssetUrl("nope")).toBe("");
  });
});

describe("b64_json 的 data URL 类型取自字节，不写死 image/png", () => {
  // 火山方舟 / kie 的 b64_json 常是 JPEG。写死 image/png 会让这段 JPEG 顶着假身份
  // 一路走到落盘层，产物被命名成 .png（2026-08-26）。
  const jpegBase64 = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "latin1"),
    Buffer.alloc(16),
  ]).toString("base64");

  it("JPEG 字节 → data:image/jpeg", () => {
    expect(extractAssetUrl({ data: [{ b64_json: jpegBase64 }] })).toBe(`data:image/jpeg;base64,${jpegBase64}`);
  });
  it("chat/completions 的两条 b64_json 支路同样按字节判", () => {
    expect(extractChatImageUrl({ choices: [{ message: { images: [{ b64_json: jpegBase64 }] } }] })).toBe(
      `data:image/jpeg;base64,${jpegBase64}`,
    );
    expect(extractChatImageUrl({ choices: [{ message: { content: [{ b64_json: jpegBase64 }] } }] })).toBe(
      `data:image/jpeg;base64,${jpegBase64}`,
    );
  });
  it("认不出的字节仍回退 image/png（既有口径不回归）", () => {
    expect(extractAssetUrl({ data: [{ b64_json: "AAAA" }] })).toBe("data:image/png;base64,AAAA");
  });
});

describe("extractChatImageUrl — chat/completions 多模态图片返回", () => {
  it("① message.images:[{url}]", () => {
    const raw = { choices: [{ message: { images: [{ url: "https://x/c.png" }] } }] };
    expect(extractChatImageUrl(raw)).toBe("https://x/c.png");
    expect(extractAssetUrl(raw)).toBe("https://x/c.png");
  });
  it("① message.images:[{b64_json}] → data URL", () => {
    const raw = { choices: [{ message: { images: [{ b64_json: "BBBB" }] } }] };
    expect(extractChatImageUrl(raw)).toBe("data:image/png;base64,BBBB");
  });
  it("② content 多模态数组里的 image_url.url", () => {
    const raw = {
      choices: [{ message: { content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://x/d.png" } }] } }],
    };
    expect(extractChatImageUrl(raw)).toBe("https://x/d.png");
  });
  it("② content 数组里 image_url 是字符串", () => {
    const raw = { choices: [{ message: { content: [{ type: "image_url", image_url: "https://x/e.png" }] } }] };
    expect(extractChatImageUrl(raw)).toBe("https://x/e.png");
  });
  it("③ content 字符串 · markdown ![](data:...)", () => {
    const raw = { choices: [{ message: { content: "生成好了 ![img](data:image/png;base64,CCCC) 完成" } }] };
    expect(extractChatImageUrl(raw)).toBe("data:image/png;base64,CCCC");
  });
  it("③ content 字符串 · markdown ![](http url)", () => {
    const raw = { choices: [{ message: { content: "![img](https://x/f.jpg)" } }] };
    expect(extractChatImageUrl(raw)).toBe("https://x/f.jpg");
  });
  it("③ content 字符串 · 裸 data:image base64", () => {
    const raw = { choices: [{ message: { content: "data:image/webp;base64,DDDD 就是它" } }] };
    expect(extractChatImageUrl(raw)).toBe("data:image/webp;base64,DDDD");
  });
  it("③ content 字符串 · 裸 http 图片链接", () => {
    const raw = { choices: [{ message: { content: "看这里 https://cdn.x/g.png?e=1 出图" } }] };
    expect(extractChatImageUrl(raw)).toBe("https://cdn.x/g.png?e=1");
  });
  it("纯文本无图 → 空", () => {
    expect(extractChatImageUrl({ choices: [{ message: { content: "抱歉我无法生成" } }] })).toBe("");
  });
  it("无 choices → 空", () => {
    expect(extractChatImageUrl({})).toBe("");
  });
});
