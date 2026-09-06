import crypto from "node:crypto";
import { assertLocalAssetTransportReady, localizeAssetsForVendor, trustedLocalOutputOrigin } from "./catalog/assetLocalization";
import { assetIngestionResolver, assetLocalizationOptions } from "./catalog/assetTransportRuntime";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from "./assets/localAssetFile";
import { importRemoteAsset, writeAsset, writeDeterministicAsset } from "./assets/projectAssetStore";
import { endpoint } from "./vendorEndpoint";
import { requestJson, requestMultipart, vendorResponseLimitForKind } from "./vendor/vendorHttp";
import { runMultipartProfileOperation } from "./catalog/multipartOperation";
import { templateContext, buildProfileHttpRequest, validateProfileRequestBeforeSpend } from "./catalog/profileHttpRequest";
import { chatImageFallbackOperation } from "./catalog/imageRouteFallback";
import { buildNormalizedRecipe, buildTaskProvenance } from "./vendor/provenance";
import { extractProviderCostActual, type ProviderCostActual } from "./vendor/cost";
import { traceVendorCompleted, traceVendorRequested } from "./events/vendorCallTrace";
import { scheduleTechnicalReview } from "./review/reviewTrace";
import { localizedTaskAssetFileName, probeLocalizedDurationSeconds } from "./assets/localizedAsset";
import { type AuthType, authHeaders as buildAuthHeaders, extractTaskId as extractTaskIdShared } from "./ai/requestPipeline";
import { assertCanonicalAntigravityOperation, executeProcessOperation, prepareAntigravityCreateOperation } from "./catalog/processOperation"; import type { AntigravityProcessStage } from "./catalog/antigravityCatalog";
import { executeTextTask } from "./textTaskRunner";
import { runAudioTask } from "./audioTaskRunner";
import { firstString, isJsonRecord, trim, type JsonRecord } from "./jsonUtils";
import { collectAssetUrls, firstMappedString, providerMetaFromResponse, resolveTaskStatus, taskFailureMessageFromResponse, valuesFromMapping } from "./tasks/responseParsing";
import { extractAssetUrl } from "./tasks/assetUrlExtract";
import { applyResponseTransform } from "./tasks/responseTransforms";
import { applyRequestTransform } from "./tasks/requestTransforms";
import { TtlLruCache } from "./tasks/taskCache";
import { markTaskAdmitted } from "./tasks/taskAdmission";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "./vendor/fingerprintCache";
import {
  createProject,
  deleteProject,
  listProjects,
  readProject,
  resolveProjectRelativePath,
  saveProject,
} from "./projects/repository";
// 公共 API：main.ts 仍从 "./runtime" 消费这些 —— re-export 保持其 import 不变。
export { createProject, deleteProject, listProjects, readProject, resolveProjectRelativePath, saveProject };
export { copyAssetFile, copyProjectAsset, importRemoteAsset, listProjectAssets, moveAssetFile, writeAsset } from "./assets/projectAssetStore";
// localizedTaskAssetFileName 已抽到 ./assets/localizedAsset（规则 9/12 减负 giant shell）；re-export 保持既有 import（含 runtime.assets.test）不变。
export { localizedTaskAssetFileName }; export type ProfileOperationStage = AntigravityProcessStage | Extract<NonNullable<import("./providerAdapter/types").AdapterModeResult["stage"]>, "result">;
// 任务执行复用 catalog 状态（readCatalog + extractVendorExtraHeaders 纯函数）；
// catalogStore 反向复用本文件任务引擎 → 运行期循环引用（CommonJS 安全）。
import { extractVendorExtraHeaders, readCatalog } from "./catalog/catalogStore";
import { activeTaskProjectFallback, unlocalizedTaskAsset } from "./tasks/activeProjectFallback";
import type { BillingModelKind, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";
import { billingKindForTaskKind, selectTaskMapping } from "./catalog/types";
import { applyHeadlessParamDefaults, imageEditGuardError } from "./catalog/taskParams";
import { modelModeBodies } from "./catalog/modelCatalogListing";
import { runCustomCallTask } from "./catalog/customCallDispatch";
import { resolveCustomCallExecution } from "./catalog/customCallMode";
import { certifyTaskOutputAndSettleComfyCandidate, materializeCertifiedComfyAssets, resolveComfyCandidateExecution } from "./catalog/comfyuiCandidateLifecycle";
import { assertAndConsumeSpendGrant } from "./spendGrant";
import { desktopT } from "./i18n";
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
  listExportJobs,
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
  fetchModelCatalogDocs,
  testModelCatalogMapping,
} from "./catalog/catalogCommit";
export type TaskRequest = {
  kind: ProfileKind;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  extras?: Record<string, unknown> & { executionBinding?: import("./productionRun/productionExecutionBinding").ProductionExecutionBinding };
};
export type TaskResult = {
  id: string;
  kind: ProfileKind;
  status: "queued" | "running" | "succeeded" | "failed";
  assets: Array<{
    type: "image" | "video" | "audio" | "model3d";
    url: string;
    thumbnailUrl?: string | null;
    assetId?: string | null;
    assetRefId?: string | null;
    assetName?: string | null;
    /** 原始 CDN URL（https://...）。供后续生成直接用，无需上传。可能过期，过期后退回本地字节。 */
    providerUrl?: string | null;
    durationSeconds?: number;
  }>;
  raw: unknown;
  /** failed 时的上游真实原因（tasks/responseParsing.taskFailureMessageFromResponse 取；渲染层只读这一处）。 */
  error?: string;
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
    cost?: { amount: number; currency: "credits"; unit: "actual" | "estimate" };
    timestamp: number;
  };
};
// TTL(1h) + LRU(200) 上限，防异步任务条目无界驻留（P0-7）。不再缓存明文 apiKey。
export const taskCache = new TtlLruCache<CachedTask>({ maxEntries: 200, ttlMs: 60 * 60 * 1000 });

