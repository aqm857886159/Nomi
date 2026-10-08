/**
 * 目录驱动的生成执行器 —— **与供应商无关**（2026-09-21 BL-1）。
 *
 * ⚠️ 文件名还叫 `apimartGenerationProvider`，这是历史残留，不是它今天的语义：里面已经
 * 没有任何供应商常量，服务哪一家由 `options.vendorKey` 说了算。**改名是单独一刀**，
 * 因为 5 份既有根因合同的 `doors[].path` 指着这个路径，重指会让门岗把那几份合同当成
 * 「本次改动的合同」重新全量校验（要求它们的回归测试也出现在同一个 diff 里）——
 * 那是一次应该自己被审的机械改名，不该混在这刀行为变更里。
 */
import type { GenerationProvider, GenerationProviderRequestInputV1 } from "./generationRuntimeAdapter";
import { appFetch } from "../appFetch";
import { requestJson, VendorRequestError } from "../vendor/vendorHttp";
import { extractMaterializationOutputs } from "./apimartGenerationOutputs";
import { productionGenerationPayloadHash } from "../productionRun/productionGenerationAuthorization";
import { readCatalog } from "../catalog/catalogStore";
import { builtinVendorScopeMatches, isBuiltinDirectKeyVendor } from "../catalog/builtinVendorSeeds";
import { hasBuiltinCuratedExecution } from "../catalog/seedBuiltins";
import { isCertificationOwnedConnection } from "../catalog/certificationOwnership";
import { billingKindForTaskKind, selectTaskMapping } from "../catalog/types";
import type { BillingModelKind, CatalogState, HttpOperation, Mapping, Model, ProfileKind, Vendor } from "../catalog/types";
import { derivePublishedExecution } from "../shared/modelPublication";
import { buildProfileHttpRequest } from "../catalog/profileHttpRequest";
import { applyHeadlessParamDefaults, imageEditGuardError } from "../catalog/taskParams";
import { resolveCustomCallExecution } from "../catalog/customCallMode";
import { extractVendorExtraHeaders } from "../catalog/catalogStore";
import { bodyReferencedParamKeys } from "../catalog/paramTranslate";
import { isJsonRecord, firstString } from "../jsonUtils";
import { firstMappedString, providerMetaFromResponse, resolveTaskStatus, taskFailureMessageFromResponse } from "../tasks/responseParsing";
import { extractTaskId as extractTaskIdShared } from "../ai/requestPipeline";
import type { TaskRequest } from "../runtime";
import "../catalog/apimartMinimaxH3";
import { applyRequestTransformSync, validateRequestTransformSync } from "../tasks/requestTransforms";
import { mirrorApimartReferenceParameterAliases } from "./apimartGenerationReferenceAliases";
import { productionFixtureBaseOrigin } from "../shared/productionRunE2eFixtureGate";
import {
  assertReferenceParameters,
  assertReferencesReachBody,
  normalizeParameters,
  projectReferenceUrls,
  resolvedReferenceUrls,
  sameJson,
} from "./apimartGenerationProjection";
import { referenceCombineChannelFor } from "../shared/videoCapabilities/referenceChannels";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { ApimartGenerationProviderError as CatalogGenerationProviderError } from "./apimartGenerationErrors";
import { catalogFingerprint } from "./apimartGenerationIdentity";

export type {
  ApimartImageReferenceWithRole,
  ApimartReferenceProjection,
} from "./apimartGenerationProjection";
export { ApimartGenerationProviderError as CatalogGenerationProviderError } from "./apimartGenerationErrors";

export type CatalogGenerationProviderOptions = {
  /**
   * 这个执行器服务哪一家。**它是参数，不是常量**——此前整份文件写死 `"apimart"`，
   * 于是 `generationProviderBootstrap` 只造得出一个 provider：用户在设置里接好的
   * kie / 火山 / Higgsfield / 本地 ComfyUI / 自建中转，在画布上按生成能跑，
   * 在 Agent 付款卡 / 外部 MCP / 全自动 Run 上一律 `configured_provider`
   * ——「一个用户明明已经配好的供应商，被告知没配」（sweep2 BL-1）。
   */
  vendorKey: string;
  resolveConnection: () => { apiKey: string; baseUrl?: string } | null;
  fetchImpl?: typeof fetch;
  /**
   * Zero-cost Electron fixture seam. The bootstrap validates this as a
   * loopback origin and enables it only under the explicit production
   * fixture flag; the catalog/vendor contract remains canonical.
   */
  fixtureBaseUrlOverride?: string;
  /** Read the current, persisted catalog. A semantic request is never built
   * from a guessed endpoint or an ad-hoc model id; the selected mapping is
   * sealed against this snapshot before approval and checked again at submit. */
  catalogReader?: () => CatalogState;
  /**
   * 装配那一刻的目录快照——**只用来算恢复能力**（这家的 mapping 声明了轮询 op 吗）。
   * 出站永远读 `catalogReader()` 的实时快照；这一份存在只是因为装配方
   * （`generationProviderBootstrap`）手上已经有那份 state，不该逼它再读一次盘。
   */
  initialState?: CatalogState;
};

