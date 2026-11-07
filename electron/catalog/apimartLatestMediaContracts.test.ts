import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/apimart/model-generations-media.json";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { curatedCatalogLifecycle } from "./seedModelIdentity";

type Family = { family: string; latest: string[]; previous: string[]; older: string[]; userKept?: string[] };
const families: Family[] = fixture.families;
const allKeys = (f: Family) => [...f.latest, ...f.previous, ...f.older, ...(f.userKept ?? [])];

// 用户 2026-11-07：「最新代和旧一代的都可以接」——Seedance 2.0 等上一代不能被收进「更多」。
describe("media model generations: latest and previous stay available to new nodes", () => {
  it("latest and previous are not legacy; older ones are", () => {
    for (const f of families) {
      for (const k of [...f.latest, ...f.previous]) {
        expect(curatedCatalogLifecycle(k), `${f.family}/${k}`).not.toBe("legacy");
      }
      // 用户点名保留（GPT Image 2：「image2留着」）：比上一代还早，也不许进「更多」。
      for (const k of f.userKept ?? []) expect(curatedCatalogLifecycle(k), `${f.family}/${k} 用户点名保留`).not.toBe("legacy");
      for (const k of f.older) expect(curatedCatalogLifecycle(k), `${f.family}/${k}`).toBe("legacy");
    }
  });

  // GPT Image 2.6 是这一家最新一代：旗舰，推荐排序不排在上一代（2.5，同为旗舰）后面。
  it("gpt image 2.6 (latest) is flagship, same tier as the previous generation", () => {
    const gpt = families.find((f) => f.family === "gpt-image")!;
    for (const k of gpt.latest) expect(curatedCatalogLifecycle(k), k).toBe("flagship");
    for (const k of gpt.previous) expect(curatedCatalogLifecycle(k), k).toBe("flagship");
  });

  // 新声明一个 APIMart 图片 / 视频模型却不登记它属于哪一代，就没有人核对它该不该进「更多」。
  it("every declared apimart image / video model is registered in the generation table", () => {
    const registered = new Set(families.flatMap(allKeys));
    const declared = [...APIMART_IMAGE_MODELS, ...APIMART_VIDEO_MODELS].map((m) => m.modelKey);
    const missing = declared.filter((key) => !registered.has(key));
    expect(missing, `declared but not registered in model-generations-media.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("the table has no duplicated model across families", () => {
    const seen = new Map<string, string>();
    for (const f of families) {
      for (const k of allKeys(f)) {
        expect(seen.get(k), `${k} is listed in both ${seen.get(k)} and ${f.family}`).toBeUndefined();
        seen.set(k, f.family);
      }
    }
  });
});