/** 受理一个异步任务：写工作缓存 + 记账本（单一入口，所有 admit 点同源，防漏记）。 */
export function admitTask(id: string, entry: CachedTask): void {
  taskCache.set(id, entry);
  markTaskAdmitted(id);
}

export type CachedTask = {
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
  /** 未知状态动词连击（规则见 tasks/taskResultQuery）：本对象已是逐任务跨轮询的载体，故状态存这。 */
  unrecognizedStatusStreak?: { verb: string; polls: number; firstSeenAt: number };
};

// 可执行模型解析下沉到 catalog/executableModel（R12 净减）；re-export 保住 textTaskRunner/taskResultQuery 既有 import 面。
export { findExecutableModel, findExecutableModelForTask } from "./catalog/executableModel";
import { findExecutableModel } from "./catalog/executableModel";

// Thin Vendor→primitive adapters over the shared requestPipeline auth logic
// (the shared module is electron-free and doesn't know the Vendor shape).
function authHeaders(vendor: Vendor, apiKey: string): Record<string, string> {
  return buildAuthHeaders(vendor.authType as AuthType, apiKey, vendor.authHeader ?? undefined);
}

// billingKindForTaskKind 下沉到 catalog/types（R12 净减）；re-export 保住既有消费方 import 面。
export { billingKindForTaskKind } from "./catalog/types";
export { extractAssetUrl } from "./tasks/assetUrlExtract";

export async function localizeTaskAsset(
  projectId: string,
  assetUrl: string,
  type: "image" | "video" | "audio" | "model3d",
  nodeId?: string, vendor?: Pick<Vendor, "key" | "baseUrlHint" | "network">,
  certificationEvidence?: import("./providerAdapter/certificationMedia").CertificationMediaEvidence,
): Promise<TaskResult["assets"][number]> {
  const imported = (await importRemoteAsset({
    projectId,
    url: assetUrl,
    kind: "generated",
    ownerNodeId: nodeId || null,
    fileName: localizedTaskAssetFileName(type, assetUrl),
  }, {
    trustedPrivateOrigin: trustedLocalOutputOrigin(vendor) || undefined,
    ...(certificationEvidence ? { certificationEvidence } : {}), ...(vendor?.network ? { providerNetwork: vendor.network } : {}),
  })) as { id?: string; name?: string; data?: { url?: string; absolutePath?: string } };
  const durationSeconds = await probeLocalizedDurationSeconds(type, imported.data?.absolutePath);
  if (type === "image" || type === "video")
    scheduleTechnicalReview({
      projectId,
      nodeId,
      absolutePath: String(imported.data?.absolutePath || ""),
      assetUrl: String(imported.data?.url || assetUrl),
      type,
    }); // S4-2b:落地技术自检,仅图像/视频（3D 模型不送 VLM）
  return {
    type,
    url: String(imported.data?.url || assetUrl),
    thumbnailUrl: type === "image" ? String(imported.data?.url || assetUrl) : null,
    assetId: imported.id || null,
    assetName: imported.name || null,
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    // 原始 CDN URL 留存：任何 vendor 都能直接使用，不需要再上传或转 base64。
    providerUrl: /^https?:\/\//i.test(assetUrl) ? assetUrl : null,
  };
}

