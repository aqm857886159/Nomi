import { checkpointPaidResponse } from "../productionRun/paidSubmissionReceipt";
import { profileAcceptanceIdentity } from "../tasks/responseParsing";
import { extractTaskId } from "../ai/requestPipeline";
import { isJsonRecord } from "../jsonUtils";
import { expectedMediaKind, readTaskResponse, requestEchoUrls } from "../tasks/taskResultReading";
import { classifyUpstreamTaskStatus } from "../shared/taskStatus";
// 自定义调用脚本的**任务派发**（从 runtime.runTask 抽出，R12 巨壳门岗净减）。
// 与 mapping 路径同语义：指纹缓存 → 付费守卫 → 参考素材本地化 → 跑脚本 → 结果落地 → 溯源。
// localizeTaskAsset 是 runtime 内部函数（定义在那），注入进来避免 ↔ runtime 循环依赖；
// 其余依赖全是独立模块，本文件直接 import。
import crypto from "node:crypto";
import { buildNormalizedRecipe, buildTaskProvenance } from "../vendor/provenance";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "../vendor/fingerprintCache";
import type { consumeTaskSpend } from "../tasks/taskSpend";
import { traceVendorCompleted, traceVendorRequested } from "../events/vendorCallTrace";
import { assertLocalAssetTransportReady, resolveAssetIngestionWithFallback } from "./assetLocalization";
import { decryptApiKeyRecord } from "./secrets";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from "../assets/localAssetFile";
import { unlocalizedTaskAsset } from "../tasks/unlocalizedTaskAsset";
import { taskTemplateParams } from "./taskParams";
import { collectCustomCallAssets, CustomCallScriptError, joinCustomCallUrl, runCustomCallScript } from "./customCallRunner";
import { readCatalog } from "./catalogStore";
import { readAutomationPolicySettings } from "../settings/automationPolicySettings";
import { assetLocalizationOptions, localizeForSend } from "./assetTransportRuntime";
import { writeGeneratedAsset } from "../assets/projectAssetStore";
import { trim } from "../jsonUtils";
import type { BillingModelKind, HttpOperation, Mapping, Model, Vendor } from "./types";
import type { TaskRequest, TaskResult } from "../runtime";

export type CustomCallDispatchInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  customConfig: Record<string, string>;
  script: string;
  taskKind: TaskRequest["kind"];
  modeId?: string;
  /** 这个模型在该桶上的 mapping create op（有才给）：脚本拿到的 params.model 与 HTTP 那条路同一个 owner 决定。 */
  operation?: HttpOperation;
  mapping?: Mapping;
  request: TaskRequest;
  kind: TaskRequest["kind"];
  /** image / video / model3d / text —— 文本 2026-08-12 解禁（此前被 runtime 挡在门外）。 */
  wantedKind: BillingModelKind;
  projectId: string;
  nodeId: string;
  grantId: string;
  taskId: string;
  /** 发出去之前的付费闸（令牌路核销令牌；Run 路批准已在 Run 的门上）。由 runtime 注入，这里不自己选。 */
  spendGate: typeof consumeTaskSpend;
  /** runtime 内部的资产落地（注入避免循环依赖）。 */
  localizeTaskAsset: (
    projectId: string,
    assetUrl: string,
    type: "image" | "video" | "audio" | "model3d",
    nodeId?: string,
    vendor?: Pick<Vendor, "key" | "baseUrlHint">,
  ) => Promise<TaskResult["assets"][number]>;
};

export async function saveCustomCallMedia(input: Pick<CustomCallDispatchInput, "projectId" | "nodeId" | "model" | "vendor" | "taskId"> & { type: "image" | "video" | "audio" | "model3d" },
  bytes: Buffer, ext: string, contentType: string): Promise<string> {
  const { projectId, nodeId, model, vendor, taskId, type } = input;
  const written = await writeGeneratedAsset(projectId, bytes, `custom-call-${taskId}.${ext}`, contentType, {
    kind: "generated", source: "custom-call", ownerNodeId: nodeId || null, modelKey: model.modelKey, vendorKey: vendor.key,
  }, type) as { data?: { url?: string } } | undefined;
  if (!written?.data?.url) throw new Error("saveFile 落盘后没拿到 URL");
  return written.data.url;
}

