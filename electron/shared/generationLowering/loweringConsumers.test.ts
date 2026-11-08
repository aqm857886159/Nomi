/** 改唯一降级函数的落点，三个真实入口必须一起跟着变，不能只调用却丢弃结果。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildArchetypeInputParams } from "../../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { GROK_IMAGINE_1_5_VIDEO_ARCHETYPE } from "../videoCapabilities/grokImagine15Video";
import { lowerHeadlessReferences } from "./headlessReferences";
import { lowerGenerationIntent } from "./lowerGenerationIntent";
import { placeApprovedRunReferences, standardizeExplicitRunReferences } from "./runReferences";

vi.mock("./lowerGenerationIntent", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lowerGenerationIntent")>();
  return { ...original, lowerGenerationIntent: vi.fn(original.lowerGenerationIntent) };
});

afterEach(() => vi.mocked(lowerGenerationIntent).mockReset());

const url = "https://cdn.example/a.png";
const body = { image_urls: "{{request.params.image_urls}}" };

describe("三个入口消费唯一降级函数的结果", () => {
  it.each([
    ["画布", () => buildArchetypeInputParams(
      { archetype: { id: GROK_IMAGINE_1_5_VIDEO_ARCHETYPE.id, modeId: "i2v" } },
      GROK_IMAGINE_1_5_VIDEO_ARCHETYPE,
      { referenceImages: [url] },
    )],
    ["headless", () => lowerHeadlessReferences(body, {
      carried: { image: [url], video: [], audio: [] },
      flat: { image: [url], video: [], audio: [] },
      placedByCanvas: { image: [], video: [], audio: [] },
      frames: {}, occupied: () => false, standardAggregateCarried: false,
    }).bodyParams],
    ["Run 非合并参考", () => placeApprovedRunReferences({}, [{ url, kind: "image" }], body, null).parameters],
    ["Run 显式参数", () => standardizeExplicitRunReferences({ imageUrls: [url] }, ["image_urls"])],
  ] as const)("%s：image_urls 落点改变时，返回值必须消费新键", async (_entry, run) => {
    const original = await vi.importActual<typeof import("./lowerGenerationIntent")>("./lowerGenerationIntent");
    vi.mocked(lowerGenerationIntent).mockImplementation((declaration, intent) => {
      const result = original.lowerGenerationIntent(declaration, intent);
      expect(result.bodyParams).toHaveProperty("image_urls");
      const { image_urls: value, ...rest } = result.bodyParams;
      return { ...result, bodyParams: { ...rest, S3_WRONG_IMAGE_KEY: value } };
    });
    const result = run();
    expect(lowerGenerationIntent).toHaveBeenCalled();
    expect(result).toHaveProperty("S3_WRONG_IMAGE_KEY", [url]);
    expect(result).not.toHaveProperty("image_urls");
  });
});
