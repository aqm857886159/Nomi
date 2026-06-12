import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hardenedFetch } from "./hardenedFetch";
import { localizeAssetsForVendor, resolveAssetIngestion } from "./catalog/assetLocalization";
import { readNomiLocalAsset, postJsonForAssetUpload } from "./assets/localAssetFile";
import { endpoint } from "./vendorEndpoint";
import { authQueryParams, requestJson } from "./vendor/vendorHttp";
import { buildNormalizedRecipe, buildTaskProvenance } from "./vendor/provenance";
import { traceVendorCompleted, traceVendorRequested } from "./events/vendorCallTrace";
import { scheduleTechnicalReview } from "./review/reviewTrace";
import { type AuthType, appendQueryParams, authHeaders as buildAuthHeaders, buildHttpRequest, buildTemplateContext, extractTaskId as extractTaskIdShared } from "./ai/requestPipeline";
import { sanitizeForBroadCompat } from "./ai/promptSanitize";
import { firstString, isJsonRecord, nowIso, readNestedRecord, trim, type JsonRecord } from "./jsonUtils";
import { collectAssetUrls, firstMappedString, providerMetaFromResponse, taskStatusFromResponse, valuesFromMapping } from "./tasks/responseParsing";
import { TtlLruCache } from "./tasks/taskCache";
import { assetBucketFromMeta, assetKindFromContentType, contentTypeFromPath, extensionFromMime, extensionFromUrl, localAssetUrl, stableAssetId } from "./assets/assetPaths";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "./vendor/fingerprintCache";
import { decryptApiKeyRecord } from "./catalog/secrets";
import { ensureDir } from "./runtimePaths";
import {
  createProject,
  deleteProject,
  listProjects,
  projectDirById,
  readProject,
  resolveProjectRelativePath,
  sanitizeName,
  saveProject,
} from "./projects/repository";
// 公共 API：main.ts 仍从 "./runtime" 消费这些 —— re-export 保持其 import 不变。
export { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject };

// 任务执行复用 catalog 状态（readCatalog）；catalogStore 反向复用本文件任务引擎 → 运行期循环引用（CommonJS 安全）。
import { readCatalog } from "./catalog/catalogStore";

import type {
  BillingModelKind,
  HttpOperation,
  Mapping,
  Model,
  ProfileKind,
  Vendor,
} from "./catalog/types";
import { selectTaskMapping } from "./catalog/types";
import { firstReferenceImage, taskTemplateParams } from "./catalog/taskParams";
export type {
  AiSdkProviderKind,
  BillingModelKind,
  CatalogState,
  CatalogVersion,
  HttpOperation,
  Mapping,
  Model,
  ProfileKind,
  Vendor,
} from "./catalog/types";

// ── 巨壳拆分：子模块再导出，main.ts/测试仍从 "./runtime" 消费这些符号（API 不破） ──
export {
  startExportJob,
  getExportJobStatus,
  cancelExportJob,
  writeExportTempInput,
  finishExportTempInput,
  subscribeExportJobEvents,
  startTimelineMp4Export,
  showExportInFolder,
} from "./export/exportJobs";
export {
  ensureBuiltinModelSeeds,
  normalizeProviderKind,
  listModelCatalogVendors,
  listModelCatalogModels,
  listModelCatalogMappings,
  resolveOnboardingAgentFromCatalog,
  getModelCatalogHealth,
  upsertModelCatalogVendor,
  deleteModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  clearModelCatalogVendorApiKey,
  upsertModelCatalogModel,
  deleteModelCatalogModel,
  upsertModelCatalogMapping,
  deleteModelCatalogMapping,
  exportModelCatalogPackage,
  importModelCatalogPackage,
  extractVendorExtraHeaders,
} from "./catalog/catalogStore";
export {
  commitOnboardedModelToCatalog,
  deriveVendorKeyFromBaseUrl,
  commitManualOpenAiCompatibleModels,
  fetchModelCatalogDocs,
  testModelCatalogMapping,
} from "./catalog/catalogCommit";
export { runAgentChatV2, clearAgentChatV2History } from "./ai/agentChatV2";
export type {
  AgentToolName,
  AgentChatV2Event,
  AgentToolConfirmation,
  AgentChatV2Hooks,
  RunAgentChatV2Payload,
} from "./ai/agentChatV2";

