import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/apimart/model-generations-media.json";
import { APIMART_IMAGE_MODELS } from "./apimartImages";
import { APIMART_VIDEO_MODELS } from "./apimartVideos";
import { curatedCatalogLifecycle } from "./seedModelIdentity";

// 用户 2026-11-07：「最新代和旧一代的都可以接」——Seedance 2.0 等上一代不能被收进「更多」。
describe("media model generations: latest and previous stay available to new nodes", () => {
  it("latest and previous are not legacy; older ones are", () => {
    for (const f of fixture.families) {
      for (const k of [...f.latest, ...f.previous]) {
        expect(curatedCatalogLifecycle(k), `${f.family}/${k}`).not.toBe("legacy");
      }
      for (const k of f.older) expect(curatedCatalogLifecycle(k), `${f.family}/${k}`).toBe("legacy");
    }
  });

  // 新声明一个 APIMart 图片 / 视频模型却不登记它属于哪一代，就没有人核对它该不该进「更多」。
  it("every declared apimart image / video model is registered in the generation table", () => {
    const registered = new Set(fixture.families.flatMap((f) => [...f.latest, ...f.previous, ...f.older]));
    const declared = [...APIMART_IMAGE_MODELS, ...APIMART_VIDEO_MODELS].map((m) => m.modelKey);
    const missing = declared.filter((key) => !registered.has(key));
    expect(missing, `declared but not registered in model-generations-media.json: ${missing.join(", ")}`).toEqual([]);
  });

  it("the table has no duplicated model across families", () => {
    const seen = new Map<string, string>();
    for (const f of fixture.families) {
      for (const k of [...f.latest, ...f.previous, ...f.older]) {
        expect(seen.get(k), `${k} is listed in both ${seen.get(k)} and ${f.family}`).toBeUndefined();
        seen.set(k, f.family);
      }
    }
  });
});
