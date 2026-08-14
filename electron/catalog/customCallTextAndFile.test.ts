// 「结果收得住」这半边的契约钉子（2026-08-12）。
//
// 背景：此前自定义调用只认资产 URL，且文本模型被 runtime 直接挡在门外（wantedKind !== "text"）——
// 等于「接不上的文本模型没有任何出路」，而用户最初踩的正是文本模型。
// 这里锁两件事：① 文本产出必须显式、不能和资产 URL 抢形状；② saveFile 没注入时要报人话。
import { describe, expect, it } from "vitest";
import { collectCustomCallAssets, collectCustomCallText, runCustomCallScript } from "./customCallRunner";

describe("collectCustomCallText", () => {
  it("accepts the shapes an AI would plausibly emit for text", () => {
    expect(collectCustomCallText({ text: "你好" })).toBe("你好");
    expect(collectCustomCallText({ content: "hi" })).toBe("hi");
    expect(collectCustomCallText({ output_text: "yo" })).toBe("yo");
  });

  // **关键不变量**：裸字符串是资产 URL 的既有约定。若文本也认裸字符串，
  // 图片脚本 `return 'https://…png'` 就会被当成正文渲染出来。两者绝不能抢同一形状。
  it("never treats a bare string as text — that shape belongs to asset URLs", () => {
    expect(collectCustomCallText("https://cdn.example.com/a.png")).toBeUndefined();
    expect(collectCustomCallText("just some words")).toBeUndefined();
    // 反向确认：同一个值走资产通道是认的。
    expect(collectCustomCallAssets("https://cdn.example.com/a.png")).toEqual(["https://cdn.example.com/a.png"]);
  });

  it("ignores empty or non-string text fields instead of returning junk", () => {
    expect(collectCustomCallText({ text: "" })).toBeUndefined();
    expect(collectCustomCallText({ text: "   " })).toBeUndefined();
    expect(collectCustomCallText({ text: 42 })).toBeUndefined();
    expect(collectCustomCallText(null)).toBeUndefined();
    expect(collectCustomCallText(["a"])).toBeUndefined();
  });

  // 资产形状不该被误判成文本：{url} 里没有 text/content，必须落空。
  it("does not mistake an asset object for text", () => {
    expect(collectCustomCallText({ url: "https://cdn.example.com/a.mp4" })).toBeUndefined();
    expect(collectCustomCallText({ b64_json: "AAA" })).toBeUndefined();
  });

  it("lets a test run preview a small saveFile result without writing project assets", async () => {
    const outcome = await runCustomCallScript({
      vendor: { key: "custom", baseUrlHint: "https://example.com" } as never,
      model: { modelKey: "m", kind: "video" } as never,
      apiKey: "",
      prompt: "p",
      params: {},
      script: "return await saveFile(new Uint8Array([1, 2, 3]), '.mp4', 'video/mp4')",
      saveFile: async (bytes, _ext, contentType) => `data:${contentType};base64,${bytes.toString('base64')}`,
    });
    expect(outcome.assets).toEqual(["data:video/mp4;base64,AQID"]);
  });

  it("uses model kind to accept a plain text response without confusing image URLs", async () => {
    const outcome = await runCustomCallScript({
      vendor: { key: "custom", baseUrlHint: "https://example.com" } as never,
      model: { modelKey: "m", kind: "text" } as never,
      apiKey: "",
      prompt: "p",
      params: {},
      script: "return 'plain text response'",
    });
    expect(outcome).toMatchObject({ assets: [], text: "plain text response" });
  });

  it("does not treat a 200 HTML login page as a successful text response", async () => {
    await expect(runCustomCallScript({
      vendor: { key: "custom", baseUrlHint: "https://example.com" } as never,
      model: { modelKey: "m", kind: "text" } as never,
      apiKey: "",
      prompt: "p",
      params: {},
      script: "return '<!doctype html><html>sign in</html>'",
    })).rejects.toThrow(/HTML.*地址|地址.*HTML/);
  });
});
