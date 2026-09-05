import type { CatalogState, Model } from "../catalog/types";
import { derivePublishedExecution } from "../shared/modelPublication";
import {
  readGenerationModelDefaults,
  type GenerationDefaultTaskKind,
  type GenerationModelDefaults,
} from "../settings/generationModelDefaultsSettings";
import { readCatalog } from "../catalog/catalogStore";
import { apiKeyDecryptStatus, type ApiKeyDecryptStatus, type ApiKeyRecord } from "../catalog/secrets";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta } from "../shared/videoCapabilities/registry";
import { effectiveVideoModes } from "../shared/videoCapabilities/recommendation";
import { SINGLE_SHOT_GENERATION_MODULE_ID } from "../shared/generationModuleId";

/** The candidate identity consumed by the semantic storyboard planner. */
export type GenerationStoryboardDefault = Readonly<{
  moduleId: typeof SINGLE_SHOT_GENERATION_MODULE_ID;
  providerId: string;
  modelId: string;
  mode: GenerationDefaultTaskKind;
  modeId?: string;
}>;

const MODEL_KIND_BY_TASK: Record<GenerationDefaultTaskKind, Model["kind"]> = {
  text_to_image: "image",
  image_edit: "image",
  text_to_video: "video",
  image_to_video: "video",
};

/**
 * Credential probe seam for the pure resolver. Production uses the same
 * safeStorage-backed status function as the catalog health/readiness paths;
 * focused tests can inject a deterministic probe without ever handling a
 * real secret. A saved-but-unverified record is intentionally not executable.
 */
export type GenerationCredentialStatusProbe = (
  record: ApiKeyRecord | undefined,
) => ApiKeyDecryptStatus;

export type GenerationDefaultModelResolverDeps = Readonly<{
  keyStatusProbe?: GenerationCredentialStatusProbe;
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
  const probe = deps.keyStatusProbe ?? apiKeyDecryptStatus;
  const vendorByKey = new Map(state.vendors.map((vendor) => [vendor.key, vendor] as const));
  // One credential record is shared by every model of a vendor. Probe it once
  // per resolver snapshot so locked credentials do not trigger repeated
  // safeStorage calls/logs while resolving several task kinds.
  const keyStatusByVendor = new Map<string, ApiKeyDecryptStatus>();
  const credentialReady = (vendorKey: string): boolean => {
    const vendor = vendorByKey.get(vendorKey);
    if (!vendor || !vendor.enabled) return false;
    // Local/no-auth vendors (for example ComfyUI) have no credential to
    // decrypt. All other vendors require a present, enabled, decryptable key.
    if (vendor.authType === "none") return true;
    const record = state.apiKeysByVendor[vendorKey];
    if (!record || record.enabled !== true) return false;
    let status = keyStatusByVendor.get(vendorKey);
    if (status === undefined) {
      status = probe(record);
      keyStatusByVendor.set(vendorKey, status);
    }
    return status === "ok";
  };

  const executable = (taskKind: GenerationDefaultTaskKind) => state.models.filter((model) =>
    model.enabled === true
      && model.kind === MODEL_KIND_BY_TASK[taskKind]
      // Publication is mode-specific.  A model may be published for text-to-
      // image while its image-edit mapping is disabled (and vice versa); using
      // the model-level boolean here would select an unusable default and make
      // the later semantic preview fail with an opaque unsupported-mode error.
      && derivePublishedExecution(model, { mappings: state.mappings }).publishedModes.includes(taskKind)
      && credentialReady(model.vendorKey),
  );

  return (taskKind) => {
    const candidates = executable(taskKind);
    if (candidates.length === 0) return undefined;
    const preferred = defaults.byTaskKind[taskKind];
    const selected = preferred
      ? candidates.find((model) => model.vendorKey === preferred.vendorKey && model.modelKey === preferred.modelKey)
      : undefined;
    const model = selected;
    if (!model) return undefined;
    const modeId = model.kind === "video"
      ? (() => {
        const video = buildVideoModelCandidates([{
          provider: model.vendorKey,
          modelKey: model.modelKey,
          label: model.labelZh,
          archetypeId: videoArchetypeIdFromMeta(model.meta),
        }])[0];
        return video
          ? effectiveVideoModes(video).find((mode) => mode.transportTaskKind === taskKind)?.id
          : undefined;
      })()
      : undefined;
    return {
      moduleId: SINGLE_SHOT_GENERATION_MODULE_ID,
      providerId: model.vendorKey,
      modelId: model.modelKey,
      mode: taskKind,
      ...(modeId ? { modeId } : {}),
    };
  };
}

/** Read the same persisted catalog/settings used by the Workbench. */
export function readGenerationDefaultModelResolver(): (taskKind: GenerationDefaultTaskKind) => GenerationStoryboardDefault | undefined {
  return createGenerationDefaultModelResolver(readCatalog(), readGenerationModelDefaults());
}
