// 生成 profile 请求的构造层（从 runtime 抽出，减负 giant shell + 让 JSON/multipart 两路共用同一份构造）。
// wizard 测试与生产同一份；params 经 taskTemplateParams 归一。TaskRequest 走 type-only 回引（编译期擦除，不成环）。

import { buildTemplateContext, buildHttpRequest, type AuthType, type JsonRecord } from "../ai/requestPipeline";
import { extractVendorExtraHeaders } from "./catalogStore";
import { taskTemplateParams } from "./taskParams";
import { applyParamMap } from "./paramTranslate";
import { connectionWireModel } from "../shared/modelArchetypes/wireModelIdentity";
import { isComfyuiVendor, type HttpOperation, type Model, type Vendor } from "./types";
import { normalizeComfyuiBaseUrl } from "../comfyui/endpointResolver";
import { trim } from "../jsonUtils";
import { validateRequestTransform } from "../tasks/requestTransforms";
import type { TaskRequest } from "../runtime";

/** 共享 requestPipeline context 构造。铁律翻译层：渲染 body 前按 op 的 paramMap 把档案中性参数译成该站 wire 字段。
 *  传整条 op（不只 paramMap）：`params.model` 由线上模型名 owner 按「这条 op 声明了什么」决定。 */
export function templateContext(
  request: TaskRequest,
  model: Model,
  apiKey: string,
  providerMeta: JsonRecord = {},
  operation?: Pick<HttpOperation, "paramMap" | "wireModel">,
): JsonRecord {
  return buildTemplateContext({
    request: request as unknown as JsonRecord,
    params: applyParamMap(operation?.paramMap, taskTemplateParams(request, {
      vendorKey: model.vendorKey,
      modelKey: model.modelKey,
      modelAlias: model.modelAlias,
      modelMeta: model.meta,
      operation,
    }), request.kind),
    model: model as unknown as JsonRecord,
    // `{{model.modelKey}}` 渲染成连接名（别名优先）——与 owner 的回落值同一个表达式。
    modelKey: connectionWireModel(model),
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
    authScheme: input.vendor.authScheme ?? undefined,
    authQueryParam: input.vendor.authQueryParam ?? undefined,
    apiKey: input.apiKey,
    context: templateContext(input.request, input.model, input.apiKey, input.providerMeta || {}, input.operation),
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
