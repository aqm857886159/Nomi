// 生成 profile 请求的构造层（从 runtime 抽出，减负 giant shell + 让 JSON/multipart 两路共用同一份构造）。
// wizard 测试与生产同一份；params 经 taskTemplateParams 归一。TaskRequest 走 type-only 回引（编译期擦除，不成环）。
//
// ── 装配主人：可发送的请求体只在这里产出 ─────────────────────────────────────────────
// `buildProfileHttpRequest` 渲染一次模板，同时给两样东西：`body` / `preview` 是普通的预览（向导、脱敏、门岗读它），
// `sealed` 是**封存的请求体**（`ProfileRequestBody`，数据在 `#payload` 里、实例冻结）。供应商变换只经
// `transformProfileBody(Sync)` 拿私有副本、产出重新封存；JSON 出网只有 `sendProfileJson` 一个口，它只认封存体，
// 裸 Record / 预览 / 展开克隆 / 断言 / 反序列化伪造一律带原因拒。本模块不导出把任意 Record 盖成封存体的函数。
// 谁能 import 发送 / 变换口、谁能直接用 vendorHttp 的原始出网：`eslint.config.mjs` 的 profile-send-owner /
// raw-vendor-send 名单（方向检查 `docs/engineering/direction-checks/2026-11-09-reference-assembly-boundary.md`）。

import { authHeaders, buildTemplateContext, buildHttpRequest, type AuthType, type JsonRecord } from "../ai/requestPipeline";
import { requestJson } from "../vendor/vendorHttp";
import { vendorAuthSpec } from "./vendorAuthSpec";
import { endpoint } from "../vendorEndpoint";
import { extractVendorExtraHeaders } from "./catalogStore";
import { taskTemplateParams } from "./taskParams";
import { applyParamMap } from "./paramTranslate";
import { connectionWireModel, noMappingWireModel } from "../shared/modelArchetypes/wireModelIdentity";
import { isComfyuiVendor, type HttpOperation, type Model, type Vendor } from "./types";
import { normalizeComfyuiBaseUrl } from "../comfyui/endpointResolver";
import { trim } from "../jsonUtils";
import {
  applyRequestTransform,
  applyRequestTransformSync,
  validateRequestTransform,
  validateRequestTransformSync,
  type RequestTransformContext,
} from "../tasks/requestTransforms";
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

/** 拿一个不是本模块封存的东西去发 / 去变换：带原因拒，不出网。 */
export class ProfileRequestProvenanceError extends Error {
  constructor(reason: string) {
    super(`a sendable request body must be sealed by profileHttpRequest: ${reason}`);
    this.name = "ProfileRequestProvenanceError";
  }
}

const SEAL: unique symbol = Symbol("profileHttpRequest.seal");

// 封存与取体只住在类的静态块里、赋给这两个模块私有变量：类上没有公开的 seal，模块也不导出它们。
let sealRendered: (payload: unknown) => ProfileRequestBody;
let payloadOf: (candidate: unknown) => unknown;

/** 封存的请求体：渲染（或受控变换）产出的那一份，私有、实例冻结；发送时取独立副本。 */
export class ProfileRequestBody {
  readonly #payload: unknown;

  private constructor(seal: typeof SEAL, payload: unknown) {
    if (seal !== SEAL) throw new ProfileRequestProvenanceError("the body can only be sealed while rendering the catalog operation");
    this.#payload = structuredClone(payload);
    Object.freeze(this);
  }

