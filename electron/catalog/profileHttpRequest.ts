// 生成 profile 请求的构造层（从 runtime 抽出，减负 giant shell + 让 JSON/multipart 两路共用同一份构造）。
// wizard 测试与生产同一份；params 经 taskTemplateParams 归一。TaskRequest 走 type-only 回引（编译期擦除，不成环）。

import { buildTemplateContext, buildHttpRequest, type AuthType, type JsonRecord } from "../ai/requestPipeline";
import { extractVendorExtraHeaders } from "./catalogStore";
import { taskTemplateParams } from "./taskParams";
import { applyParamMap, type ParamMap } from "./paramTranslate";
import { isComfyuiVendor, type HttpOperation, type Model, type Vendor } from "./types";
import { normalizeComfyuiBaseUrl } from "../comfyui/endpointResolver";
import { trim } from "../jsonUtils";
import { validateRequestTransform } from "../tasks/requestTransforms";
import type { TaskRequest } from "../runtime";

/** 共享 requestPipeline context 构造。铁律翻译层：渲染 body 前按 codec 的 paramMap 把档案中性参数译成该站 wire 字段。 */
export function templateContext(
  request: TaskRequest,
  model: Model,
  apiKey: string,
  providerMeta: JsonRecord = {},
  paramMap?: ParamMap,
): JsonRecord {
  // 「发哪个 model 串」的单一表达式：`{{model.modelKey}}` 与 `{{request.params.model}}` 的回落值
  // 必须**逐字节同源**，否则把 body 换成参数化 model 就会悄悄改掉裸模型发出去的串（P1：不留第二份）。
  const wireModelKey = model.modelAlias || model.modelKey;
  return buildTemplateContext({
    request: request as unknown as JsonRecord,
    params: applyParamMap(paramMap, taskTemplateParams(request,
      { vendorKey: model.vendorKey, modelKey: model.modelKey, wireModelKey })),
    model: model as unknown as JsonRecord,
    modelKey: wireModelKey,
    apiKey,
    providerMeta,
  });
}

/** 从 (vendor, model, request, operation) 构造一次 profile HTTP 请求（method/url/headers/query/body + 脱敏 preview）。
 *  extraHeaders（relay/网关自定义鉴权头）透传进 profile 路径（与文本路径同源）。 */
export function buildProfileHttpRequest(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
  providerMeta?: JsonRecord;
}): {
  method: string;
  url: string;
  headers: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  preview: unknown;
} {
  const extraHeaders = extractVendorExtraHeaders(input.vendor);
  return buildHttpRequest({
    baseUrl: isComfyuiVendor(input.vendor)
      ? normalizeComfyuiBaseUrl(String(input.vendor.baseUrlHint || ""))
      : String(input.vendor.baseUrlHint || ""),
    authType: input.vendor.authType as AuthType,
    authHeaderName: input.vendor.authHeader ?? undefined,
    authQueryParam: input.vendor.authQueryParam ?? undefined,
    apiKey: input.apiKey,
    context: templateContext(input.request, input.model, input.apiKey, input.providerMeta || {}, input.operation.paramMap),
    operation: input.operation,
    ...(extraHeaders ? { extraHeaders } : {}),
  });
}

/** Validate the rendered request before local asset localization and spend. */
export async function validateProfileRequestBeforeSpend(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  operation: HttpOperation;
}): Promise<void> {
  const transform = input.operation.request_transform;
  if (!transform) return;
  const preflight = buildProfileHttpRequest(input);
  await validateRequestTransform(transform, preflight.body, {
    baseUrl: String(input.vendor.baseUrlHint || ""),
    promptId: trim(input.request.extras?.comfyPromptId),
    request: input.request,
  });
}
