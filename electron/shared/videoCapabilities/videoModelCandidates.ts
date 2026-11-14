// 目录里的视频行 → 推荐 / MCP / Run 用的候选。档案只问唯一入口 resolveModelArchetype（供应商、型号名作用域、档都在入口里），
// 不在这里另做一份「按 id 找 + 按供应商换参数」（以前的私有副本只换 params、不收 vendorMax，匹配也比入口松：子串命中）。
// 单开这个文件：registry.ts 是档案表的登记处，入口所在的 modelArchetypes/entry.ts 加载时要读它，放回 registry 会成环。
import { resolveModelArchetype } from "../modelArchetypes/entry";
import { resolveArchetypeVariant } from "../modelArchetypes/variantResolution";
import type { VideoModelCandidate } from "./recommendation";
import { unknownVideoArchetype, type VideoCatalogModel } from "./registry";

/**
 * Resolve the current catalog into recommendation candidates. The returned
 * list changes when the user changes provider/model; no provider-name branch
 * or fixed candidate list is required by the recommender.
 */
export function buildVideoModelCandidates(models: readonly VideoCatalogModel[]): VideoModelCandidate[] {
  return models
    .filter((model) => model.provider.trim() && model.modelKey.trim())
    .map((model) => {
      // 这一行默认跑哪一档：基础行（如 `doubao-seedance-2.0`）是默认档，不是反推出的 standard（唯一 owner 的规则）。
      const resolved = resolveModelArchetype({
        modelKey: model.modelKey,
        vendorKey: model.provider,
        meta: model.archetypeId ? { archetypeId: model.archetypeId } : undefined,
        ...(model.modelNameSource ? { modelNameSource: model.modelNameSource } : {}),
      }, { variant: { variantId: undefined, modelId: model.modelKey } });
      // 视频目录行只认视频档案；认不出的给一份不编造能力的通用档案（文生 + 单图）。
      const archetype = resolved?.kind === "video" ? resolved : unknownVideoArchetype(model);
      const variantId = resolved?.kind === "video" ? archetypeVariantIdFor(archetype, model.modelKey) : undefined;
      return {
        provider: model.provider,
        modelKey: model.modelKey,
        label: model.label || model.modelKey,
        archetype,
        ...(variantId ? { variantId } : {}),
        ...(archetype.variants?.length ? {
          variantChoices: archetype.variants.map((variant) => ({ id: variant.id, label: variant.label, modelKey: variant.modelKey })),
        } : {}),
      };
    });
}

/** 这条目录行默认跑哪个变体——问唯一 owner。 */
function archetypeVariantIdFor(archetype: VideoModelCandidate["archetype"], modelKey: string): string | undefined {
  return resolveArchetypeVariant(archetype, { modelId: modelKey })?.id;
}
