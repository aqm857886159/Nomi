import { describe, expect, it } from "vitest";

import { DRAFT_FIELD_FOR_MISPLACED_PARAMETER, draftFieldForMisplacedParameter } from "./draftFieldAliases";
import { draftShotSchema } from "./verbs/writeVerbs";

describe("放错位置的字段对照表", () => {
  it("每个目标都是 draft_shots 每一镜真实存在的字段（schema 改名而这里没跟上就红）", () => {
    const real = new Set(Object.keys(draftShotSchema.shape));
    for (const [alias, field] of Object.entries(DRAFT_FIELD_FOR_MISPLACED_PARAMETER)) {
      expect(real.has(field), `${alias} → ${field}`).toBe(true);
    }
  });

  it("认大小写与 _ - 的写法差异", () => {
    for (const written of ["variant", "Variant", "variant_id", "variant-id", "variantId"]) expect(draftFieldForMisplacedParameter(written)).toBe("variantId");
    // 点名模型只有一个家（2026-11-15）：模型 id、供应商写进 parameters 的，全指向同一个完整名字字段。
    for (const written of ["model", "model_id", "modelId", "vendor", "provider", "providerId"]) expect(draftFieldForMisplacedParameter(written)).toBe("model");
    expect(draftFieldForMisplacedParameter("mode")).toBe("modeId");
    expect(draftFieldForMisplacedParameter("seed")).toBeUndefined();
  });
});
