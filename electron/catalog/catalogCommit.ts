import { firstString, isJsonRecord, nowIso, trim, type JsonRecord } from "../jsonUtils";
import { humanizeModelKey } from "./modelLabel";
import { newapiTransportFor } from "./newapiTransport";
import { guessModelKind } from "./modelKindHeuristic";
import { hardenedFetchText } from "../hardenedFetch";
import type { AiSdkProviderKind, BillingModelKind, HttpOperation, Model, ProfileKind, Vendor } from "./types";
import {
  mutateCatalog,
  normalizeProviderKind,
  readCatalog,
} from "./catalogStore";
// 回引 runtime 的任务执行引擎（testModelCatalogMapping 复用）；调用都在函数体内（运行期），
// CommonJS 循环引用安全（runtime ↔ catalogCommit 仅函数体互引，无加载期互调）。
import {
  billingKindForTaskKind,
  buildProfileHttpRequest,
  buildProfileTaskResult,
  executeProfileOperation,
  findExecutableModelForTask,
  type TaskRequest,
} from "../runtime";

/**
 * 把「档案声明了、但 mapping body 里没有 {{request.params.*}} 槽」的参数键补进 body
 * （档案/onboarding 字段 → 传输 body 的对账）。原属已下线的「AI 读文档」子系统，因
 * commitOnboardedModelToCatalog 仍需要它对账参数，迁来此处单源保留（P1）。
 */
function mergeMissingParamsIntoBody(body: unknown, fieldKeys: string[]): unknown {
  if (!body || typeof body !== "object") return body;
  const clone = JSON.parse(JSON.stringify(body)) as unknown;
  const PARAM_RE = /^\{\{\s*request\.params\.([A-Za-z0-9_]+)\s*\}\}$/;
  const PROMPT_RE = /^\{\{\s*request\.prompt\s*\}\}$/;
  const keySet = new Set(fieldKeys);
  const present = new Set<string>();
  const literalHolders = new Map<string, Record<string, unknown>>();
  let paramContainer: Record<string, unknown> | null = null;
  let promptContainer: Record<string, unknown> | null = null;
  const walk = (val: unknown): void => {
    if (!val || typeof val !== "object") return;
    if (Array.isArray(val)) { val.forEach(walk); return; }
    const obj = val as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        const pm = PARAM_RE.exec(v);
        if (pm) { present.add(pm[1]); paramContainer = obj; }
        else if (PROMPT_RE.test(v)) { promptContainer = obj; present.add(k); }
        else if (keySet.has(k)) { literalHolders.set(k, obj); }
      }
      walk(v);
    }
  };
  walk(clone);
  const container = paramContainer || promptContainer || (clone as Record<string, unknown>);
  for (const key of fieldKeys) {
    if (present.has(key)) continue;
    const placeholder = `{{request.params.${key}}}`;
    const literalHolder = literalHolders.get(key);
    if (literalHolder) literalHolder[key] = placeholder;
    else container[key] = placeholder;
  }
  return clone;
}

/**
 * Commit a successful onboarding trial into the local catalog as a real entry:
 * vendor + encrypted apiKey + model (with evidence) + create/query mappings.
 *
 * Designed to be called from the renderer once a TrialOutcome arrives with
 * status === "success". Returns the persisted Model so the caller can light up
 * the success UI.
 */