  static {
    sealRendered = (payload) => new ProfileRequestBody(SEAL, payload);
    payloadOf = (candidate) => {
      if (!candidate || typeof candidate !== "object" || !(#payload in candidate)) {
        throw new ProfileRequestProvenanceError("got a plain object, a preview, a clone or a deserialized copy instead of a sealed body");
      }
      if (Reflect.ownKeys(candidate).length > 0) throw new ProfileRequestProvenanceError("the sealed body carries fields the renderer did not write");
      return structuredClone(candidate.#payload);
    };
  }
}

/** 封存体的独立副本（Run 的批准哈希、门岗检查、回执用）；改它不影响封存体，也拿它发不出去。 */
export function profileBodySnapshot(body: ProfileRequestBody): unknown {
  return payloadOf(body);
}

export type ProfileTransport = Readonly<{ method: string; url: string; headers: Record<string, string>; query: Record<string, unknown> }>;

/** 受控变换阶段（异步，引擎 A）：变换拿私有副本，产出重新封存。未声明 / 未注册 → 原样（与 applyRequestTransform 同义）。 */
export async function transformProfileBody(
  name: string | undefined,
  body: ProfileRequestBody,
  context: RequestTransformContext,
): Promise<ProfileRequestBody> {
  const payload = payloadOf(body);
  if (!name) return body;
  return sealRendered(await applyRequestTransform(name, payload, context));
}

/** 受控变换阶段（同步，引擎 B 的批准 / 提交两头）：先跑校验再变换；异步变换照旧被共享注册表拒。 */
export function transformProfileBodySync(
  name: string | undefined,
  body: ProfileRequestBody,
  context: RequestTransformContext,
): ProfileRequestBody {
  const payload = payloadOf(body);
  if (!name) return body;
  validateRequestTransformSync(name, payload, context);
  return sealRendered(applyRequestTransformSync(name, payload, context));
}

type JsonSendOptions = NonNullable<Parameters<typeof requestJson>[8]>;

/**
 * **发送入口**：profile JSON 出网只经这里。`body` 必须是本模块封存的那一份（没有 body 的轮询传 `undefined`）；
 * 传输层（method / url / headers / query）由调用方按真 key 渲染。伪造的 body 在出网前带原因拒，错误照旧冒泡。
 */
export async function sendProfileJson(
  vendor: Vendor,
  apiKey: string,
  transport: ProfileTransport,
  body: ProfileRequestBody | undefined,
  signal?: AbortSignal,
  options?: JsonSendOptions,
): Promise<unknown> {
  const payload = body === undefined ? undefined : payloadOf(body);
  return requestJson(vendor, apiKey, transport.method, transport.url, transport.headers, transport.query, payload, signal, options);
}

/**
 * 没有 mapping 时的图片兜底提交（旧路，键形状由 taskParams.NO_MAPPING_FALLBACK_BODY 声明并被测试钉死，两处必须同构）。
 * 请求体在这里按固定形状组装、直接出网，不经调用方的手。
 */
export async function sendNoMappingImageFallback(input: { vendor: Vendor; model: Model; apiKey: string; request: TaskRequest }): Promise<unknown> {
  const { vendor, model, apiKey, request } = input;
  const fallbackExtraHeaders = extractVendorExtraHeaders(vendor);
  const fallbackHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(vendorAuthSpec(vendor), apiKey),
    ...(fallbackExtraHeaders || {}),
  };
  return requestJson(vendor, apiKey, "POST", endpoint(vendor, "/v1/images/generations"), fallbackHeaders, {},
    {
      model: noMappingWireModel(model, request), // 线上模型名只问 owner（wireModelIdentity）
      prompt: request.prompt,
      size: request.width && request.height ? `${request.width}x${request.height}` : undefined,
      seed: request.seed,
      n: 1,
      response_format: "url",
      extras: request.extras,
    },
  );
}

/** 从 (vendor, model, request, operation) 构造一次 profile HTTP 请求（method/url/headers/query/body + 脱敏 preview），
 *  并把渲染出的 body 封存成 `sealed`（发送只认它；`body` 只是预览，改它不影响发出去的那份）。
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
  sealed: ProfileRequestBody;
} {
  const extraHeaders = extractVendorExtraHeaders(input.vendor);
  const built = buildHttpRequest({
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
  return { ...built, sealed: sealRendered(built.body) };
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