export type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown>;
};

type TaskResult = {
  id: string;
  kind: ProfileKind;
  status: "queued" | "running" | "succeeded" | "failed";
  assets: Array<{
    type: "image" | "video";
    url: string;
    thumbnailUrl?: string | null;
    assetId?: string | null;
    assetRefId?: string | null;
    assetName?: string | null;
  }>;
  raw: unknown;
  /**
   * E11: Complete provenance for reproducibility. Populated on successful
   * generation. Renderer copies this into GenerationNodeResult.provenance.
   */
  provenance?: {
    provider?: string;
    modelKey?: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    params?: Record<string, unknown>;
    vendorRequestId?: string;
    timestamp: number;
  };
};

// TTL(1h) + LRU(200) 上限，防异步任务条目无界驻留（P0-7）。不再缓存明文 apiKey。
const taskCache = new TtlLruCache<CachedTask>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });

type CachedTask = {
  vendor: string;
  request: TaskRequest;
  raw: unknown;
  mapping?: Mapping | null;
  model?: Model;
  providerMeta?: JsonRecord;
  projectId?: string;
  nodeId?: string;
  wantedKind?: BillingModelKind;
  /** S8 指纹:异步任务终态成功时写回指纹缓存用。 */
  fingerprint?: string;
};

type LocalAssetRecord = {
  id: string;
  name: string;
  userId: "local";
  projectId: string;
  createdAt: string;
  updatedAt: string;
  data: {
    url: string;
    relativePath: string;
    absolutePath: string;
    contentType: string;
    size: number;
    kind: string;
  };
};

function collectFilesRecursively(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function uniqueAssetPath(projectId: string, fileName: string, bucket: "generated" | "imported" = "generated"): { absolutePath: string; relativePath: string } {
  const projectDir = projectDirById(projectId);
  if (!projectDir) throw new Error("Project not found");
  const today = new Date().toISOString().slice(0, 10);
  const assetDir = path.join(projectDir, "assets", bucket, today);
  ensureDir(assetDir);
  const parsed = path.parse(sanitizeName(fileName, "asset.bin"));
  const base = parsed.name || "asset";
  const ext = parsed.ext || ".bin";
  let absolutePath = path.join(assetDir, `${base}${ext}`);
  for (let index = 2; fs.existsSync(absolutePath); index += 1) {
    absolutePath = path.join(assetDir, `${base}-${index}${ext}`);
  }
  return {
    absolutePath,
    relativePath: path.relative(projectDir, absolutePath).replace(/\\/g, "/"),
  };
}

function writeAsset(projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord): unknown {
  const { absolutePath, relativePath } = uniqueAssetPath(projectId, fileName, assetBucketFromMeta(meta));
  fs.writeFileSync(absolutePath, bytes);
  const url = localAssetUrl(projectId, relativePath);
  const t = nowIso();
  return {
    id: `asset-${crypto.randomUUID()}`,
    name: sanitizeName(fileName, "asset"),
    userId: "local",
    projectId,
    createdAt: t,
    updatedAt: t,
    data: {
      ...meta,
      url,
      relativePath,
      absolutePath,
      contentType,
      size: bytes.byteLength,
    },
  };
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/);
  if (!match) throw new Error("Invalid data URL");
  const contentType = match[1] || "application/octet-stream";
  const encoded = match[3] || "";
  const bytes = match[2] ? Buffer.from(encoded, "base64") : Buffer.from(decodeURIComponent(encoded));
  return { bytes, contentType };
}

