import { describe, expect, it } from "vitest";
import fixture from "../../tests/fixtures/apimart/model-generations-media.json";
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
});