export function commitOnboardedModelToCatalog(payload: {
  outcome: unknown;
  userApiKey: string;
  /** Optional display label override; otherwise we use draft.modelDisplayName. */
  displayLabel?: string;
  /** How this model was added. Defaults to "agent" (the doc-reader path). The
   *  manual BaseURL entry passes "manual" so the catalog records provenance honestly. */
  addedVia?: "agent" | "manual";
}): Model {
  const outcome = payload?.outcome as JsonRecord | null;
  if (!outcome || typeof outcome !== "object") throw new Error("outcome required");
  const draft = (outcome as JsonRecord).draft as JsonRecord | null;
  if (!draft) throw new Error("outcome.draft missing");

  const vendorKey = String(draft.vendorKey || "").trim();
  const vendorName = String(draft.vendorName || vendorKey).trim();
  const vendorBaseUrl = String(draft.vendorBaseUrl || "").trim();
  const modelKey = String(draft.modelKey || "").trim();
  // 显示名兜底不落裸 id（审计 A13）。
  const modelDisplayName = String(payload.displayLabel || draft.modelDisplayName || "").trim() || humanizeModelKey(modelKey);
  const targetKind = String(draft.targetKind || "").trim();
  const userApiKey = String(payload.userApiKey || "").trim();

  if (!vendorKey || !vendorBaseUrl || !modelKey) {
    throw new Error("incomplete draft: vendorKey + vendorBaseUrl + modelKey are required");
  }
  if (!userApiKey) throw new Error("userApiKey required to commit a model");

  let billingKind: BillingModelKind;
  let taskKind: ProfileKind;
  if (targetKind === "text") { billingKind = "text"; taskKind = "chat"; }
  else if (targetKind === "image") { billingKind = "image"; taskKind = "text_to_image"; }
  else if (targetKind === "video") { billingKind = "video"; taskKind = "text_to_video"; }
  else if (targetKind === "audio") { billingKind = "audio"; taskKind = "text_to_audio"; }
  else throw new Error(`Unsupported model kind '${targetKind}'`);

  const auth = (draft.vendorAuth || {}) as JsonRecord;
  const authType = (auth.type as Vendor["authType"]) || "bearer";

  // onboarding evidence 快照 + meta.parameters 投影（纯计算，先备好，再进事务）。
  type OnboardingField = NonNullable<Model["onboarding"]>["fields"][number];
  const onboardingFields: OnboardingField[] = Array.isArray(draft.modelFields)
    ? (draft.modelFields as JsonRecord[]).map((f) => ({
        key: String(f.key),
        displayName: String(f.displayName),
        type: f.type as OnboardingField["type"],
        ...(f.options ? { options: f.options as OnboardingField["options"] } : {}),
        ...(f.default !== undefined ? { default: String(f.default) } : {}),
        evidence: f.evidence as OnboardingField["evidence"],
      }))
    : [];

  // Project the agent-detected fields into model.meta.parameters so the node UI
  // can render them. The UI reads parameters/upload-slots exclusively from
  // model.meta (parseModelParameterControls); onboarding.fields is only an
  // evidence snapshot. Without this projection the model lands in the catalog
  // but shows zero parameters and no image-url upload slots on the node.
  // The shape parseParameterControl expects: { key, label, type, options, default }.
  const metaParameters = onboardingFields.map((f) => ({
    key: f.key,
    label: f.displayName || f.key,
    type: f.type,
    ...(f.options ? { options: f.options } : {}),
    ...(f.default !== undefined ? { default: f.default } : {}),
  }));

  // mapping: one row per (vendor, taskKind), carrying both stages.
  // Reconcile: the agent only templatizes params it saw in the curl example,
  // so spec-derived params (resolution, duration, ...) the user can now select
  // on the node have no {{request.params.*}} slot in the body and would send
  // nothing. Inject the missing field keys at the param nesting level.
  const mappingCreate = draft.mappingCreate as HttpOperation | undefined;
  const mappingQuery = draft.mappingQuery as HttpOperation | undefined;
  const reconciledCreate: HttpOperation | undefined = mappingCreate
    ? mappingCreate.body !== undefined && onboardingFields.length > 0
      ? { ...mappingCreate, body: mergeMissingParamsIntoBody(mappingCreate.body, onboardingFields.map((f) => f.key)) }
      : mappingCreate
    : undefined;

  // 单次事务（P2·根治半截接入）：vendor + apiKey + model + mapping 在一份内存 state 上攒齐，
  // 全部成功才一次性落盘；任一步抛错则整体不写，绝不留「vendor 写了 model 没写成」的不可用空壳。
  // 与 importModelCatalogPackage 同构（共用 apply* 纯函数）。
  const model = mutateCatalog((tx) => {
    // 1. vendor — carry draft.vendorMeta through so the manual-entry form's custom
    // request headers (vendorMeta.extraHeaders) persist and reach buildAiSdkModel.
    tx.upsertVendor({
      key: vendorKey,
      name: vendorName,
      baseUrlHint: vendorBaseUrl,
      authType,
      authHeader: auth.headerName || null,
      authQueryParam: auth.queryParam || null,
      providerKind: draft.vendorProviderKind || "openai-compatible",
      enabled: true,
      ...(draft.vendorMeta !== undefined ? { meta: draft.vendorMeta } : {}),
    });
    // 2. apiKey (auto-encrypted by upsert)
    tx.upsertApiKey(vendorKey, { apiKey: userApiKey, enabled: true });
    // 3. model + onboarding evidence snapshot
    const committed = tx.upsertModel({
      modelKey,
      vendorKey,
      modelAlias: modelKey,
      labelZh: modelDisplayName,
      kind: billingKind,
      enabled: true,
      meta: { parameters: metaParameters },
      onboarding: {
        addedVia: payload.addedVia ?? "agent",
        trialId: String(outcome.trialId || ""),
        docsUrl: String(outcome.docsUrl || ""),
        addedAt: nowIso(),
        fields: onboardingFields,
      },
    });
    // 4. mapping
    if (reconciledCreate) {
      tx.upsertMapping({
        vendorKey,
        taskKind,
        name: modelDisplayName,
        enabled: true,
        create: reconciledCreate,
        ...(mappingQuery ? { query: mappingQuery } : {}),
      });
    }
    return committed;
  });

  return model;
}

