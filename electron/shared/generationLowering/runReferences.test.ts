/**
 * Run 路把参考说成意图的那一步。官方字段矩阵逐格比整条请求体；这里钉住矩阵里没有夹具、只靠逐字节对比才看得出的两条：
 *  · URL 数组参考位落进 body 读的同组写法、按数组发——即使这一档模式只收 1 张（headless 的单值位降级会把它发成字符串，
 *    官方 image_urls 是 string[]）；
 *  · 合并槽单槽超量不在这一步拒（Run 路历来按族数，见 assertResolvedReferences）。
 */
import { describe, expect, it } from "vitest";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../videoCapabilities/seedanceApimart";
import { placeApprovedRunReferences, standardizeExplicitRunReferences } from "./runReferences";

const imageUrlsBody = { model: "m", image_urls: "{{request.params.image_urls}}" };

describe("placeApprovedRunReferences", () => {
  it("合同参考图落进 body 读的 image_urls，按数组发", () => {
    const placed = placeApprovedRunReferences({}, [{ url: "https://cdn.example/a.png", kind: "image", role: "reference" }], imageUrlsBody, null);
    expect(placed.parameters).toEqual({ image_urls: ["https://cdn.example/a.png"] });
    expect(placed.placedKeys).toEqual(["image_urls"]);
  });

  it("body 读同一参考位的几种写法，每一种都放（与 body 读到的写法一一对应）", () => {
    const body = { image_urls: "{{request.params.image_urls}}", imageUrls: "{{request.params.imageUrls}}" };
    const placed = placeApprovedRunReferences({}, [{ url: "https://cdn.example/a.png", kind: "image" }], body, null);
    expect(placed.parameters).toEqual({ image_urls: ["https://cdn.example/a.png"], imageUrls: ["https://cdn.example/a.png"] });
  });

  it("body 一个同组写法都不读 → 落进组的标准写法 image_urls（以前那张表写的就是它，之后由闸门拒，报错称呼不变）", () => {
    const placed = placeApprovedRunReferences({}, [{ url: "https://cdn.example/a.png", kind: "image" }], { model: "m", prompt: "{{request.prompt}}" }, null);
    expect(placed.parameters).toEqual({ image_urls: ["https://cdn.example/a.png"] });
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
