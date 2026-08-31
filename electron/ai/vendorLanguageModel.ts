// 按 catalog 里的 Vendor/Model 造一个 AI SDK LanguageModelV1。
//
// 单一真相源(P1):对话引擎(agentChatV2)与文本任务引擎(streamTextTask)都从这里取
// 模型构造,不再各写一份「vendor → baseURL/headers → buildAiSdkModel」的拼装。
import type { LanguageModelV1 } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { endpoint } from "../vendorEndpoint";
import { extractVendorExtraHeaders, normalizeProviderKind } from "../catalog/catalogStore";
import type { Model, Vendor } from "../catalog/types";

export function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  const providerKind = normalizeProviderKind(vendor.providerKind);
  // anthropic 系认 baseUrlHint 原样;其余 provider 统一补 /v1（openai-compatible 形状）。
  const baseURL = providerKind === "anthropic"
    ? (vendor.baseUrlHint || "").trim()
    : endpoint(vendor, "/v1");
  const headers = extractVendorExtraHeaders(vendor);
  return buildAiSdkModel({
    kind: providerKind,
    baseURL,
    apiKey,
    authType: vendor.authType,
    modelId: model.modelAlias || model.modelKey,
    ...(headers ? { headers } : {}),
  });
}
