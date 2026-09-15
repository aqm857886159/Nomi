import { decryptApiKeyRecord } from "../catalog/secrets";
import { readCatalog } from "../catalog/catalogStore";
import { createCatalogAvailability, type CatalogAvailability } from "../catalog/catalogModelAvailability";
import type { CatalogState, Model, Vendor } from "../catalog/types";
import type { ModelUnusableReason } from "../shared/modelAvailability";
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

/**
 * 「这个文本模型为什么用不了」= 可用性 owner 的封闭枚举（`ModelUnusableReason`）
 * **加上**两条只属于本路的身份/角色原因：目录里压根没有这一行（`model_missing`）、
 * 这一行不能当助手主控（`model_incompatible`：不是 text / 只给 prompt_refine / 不发工具调用）。
 * 可用性那几档一个字都不在这里重写——加一档要去 shared/modelAvailability.ts。
 */
export type TextModelUnavailableReason =
  | ModelUnusableReason
  | "model_missing"
  | "model_incompatible";

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

function modelIdentityMatches(model: Model, modelKey: string): boolean {
  const selected = modelKey.trim();
  return model.modelKey === selected || model.modelAlias?.trim() === selected;
}

/** 「这一行能不能当助手主控」——纯**角色**判据，压在可用性之上，不是第二份可用性。 */
function fitsAssistantTextRole(model: Model): boolean {
  return model.kind === "text" && !isPromptRefineOnlyModel(model) && modelSupportsToolCalls(model.meta);
}

function unavailableReason(
  state: CatalogState,
  availability: CatalogAvailability,
  vendorKey: string,
  modelKey: string,
): TextModelUnavailableReason {
  const model = state.models.find((item) => item.vendorKey === vendorKey && modelIdentityMatches(item, modelKey));
  const result = model
    ? availability.of(model)
    : { usable: false as const, reason: "vendor_missing" as const };
  // 供应商层的两档先答（目录里没这一家 / 这家停了）——模型行在不在都不改变该先修哪个。
  if (!result.usable && (result.reason === "vendor_missing" || result.reason === "vendor_disabled")) {
    return state.vendors.some((item) => item.key === vendorKey) ? "vendor_disabled" : "vendor_missing";
  }
  if (!model) return "model_missing";
  if (!fitsAssistantTextRole(model)) return "model_incompatible";
  return result.usable ? "model_unpublished" : result.reason;
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
  // 整条调用链共用一个派生器：它每**家**只探一次钥匙，各建各的就会让同一家被反复开钥匙串
  // （首屏 readiness 也走这条路）。调用方不传时本函数自己建一个。
  availability: CatalogAvailability = createCatalogAvailability(state),
): Array<{ vendor: Vendor; model: Model }> {
  const texts = state.models.filter((item) => fitsAssistantTextRole(item) && availability.of(item).usable);
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
      unavailableReason(state, availability, preferredVendorKey, preferredModelKey),
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
  // 一次请求一个派生器：候选筛选、不可用原因、locked 判定全用它，钥匙串开销随「家」数走。
  const availability = createCatalogAvailability(state);
  const candidates = selectTextModelCandidates(
    state,
    modelKey ? { modelKey, vendorKey } : undefined,
    preferImageInput,
    availability,
  );
  // 候选已由 selectTextModelCandidates 过了那唯一一道可用性闸（含「钥匙此刻解得开」），
  // 所以这里不再重判一次凭据——只把明文取出来。取不出说明钥匙在这一瞬间被换掉了，继续看下一个。
  for (const { vendor, model } of candidates) {
    if (vendor.authType === "none") return { vendor, model, apiKey: "" };
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[model.vendorKey]);
    if (apiKey) return { vendor, model, apiKey };
  }
  if (exactIdentity) {
    const candidate = candidates[0];
    const reason = candidate
      ? unavailableReason(state, availability, candidate.vendor.key, candidate.model.modelKey)
      : unavailableReason(state, availability, vendorKey, modelKey);
    throw new TextModelUnavailableError(reason, vendorKey, modelKey);
  }
  // 一个候选都没有时仍要分清「钥匙锁住了」和「压根没接」：前者去重存 key，后者去接入。
  // 判据仍是同一个 owner 的 reason，不在这里另写一遍「什么叫锁住」。
  const locked = state.models.some((model) => {
    if (!fitsAssistantTextRole(model)) return false;
    const modelAvailability = availability.of(model);
    return !modelAvailability.usable && modelAvailability.reason === "credential_locked";
  });
  if (locked) throw new TextModelCredentialError();
  // 稳定 code 前缀（沿用 electron 侧「专用签名」范式：Model is retired: / Model kind mismatch: …）。
  // 渲染层 classifyGenerationError 按 "no usable text model" 签名归 model-config 报人话，不再原样甩英文散句
  // （2026-08-25 走查：旧散句「No local text model is configured…」落进 unknown 分类，被原串直通给用户）。
  throw new Error("Model is not configured: no usable text model. Open model settings and add an API key.");
}

/**
 * 解析默认文本大脑的 vendor/model 键（**不含 apiKey**）。判据就是全 App 那条唯一的可用性判据
 * （供应商启用 + 模型启用 + 发布资格 + 钥匙此刻解得开），不再是它的一个宽松近似——
 * 近似正是「首页说没接、设置页说 2 个可使用」的来源（P0-10）。
 *
 * 关于钥匙串开销：`readCatalog()` 本身就为每家算 `hasApiKey` 解一次密（catalogStore.ts:89），
 * 所以这条路径**没有新增**任何 safeStorage 往返；旧注释里「首屏绝不触碰钥匙串」在那行落地之后就已不成立。
 *
 * `preferImageInput`：本轮要喂图时传 true，把**能读图**的模型排到第一位（imageInputRank →
 * meta.supportsImageInput，如 gemini-3.5-flash）。默认 false，既有调用方行为完全不变——无偏好时仍按
 * 「像不像通用对话模型」排序，把 vision/preview 降到末尾（它们常发不可靠的 tool_use，agent 主控要避开）。
 * 视频拆解读帧、浏览器「画面复刻」都要靠这个偏好选到读图脑（否则默认脑是 deepseek，读不了图）。
 */
export function resolveTextBrainKeys(
  options: { preferImageInput?: boolean } = {},
): { vendor: string; modelKey: string } | null {
  return resolveConfiguredTextBrain(readCatalog(), options.preferImageInput === true);
}

function resolveConfiguredTextBrain(
  state: CatalogState,
  preferImageInput = false,
): { vendor: string; modelKey: string } | null {
  // 候选表已经是「可用」的全集（isExecutableTextModel → 可用性 owner），首屏就绪与 chooseTextModel
  // 因此读的是**同一条**判据：横幅说「已连接」时助手下拉必定非空，反之亦然。
  const configured = selectTextModelCandidates(state, undefined, preferImageInput)[0];
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