/**
 * Derive a stable vendorKey from a BaseURL host. Same host → same vendor (so
 * re-adding models under the same endpoint merges, per upsert semantics).
 * localhost/127.0.0.1 include the port so Ollama(11434) and ComfyUI(8188) don't
 * collide as one "localhost" vendor.
 */
export function deriveVendorKeyFromBaseUrl(baseUrl: string): string {
  let host = "";
  let port = "";
  try {
    const u = new URL(baseUrl);
    host = u.hostname;
    port = u.port;
  } catch {
    return "";
  }
  let seed = host;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    seed = `local-${port || "80"}`;
  }
  return seed.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

/**
 * Manual provider entry — the PRIMARY model-adding path (BaseURL + key + models).
 * Deterministic: for a standard OpenAI-compatible text endpoint the whole catalog
 * shape is known, so no doc-reading AI is needed (that breaks the bootstrap
 * deadlock where the doc-reader itself required a pre-existing text model).
 *
 * Reuses the SINGLE write path (commitOnboardedModelToCatalog) — N models = one
 * vendor + N model upserts. Text/chat models run via the direct AI SDK path
 * (buildAiSdkModel → createOpenAICompatible), so we deliberately emit NO HTTP
 * mapping here: a fabricated /chat/completions mapping would be unused dead data.
 *
 * Connectivity (P3·对齐「接入即验证」纪律，记录现状取舍——不在 commit 里做**阻断式**校验)：
 * 刻意不在本同步 commit 路径里探活（对齐 opencode）。原因：本地/自定义端点容忍度差异极大
 * （Ollama / ComfyUI / 各类中转），存了再在首次调用时按真实 vendor 错误报人话（runtime 已结构化
 * VendorRequestError + describeNetworkError），比在接入时阻断更诚实，也不会把合法模型挡在门外。
 *
 * 注意覆盖边界（别误以为已有兜底）：`testModelCatalogMapping`（IPC nomi:model-catalog:mapping:test）
 * 只覆盖**带 mapping** 的 image/video/异步模型；本路径提交的 text/chat 走直连 AI SDK、刻意无 mapping，
 * 因此**不被那条测试覆盖**——这一路目前确无显式连通性入口。补一个**非阻断、用户主动触发**的
 * 「测试连接」（轻量 GET {baseUrl}/models 探活，仅提示不拦提交）是合理的后续；但它需要新增
 * main.ts IPC + desktopClient 入口（均在本次作用域外），故此处暂记缺口、不落半截 dead export。
 */
/** 标准参数控件 → onboarding field 形状（落 model.meta.parameters；标准参数无文档 evidence，标 standard）。 */
function paramsToOnboardingFields(
  params: Array<{ key: string; label: string; type: string; options: Array<{ value: string; label: string }>; defaultValue?: string | number | boolean; min?: number; max?: number }>,
): JsonRecord[] {
  return params.map((p) => ({
    key: p.key,
    displayName: p.label,
    type: p.type,
    ...(p.options.length ? { options: p.options } : {}),
    ...(p.defaultValue !== undefined ? { default: String(p.defaultValue) } : {}),
    evidence: { field: p.key, evidence: "new-api 标准参数", evidence_location: "", confidence: "high" },
  }));
}

