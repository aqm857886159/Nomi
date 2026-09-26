import { describe, expect, it } from "vitest";

import { MODEL_ARCHETYPES } from ".";
import {
  archetypeBaseModelKey,
  archetypeVariantForModelId,
  canonicalArchetypeVariantId,
  resolveArchetypeVariant,
} from "./variantResolution";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../videoCapabilities";

// 「这一次生成跑哪个变体」的唯一判定。画布节点、付费卡、宿主派发、推荐、准入、参数特化都问它。
const WITH_VARIANTS = MODEL_ARCHETYPES.filter((archetype) => (archetype.variants?.length ?? 0) > 0);

describe("resolveArchetypeVariant · 报告里那一幕", () => {
  it("APIMart Seedance 2.0：目录基础行 doubao-seedance-2.0、没指定变体 → 默认的 Fast，不是反推出的 standard", () => {
    expect(resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { modelId: "doubao-seedance-2.0" })?.id).toBe("fast");
    expect(resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { modelId: "doubao-seedance-2.0" })?.modelKey).toBe("doubao-seedance-2.0-fast");
  });

  it("指定 standard 才是 standard；写变体专属名（-mini / 旧的 -2-0 拼法）照旧按那个变体", () => {
    expect(resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { variantId: "standard", modelId: "doubao-seedance-2.0" })?.id).toBe("standard");
    expect(resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { modelId: "doubao-seedance-2.0-mini" })?.id).toBe("mini");
    expect(resolveArchetypeVariant(SEEDANCE_2_APIMART_ARCHETYPE, { modelId: "doubao-seedance-2-0" })?.id).toBe("standard");
  });
});

describe("resolveArchetypeVariant · 每一个带变体的档案（视频 + 图片）", () => {
  it("确实有带变体的档案（否则下面是空转）", () => {
    expect(WITH_VARIANTS.length).toBeGreaterThan(5);
  });

  for (const archetype of WITH_VARIANTS) {
    const variants = archetype.variants!;
    const expectedDefault = variants.find((variant) => variant.id === archetype.defaultVariantId) ?? variants[0]!;
    const base = archetypeBaseModelKey(archetype)!;

    describe(archetype.id, () => {
      it("什么都没说 → 默认变体；只给基础 key → 仍是默认变体（绝不拿基础串反推）", () => {
        expect(resolveArchetypeVariant(archetype)?.id).toBe(expectedDefault.id);
        expect(resolveArchetypeVariant(archetype, { modelId: base })?.id).toBe(expectedDefault.id);
        expect(resolveArchetypeVariant(archetype, { modelId: ` ${base.toUpperCase()} ` })?.id).toBe(expectedDefault.id);
        expect(archetypeVariantForModelId(archetype, base)).toBeNull();
      });

      it("变体专属 key / 身份串（不是基础 key）→ 那个变体", () => {
        for (const variant of variants) {
          for (const identity of [variant.modelKey, ...(variant.identifierPatterns ?? [])]) {
            if (identity.trim().toLowerCase() === base.trim().toLowerCase()) continue;
            expect(resolveArchetypeVariant(archetype, { modelId: identity })?.id, identity).toBe(variant.id);
          }
        }
      });

      it("显式请求的变体（任意大小写 / 声明的别名）永远赢过模型名", () => {
        const other = variants.find((variant) => variant.id !== expectedDefault.id) ?? expectedDefault;
        for (const variant of variants) {
          expect(resolveArchetypeVariant(archetype, { variantId: variant.id.toUpperCase(), modelId: other.modelKey })?.id).toBe(variant.id);
          expect(canonicalArchetypeVariantId(archetype, ` ${variant.id} `)).toBe(variant.id);
        }
        for (const [alias, target] of Object.entries(archetype.variantIdAliases ?? {})) {
          expect(resolveArchetypeVariant(archetype, { variantId: alias })?.id, alias).toBe(target);
        }
      });

      it("认不出的变体 id 与没请求一样：按模型名，再按默认（拒绝由宿主准入带合法清单去做）", () => {
        expect(canonicalArchetypeVariantId(archetype, "no-such-variant")).toBe("");
        expect(resolveArchetypeVariant(archetype, { variantId: "no-such-variant" })?.id).toBe(expectedDefault.id);
      });
    });
  }

  it("没有变体的档案 → null", () => {
    const plain = MODEL_ARCHETYPES.find((archetype) => !archetype.variants?.length)!;
    expect(resolveArchetypeVariant(plain, { variantId: "fast", modelId: "x" })).toBeNull();
    expect(archetypeBaseModelKey(plain)).toBeUndefined();
  });
});
