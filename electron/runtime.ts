import crypto from "node:crypto";
import { assertLocalAssetTransportReady, localizeAssetsForVendor, trustedLocalOutputOrigin } from "./catalog/assetLocalization";
import { assetIngestionResolver, assetLocalizationOptions } from "./catalog/assetTransportRuntime";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload } from "./assets/localAssetFile";
import { importRemoteAsset, writeAsset } from "./assets/projectAssetStore";
import { endpoint } from "./vendorEndpoint";
import { requestJson, requestMultipart } from "./vendor/vendorHttp";
import { runMultipartProfileOperation } from "./catalog/multipartOperation";
import { templateContext, buildProfileHttpRequest } from "./catalog/profileHttpRequest";
import { chatImageFallbackOperation } from "./catalog/imageRouteFallback";
import { buildNormalizedRecipe, buildTaskProvenance } from "./vendor/provenance";
import { extractProviderCostActual, type ProviderCostActual } from "./vendor/cost";
import { traceVendorCompleted, traceVendorRequested } from "./events/vendorCallTrace";
import { scheduleTechnicalReview } from "./review/reviewTrace";
import { localizedTaskAssetFileName, probeLocalizedDurationSeconds } from "./assets/localizedAsset";
import {
  type AuthType,
  authHeaders as buildAuthHeaders,
  extractTaskId as extractTaskIdShared,
} from "./ai/requestPipeline";
import { executeProcessOperation } from "./catalog/processOperation";
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
export { copyAssetFile, importRemoteAsset, listProjectAssets, moveAssetFile, writeAsset } from "./assets/projectAssetStore";
// localizedTaskAssetFileName 已抽到 ./assets/localizedAsset（规则 9/12 减负 giant shell）；re-export 保持既有 import（含 runtime.assets.test）不变。
export { localizedTaskAssetFileName };
// 任务执行复用 catalog 状态（readCatalog + extractVendorExtraHeaders 纯函数）；
// catalogStore 反向复用本文件任务引擎 → 运行期循环引用（CommonJS 安全）。
import { extractVendorExtraHeaders, readCatalog } from "./catalog/catalogStore";
import { activeTaskProjectFallback, unlocalizedTaskAsset } from "./tasks/activeProjectFallback";
import type { BillingModelKind, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";
import { billingKindForTaskKind, selectExecutableModel, selectTaskMapping } from "./catalog/types";
import { applyHeadlessParamDefaults, imageEditGuardError } from "./catalog/taskParams";
import { modelModeBodies } from "./catalog/modelCatalogListing";
import { runCustomCallTask } from "./catalog/customCallDispatch";
import { resolveCustomCallExecution } from "./catalog/customCallMode";
import { assertAndConsumeSpendGrant } from "./spendGrant";
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
  nodeId?: string, vendor?: Pick<Vendor, "key" | "baseUrlHint">,
): Promise<TaskResult["assets"][number]> {
  const imported = (await importRemoteAsset({
    projectId,
    url: assetUrl,
    kind: "generated",
    ownerNodeId: nodeId || null,
    fileName: localizedTaskAssetFileName(type, assetUrl),
  }, { trustedPrivateOrigin: trustedLocalOutputOrigin(vendor) || undefined })) as { id?: string; name?: string; data?: { url?: string; absolutePath?: string } };
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

export function findTaskMapping(vendorKey: string, taskKind: ProfileKind, modelKey?: string): Mapping | null {
  // 按 (vendor, taskKind, modelKey) 选——同 vendor 下两模型共用一个 taskKind 但请求形状不同时（如 HappyHorse 与 Kling 都 text_to_video），靠 modelKey 精确路由，不再「第一个赢、另一个套错模板」。
  return selectTaskMapping(readCatalog().mappings, vendorKey, taskKind, modelKey);
}

// 请求构造层已抽到 catalog/profileHttpRequest（减负 giant shell）；re-export 保持 audioTaskRunner/catalogCommit 从 ./runtime 导入不变。
export { buildProfileHttpRequest };
export async function executeProfileOperation(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
  localAssetReader?: import("./catalog/assetLocalization").LocalAssetReader;
  signal?: AbortSignal;
}): Promise<{ response: unknown; request: unknown }> {
  // 进程型 transport（P4 声明驱动）：op 声明 process（本地 CLI dreamina）→ spawn，不走 HTTP。
  // 渲染/spawn/本地文件导入全在 processOperation（注入 writeAsset，避免 ↔ runtime 循环依赖）。
  if (input.operation.process) {
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
      writeAsset,
    });
  }
  // multipart transport（P4）：op 声明 multipart（/v1/images/edits 图生图文件上传）→ 全套分发在 multipartOperation
  // （localize 前分流：要参考图原始字节，不先上传换 URL）。requestMultipart 注入以带 vendor 计费上下文。
  if (input.operation.multipart) return runMultipartProfileOperation(input, (u, h, q, f) => requestMultipart(input.vendor, input.apiKey, u, h, q, f, input.signal));

  // R1：发送前把本地素材(nomi-local://)按策略变成 vendor 可达值。带跨供应商 fallback + 内容类型感知：
  // 每素材按媒体类型挑通道(图→apimart/KIE base64;视频→KIE stream,apimart image-only 跳过)。上传 key 可异于生成 key。
  const uploadCatalog = readCatalog();
  const localized = await localizeAssetsForVendor(
    input.request.extras,
    assetIngestionResolver(input.vendor, uploadCatalog),
    input.localAssetReader || readNomiLocalAsset,
    postJsonForAssetUpload,
    postMultipartForAssetUpload,
    assetLocalizationOptions(input.request.extras),
  );
  const effectiveInput =
    localized.uploaded > 0
      ? { ...input, request: { ...input.request, extras: localized.value as TaskRequest["extras"] } }
      : input;
  const built = buildProfileHttpRequest(effectiveInput);
  // 命名请求变换（P4，与 response_transform 对称）：发送前按后端实况补全 body；未声明 → 原样。
  const body = await applyRequestTransform(input.operation.request_transform, built.body, { baseUrl: String(input.vendor.baseUrlHint || ""), promptId: trim(input.request.extras?.comfyPromptId) });
  const { vendor, apiKey } = effectiveInput;
  const response = await requestJson(vendor, apiKey, built.method, built.url, built.headers, built.query, body, input.signal);
  return { response, request: built.preview };
}