/** 按 kind 给出 commit draft 的 targetKind + 标准参数 + 传输 mapping（图片同步无 query / 视频异步带 query）。 */
function draftShapeForKind(kind: "text" | "image" | "video" | "audio"): {
  targetKind: "text" | "image" | "video" | "audio";
  modelFields: JsonRecord[];
  mappingCreate?: HttpOperation;
  mappingQuery?: HttpOperation;
} {
  if (kind === "image") {
    const t = newapiTransportFor("image");
    return { targetKind: "image", modelFields: paramsToOnboardingFields(t.params), mappingCreate: t.create };
  }
  if (kind === "video") {
    const t = newapiTransportFor("video");
    return { targetKind: "video", modelFields: paramsToOnboardingFields(t.params), mappingCreate: t.create, ...(t.query ? { mappingQuery: t.query } : {}) };
  }
  if (kind === "audio") {
    // 中转配音(TTS)：OpenAI 兼容 /v1/audio/speech 同步出二进制音频（无 query）。命中 seed-tts 档案 → UI 出火山音色。
    const t = newapiTransportFor("audio");
    return { targetKind: "audio", modelFields: paramsToOnboardingFields(t.params), mappingCreate: t.create };
  }
  return { targetKind: "text", modelFields: [] };
}

export function commitManualOpenAiCompatibleModels(payload: {
  vendorName: string;
  baseUrl: string;
  apiKey: string;
  models: Array<{ id: string; displayName?: string; kind?: "text" | "image" | "video" | "audio" }>;
  /** Endpoint shape. Defaults to "openai-compatible" (the common case). "anthropic"
   *  routes text/chat through the Messages API (createAnthropic, x-api-key). */
  providerKind?: AiSdkProviderKind;
  /** Extra request headers for relay/proxy gateways, persisted on the vendor and
   *  replayed on every model call via buildAiSdkModel. */
  headers?: Record<string, string>;
}): { vendorKey: string; committed: Array<{ modelKey: string; displayName: string }> } {
  const rawBaseUrl = String(payload?.baseUrl || "").trim();
  const apiKey = String(payload?.apiKey || "").trim();
  const providerKind = normalizeProviderKind(payload?.providerKind);
  // Anthropic offers a hosted default; an OpenAI-compatible endpoint must be told.
  // For anthropic with a blank field we fill in the canonical host so the vendor
  // always has a concrete baseUrlHint (the doc-reader + commit path require one).
  const baseUrl =
    providerKind === "anthropic" && !rawBaseUrl ? "https://api.anthropic.com" : rawBaseUrl;
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("接入地址需以 http:// 或 https:// 开头");
  if (!apiKey) throw new Error("API Key 不能为空");

  const vendorKey = deriveVendorKeyFromBaseUrl(baseUrl);
  if (!vendorKey) throw new Error("无法从接入地址解析出供应商标识");

  const vendorName = String(payload?.vendorName || "").trim() || vendorKey;

  // Clean custom headers: trim, drop blanks. Stored on vendor.meta.extraHeaders.
  const cleanHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(payload?.headers || {})) {
    const key = String(k || "").trim();
    const value = String(v ?? "").trim();
    if (key && value) cleanHeaders[key] = value;
  }
  const vendorMeta =
    Object.keys(cleanHeaders).length > 0 ? { extraHeaders: cleanHeaders } : undefined;

  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set<string>();
  const cleanModels = rawModels
    .map((m) => {
      const k = m?.kind;
      const id = String(m?.id || "").trim();
      // kind 缺省时用启发式猜（安全网：即便 UI 没传 kind，flux→image / kling→video 也不会错落 text）。
      return {
        id,
        displayName: String(m?.displayName || "").trim(),
        kind: (k === "image" || k === "video" || k === "text" || k === "audio" ? k : guessModelKind(id)) as "text" | "image" | "video" | "audio",
      };
    })
    .filter((m) => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  if (cleanModels.length === 0) throw new Error("至少填写一个模型 id");

  const committed: Array<{ modelKey: string; displayName: string }> = [];
  for (const m of cleanModels) {
    const displayName = m.displayName || humanizeModelKey(m.id);
    // 图片/视频走 new-api 标准传输模板（per-model kind）；文本不带 mapping（chat 直连）。
    const shape = draftShapeForKind(m.kind);
    const outcome = {
      status: "success",
      trialId: "",
      docsUrl: "",
      draft: {
        vendorKey,
        vendorName,
        vendorBaseUrl: baseUrl,
        vendorAuth: { type: providerKind === "anthropic" ? ("x-api-key" as const) : ("bearer" as const) },
        vendorProviderKind: providerKind,
        ...(vendorMeta ? { vendorMeta } : {}),
        modelKey: m.id,
        modelDisplayName: displayName,
        targetKind: shape.targetKind,
        modelFields: shape.modelFields,
        ...(shape.mappingCreate ? { mappingCreate: shape.mappingCreate } : {}),
        ...(shape.mappingQuery ? { mappingQuery: shape.mappingQuery } : {}),
      },
    };
    commitOnboardedModelToCatalog({ outcome, userApiKey: apiKey, addedVia: "manual" });
    committed.push({ modelKey: m.id, displayName });
  }

  return { vendorKey, committed };
}