export async function importRemoteAsset(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  const url = String(raw.url || "").trim();
  if (!projectId) throw new Error("projectId is required");
  if (!url) throw new Error("url is required");
  if (url.startsWith("nomi-local://")) {
    return { id: `asset-${crypto.randomUUID()}`, name: String(raw.fileName || "local asset"), userId: "local", projectId, createdAt: nowIso(), updatedAt: nowIso(), data: { url, kind: raw.kind || "local" } };
  }
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    const ext = extensionFromMime(parsed.contentType, "bin");
    return writeAsset(projectId, parsed.bytes, String(raw.fileName || `asset-${Date.now()}.${ext}`), parsed.contentType, { kind: raw.kind || "generated", originalUrl: null });
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s), data, and nomi-local assets are supported");
  // v0.7.6: hardenedFetch — 资产下载需要更大上限（视频/图片），但仍拦私网 + 超时
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000,
    maxBytes: 200 * 1024 * 1024, // 200MB 资产上限
    allowContentTypes: ["image/", "video/", "audio/", "application/octet-stream"],
  });
  const contentType = fetched.contentType || "application/octet-stream";
  const bytes = fetched.bytes;
  const ext = extensionFromMime(contentType, extensionFromUrl(url));
  const fileName = String(raw.fileName || path.basename(new URL(url).pathname) || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName.includes(".") ? fileName : `${fileName}.${ext}`, contentType, {
    kind: raw.kind || "generated",
    originalUrl: url,
    ownerNodeId: raw.ownerNodeId || null,
  });
}

function bytesFromPayload(value: unknown): Buffer {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Buffer.from(value);
  throw new Error("bytes must be an ArrayBuffer");
}

