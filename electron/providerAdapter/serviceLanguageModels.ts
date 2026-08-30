import type { LanguageModelV1 } from "ai";
import { buildLanguageModelForVendor } from "../ai/vendorLanguageModel";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { prioritizeCompilerCandidates } from "./compilerCandidatePriority";
import type { LoadedConnection } from "./serviceCatalog";
import { modelHasPublishedExecution } from "../shared/modelPublication";

export function defaultResolveLanguageModels(connection: LoadedConnection): LanguageModelV1[] {
  const state = readCatalog();
  const candidates: Array<{ vendorKey: string; modelKey: string; languageModel: LanguageModelV1 }> = [];
  for (const model of state.models) {
    if (model.kind !== "text" || !modelHasPublishedExecution(model, { mappings: state.mappings })) continue;
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled && item.baseUrlHint);
    if (!vendor || (vendor.authType && vendor.authType !== "none" && vendor.authType !== "bearer")) continue;
    const apiKey = vendor.authType === "none" ? "" : decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    if (vendor.authType !== "none" && !apiKey) continue;
    candidates.push({
      vendorKey: vendor.key,
      modelKey: model.modelKey,
      languageModel: buildLanguageModelForVendor(vendor, model, apiKey),
    });
  }
  const selectedText = connection.models.find((model) => model.kind === "text");
  if (selectedText) {
    candidates.push({
      vendorKey: connection.vendor.key,
      modelKey: selectedText.modelKey,
      languageModel: buildLanguageModelForVendor(connection.vendor, selectedText, connection.apiKey),
    });
  }
  const seen = new Set<string>();
  return prioritizeCompilerCandidates(candidates, connection.vendor.key)
    .filter((candidate) => {
      const key = `${candidate.vendorKey}\0${candidate.modelKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map((candidate) => candidate.languageModel);
}