export async function fetchModelCatalogDocs(payload: unknown): Promise<unknown> {
  const targetUrl = String((payload as JsonRecord)?.url || "").trim();
  if (!/^https?:\/\//i.test(targetUrl)) throw new Error("http/https url is required");
  // v0.7.6: hardenedFetch — 拦私网 + 超时 + 限制大小
  const fetched = await hardenedFetchText(targetUrl, {
    timeoutMs: 15_000,
    maxBytes: 5 * 1024 * 1024, // 文档抓取 5MB 上限够用
  });
  const html = fetched.text;
  const contentType = fetched.contentType;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const max = 120000;
  return {
    url: targetUrl,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType,
    title,
    text: text.slice(0, max),
    truncated: text.length > max,
    diagnostics: [],
  };
}

export async function testModelCatalogMapping(id: string, payload: unknown): Promise<unknown> {
  const mapping = readCatalog().mappings.find((item) => item.id === id);
  const raw = payload as JsonRecord | undefined;
  if (!mapping) {
    return {
      mappingId: id,
      vendorKey: "",
      taskKind: "chat",
      stage: raw?.stage || "create",
      executed: false,
      ok: false,
      diagnostics: ["Mapping not found."],
      request: null,
    };
  }
  const stage = raw?.stage === "result" || raw?.stage === "query" ? "query" : "create";
  const operation: HttpOperation | undefined = stage === "create" ? mapping.create : mapping.query;
  if (!operation) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: false,
      diagnostics: [`Mapping has no ${stage} stage.`],
      request: null,
    };
  }
  const wantedKind = billingKindForTaskKind(mapping.taskKind);
  const { vendor, model, apiKey } = findExecutableModelForTask(mapping.vendorKey, trim(raw?.modelKey), wantedKind);
  const request: TaskRequest = {
    kind: mapping.taskKind,
    prompt: firstString(raw?.prompt, "Nomi mapping smoke test"),
    extras: {
      ...(isJsonRecord(raw?.extras) ? raw?.extras : {}),
      modelKey: model.modelKey,
      modelAlias: model.modelAlias || model.modelKey,
    },
  };
  const providerMeta = {
    query_id: firstString(raw?.taskId),
    task_id: firstString(raw?.taskId),
  };
  const preview = buildProfileHttpRequest({ vendor, model, apiKey, request, operation, providerMeta }).preview;
  const upstreamResponse = raw && Object.prototype.hasOwnProperty.call(raw, "upstreamResponse") ? raw.upstreamResponse : undefined;
  if (typeof upstreamResponse !== "undefined") {
    const normalized = await buildProfileTaskResult({
      response: upstreamResponse,
      mapping,
      operation,
      request,
      taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
      wantedKind,
    });
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: normalized.result.status !== "failed",
      diagnostics: ["Mapped the provided upstream response without sending a request."],
      request: preview,
      response: normalized.result,
    };
  }
  if (!raw?.execute) {
    return {
      mappingId: id,
      vendorKey: mapping.vendorKey,
      taskKind: mapping.taskKind,
      stage,
      executed: false,
      ok: true,
      diagnostics: ["Rendered local desktop mapping without sending a request."],
      request: preview,
    };
  }
  const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation, providerMeta });
  const normalized = await buildProfileTaskResult({
    response: executed.response,
    mapping,
    operation,
    request,
    taskIdFallback: firstString(raw?.taskId, `test-${Date.now()}`),
    wantedKind,
  });
  return {
    mappingId: id,
    vendorKey: mapping.vendorKey,
    taskKind: mapping.taskKind,
    stage,
    executed: true,
    ok: normalized.result.status !== "failed",
    diagnostics: ["Executed mapping through the desktop runtime."],
    request: executed.request,
    response: normalized.result,
  };
}
