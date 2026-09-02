import type { PlanCandidate } from "./executionContract";
import {
  projectMultiShotPreview,
  type ModelPricing,
  type MultiShotPreviewProjection,
} from "../productionRun/shotPricing";
import {
  candidateHasCharacterReference,
  modelSupportsReferenceImage,
  normalizeVideoCandidate,
  shotDurationSeconds,
} from "./mcpGenerationVideoResolve";
import type { VideoModelCandidate } from "../shared/videoCapabilities/recommendation";

type PreviewOperation = Readonly<{
  shots?: ReadonlyArray<Readonly<{
    shotId: string;
    role?: "anchor" | "shot";
    included?: boolean;
    candidate: PlanCandidate;
  }>>;
}>;

type PreviewOptions = Readonly<{
  videoModelCandidates?: readonly VideoModelCandidate[];
  resolveModelPricing?: (providerId: string, modelId: string) => ModelPricing | undefined;
}>;

/**
 * Build the provider-free preview for one semantic operation.  Multi-shot
 * previews use the same included video rows as the confirmation gate; the
 * top-level candidate is only the legacy single-shot fallback.
 */
export function projectGenerationOperationPreview(
  operation: PreviewOperation,
  fallbackCandidate: PlanCandidate,
  options: PreviewOptions,
): MultiShotPreviewProjection {
  const includedVideo = (operation.shots ?? [])
    .filter((shot) => shot.role !== "anchor" && shot.included !== false);
  const shots = includedVideo.length > 0
    ? includedVideo.map((shot) => {
      const candidate = normalizeVideoCandidate(shot.candidate, options.videoModelCandidates);
      return {
        shotId: shot.shotId,
        candidate,
        hasCharacter: candidateHasCharacterReference(candidate),
        supportsReferenceImage: modelSupportsReferenceImage(candidate, options.videoModelCandidates),
      };
    })
    : (() => {
      const candidate = normalizeVideoCandidate(fallbackCandidate, options.videoModelCandidates);
      return [{
        shotId: candidate.candidateId,
        candidate,
        hasCharacter: candidateHasCharacterReference(candidate),
        supportsReferenceImage: modelSupportsReferenceImage(candidate, options.videoModelCandidates),
      }];
    })();
  return projectMultiShotPreview({
    shots,
    resolvePricing: (providerId, modelId) => options.resolveModelPricing?.(providerId, modelId),
    durationSeconds: (candidate) => shotDurationSeconds(candidate as PlanCandidate),
    currency: "CNY",
  });
}