export async function runCustomCallTask(input: CustomCallDispatchInput): Promise<TaskResult> {
  const { vendor, model, apiKey, customConfig, script, taskKind, modeId, request, kind, wantedKind, projectId, nodeId, grantId, taskId, spendGate } = input;
  // S8 指纹缓存同语义：脚本内容进 recipe（改脚本=新配方），mappingId 槽复用为脚本指纹。
  const scriptHash = crypto.createHash("sha1").update(script).digest("hex").slice(0, 16);
  const recipe = buildNormalizedRecipe({ vendor, model, mappingId: `custom-call:${scriptHash}`, request });
  const fingerprint = recipeFingerprint(recipe);
  const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
  if (cachedHit) return cachedHit as TaskResult;
  // 参考素材本地 URL → vendor 可达（与 mapping 路径同一套 localize，脚本拿到的 references 即成品 URL）。
  const uploadCatalog = readCatalog();
  const automationSettings = readAutomationPolicySettings();
  const localizationOptions = assetLocalizationOptions(vendor, request.extras, automationSettings);
  assertLocalAssetTransportReady(
    request.extras,
    (mediaKind) => resolveAssetIngestionWithFallback(
      vendor,
      uploadCatalog.vendors,
      (key) => decryptApiKeyRecord(uploadCatalog.apiKeysByVendor[key]),
      mediaKind,
    ),
    readNomiLocalAsset,
    localizationOptions,
  );
  await spendGate({ grantId, nodeId, projectId, vendorKey: vendor.key, modelKey: model.modelKey, parameters: request.extras }); // 付费守卫：本地资产/上传策略预检通过后才消费
  traceVendorRequested(projectId, { runId: taskId, nodeId, recipe });
  const localized = await localizeForSend(
    request.extras,
    (mediaKind) =>
      resolveAssetIngestionWithFallback(
        vendor,
        uploadCatalog.vendors,
        (key) => decryptApiKeyRecord(uploadCatalog.apiKeysByVendor[key]),
        mediaKind,
      ),
    readNomiLocalAsset,
    postJsonForAssetUpload,
    postMultipartForAssetUpload,
    localizationOptions,
    putBinaryForAssetUpload,
  );
  const effectiveRequest =
    localized.uploaded > 0 ? { ...request, extras: localized.value as TaskRequest["extras"] } : request;
  const type: "image" | "video" | "audio" | "model3d" =
    wantedKind === "video"
      ? "video"
      : wantedKind === "audio"
        ? "audio"
        : wantedKind === "model3d"
          ? "model3d"
          : "image";
  const params = taskTemplateParams(effectiveRequest, { vendorKey: vendor.key, modelKey: model.modelKey, modelAlias: model.modelAlias, modelMeta: model.meta, operation: input.operation });
  let executed;
  try {
    executed = await runCustomCallScript({
      vendor,
      model,
      apiKey,
      customConfig,
      script,
      onHttpResponse: (call, response) => {
        if (["GET", "HEAD"].includes(call.method.toUpperCase())) return;
        const create = input.operation;
        const declaredUrl = create && new URL(joinCustomCallUrl(vendor.baseUrlHint || "", create.path));
        const actualUrl = new URL(call.url);
        const declared = create && declaredUrl && create.method.toUpperCase() === call.method.toUpperCase() && actualUrl.origin === declaredUrl.origin && actualUrl.pathname === declaredUrl.pathname;
        const id = declared ? trim(profileAcceptanceIdentity(response, create, "").providerMeta.task_id) : "";
        // Undeclared scripts can return an explicit job handle. Generic "id" on an upload/auth response is ambiguous.
        const queuedHandle = isJsonRecord(response) && ["queued", "running"].includes(classifyUpstreamTaskStatus(response.status)) ? trim(response.request_id) || trim(response.id) : "";
        const explicitHandle = isJsonRecord(response) && ("task_id" in response || "jobId" in response || "taskId" in response) ? extractTaskId(response) : "";
        const handle = id || (!create ? explicitHandle || queuedHandle : "");
        const mediaType = call.contentType.split(";")[0]?.trim().toLowerCase();
        if (Buffer.isBuffer(response) && mediaType?.startsWith(type + "/")) {
          checkpointPaidResponse({ vendor, model, modeId: modeId || taskKind, source: "assets", taskId,
            remoteTaskId: null, rawAcceptance: [`data:${mediaType};base64,${response.toString("base64")}`] });
          return;
        }
        if (!handle) {
          if (create && !declared) return;
          const media = readTaskResponse({ response, responseMapping: create?.response_mapping ?? null, statusMapping: input.mapping?.statusMapping,
            wantedKind: expectedMediaKind(wantedKind), echoUrls: requestEchoUrls(params) }).assetUrls;
          if (!media.length && !(declared && collectCustomCallAssets(response).length)) return;
        }
        checkpointPaidResponse({ vendor, model, modeId: modeId || taskKind, mapping: input.mapping, remoteTaskId: handle || null, taskId: handle || taskId,
          source: "script", rawAcceptance: response, scriptCall: { requestHash: call.requestHash, script, params, taskKind, modeId } });
      },
      prompt: trim(effectiveRequest.prompt),
      params,
      taskKind,
      modeId,
      timeoutMs: wantedKind === "video" ? 15 * 60 * 1000 : 5 * 60 * 1000,
      // 上游只给字节流时的落地口：经生成产物关口（暂存 → 按任务种类解码校验 → 原子发布）写进本项目，脚本拿回
      // 一个能用的本地 URL——比拼 data URL 靠谱（几十 MB 的视频拼成 base64 会把整条链路撑爆）。期望类型只看任务种类，
      // 不信脚本给的后缀和 content-type。没项目的任务走不到这里：用到 saveFile 的脚本，runTask 在付费前就拒了（projectFileResult）。
      saveFile: (bytes, ext, contentType) => saveCustomCallMedia({ projectId, nodeId, model, vendor, taskId, type }, bytes, ext, contentType),
    });
  } catch (error) {
    traceVendorCompleted(projectId, { runId: taskId, nodeId, status: "failed", assetCount: 0 });
    // 解包结构化 vendor 错误（401→auth/402→balance 等分类靠它），脚本级错误原样抛。
    if (error instanceof CustomCallScriptError && error.causeError instanceof Error && error.causeError.name === "VendorRequestError") {
      throw error.causeError;
    }
    throw error;
  }
  // 转写的正文与音频执行器一致，同时保留脚本的 choices 回执。
  if (executed.text !== undefined) {
    const textResult: TaskResult = {
      id: taskId,
      kind,
      status: "succeeded",
      assets: [],
      raw: {
        ...(kind === "transcribe" && { text: executed.text }),
        choices: [{ message: { role: "assistant", content: executed.text } }],
        customCall: true,
      },
      provenance: buildTaskProvenance({ vendor, model, request, vendorRequestId: taskId }),
    };
    traceVendorCompleted(projectId, { runId: taskId, nodeId, status: "succeeded", assetCount: 0 });
    rememberTaskResult(projectId, fingerprint, textResult);
    return textResult;
  }

  checkpointPaidResponse({ vendor, model, modeId: modeId || taskKind, mapping: input.mapping, remoteTaskId: null, taskId,
    source: "assets", rawAcceptance: executed.assets });
  const assets = await Promise.all(
    executed.assets.map((url) =>
      projectId ? input.localizeTaskAsset(projectId, url, type, nodeId, vendor) : unlocalizedTaskAsset(type, url),
    ),
  );
  const finalResult: TaskResult = {
    id: taskId,
    kind,
    status: "succeeded",
    assets,
    raw: { customCall: true, assets: executed.assets },
    provenance: buildTaskProvenance({ vendor, model, request, vendorRequestId: taskId }),
  };
  traceVendorCompleted(projectId, { runId: taskId, nodeId, status: "succeeded", assetCount: assets.length });
  rememberTaskResult(projectId, fingerprint, finalResult);
  return finalResult;
}