type JsonRecord = Record<string, unknown>;

type CatalogSelection = Readonly<{
  vendor: Vendor;
  model: Model;
  mapping: Mapping;
  /** 计费族（image / video / audio / model3d）。**不再是「两条 APIMart 路径二选一」。** */
  endpoint: BillingModelKind;
  fingerprint: string;
}>;

type PreparedRequest = Readonly<{
  modelKey: string;
  mappingId: string;
  taskKind: ProfileKind;
  endpoint: BillingModelKind;
  fingerprint: string;
}>;

/** Explicit semantic aliases; unknown modes cannot fall through to a paid endpoint. */
const MODE_TO_TASK_KIND: Record<string, ProfileKind> = {
  text_to_image: "text_to_image",
  "text-to-image": "text_to_image",
  image_to_image: "image_edit",
  "image-to-image": "image_edit",
  image_edit: "image_edit",
  "image-edit": "image_edit",
  text_to_video: "text_to_video",
  "text-to-video": "text_to_video",
  image_to_video: "image_to_video",
  "image-to-video": "image_to_video",
  reference_to_video: "image_to_video",
  "reference-to-video": "image_to_video",
  first_last: "image_to_video",
  firstlast: "image_to_video",
  video_edit: "image_to_video",
  "video-edit": "image_to_video",
  text_to_audio: "text_to_audio",
  "text-to-audio": "text_to_audio",
  text_to_3d: "text_to_3d",
  "text-to-3d": "text_to_3d",
  image_to_3d: "image_to_3d",
  "image-to-3d": "image_to_3d",
};

function record(value: unknown, vendorKey: string, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogGenerationProviderError(`${vendorKey} ${label} response is invalid`);
  return value as JsonRecord;
}