export async function importLocalFile(payload: unknown): Promise<unknown> {
  const raw = payload as JsonRecord;
  const projectId = String(raw.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const bytes = bytesFromPayload(raw.bytes);
  const contentType = String(raw.contentType || "application/octet-stream");
  const ext = extensionFromMime(contentType, "bin");
  const fileName = String(raw.fileName || `asset-${Date.now()}.${ext}`);
  return writeAsset(projectId, bytes, fileName, contentType, {
    kind: raw.kind || "upload",
    originalName: raw.fileName || null,
  });
}

export function listProjectAssets(payload: unknown): { items: LocalAssetRecord[]; cursor: string | null } {
  const raw = payload as JsonRecord | undefined;
  const projectId = String(raw?.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required");
  const projectDir = projectDirById(projectId);
  if (!projectDir) return { items: [], cursor: null };
  const assetsDir = path.join(projectDir, "assets");
  const requestedLimit = typeof raw?.limit === "number" && Number.isFinite(raw.limit) ? Math.floor(raw.limit) : 200;
  const limit = Math.max(1, Math.min(500, requestedLimit));
  const offset = Math.max(0, Number.parseInt(String(raw?.cursor || "0"), 10) || 0);
  const kindFilter = typeof raw?.kind === "string" && raw.kind.trim() ? raw.kind.trim() : "";
  const records = collectFilesRecursively(assetsDir).flatMap((absolutePath): LocalAssetRecord[] => {
    try {
      const stat = fs.statSync(absolutePath);
      const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, "/");
      const contentType = contentTypeFromPath(absolutePath);
      const kind = assetKindFromContentType(contentType);
      if (kindFilter && kind !== kindFilter) return [];
      const createdAt = new Date(stat.birthtimeMs || stat.mtimeMs).toISOString();
      const updatedAt = new Date(stat.mtimeMs).toISOString();
      return [{
        id: stableAssetId(projectId, relativePath),
        name: path.basename(absolutePath),
        userId: "local",
        projectId,
        createdAt,
        updatedAt,
        data: {
          url: localAssetUrl(projectId, relativePath),
          relativePath,
          absolutePath,
          contentType,
          size: stat.size,
          kind,
        },
      }];
    } catch {
      return [];
    }
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const items = records.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  return {
    items,
    cursor: nextOffset < records.length ? String(nextOffset) : null,
  };
}

function findExecutableModel(vendorKey: string, modelKey: string, kind?: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const vendor = state.vendors.find((item) => item.key === vendorKey && item.enabled);
  if (!vendor) throw new Error(`Vendor is not enabled: ${vendorKey}`);
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && (!kind || item.kind === kind) && (item.modelKey === modelKey || item.modelAlias === modelKey));
  if (!model) throw new Error(`Model is not enabled: ${modelKey}`);
  const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[vendorKey]);
  if (vendor.authType !== "none" && !apiKey) throw new Error(`API key missing: ${vendorKey}`);
  return { vendor, model, apiKey };
}

export function findExecutableModelForTask(vendorKey: string, modelKey: string, kind: BillingModelKind): { vendor: Vendor; model: Model; apiKey: string } {
  if (modelKey) return findExecutableModel(vendorKey, modelKey, kind);
  const state = readCatalog();
  const model = state.models.find((item) => item.vendorKey === vendorKey && item.enabled && item.kind === kind);
  if (!model) throw new Error(`No enabled ${kind} model for vendor: ${vendorKey}`);
  return findExecutableModel(vendorKey, model.modelKey, kind);
}

// Thin Vendor→primitive adapters over the shared requestPipeline auth logic
// (the shared module is electron-free and doesn't know the Vendor shape).
function authHeaders(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthHeaders(vendor.authType as AuthType, apiKey, vendor.authHeader ?? undefined);
}

// endpoint() 已抽到 electron/vendorEndpoint.ts（纯函数，便于无 electron 的单测）

export function billingKindForTaskKind(kind: ProfileKind): BillingModelKind {
  if (kind === "text_to_video" || kind === "image_to_video") return "video";
  if (kind === "chat" || kind === "prompt_refine" || kind === "image_to_prompt") return "text";
  return "image";
}

function extractAssetUrl(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const record = raw as JsonRecord;
  const candidates = [
    record.url,
    record.video_url,
    record.image_url,
    record.output,
    (record.data as JsonRecord[] | undefined)?.[0]?.url,
    (record.data as JsonRecord[] | undefined)?.[0]?.b64_json ? `data:image/png;base64,${(record.data as JsonRecord[])[0].b64_json}` : "",
    (record.images as JsonRecord[] | undefined)?.[0]?.url,
    (record.videos as JsonRecord[] | undefined)?.[0]?.url,
    (record.result as JsonRecord | undefined)?.url,
    (record.result as JsonRecord | undefined)?.video_url,
    (record.result as JsonRecord | undefined)?.image_url,
  ];
  return firstString(...candidates);
}

async function postJson(url: string, apiKey: string, vendor: Vendor, body: unknown): Promise<unknown> {
  const response = await fetch(appendQueryParams(url, authQueryParams(vendor, apiKey)), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(vendor, apiKey),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(firstString((json as JsonRecord | null)?.message, (json as JsonRecord | null)?.error, `Provider request failed: ${response.status}`));
  return json;
}

async function localizeTaskAsset(projectId: string, assetUrl: string, type: "image" | "video", nodeId?: string): Promise<TaskResult["assets"][number]> {
  const imported = await importRemoteAsset({
    projectId,
    url: assetUrl,
    kind: "generated",
    ownerNodeId: nodeId || null,
    fileName: `${type}-${Date.now()}.${type === "image" ? "png" : "mp4"}`,
  }) as { id?: string; name?: string; data?: { url?: string; absolutePath?: string } };
  // S4-2b V-a:落地后异步技术自检(黑帧/静音/解码),fire-and-forget 绝不挡结果呈现。
  scheduleTechnicalReview({ projectId, nodeId, absolutePath: String(imported.data?.absolutePath || ""), assetUrl: String(imported.data?.url || assetUrl), type });
  return {
    type,
    url: String(imported.data?.url || assetUrl),
    thumbnailUrl: type === "image" ? String(imported.data?.url || assetUrl) : null,
    assetId: imported.id || null,
    assetName: imported.name || null,
  };
}

function findTaskMapping(vendorKey: string, taskKind: ProfileKind, modelKey?: string): Mapping | null {
  // 按 (vendor, taskKind, modelKey) 选——同 vendor 下两个模型共用一个 taskKind 但请求形状不同时
  // （如 HappyHorse 与 Kling 都 text_to_video），靠 modelKey 精确路由，不再「第一个赢、另一个套错模板」。
  return selectTaskMapping(readCatalog().mappings, vendorKey, taskKind, modelKey);
}

// Adapter over the shared requestPipeline context builder(canonical context 形状在
// shared 模块,wizard 测试与生产构建一致;params 经 taskTemplateParams 归一)。
function templateContext(request: TaskRequest, model: Model, apiKey: string, providerMeta: JsonRecord = {}): JsonRecord {
  return buildTemplateContext({
    request: request as unknown as JsonRecord,
    params: taskTemplateParams(request),
    model: model as unknown as JsonRecord,
    modelKey: model.modelAlias || model.modelKey,
    apiKey,
    providerMeta,
  });
}

export function buildProfileHttpRequest(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): { method: string; url: string; headers: Record<string, string>; query: Record<string, unknown>; body: unknown; preview: unknown } {
  // Single source of truth: the shared requestPipeline builds the exact request
  // the wizard test also builds, so "passed test" == "works in prod".
  return buildHttpRequest({
    baseUrl: String(input.vendor.baseUrlHint || ""),
    authType: input.vendor.authType as AuthType,
    authHeaderName: input.vendor.authHeader ?? undefined,
    apiKey: input.apiKey,
    context: templateContext(input.request, input.model, input.apiKey, input.providerMeta || {}),
    operation: input.operation,
  });
}

export async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): Promise<{ response: unknown; request: unknown }> {
  // R1：发送前把 request 里的本地素材(nomi-local://)按当前 vendor 声明的策略变成可达值
  // (上传换公网 URL / 内联 base64)。通用层与供应商无关;无本地素材时零开销原样通过。
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    resolveAssetIngestion(input.vendor),
    input.apiKey,
    readNomiLocalAsset,
    postJsonForAssetUpload,
  );
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  const built = buildProfileHttpRequest(effectiveInput);
  const response = await requestJson(effectiveInput.vendor, effectiveInput.apiKey, built.method, built.url, built.headers, built.query, built.body);
  return {
    response,
    request: built.preview,
  };
}

