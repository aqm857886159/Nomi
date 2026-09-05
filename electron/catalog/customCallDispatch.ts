// 自定义调用脚本的**任务派发**（从 runtime.runTask 抽出，R12 巨壳门岗净减）。
// 与 mapping 路径同语义：指纹缓存 → 付费守卫 → 参考素材本地化 → 跑脚本 → 结果落地 → 溯源。
// localizeTaskAsset 是 runtime 内部函数（定义在那），注入进来避免 ↔ runtime 循环依赖；
// 其余依赖全是独立模块，本文件直接 import。
import crypto from "node:crypto";
import { buildNormalizedRecipe, buildTaskProvenance } from "../vendor/provenance";
import { readCachedTaskResult, recipeFingerprint, rememberTaskResult } from "../vendor/fingerprintCache";
import { assertAndConsumeSpendGrant } from "../spendGrant";
import { traceVendorCompleted, traceVendorRequested } from "../events/vendorCallTrace";
import { assertLocalAssetTransportReady, localizeAssetsForVendor, resolveAssetIngestionWithFallback } from "./assetLocalization";
import { decryptApiKeyRecord } from "./secrets";
import { readNomiLocalAsset, postJsonForAssetUpload, postMultipartForAssetUpload, putBinaryForAssetUpload } from "../assets/localAssetFile";
import { unlocalizedTaskAsset } from "../tasks/activeProjectFallback";
import { taskTemplateParams } from "./taskParams";
import { CustomCallScriptError, runCustomCallScript } from "./customCallRunner";
import { readCatalog } from "./catalogStore";
import { readAutomationPolicySettings } from "../settings/automationPolicySettings";
import { assetLocalizationOptions } from "./assetTransportRuntime";
import { trim } from "../jsonUtils";
import type { BillingModelKind, Model, Vendor } from "./types";
import type { TaskRequest, TaskResult } from "../runtime";

export type CustomCallDispatchInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  customConfig: Record<string, string>;
  script: string;
  taskKind: TaskRequest["kind"];
  modeId?: string;
  request: TaskRequest;
  kind: TaskRequest["kind"];
  /** image / video / model3d / text —— 文本 2026-08-12 解禁（此前被 runtime 挡在门外）。 */
  wantedKind: BillingModelKind;
  projectId: string;
  nodeId: string;
  grantId: string;
  taskId: string;
  /** 把脚本产出的二进制写成项目资产（注入避免循环依赖，同 localizeTaskAsset）。 */
  writeAsset: (projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: Record<string, unknown>) => unknown;
  /** runtime 内部的资产落地（注入避免循环依赖）。 */
  localizeTaskAsset: (
    projectId: string,
    assetUrl: string,
    type: "image" | "video" | "audio" | "model3d",
    nodeId?: string,
    vendor?: Pick<Vendor, "key" | "baseUrlHint">,
  ) => Promise<TaskResult["assets"][number]>;
};

export async function runCustomCallTask(input: CustomCallDispatchInput): Promise<TaskResult> {
  const { vendor, model, apiKey, customConfig, script, taskKind, modeId, request, kind, wantedKind, projectId, nodeId, grantId, taskId } = input;
  // S8 指纹缓存同语义：脚本内容进 recipe（改脚本=新配方），mappingId 槽复用为脚本指纹。
  const scriptHash = crypto.createHash("sha1").update(script).digest("hex").slice(0, 16);
  const recipe = buildNormalizedRecipe({ vendor, model, mappingId: `custom-call:${scriptHash}`, request });
  const fingerprint = recipeFingerprint(recipe);
  const cachedHit = readCachedTaskResult({ projectId, fingerprint, nodeId, extras: request.extras });
  if (cachedHit) return cachedHit as TaskResult;
  // 参考素材本地 URL → vendor 可达（与 mapping 路径同一套 localize，脚本拿到的 references 即成品 URL）。
  const uploadCatalog = readCatalog();
  const automationSettings = readAutomationPolicySettings();
  const localizationOptions = assetLocalizationOptions(request.extras, automationSettings);
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
  assertAndConsumeSpendGrant(grantId, nodeId); // 付费守卫：本地资产/上传策略预检通过后才消费
  traceVendorRequested(projectId, { runId: taskId, nodeId, recipe });
  const localized = await localizeAssetsForVendor(
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
  let executed;
  try {
    executed = await runCustomCallScript({
      vendor,
      model,
      apiKey,
      customConfig,
      script,
      prompt: trim(effectiveRequest.prompt),
      params: taskTemplateParams(effectiveRequest, { vendorKey: vendor.key, modelKey: model.modelKey, wireModelKey: model.modelAlias || model.modelKey }),
      taskKind,
      modeId,
      timeoutMs: wantedKind === "video" ? 15 * 60 * 1000 : 5 * 60 * 1000,
      // 上游只给字节流时的落地口。写进本项目资产库，脚本拿回一个能用的本地 URL——
      // 比拼 data URL 靠谱（几十 MB 的视频拼成 base64 会把整条链路撑爆）。
      saveFile: async (bytes, ext, contentType) => {
        const written = input.writeAsset(projectId, bytes, `custom-call-${taskId}.${ext}`, contentType, {
          kind: wantedKind,
          source: "custom-call",
          modelKey: model.modelKey,
          vendorKey: vendor.key,
        }) as { data?: { url?: string }; url?: string } | undefined;
        const url = written?.data?.url || written?.url;
        if (!url) throw new Error("saveFile 落盘后没拿到 URL");
        return url;
      },
    });
  } catch (error) {
    traceVendorCompleted(projectId, { runId: taskId, nodeId, status: "failed", assetCount: 0 });
    // 解包结构化 vendor 错误（401→auth/402→balance 等分类靠它），脚本级错误原样抛。
    if (error instanceof CustomCallScriptError && error.causeError instanceof Error && error.causeError.name === "VendorRequestError") {
      throw error.causeError;
    }
    throw error;
  }
  // 文本：脚本 return { text }。**raw 合成成与 streamTextTask 完全相同的 OpenAI choices 形状**
  // （streamTextTask.ts:126），这样下游解析一行都不用改——文本产出只有一种形状，不是两种。
  if (executed.text !== undefined) {
    const textResult: TaskResult = {
      id: taskId,
      kind,
      status: "succeeded",
      assets: [],
      raw: { choices: [{ message: { role: "assistant", content: executed.text } }], customCall: true },
      provenance: buildTaskProvenance({ vendor, model, request, vendorRequestId: taskId }),
    };
    traceVendorCompleted(projectId, { runId: taskId, nodeId, status: "succeeded", assetCount: 0 });
    rememberTaskResult(projectId, fingerprint, textResult);
    return textResult;
  }

  const type: "image" | "video" | "audio" | "model3d" =
    wantedKind === "video"
      ? "video"
      : wantedKind === "audio"
        ? "audio"
        : wantedKind === "model3d"
          ? "model3d"
          : "image";
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
