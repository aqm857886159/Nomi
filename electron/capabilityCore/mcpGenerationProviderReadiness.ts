import { classifyGenerationProviderCapabilities, type GenerationProviderCapabilityProfile } from "./generationProviderCapabilities";
import type { GenerationPlanningHandlerDependencies } from "./mcpGenerationTools";
import type { PlanCandidate } from "./executionContract";

const RECOVERY_CAPABILITIES = ["submitIdempotency", "query", "reconcile", "cancel"] as const;

export type ProviderReadiness = {
  providerReady: boolean;
  providerCapabilityProfile: GenerationProviderCapabilityProfile;
  recoveryNotice: string;
  providerCapabilitiesMissing: string[];
  missingForSubmit: string[];
};

function recoveryNotice(profile: GenerationProviderCapabilityProfile): string {
  if (profile === "full_recovery") return "可正常生成；异常时 Nomi 可以继续查询并恢复。";
  if (profile === "observe_only") return "可正常生成；如果提交结果不确定，需要到供应商核对任务，Nomi 不会自动重提。";
  return "可正常生成；如果提交结果不确定，需要你到供应商核对后再决定，Nomi 不会自动重提。";
}

export function resolveProviderReadiness(
  deps: Pick<GenerationPlanningHandlerDependencies, "registry" | "providerReadiness">,
  candidate: PlanCandidate,
): ProviderReadiness {
  const resolved = deps.registry.resolve({ moduleId: candidate.moduleId, providerId: candidate.providerId, modelId: candidate.modelId, mode: candidate.mode });
  const providerCapabilitiesMissing = RECOVERY_CAPABILITIES.filter((capability) => !resolved.capabilities[capability]);
  const adapterReadiness = deps.providerReadiness?.({
    providerId: resolved.providerId,
    modelId: resolved.modelId,
    moduleId: resolved.moduleId,
    mode: resolved.mode,
  }) ?? { providerReady: true };
  return {
    providerReady: adapterReadiness.providerReady,
    providerCapabilityProfile: classifyGenerationProviderCapabilities(resolved.capabilities),
    recoveryNotice: recoveryNotice(classifyGenerationProviderCapabilities(resolved.capabilities)),
    providerCapabilitiesMissing,
    missingForSubmit: adapterReadiness.missingForSubmit ?? [],
  };
}