/**
 * If `value` is a string that looks like serialized JSON ({...} or [...]),
 * parse it. Some providers (kie.ai) return nested results as JSON strings
 * (e.g. `data.resultJson = "{\"resultUrls\":[...]}"`) and the mapping path
 * `data.resultJson.resultUrls.0` only works if we transparently parse.
 */
export async function buildProfileTaskResult(input: {
  response: unknown;
  mapping: Mapping;
  operation: HttpOperation;
  request: TaskRequest;
  taskIdFallback: string;
  wantedKind: BillingModelKind;
  projectId?: string;
  nodeId?: string;
  /** S4-1:provenance 统一在本出口写(修主路径漏写根因),需要 vendor/model。 */
  vendor?: Vendor;
  model?: Model;
}): Promise<{ result: TaskResult; providerMeta: JsonRecord }> {
  const responseMapping = isJsonRecord(input.operation.response_mapping) ? input.operation.response_mapping : null;
  const providerMetaMapping = isJsonRecord(input.operation.provider_meta_mapping) ? input.operation.provider_meta_mapping : null;
  const providerMeta = providerMetaFromResponse(input.response, providerMetaMapping);
  const taskId = firstString(
    firstMappedString(input.response, responseMapping, "task_id"),
    providerMeta.task_id,
    providerMeta.query_id,
    extractTaskIdShared(input.response),
    input.taskIdFallback,
  );
  const mappedAssetValues = [
    ...valuesFromMapping(input.response, responseMapping, "assets"),
    ...valuesFromMapping(input.response, responseMapping, "image_url"),
    ...valuesFromMapping(input.response, responseMapping, "video_url"),
  ];
  const assetUrls = Array.from(new Set([
    ...mappedAssetValues.flatMap(collectAssetUrls),
    ...collectAssetUrls(extractAssetUrl(input.response)),
  ]));
  const status = taskStatusFromResponse(input.response, responseMapping, input.mapping.statusMapping, assetUrls);
  const type: "image" | "video" = input.wantedKind === "video" ? "video" : "image";
  const assets = input.projectId
    ? await Promise.all(assetUrls.map((url) => localizeTaskAsset(input.projectId || "", url, type, input.nodeId)))
    : assetUrls.map((url) => ({ type, url, thumbnailUrl: type === "image" ? url : null }));
  return {
    providerMeta,
    result: {
      id: taskId,
      kind: input.request.kind,
      status,
      assets,
      raw: input.response,
      // S4-1:profile 主路径补 provenance(与 fallback 共用 buildTaskProvenance,单一真相)。
      ...(status === "succeeded" && input.vendor && input.model
        ? { provenance: buildTaskProvenance({ vendor: input.vendor, model: input.model, request: input.request, vendorRequestId: taskId }) }
        : {}),
    },
  };
}

