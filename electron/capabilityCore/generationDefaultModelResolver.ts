import type { CatalogState, Model } from "../catalog/types";
import { createCatalogAvailability } from "../catalog/catalogModelAvailability";
import { derivePublishedExecution } from "../shared/modelPublication";
import {
  readGenerationModelDefaults,
  type GenerationDefaultTaskKind,
  type GenerationModelDefaults,
} from "../settings/generationModelDefaultsSettings";
import { mediaKindForTaskKind } from "../shared/contracts/generationModelDefaultsContract";
import { readCatalog } from "../catalog/catalogStore";
import { type KeyStatusProbe } from "../catalog/secrets";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";

/** The candidate identity consumed by the semantic storyboard planner. */
export type GenerationStoryboardDefault = Readonly<{
  moduleId: typeof SINGLE_SHOT_GENERATION_MODULE_ID;
  providerId: string;
  modelId: string;
  mode: GenerationDefaultTaskKind;
}>;

const MODEL_KIND_BY_TASK: Record<GenerationDefaultTaskKind, Model["kind"]> = {
  text_to_image: "image",
  image_edit: "image",
  text_to_video: "video",
  image_to_video: "video",
};

export type GenerationDefaultModelResolverDeps = Readonly<{
  keyStatusProbe?: KeyStatusProbe;
}>;

/**
 * Select a model for an Agent-created storyboard without inventing a second
 * preference store. An enabled, published model matching the saved
 * (vendorKey, modelKey) wins. A missing or stale preference returns undefined
 * so the Agent can ask the user to choose; silently selecting row zero would
 * make a paid operation unpredictable. The returned mode is always a
 * declared catalog task kind, never a transport alias guessed by the planner.
 */
export function createGenerationDefaultModelResolver(
  state: CatalogState,
  defaults: GenerationModelDefaults,
  deps: GenerationDefaultModelResolverDeps = {},
): (taskKind: GenerationDefaultTaskKind) => GenerationStoryboardDefault | undefined {
  // 「能不能用」= 唯一那道闸（供应商启用 + 模型启用 + 发布资格 + 钥匙解得开），每家只探一次钥匙。
  // 这里额外保留的只有**模式级**与**类型级**要求：发布资格是分模式的——同一个模型可能文生图发布了、
  // 改图那条 mapping 却停用着，用模型级布尔选默认会让后面的语义预览报一句看不懂的「不支持该模式」。
  const availability = createCatalogAvailability(state, deps.keyStatusProbe);

  const executable = (taskKind: GenerationDefaultTaskKind) => state.models.filter((model) =>
    model.kind === MODEL_KIND_BY_TASK[taskKind]
      && availability.of(model).usable
      && derivePublishedExecution(model, { mappings: state.mappings }).publishedModes.includes(taskKind),
  );

  return (taskKind) => {
    const candidates = executable(taskKind);
    if (candidates.length === 0) return undefined;
    const preferred = defaults.byKind[mediaKindForTaskKind(taskKind)];
    const selected = preferred
      ? candidates.find((model) => model.vendorKey === preferred.vendorKey && model.modelKey === preferred.modelKey)
      : undefined;
    const model = selected;
    if (!model) return undefined;
    // 默认只答「哪个模型」。方式不在这里挑（2026-11-17 删）：方式由归一按这个模型的档案 + 这次真放进来的参考现算，
    // 和点名别的模型、画布同一个主人（`modeForInputs`）。以前这里取「第一个同桶方式」带出去，点名别家时也被继承过去。
    return {
      moduleId: SINGLE_SHOT_GENERATION_MODULE_ID,
      providerId: model.vendorKey,
      modelId: model.modelKey,
      mode: taskKind,
    };
  };
}

/** Read the same persisted catalog/settings used by the Workbench. */
export function readGenerationDefaultModelResolver(): (taskKind: GenerationDefaultTaskKind) => GenerationStoryboardDefault | undefined {
  return createGenerationDefaultModelResolver(readCatalog(), readGenerationModelDefaults());
}
