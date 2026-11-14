import { describe, it, expect } from "vitest";
import { extractAssetUrls, extractChatImageUrls } from "./assetUrlExtract";

describe("extractAssetUrls — 既有 images 端点口径（不回归）", () => {
  it("顶层 url", () => {
    expect(extractAssetUrls({ url: "https://x/a.png" })).toEqual(["https://x/a.png"]);
  });
  it("data[0].url", () => {
    expect(extractAssetUrls({ data: [{ url: "https://x/b.png" }] })).toEqual(["https://x/b.png"]);
  });
  it("audio_url at the top level or inside result", () => {
    expect(extractAssetUrls({ audio_url: "https://x/a.mp3" })).toEqual(["https://x/a.mp3"]);
    expect(extractAssetUrls({ result: { audio_url: "https://x/b.wav" } })).toEqual(["https://x/b.wav"]);
  });
  it("data[0].b64_json → data URL", () => {
    expect(extractAssetUrls({ data: [{ b64_json: "AAAA" }] })).toEqual(["data:image/png;base64,AAAA"]);
  });
  it("非对象 → 空", () => {
    expect(extractAssetUrls(null)).toEqual([]);
    expect(extractAssetUrls("nope")).toEqual([]);
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
    expect(extractAssetUrls({ data: [{ b64_json: jpegBase64 }] })).toEqual([`data:image/jpeg;base64,${jpegBase64}`]);
  });
  it("chat/completions 的两条 b64_json 支路同样按字节判", () => {
    expect(extractChatImageUrls({ choices: [{ message: { images: [{ b64_json: jpegBase64 }] } }] })).toEqual([
      `data:image/jpeg;base64,${jpegBase64}`,
    ]);
    expect(extractChatImageUrls({ choices: [{ message: { content: [{ b64_json: jpegBase64 }] } }] })).toEqual([
      `data:image/jpeg;base64,${jpegBase64}`,
    ]);
  });
  it("认不出的字节仍回退 image/png（既有口径不回归）", () => {
    expect(extractAssetUrls({ data: [{ b64_json: "AAAA" }] })).toEqual(["data:image/png;base64,AAAA"]);
  });
});

describe("extractChatImageUrls — chat/completions 多模态图片返回", () => {
  it("① message.images:[{url}]", () => {
    const raw = { choices: [{ message: { images: [{ url: "https://x/c.png" }] } }] };
    expect(extractChatImageUrls(raw)).toEqual(["https://x/c.png"]);
    expect(extractAssetUrls(raw)).toEqual(["https://x/c.png"]);
  });
  it("① message.images:[{b64_json}] → data URL", () => {
    const raw = { choices: [{ message: { images: [{ b64_json: "BBBB" }] } }] };
    expect(extractChatImageUrls(raw)).toEqual(["data:image/png;base64,BBBB"]);
  });
  it("② content 多模态数组里的 image_url.url", () => {
    const raw = {
      choices: [{ message: { content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://x/d.png" } }] } }],
    };
    expect(extractChatImageUrls(raw)).toEqual(["https://x/d.png"]);
  });
  it("② content 数组里 image_url 是字符串", () => {
    const raw = { choices: [{ message: { content: [{ type: "image_url", image_url: "https://x/e.png" }] } }] };
    expect(extractChatImageUrls(raw)).toEqual(["https://x/e.png"]);
  });
  it("③ content 字符串 · markdown ![](data:...)", () => {
    const raw = { choices: [{ message: { content: "生成好了 ![img](data:image/png;base64,CCCC) 完成" } }] };
    expect(extractChatImageUrls(raw)).toEqual(["data:image/png;base64,CCCC"]);
  });
  it("③ content 字符串 · markdown ![](http url)", () => {
    const raw = { choices: [{ message: { content: "![img](https://x/f.jpg)" } }] };
    expect(extractChatImageUrls(raw)).toEqual(["https://x/f.jpg"]);
  });
  it("③ content 字符串 · 裸 data:image base64", () => {
    const raw = { choices: [{ message: { content: "data:image/webp;base64,DDDD 就是它" } }] };
    expect(extractChatImageUrls(raw)).toEqual(["data:image/webp;base64,DDDD"]);
  });
  it("③ content 字符串 · 裸 http 图片链接", () => {
    const raw = { choices: [{ message: { content: "看这里 https://cdn.x/g.png?e=1 出图" } }] };
    expect(extractChatImageUrls(raw)).toEqual(["https://cdn.x/g.png?e=1"]);
  });
  it("纯文本无图 → 空", () => {
    expect(extractChatImageUrls({ choices: [{ message: { content: "抱歉我无法生成" } }] })).toEqual([]);
  });
  it("无 choices → 空", () => {
    expect(extractChatImageUrls({})).toEqual([]);
  });
});

// 一次运行给几份就取几份：已知形状的那一处列表整张取（b64_json 四张、n 个 choice、一段文字里几张图），别处的地址不搭车。
describe("extractAssetUrls — 一次运行的全部产物", () => {
  const four = [0, 1, 2, 3];
  it("data[].b64_json 四张 → 四个 data URL，按上游顺序", () => {
    expect(extractAssetUrls({ data: four.map((i) => ({ b64_json: `AAA${i}` })) })).toEqual(four.map((i) => `data:image/png;base64,AAA${i}`));
  });
  it("data[].url 四张；顶层另有 url 时只取顶层那一处（位置优先级不变）", () => {
    expect(extractAssetUrls({ data: four.map((i) => ({ url: `https://x/${i}.png` })) })).toHaveLength(4);
    expect(extractAssetUrls({ url: "https://x/top.png", data: four.map((i) => ({ url: `https://x/${i}.png` })) })).toEqual(["https://x/top.png"]);
  });
  it("同一地址重复出现只算一份", () => {
    expect(extractAssetUrls({ data: [{ url: "https://x/a.png" }, { url: "https://x/a.png" }, { url: "https://x/b.png" }] })).toEqual(["https://x/a.png", "https://x/b.png"]);
  });
  it("chat/completions：n 个 choice、每个 message.images 多张、一段 markdown 里几张都取", () => {
    expect(extractChatImageUrls({ choices: four.map((i) => ({ message: { images: [{ url: `https://x/c${i}.png` }] } })) })).toHaveLength(4);
    expect(extractChatImageUrls({ choices: [{ message: { images: four.map((i) => ({ url: `https://x/m${i}.png` })) } }] })).toHaveLength(4);
    expect(extractChatImageUrls({ choices: [{ message: { content: "![a](https://x/1.png) 和 ![b](https://x/2.png)" } }] })).toEqual(["https://x/1.png", "https://x/2.png"]);
  });
});
