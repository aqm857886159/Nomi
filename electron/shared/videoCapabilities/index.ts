export { buildVideoModelCandidates, sourceBackedVideoProfiles, videoArchetypeIdFromMeta } from "./registry";

// Video archetype definitions live here (canonical home). This barrel is the
// single public surface the renderer imports from — no re-export shells in
// src/config/modelArchetypes (P1: 搬家不留转发壳). Keep alphabetized by source module.
export { AGNES_VIDEO_ARCHETYPE } from "./agnesVideo";
export { AGNES_VIDEO_25_ARCHETYPE, AGNES_VIDEO_25_FLASH_ARCHETYPE } from "./agnesVideo25";
export { DREAMINA_MULTIFRAME_ARCHETYPE } from "./dreaminaMultiframe";
export { DREAMINA_SEEDANCE_ARCHETYPE } from "./dreaminaSeedance";
export { GEMINI_OMNI_11_ARCHETYPE } from "./geminiOmni11";
export { GROK_IMAGINE_1_5_VIDEO_ARCHETYPE } from "./grokImagine15Video";
export { HAILUO_2_3_ARCHETYPE } from "./hailuo23";
export { HAPPYHORSE_ARCHETYPE } from "./happyhorse";
export { HAPPYHORSE_1_1_ARCHETYPE } from "./happyhorse11";
export { KLING_3_ARCHETYPE } from "./kling";
export { KLING_3_TURBO_ARCHETYPE } from "./kling30Turbo";
export { MINIMAX_H3_ARCHETYPE } from "./minimaxH3";
export { MINIMAX_H3_APIMART_ARCHETYPE } from "./minimaxH3Apimart";
export { MINIMAX_H3_MAX_ARCHETYPE } from "./minimaxH3Max";
export { MINIMAX_H3_REGENERATION_ARCHETYPE } from "./minimaxH3Regeneration";
export { OMNI_FLASH_EXT_ARCHETYPE } from "./omniFlashExt";
export { RUNNINGHUB_SEEDANCE_ARCHETYPE } from "./runninghubSeedance";
export { RUNNINGHUB_VIDEO_ARCHETYPES } from "./runninghubVideoArchetypes";
export { RUNWAY_GEN45_ARCHETYPE } from "./runwayGen45";
export { RUNWAY_GEN4_TURBO_ARCHETYPE } from "./runwayGen4Turbo";
export { SEEDANCE_2_ARCHETYPE } from "./seedance";
export { SEEDANCE_2_5_ARCHETYPE } from "./seedance25";
export { SEEDANCE_2_5_APIMART_ARCHETYPE } from "./seedance25Apimart";
export { SEEDANCE_2_APIMART_ARCHETYPE } from "./seedanceApimart";
export { SEEDANCE_VOLCENGINE_ARCHETYPE } from "./seedanceVolcengine";
export { SEEDANCE_VOLCENGINE_2_5_ARCHETYPE } from "./seedanceVolcengine25";
export { SORA_2_ARCHETYPE } from "./sora2";
export { VEO_3_1_ARCHETYPE } from "./veo31";
export { VIDU_Q3_ARCHETYPE } from "./viduQ3";
export { WAN_2_7_ARCHETYPE } from "./wan27";
export { WAN_3_0_ARCHETYPE } from "./wan30";
export { WAN_3_0_APIMART_ARCHETYPE } from "./wan30Apimart";

export { modeTransportFor } from "./modeTransport";
export { applyMergeProposal, applySplitProposal, resolveGenerationPlan } from "./planResolver";
export { GenerationResolveErrorCode } from "./planResolutionContracts";
export { canonicalVideoVariantId, effectiveVideoModes, recommendVideoGeneration } from "./recommendation";
export type {
  VideoCatalogModel,
} from "./registry";
export type {
  ArchetypeExpressionChannel,
  ArchetypeIntent,
  ArchetypeMode,
  ArchetypeReferenceSlot,
  ArchetypeReferenceSlotKind,
  ArchetypeSource,
  ModelArchetype,
  ModelArchetypeVariant,
  ModelParameterControl,
} from "./types";
export type {
  GenerationResolutionInput,
  GenerationResolutionResult,
  MergeProposal,
  PlanIssue,
  PlanShotInput,
  PlanShotOutput,
  SplitProposal,
} from "./planResolver";
export type {
  GenerationResolvePlanEnvelope,
  GenerationResolvePlanRequest,
  GenerationResolvePlanValue,
  GenerationResolveShotView,
} from "./planResolutionContracts";
export type {
  VideoGenerationRecommendation,
  VideoGenerationRecommendationInput,
  VideoGenerationRecommendationResult,
  VideoModelCandidate,
  VideoReferenceInput,
} from "./recommendation";
