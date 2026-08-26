import { describe, expect, it } from "vitest";
import { buildNormalizedRecipe, buildTaskProvenance } from "./provenance";
import type { Model, Vendor } from "../catalog/types";

const vendor = { key: "kie" } as unknown as Vendor;
const model = { modelKey: "gpt-image-2", modelAlias: "" } as unknown as Model;

describe("buildNormalizedRecipe(S4-1:一份数据三用的'机器比'侧)", () => {
  it("params 键排序且剔除路由字段(projectId/nodeId 不影响产物,进指纹会假漂)", () => {
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      request: {
        kind: "text_to_image",
        prompt: "a cat",
        seed: 42,
        width: 1024,
        extras: { zQuality: "high", aspectRatio: "16:9", projectId: "p1", nodeId: "n1" },
      },
    });
    expect(Object.keys(recipe.params)).toEqual(["aspectRatio", "width", "zQuality"]);
    expect(recipe.params).not.toHaveProperty("projectId");
    expect(recipe).toMatchObject({ vendorKey: "kie", modelKey: "gpt-image-2", seed: 42, prompt: "a cat" });
  });

  it("同输入(extras 键序不同)→ 序列化逐字节相等(S8 指纹的前提)", () => {
    const a = buildNormalizedRecipe({ vendor, model, request: { kind: "k", prompt: "p", extras: { b: 1, a: 2 } } });
    const b = buildNormalizedRecipe({ vendor, model, request: { kind: "k", prompt: "p", extras: { a: 2, b: 1 } } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildTaskProvenance(profile/fallback 两路径共用,修主路径漏写)", () => {
  it("形状与原 fallback 内联块对齐(E11 契约不变)", () => {
    const provenance = buildTaskProvenance({
      vendor,
      model,
      request: { kind: "text_to_image", prompt: "a cat", negativePrompt: "blur", seed: 7, width: 512, extras: { x: 1 } },
      vendorRequestId: "task-1",
    });
    expect(provenance).toMatchObject({
      provider: "kie",
      modelKey: "gpt-image-2",
      prompt: "a cat",
      negativePrompt: "blur",
      seed: 7,
      vendorRequestId: "task-1",
      params: { width: 512, extras: { x: 1 } },
    });
    expect(typeof provenance.timestamp).toBe("number");
  });
});

/**
 * 内联素材（data: URI）进记账面必须先摘要。
 * 三处实伤（详见 provenance.inlineAssetDigest 注释）：溯源随 project.json 永久落盘、溯源面板
 * 把 params 整段 JSON 铺进 <pre>、指纹要先把整个 extras stringify 再 sha256。
 */
describe("内联素材摘要（记账面只留身份，不留整串）", () => {
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const inline = (salt = "") => `data:image/png;base64,${Buffer.concat([pngBytes, Buffer.from(salt)]).toString("base64")}`;
  const requestWith = (url: string) => ({
    kind: "image_edit",
    prompt: "keep it",
    extras: { referenceImages: [url], archetypeInput: { image_input: [url] }, aspectRatio: "16:9" },
  });

  it("recipe 与 provenance 都换成摘要：整串 base64 一个字节都不留", () => {
    const url = inline();
    const recipe = buildNormalizedRecipe({ vendor, model, request: requestWith(url) });
    const provenance = buildTaskProvenance({ vendor, model, request: requestWith(url), vendorRequestId: "task-1" });
    for (const serialized of [JSON.stringify(recipe), JSON.stringify(provenance)]) {
      expect(serialized).not.toContain("base64,");
      expect(serialized).toContain("nomi-inline-asset:sha256-");
      expect(serialized).toContain("image/png");
    }
    // 嵌套结构（档案投影）里的那份也换掉，不只是顶层。
    const nested = (recipe.params.archetypeInput as { image_input: string[] }).image_input[0];
    expect(nested.startsWith("nomi-inline-asset:")).toBe(true);
  });

  it("摘要是内容身份：同字节恒同（指纹仍命中）、异字节恒异（不串图）", () => {
    const same = JSON.stringify(buildNormalizedRecipe({ vendor, model, request: requestWith(inline()) }));
    const sameAgain = JSON.stringify(buildNormalizedRecipe({ vendor, model, request: requestWith(inline()) }));
    const other = JSON.stringify(buildNormalizedRecipe({ vendor, model, request: requestWith(inline("x")) }));
    expect(same).toBe(sameAgain);
    expect(same).not.toBe(other);
  });

  it("非内联值原样：公网 URL / nomi-local / 普通参数不被摘要碰", () => {
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      request: { kind: "k", prompt: "p", extras: { a: "https://cdn/a.png", b: "nomi-local://asset/p/a.png", c: 3 } },
    });
    expect(recipe.params).toMatchObject({ a: "https://cdn/a.png", b: "nomi-local://asset/p/a.png", c: 3 });
  });

  it("摘要体积恒定：几 MB 的内联素材也只留一行", () => {
    const huge = `data:image/png;base64,${"A".repeat(4 * 1024 * 1024)}`;
    const recipe = buildNormalizedRecipe({ vendor, model, request: requestWith(huge) });
    expect(JSON.stringify(recipe).length).toBeLessThan(600);
    expect(JSON.stringify(recipe)).toContain("3.0MB"); // 报的是解码后体积
  });
});
