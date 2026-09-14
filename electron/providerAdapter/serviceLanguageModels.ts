import type { LanguageModelV1 } from "ai";
import { buildLanguageModelForVendor } from "../ai/vendorLanguageModel";
import { readCatalog } from "../catalog/catalogStore";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { prioritizeCompilerCandidates } from "./compilerCandidatePriority";
import type { LoadedConnection } from "./serviceCatalog";
import { createCatalogAvailability } from "../catalog/catalogModelAvailability";

type CompilerCandidate = { vendorKey: string; modelKey: string; languageModel: LanguageModelV1 };

/**
 * 谁能当「读文档写说明卡」的编译器：已发布、可执行、凭据可解密的文本模型，外加本次接入
 * 自己选中的那个文本模型（vendor 还没发布，但 key 就在手上）。
 *
 * 单独抽出来是因为**同一份判据有两个消费者**：真要跑编译时要拿到模型实例；而在 propose
 * 阶段只需要知道「有没有」——没有就把待编译的输入交回给驱动 Agent 自己编（B 路）。
 * 两处各写一遍必然漂移成「界面说没有、跑起来又有」。
 */
export function compilerLanguageModelCandidates(connection?: LoadedConnection): CompilerCandidate[] {
  const state = readCatalog();
  const availability = createCatalogAvailability(state);
  const candidates: CompilerCandidate[] = [];
  for (const model of state.models) {
    // 可用性判据只有一处；这里只加本用途独有的角色要求（text、有 baseUrl、鉴权形状认得）。
    if (model.kind !== "text" || !availability.of(model).usable) continue;
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.baseUrlHint);
    if (!vendor || (vendor.authType && vendor.authType !== "none" && vendor.authType !== "bearer")) continue;
    const apiKey = vendor.authType === "none" ? "" : decryptApiKeyRecord(state.apiKeysByVendor[vendor.key]);
    candidates.push({
      vendorKey: vendor.key,
      modelKey: model.modelKey,
      languageModel: buildLanguageModelForVendor(vendor, model, apiKey),
    });
  }
  const selectedText = connection?.models.find((model) => model.kind === "text");
  if (connection && selectedText) {
    candidates.push({
      vendorKey: connection.vendor.key,
      modelKey: selectedText.modelKey,
      languageModel: buildLanguageModelForVendor(connection.vendor, selectedText, connection.apiKey),
    });
  }
  return candidates;
}

/** propose 阶段的「Nomi 自己编得动吗」。false = 把待编译的输入交回驱动 Agent。 */
export function hasCompilerLanguageModel(): boolean {
  return compilerLanguageModelCandidates().length > 0;
}

export function defaultResolveLanguageModels(connection: LoadedConnection): LanguageModelV1[] {
  const seen = new Set<string>();
  return prioritizeCompilerCandidates(compilerLanguageModelCandidates(connection), connection.vendor.key)
    .filter((candidate) => {
      const key = `${candidate.vendorKey}\0${candidate.modelKey}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 4)
    .map((candidate) => candidate.languageModel);
}
