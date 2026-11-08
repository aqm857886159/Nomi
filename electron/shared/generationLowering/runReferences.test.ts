/**
 * Run 路把参考说成意图的那一步。官方字段矩阵逐格比整条请求体；这里钉住矩阵里没有夹具、只靠逐字节对比才看得出的两条：
 *  · URL 数组参考位落进 body 读的同组写法、按数组发——即使这一档模式只收 1 张（headless 的单值位降级会把它发成字符串，
 *    官方 image_urls 是 string[]）；
 *  · 合并槽单槽超量不在这一步拒（Run 路历来按族数，见 assertResolvedReferences）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../videoCapabilities/seedanceApimart";
import { lowerGenerationIntent } from "./lowerGenerationIntent";
import { placeApprovedRunReferences, runReferenceGroupOf, standardizeExplicitRunReferences } from "./runReferences";

vi.mock("./lowerGenerationIntent", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lowerGenerationIntent")>();
  return { ...original, lowerGenerationIntent: vi.fn(original.lowerGenerationIntent) };
});
afterEach(() => vi.mocked(lowerGenerationIntent).mockClear());

const imageUrlsBody = { model: "m", image_urls: "{{request.params.image_urls}}" };

describe("placeApprovedRunReferences", () => {
  it.each([
    ["body 读一个键", imageUrlsBody, ["image_urls"]],
    ["body 读同组全部写法", { image_urls: "{{request.params.image_urls}}", imageUrls: "{{request.params.imageUrls}}" }, ["image_urls", "imageUrls"]],
    ["body 不读同组键", { model: "m", prompt: "{{request.prompt}}" }, []],
  ])("%s：只交数组原值和同组匹配声明，消费降级结果", (_name, body, readKeys) => {
    const placed = placeApprovedRunReferences({}, [{ url: "https://cdn.example/a.png", kind: "image" }], body, null);
    expect(lowerGenerationIntent).toHaveBeenCalledWith(
      { slots: [], combine: null, joinsCombine: [] },
      { references: [], preservedReferences: [{ kind: "image_ref", value: ["https://cdn.example/a.png"], keys: runReferenceGroupOf("referenceImageUrls"), readKeys, selection: "all-read-or-first" }] },
    );
    const lowered = vi.mocked(lowerGenerationIntent).mock.results[0]!.value;
    expect(placed.parameters).toEqual(lowered.bodyParams);
    expect(placed.placedKeys).toEqual(Object.keys(lowered.bodyParams));
  });

  it("显式参数里写死的地址与授权时封存的不一致 → 拒", () => {
    expect(() => placeApprovedRunReferences(
      { imageUrls: ["https://cdn.example/other.png"] },
      [{ url: "https://cdn.example/a.png", kind: "image" }],
      imageUrlsBody,
      null,
    )).toThrow(/conflicts with canonical parameters/);
  });

  it("合并槽单槽超量不在这一步拒：两张首帧都进 image_with_roles", () => {
    const mode = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((candidate) => candidate.id === "firstlast")!;
    const body = { image_with_roles: "{{request.params.image_with_roles}}" };
    const placed = placeApprovedRunReferences({}, [
      { url: "https://cdn.example/a.png", kind: "image", role: "first_frame" },
      { url: "https://cdn.example/b.png", kind: "image", role: "first_frame" },
    ], body, mode);
    expect(placed.parameters).toEqual({
      image_with_roles: [
        { url: "https://cdn.example/a.png", role: "first_frame" },
        { url: "https://cdn.example/b.png", role: "first_frame" },
      ],
    });
  });
});

describe("standardizeExplicitRunReferences", () => {
  it("显式 imageUrls 落进 body 读的 image_urls，按数组", () => {
    expect(standardizeExplicitRunReferences({ imageUrls: ["https://cdn.example/a.png"] }, ["image_urls"]))
      .toEqual({ imageUrls: ["https://cdn.example/a.png"], image_urls: ["https://cdn.example/a.png"] });
  });

  it("显式首帧写法 body 不读 → 标准首帧键（之后按 body 的帧位放）", () => {
    expect(standardizeExplicitRunReferences({ firstFrameImage: "https://cdn.example/a.png" }, ["first_frame_image"]))
      .toEqual({ firstFrameImage: "https://cdn.example/a.png", first_frame_url: "https://cdn.example/a.png" });
  });
});
