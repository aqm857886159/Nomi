import { decryptApiKeyRecord, type ApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import { modelHasPublishedExecution } from "../shared/modelPublication";
import { modelSupportsToolCalls } from "../shared/textModelCapabilities";
import { modelSuccessorDepth } from "../shared/vendorLineage";
import { modelSupportsImageInput } from "./agentUserContent";

// vision/preview/audio 等常不可靠发 tool_use → 无偏好时降权（仍作回退），让通用对话模型优先做 Agent 主控（2026-06-07 真机走查 P0）。
const AUTO_TEXT_MODEL_DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i;
function autoTextModelPenalty(model: Model): number {
  return AUTO_TEXT_MODEL_DEPRIORITIZE.test(`${model.modelKey} ${model.modelAlias ?? ""}`) ? 1 : 0;
}

function imageInputRank(model: Model): number {
  return modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta) ? 1 : 0;
}

/**
 * Some catalog text entries are asynchronous task profiles rather than
 * chat-completions models (for example APIMart MiniMax H3 Context-IR). Keep
 * those available to the workbench's prompt_refine mapping, but never let the
 * generic Agent route them through /v1/chat/completions.
 */
function isPromptRefineOnlyModel(model: Model): boolean {
  return Boolean(
    model.meta &&
      typeof model.meta === "object" &&
      (model.meta as { promptRefineOnly?: unknown }).promptRefineOnly === true,
  );
}

export type TextModelPreference = {
  modelKey?: string;
  vendorKey?: string;
};

export class TextModelCredentialError extends Error {
  readonly code = "text_model_credential_locked" as const;

  constructor() {
    super("Model is not configured: text model credential is locked. Open model settings and save the API key again.");
    this.name = "TextModelCredentialError";
  }
}

export type TextModelUnavailableReason =
  | "vendor_missing"
  | "vendor_disabled"
  | "model_missing"
  | "model_disabled"
  | "model_unpublished"
  | "model_incompatible"
  | "credential_missing"
  | "credential_needs_resave"
  | "credential_locked";

export class TextModelUnavailableError extends Error {
  readonly code = "text_model_unavailable" as const;

  constructor(
    readonly reason: TextModelUnavailableReason,
    readonly vendorKey: string,
    readonly modelKey: string,
  ) {
    const detail = reason === "model_incompatible"
      ? "selected text model does not support assistant tools"
      : `selected text model is unavailable (${reason})`;
    super(`Model is not configured: ${detail}. Open model settings and select an available model.`);
    this.name = "TextModelUnavailableError";
  }
}

function configuredCredential(record: ApiKeyRecord | undefined): boolean {
  return Boolean(record?.enabled && record.enc === "safeStorage" && record.apiKey.trim());
}

function modelIdentityMatches(model: Model, modelKey: string): boolean {
  const selected = modelKey.trim();
  return model.modelKey === selected || model.modelAlias?.trim() === selected;
}

function isExecutableTextModel(state: CatalogState, model: Model): boolean {
  return model.kind === "text"
    && model.enabled
    && !isPromptRefineOnlyModel(model)
    && modelSupportsToolCalls(model.meta)
    && modelHasPublishedExecution(model, { mappings: state.mappings });
}

function unavailableReason(state: CatalogState, vendorKey: string, modelKey: string): TextModelUnavailableReason {
  const vendor = state.vendors.find((item) => item.key === vendorKey);
  if (!vendor) return "vendor_missing";
  if (!vendor.enabled) return "vendor_disabled";
  const model = state.models.find((item) => item.vendorKey === vendorKey && modelIdentityMatches(item, modelKey));
  if (!model) return "model_missing";
  if (!model.enabled) return "model_disabled";
  if (model.kind !== "text" || isPromptRefineOnlyModel(model) || !modelSupportsToolCalls(model.meta)) {
    return "model_incompatible";
  }
  if (!modelHasPublishedExecution(model, { mappings: state.mappings })) return "model_unpublished";
  const credential = state.apiKeysByVendor[vendorKey];
  if (vendor.authType === "none") return "model_unpublished";
  if (!credential?.enabled || !credential.apiKey.trim()) return "credential_missing";
  return credential.enc === "plain" ? "credential_needs_resave" : "credential_locked";
}

/**
 * Rank catalog candidates before credentials are resolved. The exact
 * (vendorKey, modelKey) identity always wins; a matching modelKey without a
 * vendor is only a compatibility fallback for old callers. This keeps a
 * same-named model from silently switching providers when the user selected
 * a specific vendor in the picker.
 */
