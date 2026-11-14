export {
  archetypeBaseModelKey,
  archetypeVariantForModelId,
  canonicalArchetypeVariantId,
  resolveArchetypeVariant,
} from "./variantResolution";
export type { VariantBearingArchetype } from "./variantResolution";
export { installModelNameSourceLookup, isModelNameSource, modelNameSourceFor, scopeArchetypeModelNames } from "./modelNameSource";
export type { ModelNameSource, ModelNameSourceLookup } from "./modelNameSource";

export type { ModelArchetype, ArchetypeMode, ArchetypeReferenceSlot, ArchetypeReferenceSlotKind, ArchetypeExpressionChannel, ArchetypeIntent, ArchetypeTransportTaskKind, ModelArchetypeVariant } from "./types";
export { combineChannelForMode, combineRoleForSlot, modeTransportFor, recommendVideoGeneration, REFERENCE_ROLE_FOR_KIND, slotJoinsCombine } from "../videoCapabilities";
export type { ReferenceCombineChannel } from "../videoCapabilities";
export type {
  VideoGenerationRecommendation,
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
  VideoReferenceInput,
} from "../videoCapabilities";
export {
  CUSTOM_CAPABILITY_CONTRACT_META_KEY,
  CUSTOM_CAPABILITY_CONTRACT_VERSION,
  normalizeCustomCapabilityContract,
  parseCustomCapabilityContract,
  replaceCustomCapabilityContractMeta,
} from "./customCapabilityContract";
export type { CustomCapabilityContractV1, CustomCapabilityModeV1 } from "./customCapabilityContract";
export {
  archetypeParameterControls,
  everyBuiltInArchetype,
  EVERY_VARIANT,
  rescopeArchetypeVariant,
  resolveModelArchetype,
  specializeArchetypeForVendor,
  variantRecordedInMeta,
} from "./entry";
export type { ArchetypeModelLike, ArchetypeVariantPick, ArchetypeVariantRequest } from "./entry";