function strictBaseUrl(value: unknown, vendorKey: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CatalogGenerationProviderError(`${vendorKey} catalog vendor base URL is missing`);
  const candidate = value.trim().replace(/\/+$/, "");
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("invalid URL");
    return candidate;
  } catch {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog vendor base URL is invalid`);
  }
}

function normalizedMode(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return MODE_TO_TASK_KIND[raw] || "";
}

function taskKindForMode(value: unknown, vendorKey: string): ProfileKind {
  const mode = normalizedMode(value);
  if (!mode) throw new CatalogGenerationProviderError(`${vendorKey} generation mode is unsupported: ${String(value)}`);
  return mode as ProfileKind;
}

function readCatalogSnapshot(reader: () => CatalogState, vendorKey: string): CatalogState {
  let state: CatalogState;
  try {
    state = reader();
  } catch {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog is unavailable`);
  }
  if (!state || !Array.isArray(state.vendors) || !Array.isArray(state.models) || !Array.isArray(state.mappings)) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog is invalid`);
  }
  return state;
}

/**
 * 内置 direct-key 家（APIMart 等）的连接身份是**代码拥有**的策展合同：它的 auth / 端点 /
 * 生命周期由仓库里的种子说了算。这条连接如果归认证适配器管（判据唯一的主人：
 * `catalog/certificationOwnership`），就必须由认证适配器伺候——这个执行器不能悄悄接管它。
 *
 * 非 direct-key 的家（用户自己接的中转、自建网关、ComfyUI…）没有这份策展合同，
 * 它们的 auth / 端点全部来自用户保存的那条连接与 mapping 声明，由
 * `buildProfileHttpRequest` 统一渲染——与画布手动路逐字节同源。
 */
function assertDirectKeyContract(state: CatalogState, vendor: Vendor): void {
  if (!isBuiltinDirectKeyVendor(vendor.key)) return;
  if (isCertificationOwnedConnection(state, vendor.key)) {
    throw new CatalogGenerationProviderError(`${vendor.key} certification-owned connection requires its certified transport`);
  }
  if (!builtinVendorScopeMatches(vendor) || !hasBuiltinCuratedExecution(state, vendor.key)) {
    throw new CatalogGenerationProviderError(`${vendor.key} catalog direct-key contract is unavailable; restore the built-in Settings connection`);
  }
}

/**
 * 这条 mapping 的 create op 能不能发。**判据不再是「路径必须是那两条 APIMart 串之一」**
 * （那条判据对任何别家都必假），而是：它声明了一个非空路径、而且这条路径解析出来的
 * origin 仍然落在用户保存的那个 base 上——防的是「合同被改成把钱发去另一个域名」。
 */
function assertCreateOperation(mapping: Mapping, taskKind: ProfileKind, vendorKey: string): BillingModelKind {
  const path = typeof mapping.create.path === "string" ? mapping.create.path.trim() : "";
  if (!path) throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${mapping.id} has no create path`);
  if (mapping.taskKind !== taskKind) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${mapping.id} does not match ${taskKind}`);
  }
  // 七项引擎差异之二/之七（sweep2 §二 表 1）：multipart 上传与 process（antigravity CLI）这两种
  // 传输只有引擎 A 有执行器（`runMultipartProfileOperation` / `executeProcessOperation`）。
  // 铺开到所有供应商的那一刻，声明了它们的 mapping 会被这里当成普通 JSON POST 发出去——
  // **付了钱、发了一个上游读不懂的形状**。所以在选型这一步就 fail closed，而不是发出去再说。
  if (mapping.create.multipart) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${mapping.id} needs a multipart transport this executor cannot send`);
  }
  if (mapping.create.process) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${mapping.id} needs a local process transport this executor cannot run`);
  }
  return billingKindForTaskKind(taskKind);
}

function selectCatalogSelection(
  reader: () => CatalogState,
  vendorKey: string,
  extraHeadersOf: (vendor: Vendor) => Record<string, string> | undefined,
  modelKey: string,
  taskKind: ProfileKind,
): CatalogSelection {
  const state = readCatalogSnapshot(reader, vendorKey);
  const vendor = state.vendors.find((candidate) => candidate.key === vendorKey && candidate.enabled);
  if (!vendor) throw new CatalogGenerationProviderError(`${vendorKey} catalog vendor is unavailable`);
  const model = state.models.find((candidate) => candidate.vendorKey === vendorKey
    && candidate.modelKey === modelKey
    && candidate.enabled
    && candidate.kind === billingKindForTaskKind(taskKind));
  if (!model) throw new CatalogGenerationProviderError(`${vendorKey} catalog model is unavailable: ${modelKey}`);
  const publication = derivePublishedExecution(model, { mappings: state.mappings });
  if (!publication.publishedModes.includes(taskKind)) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping is unavailable: ${modelKey}/${taskKind}`);
  }
  const mapping = selectTaskMapping(state.mappings, vendorKey, taskKind, model.modelKey);
  if (!mapping) throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping is unavailable: ${modelKey}/${taskKind}`);
  const endpoint = assertCreateOperation(mapping, taskKind, vendorKey);
  strictBaseUrl(vendor.baseUrlHint, vendorKey);
  // Keep this check after ordinary catalog diagnostics so a missing mapping or
  // malformed endpoint reports its actionable cause rather than a generic
  // ownership error.
  assertDirectKeyContract(state, vendor);
  return { vendor, model, mapping, endpoint, fingerprint: catalogFingerprint({ vendor, model, mapping }, extraHeadersOf(vendor), vendorKey) };
}

/** 渲染用的 TaskRequest —— 与引擎 A 交给 `buildProfileHttpRequest` 的那一份同形。 */
function transportTaskRequest(selection: CatalogSelection, prompt: string, extras: Record<string, unknown>): TaskRequest {
  return { kind: selection.mapping.taskKind, prompt, extras } as TaskRequest;
}

function projectionRequest(
  input: GenerationProviderRequestInputV1,
  selection: CatalogSelection,
  vendorKey: string,
): { body: JsonRecord; request: TaskRequest } {
  if (!input.prompt || !input.prompt.trim()) throw new CatalogGenerationProviderError(`${vendorKey} prompt is required`);
  // 参考图落哪条通道由**用户选的档案模式**回答（与渲染层合并槽同一个 owner），不由 body 猜。
  const combineChannel = referenceCombineChannelFor({
    meta: selection.model.meta,
    kind: selection.model.kind,
    ...(input.modeId ? { modeId: input.modeId } : {}),
    createBody: selection.mapping.create.body,
  });
  const projected = projectReferenceUrls(input, selection.mapping, combineChannel);
  const parameters = normalizeParameters(projected.parameters, selection.mapping);
  mirrorApimartReferenceParameterAliases(parameters, selection.mapping.create.body, sameJson);
  const archetypeId = selection.model.meta && typeof selection.model.meta === "object" && !Array.isArray(selection.model.meta)
    ? (selection.model.meta as Record<string, unknown>).archetypeId
    : undefined;
  let defaulted: Record<string, unknown>;
  try {
    defaulted = applyHeadlessParamDefaults(parameters, typeof archetypeId === "string" ? archetypeId : undefined,
      selection.mapping.taskKind, vendorKey, selection.mapping.create.defaultParams,
      selection.mapping.create.body, selection.model.modelKey) || {};
  } catch {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping defaults are invalid: ${selection.mapping.id}`);
  }
  const bodyParameterKeys = bodyReferencedParamKeys(selection.mapping.create.body);
  if (bodyParameterKeys.includes("model")) {
    const transportModel = input.transportModelId?.trim();
    if (transportModel) defaulted.model = transportModel;
    else if (typeof defaulted.model !== "string" || !defaulted.model.trim()) defaulted.model = input.modelId;
  }
  const request = transportTaskRequest(selection, input.prompt, defaulted);
  // 七项引擎差异之三：自定义调用脚本的模型由 `runCustomCallTask` 执行，不是 HTTP mapping。
  if (resolveCustomCallExecution(selection.model, request, selection.mapping)?.script) {
    throw new CatalogGenerationProviderError(`${vendorKey} model ${selection.model.modelKey} runs through a custom call script this executor cannot execute`);
  }
  // 七项引擎差异之四：图生图/图生视频**一张参考都没带**时，引擎 A 在付费前就拒发
  // （`runtime.ts` 的 imageEditGuardError）；引擎 B 此前照发不误 —— 用户意图「拿图改」，
  // 结果静默退化成纯文生，钱照扣、拿回来的东西跟参考图毫无关系。同一把尺子收在这里。
  // 引擎 B 的参考素材住在合同里（`input.references` + 授权时封存的 URL 表），而这把共享的尺子
  // 读的是「headless extras 里带了哪些参考」——所以把封存的那几条 URL 按它认得的标准键喂进去，
  // 而不是在这里另写一份判据（那就成了同一个问题的第二个答案）。
  const approvedReferenceUrls = [...new Set([
    ...input.references
      .map((reference) => input.referenceUrls?.[spendReferenceKey(reference)])
      .filter((url): url is string => typeof url === "string" && Boolean(url.trim())),
    // 合同里显式写死的 canonical 参数（付款卡直接给 `image_urls` 的那条路）同样算数。
    ...resolvedReferenceUrls(defaulted),
  ])];
  const guardError = imageEditGuardError(
    selection.mapping.taskKind,
    { extras: { ...defaulted, ...(approvedReferenceUrls.length ? { referenceImages: approvedReferenceUrls } : {}) } },
    true,
    selection.model.labelZh || selection.model.modelKey,
    selection.mapping.create.body,
  );
  if (guardError) throw new CatalogGenerationProviderError(guardError);
  let built: ReturnType<typeof buildProfileHttpRequest>;
  try {
    built = buildProfileHttpRequest({
      vendor: selection.vendor,
      model: selection.model,
      // The profile renderer needs a value for auth placeholders. This value
      // is never sent: submit resolves the real key only at the network edge.
      apiKey: "__nomi_catalog_projection__",
      request,
      operation: selection.mapping.create,
    });
  } catch {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping cannot render: ${selection.mapping.id}`);
  }
  const body = record(built.body, vendorKey, "catalog request");
  assertNoProjectionCredential(body, vendorKey);
  const transformed = applyCatalogRequestTransform(body, selection, vendorKey, request);
  assertNoProjectionCredential(transformed, vendorKey);
  assertReferenceParameters(transformed);
  assertReferencesReachBody(input, defaulted, transformed);
  return { body: transformed, request };
}

function transformRequestContext(input: GenerationProviderRequestInputV1, vendorKey: string): TaskRequest {
  return {
    kind: taskKindForMode(input.mode, vendorKey),
    prompt: input.prompt,
    extras: structuredClone(input.parameters),
  } as TaskRequest;
}

function assertNoProjectionCredential(body: JsonRecord, vendorKey: string): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog request is not serializable`);
  }
  if (serialized?.includes("__nomi_catalog_projection__")) {
    throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping attempted to place credentials in the request body`);
  }
}

/**
 * Run the catalog's declared request transform at both approval and network
 * boundaries.  `buildRequest` is intentionally synchronous, so the shared
 * registry's sync bridge rejects an async transform instead of accidentally
 * approving a Promise or bypassing a model-specific guard.
 */
function applyCatalogRequestTransform(
  body: JsonRecord,
  selection: CatalogSelection,
  vendorKey: string,
  request?: TaskRequest,
  options: { requireStable?: boolean } = {},
): JsonRecord {
  const name = selection.mapping.create.request_transform;
  if (!name) return body;
  const context = {
    baseUrl: strictBaseUrl(selection.vendor.baseUrlHint, vendorKey),
    request,
  };
  try {
    validateRequestTransformSync(name, body, context);
    const transformed = record(applyRequestTransformSync(name, body, context), vendorKey, "transformed catalog request");
    if (options.requireStable && !sameJson(body, transformed)) {
      throw new CatalogGenerationProviderError(`${vendorKey} request transform changed the approved payload; rebuild the request`);
    }
    return transformed;
  } catch (error) {
    if (error instanceof CatalogGenerationProviderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new CatalogGenerationProviderError(`${vendorKey} request transform ${name} rejected: ${message}`);
  }
}

function preparedForSelection(selection: CatalogSelection): PreparedRequest {
  return {
    modelKey: selection.model.modelKey,
    mappingId: selection.mapping.id,
    taskKind: selection.mapping.taskKind,
    endpoint: selection.endpoint,
    fingerprint: selection.fingerprint,
  };
}

function findPrepared(
  entries: readonly PreparedRequest[] | undefined,
  selection: CatalogSelection,
): PreparedRequest | undefined {
  return entries?.find((entry) => entry.modelKey === selection.model.modelKey
    && entry.mappingId === selection.mapping.id
    && entry.taskKind === selection.mapping.taskKind
    && entry.endpoint === selection.endpoint
    && entry.fingerprint === selection.fingerprint);
}

/** 这家的 mapping 里有没有可用的轮询 op —— 恢复能力**由声明决定**，不按 vendor 写死。 */
function vendorHasQueryOperation(state: CatalogState, vendorKey: string): boolean {
  return state.mappings.some((mapping) => mapping.vendorKey === vendorKey && mapping.enabled !== false && Boolean(mapping.query));
}

export function createCatalogGenerationProvider(options: CatalogGenerationProviderOptions): GenerationProvider {
  const vendorKey = options.vendorKey.trim();
  if (!vendorKey) throw new CatalogGenerationProviderError("a generation provider needs a vendor key");
  const fetchImpl = options.fetchImpl ?? appFetch;
  const catalogReader = options.catalogReader ?? readCatalog;
  const fixtureBaseUrl = productionFixtureBaseOrigin(options.fixtureBaseUrlOverride, process.env, false);
  // 出站真正用的那条 base：夹具回环优先，否则用户保存的那条。**渲染与发送共用它**，
  // 于是 path / origin / 鉴权头全部来自同一次 `buildProfileHttpRequest`，与引擎 A 同源。
  const networkVendor = (vendor: Vendor): Vendor =>
    fixtureBaseUrl
      ? {
          ...vendor,
          baseUrlHint: fixtureBaseUrl,
          // The production fixture deliberately routes the saved synthetic key
          // to its loopback server. Keep the credential-origin invariant intact
          // by moving only the fixture copy of the binding; real catalog data is
          // never rewritten and normal users cannot enable this seam.
          ...(vendor.credentialBinding ? { credentialBinding: { ...vendor.credentialBinding, origin: fixtureBaseUrl } } : {}),
        }
      : vendor;
  // A payload hash alone cannot identify a mode; keep catalog identity alongside every prepared
  // hash and require it again at submit. This also makes a restart fail closed
  // instead of guessing an endpoint from model names or body fields.
  const preparedByPayloadHash = new Map<string, PreparedRequest[]>();
  const projectionCache = new Map<string, { inputHash: string; body: JsonRecord; prepared: PreparedRequest; request: TaskRequest }>();
  const requestByPreparedKey = new Map<string, TaskRequest>();
  /** providerTaskId → 它是用哪个模型 / 哪一档模式提交的。轮询要靠它找回那条 mapping 的 query op。 */
  const selectionByTaskId = new Map<string, { modelKey: string; taskKind: ProfileKind }>();
  const preparedKey = (prepared: PreparedRequest): string => `${prepared.modelKey}|${prepared.mappingId}|${prepared.taskKind}|${prepared.fingerprint}`;

  const select = (modelKey: string, taskKind: ProfileKind): CatalogSelection =>
    selectCatalogSelection(catalogReader, vendorKey, extractVendorExtraHeaders, modelKey, taskKind);

  /**
   * 发一次请求。**method / url / headers / query 全部来自 `buildProfileHttpRequest`**
   * ——与引擎 A（`runtime.executeProfileOperation`）同一个渲染器，于是鉴权方案词
   * （Higgsfield 的 `Key`）、自定义网关头、query 式鉴权、host-root 端点统统自动正确。
   * 此前这里是写死的 `Authorization: Bearer` + `base + createPath`，那正是
   * 「同一把 key 画布上能跑、Agent 上 401」的形状。
   */
  /**
   * 解一次密钥。**整个出站只解这一次**：渲染（url/headers/query）与发送用的是同一把，
   * 否则 keychain 会被同一次提交问两遍，测试里那条「第一次真网络请求之前不解密」的断言
   * 也就名存实亡了。
   */
  const requireApiKey = (): string => {
    let connection: { apiKey: string; baseUrl?: string } | null = null;
    try {
      connection = options.resolveConnection();
    } catch {
      // Credential resolution is deliberately deferred to a real network action.
      // Keep OS/keychain details private while preserving a structured provider error.
    }
    const apiKey = typeof connection?.apiKey === "string" ? connection.apiKey.trim() : "";
    if (!apiKey) throw new CatalogGenerationProviderError(`${vendorKey} connection is disabled, missing, or locked`);
    return apiKey;
  };

  const send = async (
    vendor: Vendor,
    apiKey: string,
    built: { method: string; url: string; headers: Record<string, string>; query: Record<string, unknown> },
    body: unknown,
    context: string,
  ): Promise<JsonRecord> => {
    const method = built.method.toUpperCase();
    try {
      const payload = await requestJson(
        networkVendor(vendor),
        apiKey,
        method,
        built.url,
        built.headers,
        built.query,
        body,
        undefined,
        { fetchImpl, logicalSuccessCodes: [0, 200] },
      );
      return record(payload, vendorKey, "");
    } catch (error: unknown) {
      if (error instanceof VendorRequestError) {
        throw new CatalogGenerationProviderError(`${vendorKey} ${context} failed: ${error.message}`, {
          cause: error,
          ...(error.providerAnswer ? { providerAnswer: error.providerAnswer } : {}),
        });
      }
      throw error;
    }
  };

  /** 渲染一条 op（create / query）——与引擎 A 同一个渲染器，真 key 只在这一层出现。 */
  const renderOperation = (
    selection: { vendor: Vendor; model: Model; mapping: Pick<Mapping, "id"> },
    operation: HttpOperation,
    request: TaskRequest,
    providerMeta: JsonRecord,
    apiKey: string,
  ) => {
    const vendor = networkVendor(selection.vendor);
    strictBaseUrl(vendor.baseUrlHint, vendorKey);
    const built = buildProfileHttpRequest({ vendor, model: selection.model, apiKey, request, operation, providerMeta });
    // 合同被改成把钱发去别的域名时当场拒：渲染出来的 origin 必须还在用户保存的那个 base 上。
    if (new URL(built.url).origin !== new URL(strictBaseUrl(vendor.baseUrlHint, vendorKey)).origin) {
      throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${selection.mapping.id} renders an off-origin URL`);
    }
    return built;
  };

  /**
   * 「这条任务该用哪条 query op 去问」。
   *
   * 合法答案只有三个，**没有第四个**：① 调用方明说（Run 的账本里就记着 job.model /
   * job.taskKind）；② 本进程提交时记下的那一条；③ 这家**每一条** mapping 的轮询 op 都一样、
   * 而且那条 op 不引用模型/请求相关的模板令牌——这时「用哪条」根本不构成一个选择
   * （内置 APIMart 的 `/v1/tasks/{{providerMeta.task_id}}` 正是这种）。
   * 三个都答不出就报错：随便挑一条是猜，猜错就是拿一个不存在的路径去轮询一笔已经花掉的钱。
   */
  const queryTargetFor = (
    taskId: string,
    context?: { modelId?: string; mode?: string },
  ): { vendor: Vendor; model: Model; mapping: Mapping; operation: HttpOperation } => {
    const remembered = selectionByTaskId.get(taskId);
    const modelKey = context?.modelId?.trim() || remembered?.modelKey || "";
    const taskKind = context?.mode ? taskKindForMode(context.mode, vendorKey) : remembered?.taskKind;
    if (modelKey && taskKind) {
      const selection = select(modelKey, taskKind);
      const operation = selection.mapping.query;
      if (!operation) throw new CatalogGenerationProviderError(`${vendorKey} catalog mapping ${selection.mapping.id} declares no task query`);
      return { vendor: selection.vendor, model: selection.model, mapping: selection.mapping, operation };
    }
    const state = readCatalogSnapshot(catalogReader, vendorKey);
    const candidates = state.mappings.filter((mapping) => mapping.vendorKey === vendorKey
      && mapping.enabled !== false && Boolean(mapping.query));
    const first = candidates[0];
    const distinct = new Set(candidates.map((mapping) => JSON.stringify({ q: mapping.query, s: mapping.statusMapping ?? null })));
    const modelBound = first ? /\{\{\s*(model|request)\./.test(JSON.stringify(first.query)) : true;
    const vendor = state.vendors.find((candidate) => candidate.key === vendorKey && candidate.enabled);
    const model = first
      ? state.models.find((candidate) => candidate.vendorKey === vendorKey && candidate.enabled
        && (!first.modelKey || candidate.modelKey === first.modelKey))
      : undefined;
    if (!first || distinct.size !== 1 || modelBound || !vendor || !model) {
      throw new CatalogGenerationProviderError(`${vendorKey} cannot poll task ${taskId} without the model it was submitted with`);
    }
    assertDirectKeyContract(state, vendor);
    return { vendor, model, mapping: first, operation: first.query! };
  };

  const queryTask = async (providerTaskId: string, context?: { modelId?: string; mode?: string }) => {
    const taskId = providerTaskId.trim();
    if (!taskId) throw new CatalogGenerationProviderError(`${vendorKey} task id is missing`);
    const target = queryTargetFor(taskId, context);
    const queryOperation = target.operation;
    const providerMeta: JsonRecord = { task_id: taskId, query_id: taskId, id: taskId };
    const request = { kind: target.mapping.taskKind, prompt: "", extras: { ...providerMeta } } as TaskRequest;
    const apiKey = requireApiKey();
    const built = renderOperation(target, queryOperation, request, providerMeta, apiKey);
    const payload = await send(target.vendor, apiKey, built, undefined, "task query");
    const responseMapping = isJsonRecord(queryOperation.response_mapping) ? queryOperation.response_mapping : null;
    // 状态词表是共享的（`tasks/responseParsing.resolveTaskStatus`），与引擎 A 同一份：
    // 上游原样的状态串优先（Run 的账本记的是真话），认不出来时才落到归一后的判词。
    const rawStatus = firstString(
      firstMappedString(payload, responseMapping, "status"),
      isJsonRecord(payload.data) ? (payload.data as JsonRecord).status : "",
      payload.status,
    );
    const resolved = resolveTaskStatus(payload, responseMapping, target.mapping.statusMapping, []);
    return { status: rawStatus || resolved.status, raw: payload };
  };

  const submitForSelection = async (
    providerRequest: unknown,
    selection: CatalogSelection,
    prepared: PreparedRequest,
    requestInput?: GenerationProviderRequestInputV1,
  ) => {
    const preparedBody = record(providerRequest, vendorKey, "submit");
    // Re-run the same pure transform immediately before the network request as
    // defense-in-depth.  H3 normalization is idempotent; any deterministic
    // transform that cannot run synchronously is rejected by the shared bridge.
    const body = applyCatalogRequestTransform(
      preparedBody,
      selection,
      vendorKey,
      requestInput ? transformRequestContext(requestInput, vendorKey) : undefined,
      { requireStable: true },
    );
    assertNoProjectionCredential(body, vendorKey);
    assertReferenceParameters(body);
    const rendered = requestByPreparedKey.get(preparedKey(prepared));
    if (!rendered) throw new CatalogGenerationProviderError(`${vendorKey} sealed catalog identity is missing; rebuild the request before submission`);
    const apiKey = requireApiKey();
    const built = renderOperation(selection, selection.mapping.create, rendered, {}, apiKey);
    // **发的是封存过的那份 body**（用户批准的就是它），传输层（method/url/headers/query）
    // 才是这一刻按真 key 现渲染的。两者分开，正是「批准的是 A、发出去的是 B」的反面。
    const payload = await send(selection.vendor, apiKey, built, body, `${selection.endpoint} submission`);
    const createMapping = isJsonRecord(selection.mapping.create.response_mapping) ? selection.mapping.create.response_mapping : null;
    const metaMapping = isJsonRecord(selection.mapping.create.provider_meta_mapping) ? selection.mapping.create.provider_meta_mapping : null;
    // 任务编号从**声明**里取（与引擎 A 的 `buildProfileTaskResult` 同一条链），
    // 不再写死 `data[0].task_id` —— 那是 APIMart 的信封形状，别家一律取不到。
    const meta = providerMetaFromResponse(payload, metaMapping);
    const taskId = firstString(
      firstMappedString(payload, createMapping, "task_id"),
      meta.task_id,
      meta.query_id,
      extractTaskIdShared(payload),
    );
    if (!taskId.trim()) {
      const failure = taskFailureMessageFromResponse(payload, createMapping);
      throw new CatalogGenerationProviderError(
        `${vendorKey} submission did not return a task id${failure ? `: ${failure}` : ""}`,
      );
    }
    selectionByTaskId.set(taskId.trim(), { modelKey: prepared.modelKey, taskKind: prepared.taskKind });
    while (selectionByTaskId.size > 512) {
      const oldest = selectionByTaskId.keys().next().value;
      if (typeof oldest !== "string") break;
      selectionByTaskId.delete(oldest);
    }
    return { providerTaskId: taskId.trim(), raw: payload };
  };

  const rememberPrepared = (body: JsonRecord, prepared: PreparedRequest, request: TaskRequest): void => {
    const hash = productionGenerationPayloadHash(body);
    const entries = preparedByPayloadHash.get(hash) ?? [];
    if (!entries.some((entry) => sameJson(entry, prepared))) entries.push(prepared);
    preparedByPayloadHash.set(hash, entries);
    requestByPreparedKey.set(preparedKey(prepared), request);
    // Keep the in-memory seal bounded; durable ProductionRun callers must
    // rebuild with a fresh catalog identity after a process restart.
    while (preparedByPayloadHash.size > 256) {
      const oldest = preparedByPayloadHash.keys().next().value;
      if (typeof oldest !== "string") break;
      preparedByPayloadHash.delete(oldest);
    }
    while (requestByPreparedKey.size > 256) {
      const oldest = requestByPreparedKey.keys().next().value;
      if (typeof oldest !== "string") break;
      requestByPreparedKey.delete(oldest);
    }
  };

  const inputCacheKey = (input: GenerationProviderRequestInputV1): { key: string; hash: string } => {
    let hash: string;
    try {
      hash = productionGenerationPayloadHash(input);
    } catch {
      throw new CatalogGenerationProviderError(`${vendorKey} generation input is not serializable`);
    }
    return { key: `${input.contractHash}:${input.idempotencyKey}:${hash}`, hash };
  };

  const capabilities = (() => {
    // 恢复能力由**声明**决定：这家的 mapping 声明了轮询 op 才报 query/reconcile。
    // 目录读不出来（盘上坏了 / 还没种子）时报「没有」——诚实的下限，绝不谎称能轮询。
    let hasQuery: boolean;
    try {
      hasQuery = vendorHasQueryOperation(options.initialState ?? readCatalogSnapshot(catalogReader, vendorKey), vendorKey);
    } catch {
      hasQuery = false;
    }
    return { submitIdempotency: false, query: hasQuery, reconcile: hasQuery, cancel: false, materialize: true };
  })();

  const provider: GenerationProvider & {
    submitWithContext: (
      providerRequest: unknown,
      idempotencyKey: string,
      input: GenerationProviderRequestInputV1,
    ) => Promise<{ providerTaskId: string; raw?: unknown }>;
  } = {
    providerId: vendorKey,
    capabilities,
    // 出站只有 `send` 一处，走的是 fetchImpl；只有它就是 appFetch 时才声明（注入了别的 fetch 的测试装配不声明）。
    ...(fetchImpl === appFetch ? { networkTransport: "app-fetch" as const } : {}),
    buildRequest(input) {
      if (input.providerId !== vendorKey) throw new CatalogGenerationProviderError(`${vendorKey} provider identity does not match the request`);
      const taskKind = taskKindForMode(input.mode, vendorKey);
      const selection = select(input.modelId, taskKind);
      const { key, hash } = inputCacheKey(input);
      const cached = projectionCache.get(key);
      if (cached && cached.inputHash === hash && cached.prepared.fingerprint === selection.fingerprint) {
        rememberPrepared(cached.body, cached.prepared, cached.request);
        return structuredClone(cached.body);
      }
      const { body, request } = projectionRequest(input, selection, vendorKey);
      const prepared = preparedForSelection(selection);
      projectionCache.set(key, { inputHash: hash, body: structuredClone(body), prepared, request });
      while (projectionCache.size > 128) {
        const oldest = projectionCache.keys().next().value;
        if (typeof oldest !== "string") break;
        projectionCache.delete(oldest);
      }
      rememberPrepared(body, prepared, request);
      return body;
    },
    async submit(providerRequest) {
      const body = record(providerRequest, vendorKey, "submit");
      const entries = preparedByPayloadHash.get(productionGenerationPayloadHash(body));
      if (!entries || entries.length !== 1) {
        throw new CatalogGenerationProviderError(`${vendorKey} sealed catalog identity is missing; rebuild the request before submission`);
      }
      const prepared = entries[0];
      const selection = select(prepared.modelKey, prepared.taskKind);
      if (!findPrepared(entries, selection)) {
        throw new CatalogGenerationProviderError(`${vendorKey} catalog changed after authorization; rebuild the request`);
      }
      return submitForSelection(body, selection, prepared);
    },
    async submitWithContext(providerRequest, _idempotencyKey, input) {
      const body = record(providerRequest, vendorKey, "submit");
      const entries = preparedByPayloadHash.get(productionGenerationPayloadHash(body));
      if (!entries || entries.length === 0) {
        throw new CatalogGenerationProviderError(`${vendorKey} sealed catalog identity is missing; rebuild the request before submission`);
      }
      if (input.providerId !== vendorKey) throw new CatalogGenerationProviderError(`${vendorKey} provider identity does not match the request`);
      const taskKind = taskKindForMode(input.mode, vendorKey);
      const selection = select(input.modelId, taskKind);
      const prepared = findPrepared(entries, selection);
      if (!prepared) {
        throw new CatalogGenerationProviderError(`${vendorKey} catalog changed or request identity does not match authorization`);
      }
      return submitForSelection(body, selection, prepared, input);
    },
    query: queryTask,
    async materialize(input) {
      return { outputs: extractMaterializationOutputs(input.raw), raw: input.raw };
    },
    async reconcile(input) {
      if (!input.providerTaskId?.trim()) return { disposition: "indeterminate" };
      const result = await queryTask(input.providerTaskId);
      // A successful HTTP response with an unrecognised/missing task status is
      // not proof that the paid operation exists. Keep it in manual
      // reconciliation (indeterminate): callers must not materialize outputs or
      // resubmit from an ambiguous provider receipt. A recognised status proves
      // the task exists → found.
      const status = result.status.trim().toLowerCase();
      const knownStatuses = new Set([
        "submitted", "queued", "pending", "processing", "running",
        "completed", "succeeded", "success", "failed", "error",
        "cancelled", "canceled", "rejected",
      ]);
      return knownStatuses.has(status)
        ? { disposition: "found", providerTaskId: input.providerTaskId, raw: result.raw }
        : { disposition: "indeterminate", providerTaskId: input.providerTaskId, raw: result.raw };
    },
  };
  return provider;
}