export async function runTask(payload: unknown): Promise<TaskResult> {
  const raw = payload as { vendor?: string; request?: TaskRequest };
  const vendorKey = trim(raw.vendor);
  const request = raw.request;
  if (!vendorKey || !request) throw new Error("vendor and request are required");
  const kind = request.kind;
  const wantedKind = billingKindForTaskKind(kind);
  const modelKey = firstString(request.extras?.modelKey, request.extras?.modelAlias);
  const { vendor, model, apiKey } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId);
  const nodeId = trim(request.extras?.nodeId);
  const taskId = `task-${crypto.randomUUID()}`;
  const mapping = findTaskMapping(vendorKey, kind, modelKey);

  if (mapping) {
    // S8 指纹缓存:同配方(参数没动)秒回上次成功结果,零 vendor 调用;强制重跑经 extras.forceRerun 绕读。
    const recipe = buildNormalizedRecipe({ vendor, model, mappingId: trim((mapping as unknown as JsonRecord).id), request });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    const executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: mapping.create });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping,
      operation: mapping.create,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
      vendor,
      model,
    });
    traceVendorRequested(projectId, { runId: normalized.result.id, nodeId, recipe });
    if (["succeeded", "failed"].includes(normalized.result.status)) {
      traceVendorCompleted(projectId, { runId: normalized.result.id, nodeId, status: normalized.result.status as "succeeded" | "failed", assetCount: normalized.result.assets.length });
      rememberTaskResult(projectId, fingerprint, normalized.result);
    }
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      taskCache.set(normalized.result.id, {
        vendor: vendorKey,
        request,
        raw: executed.response,
        mapping,
        model,
        providerMeta: normalized.providerMeta,
        projectId,
        nodeId,
        wantedKind,
        fingerprint,
      });
    }
    return normalized.result;
  }

  if (wantedKind === "text") {
    const imageUrl = kind === "image_to_prompt" ? firstReferenceImage(request) : "";
    // 收口 sanitize（P0-6）：聊天/文本 LLM 调用的 prompt 统一 ASCII 可移植化。
    const promptText = sanitizeForBroadCompat(request.prompt);
    const userContent: unknown = imageUrl
      ? [{ type: "text", text: promptText }, { type: "image_url", image_url: { url: imageUrl } }]
      : promptText;
    const maxTokensValue = Number(request.extras?.maxTokens ?? request.extras?.max_tokens);
    const temperatureValue = Number(request.extras?.temperature);
    const response = await postJson(endpoint(vendor, "/v1/chat/completions"), apiKey, vendor, {
      model: model.modelAlias || model.modelKey,
      messages: [{ role: "user", content: userContent }],
      temperature: Number.isFinite(temperatureValue) ? temperatureValue : 0.7,
      ...(Number.isFinite(maxTokensValue) && maxTokensValue > 0 ? { max_tokens: maxTokensValue } : {}),
    });
    return { id: taskId, kind, status: "succeeded", assets: [], raw: response };
  }

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  // S8 指纹缓存(fallback 路径同语义)。
  const fallbackRecipe = buildNormalizedRecipe({ vendor, model, request });
  const fallbackFingerprint = recipeFingerprint(fallbackRecipe);
  const fallbackHit = readCachedTaskResult({ projectId, fingerprint: fallbackFingerprint, nodeId, extras: request.extras });
  if (fallbackHit) return fallbackHit as TaskResult;
  const providerResponse = await postJson(endpoint(vendor, suffix), apiKey, vendor, {
    model: model.modelAlias || model.modelKey,
    prompt: request.prompt,
    size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
    seed: request.seed,
    n: 1,
    response_format: "url",
    extras: request.extras,
  });
  const assetUrl = extractAssetUrl(providerResponse);
  const upstreamTaskId = extractTaskIdShared(providerResponse) || taskId;
  traceVendorRequested(projectId, { runId: upstreamTaskId, nodeId, recipe: fallbackRecipe });
  if (!assetUrl) {
    taskCache.set(upstreamTaskId, { vendor: vendorKey, request, raw: providerResponse, model, projectId, nodeId, wantedKind, fingerprint: fallbackFingerprint });
    return { id: upstreamTaskId, kind, status: "queued", assets: [], raw: providerResponse };
  }
  const type: "image" | "video" = wantedKind === "video" ? "video" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId)
    : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
  // E11 provenance + S4-1 终态事件:与 profile 路径共用 vendor/provenance 模块(单一真相)。
  const provenance = buildTaskProvenance({ vendor, model, request, vendorRequestId: upstreamTaskId });
  traceVendorCompleted(projectId, { runId: upstreamTaskId, nodeId, status: "succeeded", assetCount: 1 });
  const finalResult: TaskResult = { id: upstreamTaskId, kind, status: "succeeded", assets: [asset], raw: providerResponse, provenance };
  rememberTaskResult(projectId, fallbackFingerprint, finalResult);
  return finalResult;
}