export function findTaskMapping(vendorKey: string, taskKind: ProfileKind, modelKey?: string, modeId?: string): Mapping | null {
  // 按 (vendor, taskKind, modelKey) 选——同 vendor 下两模型共用一个 taskKind 但请求形状不同时（如 HappyHorse 与 Kling 都 text_to_video），靠 modelKey 精确路由，不再「第一个赢、另一个套错模板」。
  return selectTaskMapping(readCatalog().mappings, vendorKey, taskKind, modelKey, modeId);
}

/** Audio with a query operation is an asynchronous generation task, not a synchronous TTS/STT response. */
export function usesSynchronousAudioRunner(wantedKind: BillingModelKind, mapping?: Mapping | null): boolean {
  return wantedKind === "audio" && !mapping?.query;
}

export { buildProfileHttpRequest };
export async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
  localAssetReader?: import("./catalog/assetLocalization").LocalAssetReader; signal?: AbortSignal; stage?: ProfileOperationStage; antigravityPreflight?: import("./ai/antigravityTask").PreparedAntigravityTask;
}): Promise<{ response: unknown; request: unknown }> {
  // Process and multipart declarations are handled by their shared executors.
  if (input.operation.process) {
    if (input.stage === "result") throw new Error("ANTIGRAVITY_INVALID_CONFIG");
    if (input.operation.process.parser === "antigravity-cli-image" && !input.stage) throw new Error("ANTIGRAVITY_INVALID_CONFIG");
    if (input.operation.process.parser === "antigravity-cli-image") assertCanonicalAntigravityOperation({ vendorKey: input.vendor.key, modelKey: input.model.modelKey, taskKind: input.request.kind, stage: input.stage!, operation: input.operation });
    const context = templateContext(
      input.request,
      input.model,
      input.apiKey,
      input.providerMeta || {},
      input.operation.paramMap,
    );
    return executeProcessOperation({
      process: input.operation.process,
      context,
      projectId: trim(input.request.extras?.projectId) || activeTaskProjectFallback(),
      writeAsset, writeDeterministicAsset, signal: input.signal, stage: input.stage, identity: { vendorKey: input.vendor.key, modelKey: input.model.modelKey, taskKind: input.request.kind }, antigravityPreflight: input.antigravityPreflight,
    });
  }
  if (input.operation.multipart) return runMultipartProfileOperation(input, (u, h, q, f) => requestMultipart(input.vendor, input.apiKey, u, h, q, f, input.signal, { maxResponseBytes: vendorResponseLimitForKind(input.model.kind) }));
  const uploadCatalog = readCatalog();
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    assetIngestionResolver(input.vendor, uploadCatalog),
    input.localAssetReader || readNomiLocalAsset,
    postJsonForAssetUpload,
    postMultipartForAssetUpload,
    assetLocalizationOptions(input.request.extras),
    putBinaryForAssetUpload,
  );
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  const built = buildProfileHttpRequest(effectiveInput);
  const body = await applyRequestTransform(input.operation.request_transform, built.body, { baseUrl: String(input.vendor.baseUrlHint || ""), promptId: trim(input.request.extras?.comfyPromptId), request: input.request });
  const { vendor, apiKey } = effectiveInput;
  const response = await requestJson(vendor, apiKey, built.method, built.url, built.headers, built.query, body, input.signal, { maxResponseBytes: vendorResponseLimitForKind(input.model.kind) });
  return { response, request: built.preview };
}
/** Normalize an upstream response into the shared TaskResult contract. */
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
}): Promise<{ result: TaskResult; providerMeta: JsonRecord; unrecognizedStatus: string; actualCost?: ProviderCostActual }> {
  const response = applyResponseTransform(input.operation.response_transform, input.response, {
    baseUrl: String(input.vendor?.baseUrlHint || ""),
  });
  const { response_mapping: rawResponseMapping, provider_meta_mapping: rawMetaMapping } = input.operation;
  const responseMapping = isJsonRecord(rawResponseMapping) ? rawResponseMapping : null;
  const providerMetaMapping = isJsonRecord(rawMetaMapping) ? rawMetaMapping : null;
  const providerMeta = providerMetaFromResponse(response, providerMetaMapping);
  const taskId = firstString(
    firstMappedString(response, responseMapping, "task_id"),
    providerMeta.task_id,
    providerMeta.query_id,
    extractTaskIdShared(response),
    input.taskIdFallback,
  );
  const mappedAssetValues = ["assets", "image_url", "video_url", "audio_url", "model_url"].flatMap((key) => valuesFromMapping(response, responseMapping, key));
  const assetUrls = Array.from(new Set([...mappedAssetValues.flatMap(collectAssetUrls), ...collectAssetUrls(extractAssetUrl(response))]));
  const { status, unrecognizedStatus } = resolveTaskStatus(response, responseMapping, input.mapping.statusMapping, assetUrls);
  const type: "image" | "video" | "audio" | "model3d" =
    input.wantedKind === "video" ? "video" : input.wantedKind === "audio" ? "audio" : input.wantedKind === "model3d" ? "model3d" : "image";
  const certification = await certifyTaskOutputAndSettleComfyCandidate({ request: input.request, modelKey: input.model?.modelKey, status, urls: assetUrls, kind: type, vendorBaseUrl: String(input.vendor?.baseUrlHint || "") });
  const assets = await materializeCertifiedComfyAssets({ certification, status, urls: assetUrls,
    materialize: (url, index) => input.projectId
      ? localizeTaskAsset(input.projectId, url, type, input.nodeId, input.vendor, certification.evidence[index])
      : Promise.resolve(unlocalizedTaskAsset(type, url)) });
  const actualCost = extractProviderCostActual(input.vendor?.key || "", input.response);
  return {
    providerMeta,
    unrecognizedStatus,
    ...(actualCost ? { actualCost } : {}),
    result: {
      id: taskId,
      kind: input.request.kind,
      status,
      assets,
      raw: input.response,
      ...(status === "failed" ? { error: taskFailureMessageFromResponse(response, responseMapping) } : {}),
      ...(status === "succeeded" && input.vendor && input.model
        ? { provenance: buildTaskProvenance({ vendor: input.vendor, model: input.model, request: input.request, vendorRequestId: taskId, actualCost }) }
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
  const archetypeMeta = request.extras?.archetype;
  const modeId = archetypeMeta && typeof archetypeMeta === "object" ? firstString((archetypeMeta as JsonRecord).modeId) : firstString(request.extras?.modeId);
  const stagedCandidate = resolveComfyCandidateExecution(request);
  const { vendor, model, apiKey, customConfig } = stagedCandidate || findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId) || activeTaskProjectFallback();
  const nodeId = trim(request.extras?.nodeId);
  const grantId = trim(request.extras?.grantId);
  const taskId = `task-${crypto.randomUUID()}`;
  const effectiveVendorKey = vendor.key;
  const mapping = stagedCandidate?.mapping || findTaskMapping(effectiveVendorKey, kind, modelKey, modeId);
  request.extras = applyHeadlessParamDefaults(request.extras, (model?.meta as { archetypeId?: string } | undefined)?.archetypeId, kind, effectiveVendorKey, mapping?.create?.defaultParams, mapping?.create?.body, model.modelKey);
  const customCall = resolveCustomCallExecution(model as Model, request, mapping);
  const customCallScript = customCall?.script || "";
  const guardError = imageEditGuardError(kind, request, Boolean(mapping) || Boolean(customCallScript), model.labelZh || model.modelKey, customCallScript ? undefined : mapping?.create?.body, modelModeBodies(readCatalog().mappings, effectiveVendorKey, modelKey, (model as Model).modelAlias), { vendorKey: effectiveVendorKey, modelKey: model.modelKey });
  if (guardError) throw new Error(guardError);
  if (customCallScript)
    return runCustomCallTask({ vendor, model, apiKey, customConfig, script: customCallScript, taskKind: customCall!.taskKind, modeId: customCall!.modeId, request, kind, wantedKind, projectId, nodeId, grantId, taskId, localizeTaskAsset, writeAsset });
  if (usesSynchronousAudioRunner(wantedKind, mapping)) {
    assertAndConsumeSpendGrant(grantId, nodeId);
    return runAudioTask({ vendor, model, apiKey, request, kind, taskId, projectId, nodeId, mapping });
  }
  if (mapping) {
    await validateProfileRequestBeforeSpend({ vendor, model, apiKey, request, operation: mapping.create });
    const uploadCatalog = readCatalog();
    if (!mapping.create.multipart && !mapping.create.process) {
      assertLocalAssetTransportReady(
        request.extras,
        assetIngestionResolver(vendor, uploadCatalog),
        readNomiLocalAsset,
        assetLocalizationOptions(request.extras),
      );
    }
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      mappingId: trim((mapping as unknown as JsonRecord).id),
      request,
    });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    const antigravityPreflight = await prepareAntigravityCreateOperation({ vendorKey: effectiveVendorKey, modelKey: model.modelKey, taskKind: kind, operation: mapping.create, request });
    assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：缓存未命中=真发 vendor，发前校验消费令牌
    let createOperation = mapping.create; let executed;
    try {
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation, stage: "create", antigravityPreflight });
    } catch (error) {
      const fallbackOp = chatImageFallbackOperation(error, createOperation, kind);
      if (!fallbackOp) throw error;
      createOperation = fallbackOp;
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation, stage: "create", antigravityPreflight });
    }
    const normalized = await buildProfileTaskResult({
      response: executed.response,
      mapping,
      operation: createOperation,
      request,
      taskIdFallback: taskId,
      wantedKind,
      projectId,
      nodeId,
      vendor,
      model,
    });
    if (normalized.result.status === "queued" && mapping.query && !normalized.providerMeta.task_id && !normalized.providerMeta.query_id) {
      const missingTaskIdResult: TaskResult = { ...normalized.result, status: "failed", error: desktopT("tasks.missingTaskId") };
      traceVendorRequested(projectId, { runId: missingTaskIdResult.id, nodeId, recipe });
      traceVendorCompleted(projectId, {
        runId: missingTaskIdResult.id,
        nodeId,
        status: "failed",
        assetCount: 0,
      });
      rememberTaskResult(projectId, fingerprint, missingTaskIdResult);
      return missingTaskIdResult;
    }
    traceVendorRequested(projectId, { runId: normalized.result.id, nodeId, recipe });
    if (["succeeded", "failed"].includes(normalized.result.status)) {
      traceVendorCompleted(projectId, { runId: normalized.result.id, nodeId, status: normalized.result.status as "succeeded" | "failed", assetCount: normalized.result.assets.length, ...(normalized.actualCost ? { cost: normalized.actualCost } : {}) });
      rememberTaskResult(projectId, fingerprint, normalized.result);
    }
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      admitTask(normalized.result.id, {
        vendor: effectiveVendorKey,
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

  if (wantedKind === "text") return executeTextTask({ vendor, model, apiKey, kind, request, taskId });

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  const fallbackRecipe = buildNormalizedRecipe({ vendor, model, request });
  const fallbackFingerprint = recipeFingerprint(fallbackRecipe);
  const fallbackHit = readCachedTaskResult({
    projectId,
    fingerprint: fallbackFingerprint,
    nodeId,
    extras: request.extras,
  });
  if (fallbackHit) return fallbackHit as TaskResult;
  assertAndConsumeSpendGrant(grantId, nodeId);
  const fallbackExtraHeaders = extractVendorExtraHeaders(vendor);
  const fallbackHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(vendor, apiKey),
    ...(fallbackExtraHeaders || {}),
  };
  const providerResponse = await requestJson(
    vendor,
    apiKey,
    "POST",
    endpoint(vendor, suffix),
    fallbackHeaders,
    {},
    { // 键形状由 taskParams.NO_MAPPING_FALLBACK_BODY 声明并被测试钉死（两处必须同构）。
      model: model.modelAlias || model.modelKey,
      prompt: request.prompt,
      size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
      seed: request.seed,
      n: 1,
      response_format: "url",
      extras: request.extras,
    },
  );
  const assetUrl = extractAssetUrl(providerResponse);
  const upstreamTaskId = extractTaskIdShared(providerResponse) || taskId;
  traceVendorRequested(projectId, { runId: upstreamTaskId, nodeId, recipe: fallbackRecipe });
  if (!assetUrl) {
    admitTask(upstreamTaskId, {
      vendor: vendorKey,
      request,
      raw: providerResponse,
      model,
      projectId,
      nodeId,
      wantedKind,
      fingerprint: fallbackFingerprint,
    });
    return { id: upstreamTaskId, kind, status: "queued", assets: [], raw: providerResponse };
  }
  const type: "image" | "video" | "audio" | "model3d" =
    wantedKind === "video" ? "video" : wantedKind === "audio" ? "audio" : wantedKind === "model3d" ? "model3d" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId, vendor) : unlocalizedTaskAsset(type, assetUrl);
  const actualCost = extractProviderCostActual(vendor.key, providerResponse);
  const provenance = buildTaskProvenance({ vendor, model, request, vendorRequestId: upstreamTaskId, actualCost });
  traceVendorCompleted(projectId, { runId: upstreamTaskId, nodeId, status: "succeeded", assetCount: 1, ...(actualCost ? { cost: actualCost } : {}) });
  const finalResult: TaskResult = {
    id: upstreamTaskId,
    kind,
    status: "succeeded",
    assets: [asset],
    raw: providerResponse,
    provenance,
  };
  rememberTaskResult(projectId, fallbackFingerprint, finalResult);
  return finalResult;
}

export { fetchTaskResult } from "./tasks/taskResultQuery";