export function selectTextModelCandidates(
  state: CatalogState,
  preference?: TextModelPreference,
  preferImageInput = false,
): Array<{ vendor: Vendor; model: Model }> {
  const texts = state.models.filter((item) => isExecutableTextModel(state, item));
  // 有偏好：用户选的排第一（其余作回退）。
  // 无偏好且本轮带图：优先支持图片输入的 text 模型（gpt-4o/claude/gemini 既能看图又擅长 tool_use）。
  // 无偏好无图：不盲选第一个，按「是否像通用对话模型」稳定排序，vision/preview 降到末尾。
  const preferredModelKey = preference?.modelKey?.trim();
  const preferredVendorKey = preference?.vendorKey?.trim();
  if (preferredModelKey && preferredVendorKey) {
    const exact = texts.find((model) =>
      model.vendorKey === preferredVendorKey && modelIdentityMatches(model, preferredModelKey));
    const exactVendor = exact
      ? state.vendors.find((vendor) => vendor.key === exact.vendorKey && vendor.enabled)
      : undefined;
    if (exact && exactVendor) return [{ vendor: exactVendor, model: exact }];

    const successor = texts.flatMap((model) => {
      if (!modelIdentityMatches(model, preferredModelKey)) return [];
      const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
      if (!vendor) return [];
      const depth = modelSuccessorDepth(
        state.vendors,
        vendor.key,
        preferredVendorKey,
        [preferredModelKey, model.modelKey, model.modelAlias ?? ""],
      );
      return depth && depth > 0 ? [{ vendor, model, depth }] : [];
    }).sort((a, b) => b.depth - a.depth
      || b.model.updatedAt.localeCompare(a.model.updatedAt)
      || a.vendor.key.localeCompare(b.vendor.key))[0];
    if (successor) return [{ vendor: successor.vendor, model: successor.model }];
    throw new TextModelUnavailableError(
      unavailableReason(state, preferredVendorKey, preferredModelKey),
      preferredVendorKey,
      preferredModelKey,
    );
  }
  const preferenceRank = (model: Model): number => {
    if (!preferredModelKey || !modelIdentityMatches(model, preferredModelKey)) return 0;
    return 1;
  };
  const ordered = preferredModelKey
    ? [...texts].sort((a, b) => preferenceRank(b) - preferenceRank(a))
    : preferImageInput
      ? [...texts].sort((a, b) => imageInputRank(b) - imageInputRank(a))
      : [...texts].sort((a, b) => autoTextModelPenalty(a) - autoTextModelPenalty(b));
  return ordered.flatMap((model) => {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
    return vendor ? [{ vendor, model }] : [];
  });
}

export function chooseTextModel(
  prefModelKey?: string,
  preferImageInput = false,
  prefVendorKey?: string,
): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const modelKey = prefModelKey?.trim() ?? "";
  const vendorKey = prefVendorKey?.trim() ?? "";
  const exactIdentity = Boolean(modelKey && vendorKey);
  const candidates = selectTextModelCandidates(
    state,
    modelKey ? { modelKey, vendorKey } : undefined,
    preferImageInput,
  );
  let lockedCredential = false;
  for (const { vendor, model } of candidates) {
    if (vendor.authType === "none") return { vendor, model, apiKey: "" };
    const record = state.apiKeysByVendor[model.vendorKey];
    if (!configuredCredential(record)) continue;
    const apiKey = decryptApiKeyRecord(record);
    if (apiKey) return { vendor, model, apiKey };
    if (record?.enc === "safeStorage") lockedCredential = true;
  }
  if (exactIdentity) {
    const candidate = candidates[0];
    const reason = candidate
      ? unavailableReason(state, candidate.vendor.key, candidate.model.modelKey)
      : unavailableReason(state, vendorKey, modelKey);
    throw new TextModelUnavailableError(reason, vendorKey, modelKey);
  }
  if (lockedCredential) throw new TextModelCredentialError();
  // 稳定 code 前缀（沿用 electron 侧「专用签名」范式：Model is retired: / Model kind mismatch: …）。
  // 渲染层 classifyGenerationError 按 "no usable text model" 签名归 model-config 报人话，不再原样甩英文散句
  // （2026-08-25 走查：旧散句「No local text model is configured…」落进 unknown 分类，被原串直通给用户）。
  throw new Error("Model is not configured: no usable text model. Open model settings and add an API key.");
}

/**
 * 解析默认文本大脑的 vendor/model 键（**不含 apiKey**）。这是只读的“已配置”探测：
 * enabled 的免鉴权 vendor，或 enabled/nonempty 的 safeStorage 凭据记录即可；启动与首屏绝不为 readiness
 * 触碰系统钥匙串。真正执行文本请求时由 chooseTextModel 解密并验证凭据。
 */
export function resolveTextBrainKeys(): { vendor: string; modelKey: string } | null {
  return resolveConfiguredTextBrain(readCatalog());
}

function resolveConfiguredTextBrain(state: CatalogState): { vendor: string; modelKey: string } | null {
  const configured = selectTextModelCandidates(state).find(({ vendor }) =>
    vendor.authType === "none" || configuredCredential(state.apiKeysByVendor[vendor.key]));
  return configured ? { vendor: configured.vendor.key, modelKey: configured.model.modelKey } : null;
}

/** Read-only catalog readiness. Locked is learned only by the first real request, never by startup probing. */
export function resolveTextBrainStatus():
  | { status: "ok"; brain: { vendor: string; modelKey: string } }
  | { status: "missing" } {
  const brain = resolveConfiguredTextBrain(readCatalog());
  if (brain) return { status: "ok", brain };
  return { status: "missing" };
}