export async function fetchTaskResult(payload: unknown): Promise<{ vendor: string; result: TaskResult }> {
  const raw = payload as JsonRecord;
  const taskId = trim(raw.taskId);
  const cached = taskCache.get(taskId);
  if (!cached) {
    return {
      vendor: trim(raw.vendor),
      result: {
        id: taskId,
        kind: (raw.taskKind as ProfileKind) || "text_to_image",
        status: "failed",
        assets: [],
        raw: { message: "Local task is not in the pending cache." },
      },
    };
  }
  const queryOperation = cached.mapping?.query;
  if (cached.mapping && queryOperation && cached.model) {
    // 不再用缓存的明文 key，轮询时按 vendor 重新派生（并重新校验 key 仍可用）。
    const { vendor, model, apiKey } = findExecutableModel(
      cached.vendor,
      cached.model.modelKey,
      cached.wantedKind,
    );
    const executed = await executeProfileOperation({
      vendor,
      model,
      apiKey,
      request: cached.request,
      operation: queryOperation,
      providerMeta: {
        ...(cached.providerMeta || {}),
        query_id: cached.providerMeta?.query_id || taskId,
        task_id: cached.providerMeta?.task_id || taskId,
      },
    });
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping: cached.mapping,
      operation: queryOperation,
      request: cached.request,
      taskIdFallback: taskId,
      wantedKind: cached.wantedKind || model.kind,
      projectId: cached.projectId,
      nodeId: cached.nodeId,
      vendor,
      model,
    });
    if (normalized.result.status === "succeeded" || normalized.result.status === "failed") {
      // 终态才入日志(轮询 tick 不记);cache.delete 保证单次触发
      traceVendorCompleted(cached.projectId, { runId: taskId, nodeId: cached.nodeId, status: normalized.result.status, assetCount: normalized.result.assets.length });
      rememberTaskResult(cached.projectId || "", cached.fingerprint, normalized.result);
      taskCache.delete(taskId);
    } else {
      taskCache.set(taskId, {
        ...cached,
        raw: executed.response,
        providerMeta: {
          ...(cached.providerMeta || {}),
          ...normalized.providerMeta,
        },
      });
    }
    return { vendor: cached.vendor, result: normalized.result };
  }

  const assetUrl = extractAssetUrl(cached.raw);
  if (assetUrl) {
    const type: "image" | "video" = cached.wantedKind === "video" ? "video" : "image";
    const asset = cached.projectId
      ? await localizeTaskAsset(cached.projectId, assetUrl, type, cached.nodeId)
      : { type, url: assetUrl, thumbnailUrl: type === "image" ? assetUrl : null };
    taskCache.delete(taskId);
    const lateResult: TaskResult = { id: taskId, kind: cached.request.kind, status: "succeeded", assets: [asset], raw: cached.raw };
    rememberTaskResult(cached.projectId || "", cached.fingerprint, lateResult);
    return { vendor: cached.vendor, result: lateResult };
  }

  return {
    vendor: cached.vendor,
    result: {
      id: taskId,
      kind: cached.request.kind,
      status: "queued",
      assets: [],
      raw: cached.raw,
    },
  };
}
