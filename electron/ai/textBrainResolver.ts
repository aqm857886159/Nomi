import { decryptApiKeyRecord, type ApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import { modelSupportsToolCalls } from "../shared/textModelCapabilities";
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

function configuredCredential(record: ApiKeyRecord | undefined): boolean {
  return Boolean(record?.enabled && record.apiKey.trim());
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
  if (preference?.modelKey && state.models.some((model) => model.modelKey === preference.modelKey
    && (!preference.vendorKey || model.vendorKey === preference.vendorKey)
    && !modelSupportsToolCalls(model.meta))) {
    throw new Error("Model does not support assistant tools");
  }
  const texts = state.models.filter(
    (item) => item.kind === "text" && item.enabled && !isPromptRefineOnlyModel(item) && modelSupportsToolCalls(item.meta),
  );
  // 有偏好：用户选的排第一（其余作回退）。
  // 无偏好且本轮带图：优先支持图片输入的 text 模型（gpt-4o/claude/gemini 既能看图又擅长 tool_use）。
  // 无偏好无图：不盲选第一个，按「是否像通用对话模型」稳定排序，vision/preview 降到末尾。
  const preferredModelKey = preference?.modelKey?.trim();
  const preferredVendorKey = preference?.vendorKey?.trim();
  const preferenceRank = (model: Model): number => {
    if (!preferredModelKey || model.modelKey !== preferredModelKey) return 0;
    if (preferredVendorKey) return model.vendorKey === preferredVendorKey ? 2 : 0;
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
  const candidates = selectTextModelCandidates(
    state,
    prefModelKey ? { modelKey: prefModelKey, vendorKey: prefVendorKey } : undefined,
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
  if (lockedCredential) throw new TextModelCredentialError();
  // 稳定 code 前缀（沿用 electron 侧「专用签名」范式：Model is retired: / Model kind mismatch: …）。
  // 渲染层 classifyGenerationError 按 "no usable text model" 签名归 model-config 报人话，不再原样甩英文散句
  // （2026-08-25 走查：旧散句「No local text model is configured…」落进 unknown 分类，被原串直通给用户）。
  throw new Error("Model is not configured: no usable text model. Open model settings and add an API key.");
}

/**
 * 解析默认文本大脑的 vendor/model 键（**不含 apiKey**）。这是只读的“已配置”探测：
 * enabled 的免鉴权 vendor，或 enabled/nonempty 的凭据记录即可；启动与首屏绝不为 readiness
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
