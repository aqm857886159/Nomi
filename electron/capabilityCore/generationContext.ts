import { deepFreeze } from "../jsonUtils";

export type GenerationContextAsset = {
  assetId: string;
  contentHash: string;
  version: number;
  kind: string;
};

export type GenerationContextProviderProfile = {
  providerId: string;
  modelIds: string[];
};

export type GenerationContext = {
  projectId: string;
  immutableProjectUuid: string;
  projectGeneration: number;
  assets: GenerationContextAsset[];
  providerProfiles: GenerationContextProviderProfile[];
};

export function createGenerationContext(input: GenerationContext): Readonly<GenerationContext> {
  if (!input.projectId.trim() || !input.immutableProjectUuid.trim() || !Number.isInteger(input.projectGeneration) || input.projectGeneration < 0) {
    throw new Error("Generation context project identity is invalid");
  }
  return deepFreeze(structuredClone(input));
}