/** 归一上游响应成 TaskResult：命名响应变换（可选）→ 点路径 mapping（kie 等返 JSON 字符串已透明 parse）。 */
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
  // unrecognizedStatus 随返回对象带出，**不进 TaskResult 公共类型**：判定只在 tasks/taskResultQuery 收口。
}): Promise<{ result: TaskResult; providerMeta: JsonRecord; unrecognizedStatus: string; actualCost?: ProviderCostActual }> {
  // 命名响应变换（P4，如 ComfyUI /history 归一）：response_mapping 前对 raw response 应用一次；未声明→原样。
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
  const mappedAssetValues = ["assets", "image_url", "video_url", "model_url"].flatMap((key) =>
    valuesFromMapping(response, responseMapping, key),
  );
  const assetUrls = Array.from(
    new Set([...mappedAssetValues.flatMap(collectAssetUrls), ...collectAssetUrls(extractAssetUrl(response))]),
  );
  const { status, unrecognizedStatus } = resolveTaskStatus(response, responseMapping, input.mapping.statusMapping, assetUrls);
  const type: "image" | "video" | "model3d" =
    input.wantedKind === "video" ? "video" : input.wantedKind === "model3d" ? "model3d" : "image";
  const assets = input.projectId
    ? await Promise.all(assetUrls.map((url) => localizeTaskAsset(input.projectId || "", url, type, input.nodeId, input.vendor)))
    : assetUrls.map((url) => unlocalizedTaskAsset(type, url));
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
        ? {
            provenance: buildTaskProvenance({
              vendor: input.vendor,
              model: input.model,
              request: input.request,
              vendorRequestId: taskId,
              actualCost,
            }),
          }
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
  const { vendor, model, apiKey, customConfig } = findExecutableModel(vendorKey, modelKey, wantedKind);
  const projectId = trim(request.extras?.projectId) || activeTaskProjectFallback();
  const nodeId = trim(request.extras?.nodeId);
  const grantId = trim(request.extras?.grantId);
  const taskId = `task-${crypto.randomUUID()}`;
  const mapping = findTaskMapping(vendorKey, kind, modelKey);
  // headless/MCP extras 预备：缺参兜底 + W1d 参考键形态投影（末参 createBody，逻辑/文档住 taskParams.applyHeadlessParamDefaults）；自定义调用脚本存在即接管图/视频/3D（对 L3 护栏算「有 mapping」，参考缺失拒发仍生效，派发抽到 catalog/customCallDispatch，R12）。
  request.extras = applyHeadlessParamDefaults(request.extras, (model?.meta as { archetypeId?: string } | undefined)?.archetypeId, kind, vendorKey, mapping?.create?.defaultParams, mapping?.create?.body);
  const customCall = resolveCustomCallExecution(model as Model, request, mapping);
  const customCallScript = customCall?.script || "";
  // L3 诚实护栏（判定在 taskParams.imageEditGuardError）：图生图/图生视频缺参考或缺 mapping → 付费守卫前拒发人话，绝不静默退化纯文生。末参 modelModeBodies（该模型所有模式 body）= 交付4：拒发时点名"哪个模式带得动你连的参考"（同套 mapping derive）。
  const guardError = imageEditGuardError(kind, request, Boolean(mapping) || Boolean(customCallScript), model.labelZh || model.modelKey, customCallScript ? undefined : mapping?.create?.body, modelModeBodies(readCatalog().mappings, vendorKey, modelKey, (model as Model).modelAlias));
  if (guardError) throw new Error(guardError);
  if (customCallScript) // 先于 mapping/fallback；注入避免循环依赖。文本也走这里（去掉 wantedKind!=="text" 排除：那等于「接不上的文本模型毫无出路」，而用户最初踩的正是文本模型）；文本脚本 return { text }
    return runCustomCallTask({ vendor, model, apiKey, customConfig, script: customCallScript, taskKind: customCall!.taskKind, modeId: customCall!.modeId, request, kind, wantedKind, projectId, nodeId, grantId, taskId, localizeTaskAsset, writeAsset });
  // 第四路 audio：没有脚本接管时才走 TTS/Whisper 同步收口（二进制/multipart）。
  if (wantedKind === "audio") {
    assertAndConsumeSpendGrant(grantId, nodeId);
    return runAudioTask({ vendor, model, apiKey, request, kind, taskId, projectId, nodeId, mapping });
  }
  if (mapping) {
    const uploadCatalog = readCatalog();
    if (!mapping.create.multipart && !mapping.create.process) {
      assertLocalAssetTransportReady(
        request.extras,
        assetIngestionResolver(vendor, uploadCatalog),
        readNomiLocalAsset,
        assetLocalizationOptions(request.extras),
      );
    }
    // S8 指纹缓存:同配方(参数没动)秒回上次成功结果,零 vendor 调用;强制重跑经 extras.forceRerun 绕读。
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      mappingId: trim((mapping as unknown as JsonRecord).id),
      request,
    });
    const fingerprint = recipeFingerprint(recipe);
    const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
    if (cachedHit) return cachedHit as TaskResult;
    assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：缓存未命中=真发 vendor，发前校验消费令牌
    // 中转生图路由回退（y7api 403 定案）：OpenAI images 端点被「分组未开通」类确定性拒绝（403 命中
    // 窄短语 / 404/405，未创建任务未扣费）→ 换 chat/completions 多模态 op 重发一次；结果归一按
    // 实际执行的 op 走（chat 同步返回，extractChatImageUrl 兜底解析）。详见 catalog/imageRouteFallback。
    let createOperation = mapping.create;
    let executed;
    try {
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation });
    } catch (error) {
      const fallbackOp = chatImageFallbackOperation(error, createOperation, kind);
      if (!fallbackOp) throw error;
      createOperation = fallbackOp;
      executed = await executeProfileOperation({ vendor, model, apiKey, request, operation: createOperation });
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
    traceVendorRequested(projectId, { runId: normalized.result.id, nodeId, recipe });
    if (["succeeded", "failed"].includes(normalized.result.status)) {
      traceVendorCompleted(projectId, { runId: normalized.result.id, nodeId, status: normalized.result.status as "succeeded" | "failed", assetCount: normalized.result.assets.length, ...(normalized.actualCost ? { cost: normalized.actualCost } : {}) });
      rememberTaskResult(projectId, fingerprint, normalized.result);
    }
    if (!["succeeded", "failed"].includes(normalized.result.status)) {
      admitTask(normalized.result.id, {
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

  // 路径 B 文本任务走 AI SDK（引擎在 textTaskRunner）；逐字流式由 runTextTaskStream 消费。
  if (wantedKind === "text") return executeTextTask({ vendor, model, apiKey, kind, request, taskId });

  const suffix = wantedKind === "video" ? "/v1/videos/generations" : "/v1/images/generations";
  // S8 指纹缓存(fallback 路径同语义)。
  const fallbackRecipe = buildNormalizedRecipe({ vendor, model, request });
  const fallbackFingerprint = recipeFingerprint(fallbackRecipe);
  const fallbackHit = readCachedTaskResult({
    projectId,
    fingerprint: fallbackFingerprint,
    nodeId,
    extras: request.extras,
  });
  if (fallbackHit) return fallbackHit as TaskResult;
  assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：fallback 缓存未命中=真发 vendor，发前校验
  // 与 profile 路径同源走 requestJson（单一真相）：错误在抛出那刻即为结构化
  // VendorRequestError（401→auth/402→balance 查表），不再裸 Error 让下游正则反猜（修 #1）；
  // extraHeaders（网关头）也一并带上，与 profile 路径一致（修 #2 的 fallback 分支）。
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
    {
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
  const type: "image" | "video" | "model3d" =
    wantedKind === "video" ? "video" : wantedKind === "model3d" ? "model3d" : "image";
  const asset: TaskResult["assets"][number] = projectId
    ? await localizeTaskAsset(projectId, assetUrl, type, nodeId, vendor) : unlocalizedTaskAsset(type, assetUrl);
  // E11 provenance + S4-1 终态事件:与 profile 路径共用 vendor/provenance 模块(单一真相)。
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

// 异步任务「续查」已拆到 ./tasks/taskResultQuery（巨壳门岗·只减不增 R12）。
// 该模块从本文件取 executeProfileOperation/buildProfileTaskResult/findExecutableModel/findTaskMapping/
// extractAssetUrl/localizeTaskAsset/admitTask/taskCache（调用时循环依赖，安全）。对外导出面不变。
export { fetchTaskResult } from "./tasks/taskResultQuery";
