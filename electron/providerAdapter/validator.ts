import crypto from "node:crypto";
import { modeDeliveryDefect } from "../catalog/transportDelivery";
import { z } from "zod";
import { BILLING_MODEL_KINDS, PROFILE_KINDS, billingKindForTaskKind, type BillingModelKind, type HttpOperation, type ProfileKind } from "../catalog/types";
// 「这个 taskKind 属于哪种模型」只有一个家：媒体侧是准入用的那张表，文本侧是计费口径。
// 这里不再手抄第三份（手抄那版把 image_to_audio 放进了音频，而 Nomi 投不成它）。
import { modelKindForTaskKind } from "../shared/capabilityModeManifest";
// 「哪些 taskKind 的参考媒体是**说明卡声明**进去的」由 PROFILE_KINDS 旁边那份完全划分拥有
// （新增 kind 不分类 = tsc 红）。这里只消费，不再手抄 Set——手抄那版没有穷尽检查，也说不清
// image_to_prompt / transcribe 这类「吃媒体但通道写死在运行期」的 kind 该不该要声明。
import { PROFILE_KIND_REFERENCE_CHANNEL } from "../shared/contracts/modelAccessCapabilities";
import {
  DECLARABLE_INGESTION_STRATEGIES,
  declaredAssetIngestionSchema,
  declaredOmissionsSchema,
  declaredOpenApiSchema,
  declaredSelfCheckSchema,
} from "./declarationCard";
import { assertNeutralDeclarationParameters } from "./promotionMeta";
import type { AdapterModeDraft, AdapterModelDraft, ProviderAdapterDraft } from "./types";

const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH"]);
const allowedTemplateRoots = new Set(["user_api_key", "model", "request", "providerMeta"]);
const forbiddenObjectPathParts = new Set(["__proto__", "prototype", "constructor"]);
const allowedResponseMappingKeys = new Set([
  "task_id",
  "status",
  "assets",
  "image_url",
  "video_url",
  "audio_url",
  "model_url",
  "text",
  "error_message",
]);

const audioResponseSchema = z.union([
  z.enum(["binary", "ndjson-base64"]),
  z.object({
    type: z.literal("binary"),
    contentType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/).max(128),
    extension: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  }).strict(),
  z.object({
    type: z.literal("json"),
    dataPath: z.string().min(1).max(512),
    encoding: z.enum(["hex", "base64"]),
    contentType: z.string().regex(/^audio\/[A-Za-z0-9.+-]+$/).max(128),
    extension: z.string().regex(/^[A-Za-z0-9]{1,10}$/),
  }).strict(),
]);

const multipartSchema = z.object({
  fields: z.record(z.string(), z.string()).optional(),
  fileField: z.string().min(1).max(128).optional(),
  fileSource: z.string().min(1).max(2_048).optional(),
  fileKind: z.enum(["image", "audio", "video"]).optional(),
  imageField: z.string().min(1).max(128).optional(),
  imageSource: z.string().min(1).max(2_048).optional(),
  multiple: z.boolean().optional(),
  filename: z.string().min(1).max(128).optional(),
}).strict().superRefine((value, context) => {
  const generic = Boolean(value.fileField && value.fileSource);
  const legacy = Boolean(value.imageField && value.imageSource);
  if (!generic && !legacy && !Object.keys(value.fields || {}).length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "multipart requires text fields or fileField/fileSource" });
  }
  if ((value.fileField && !value.fileSource) || (!value.fileField && value.fileSource)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "multipart fileField and fileSource must be paired" });
  }
  if ((value.imageField && !value.imageSource) || (!value.imageField && value.imageSource)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "multipart imageField and imageSource must be paired" });
  }
});

const httpOperationSchema = z
  .object({
    method: z.string().min(1).max(12),
    path: z.string().min(1).max(2_048),
    pathFrom: z.literal("host-root").optional(),
    headers: z.record(z.string(), z.string()).optional(),
    query: z.record(z.string(), z.unknown()).optional(),
    body: z.unknown().optional(),
    response_mapping: z.record(z.string(), z.unknown()).optional(),
    provider_meta_mapping: z.record(z.string(), z.unknown()).optional(),
    defaultParams: z.record(z.string(), z.unknown()).optional(),
    audioResponse: audioResponseSchema.optional(),
    mediaResponse: z.object({ kind: z.literal("binary"), contentType: z.literal("video/mp4") }).strict().optional(),
    multipart: multipartSchema.optional(),
  })
  .strict();

const adapterParametersSchema = z
  .array(
    z
      .object({
        key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).max(128),
        label: z.string().min(1).max(128),
        type: z.enum(["select", "number", "text", "boolean"]),
        options: z
          .array(z.object({ value: z.string().max(256), label: z.string().max(256) }).strict())
          .max(128)
          .optional(),
        default: z.union([z.string(), z.number(), z.boolean()]).optional(),
        min: z.number().finite().optional(),
        max: z.number().finite().optional(),
        // 每个数字能追到出处（§5）：mode 级 sourceUrls 已有，参数级补齐。
        sourceUrl: z.string().url().optional()
          .describe("Exact documentation page URL this parameter's range and default were read from."),
      })
      .strict(),
  )
  .max(64);

const adapterModesSchema = z
  .array(
    z
      .object({
        taskKind: z.enum(PROFILE_KINDS),
        create: httpOperationSchema,
        /**
         * 这条 wire 是同步返回结果还是提交任务后轮询——**上游契约的事实，写清楚，别让我们猜**。
         * 缺省按「有 query 即异步」向后兼容；声明 asynchronous 就必须同时给 query 与 statusMapping
         * （下面 superRefine 强制），否则第一次真实生成一定会撞上「拿到任务却没有查询接口」。
         * 这条要求同时出现在交给外部 Agent 的 JSON schema 里（adapterContractJsonSchema 由本 schema 派生）。
         */
        delivery: z.enum(["synchronous", "asynchronous"]).optional()
          .describe("How this endpoint delivers results: 'synchronous' returns the artifact on the create call; 'asynchronous' returns a task that must be polled (then query and statusMapping are required)."),
        query: httpOperationSchema.optional(),
        result: httpOperationSchema.optional(),
        statusMapping: z.record(z.string(), z.array(z.string().max(128)).max(32)).optional(),
        referenceParam: z.string().min(1).max(128).optional(),
        referenceShape: z.enum(["single", "array"]).optional(),
        testParams: z.record(z.string(), z.unknown()).optional(),
        sourceUrls: z.array(z.string().url()).min(1).max(16),
      })
      .strict()
      .superRefine((mode, context) => {
        const defect = modeDeliveryDefect(mode);
        if (defect) context.addIssue({ code: "custom", message: `Mode ${mode.taskKind} ${defect}` });
      }),
  )
  .min(1)
  .max(16);

export const adapterModelContractSchema: z.ZodType<Pick<AdapterModelDraft, "parameters" | "modes">> = z
  .object({
    parameters: adapterParametersSchema.optional(),
    modes: adapterModesSchema,
  });

const adapterSourcesSchema = z
  .array(
    z
      .object({
        url: z.string().url().describe("Exact documentation page URL this mapping was read from."),
        title: z.string().max(300).optional(),
        evidence: z.string().min(1).max(8_000).describe("The supporting excerpt copied from that page."),
      })
      .strict(),
  )
  .min(1)
  .max(64);

const adapterDraftModelsSchema = z
  .array(
    z
      .object({
        modelKey: z.string().min(1).max(256),
        labelZh: z.string().min(1).max(256),
        kind: z.enum(BILLING_MODEL_KINDS),
        parameters: adapterParametersSchema.optional(),
        modes: adapterModesSchema,
      })
      .strict(),
  )
  .min(1)
  .max(256);

/**
 * 由 Nomi 之外编译好的说明卡交件形状：**只有出处与模型两块**。
 * `provider`（baseUrl / authType / 鉴权字段）由 Nomi 从会话配置填，和编译器那条路一样是锁死的身份，
 * 不接受外部覆写——否则「说明卡」就变成了「把请求发到哪儿」的改写入口。
 */
export const adapterSuppliedContractSchema = z
  .object({
    sources: adapterSourcesSchema,
    models: adapterDraftModelsSchema,
    /**
     * **必填，且 `none` 必须显式**（§5，任务书附二）。「没声明」不是「用兜底」——
     * 那正是跨供应商互借与匿名图床活下来的缝。声明成 `none` 的家，参考图路径上诚实报错。
     */
    assetIngestion: declaredAssetIngestionSchema,
    selfCheck: declaredSelfCheckSchema.optional(),
    omitted: declaredOmissionsSchema.optional(),
    openapi: declaredOpenApiSchema.optional(),
  })
  .strict();

export type AdapterSuppliedContract = z.infer<typeof adapterSuppliedContractSchema>;

const providerSchema = z
  .object({
    baseUrl: z.string().url(),
    authType: z.enum(["none", "bearer", "x-api-key", "query"]),
    authHeader: z.string().min(1).max(128).optional(),
    authQueryParam: z.string().min(1).max(128).optional(),
    /**
     * `Authorization` 里 key 前面的方案词（Higgsfield 的 `Key id:secret`）。
     * **由 Nomi 从已绑定的 vendor 填**，卡上只能复述、不能改——它属于「key 怎么放」，
     * 与地址同一档，只能在贴 key 页上改（§6.1）。
     */
    authScheme: z.string().min(1).max(64).optional(),
    providerKind: z.enum(["openai-compatible", "anthropic", "openai-responses"]).optional(),
  })
  .strict();

/**
 * 外部交来的整张卡（设置向导收到的卡、接入会话交来的卡、整卡提交、旧会话恢复）。
 * 卡顶层那几格从交件 schema 派生，不抄第二遍（Ponytail 2026-09-18）；`assetIngestion` 必填，
 * `none` 也要显式写——三条入口同一条（2026-11-17 统一，此前只有会话那条要求它）。
 */
const adapterDraftSchema: z.ZodType<ProviderAdapterDraft> = z
  .object({ provider: providerSchema, ...adapterSuppliedContractSchema.shape })
  .strict();

/**
 * 内置编译器产出的卡：唯一的差别是可以没有 `assetIngestion`（它走 curated 注册表）。
 * 只有 compiler.ts 能拿到这个口（eslint 白名单守）。
 */
const compiledAdapterDraftSchema: z.ZodType<ProviderAdapterDraft> = z
  .object({ provider: providerSchema, ...adapterSuppliedContractSchema.partial({ assetIngestion: true }).shape })
  .strict();

/** 这条 taskKind 能不能挂在这种模型上：媒体侧问准入表，文本侧问计费口径。 */
function taskKindFitsModelKind(taskKind: ProfileKind, kind: BillingModelKind): boolean {
  return kind === "text" ? billingKindForTaskKind(taskKind) === "text" : modelKindForTaskKind(taskKind) === kind;
}

function assertSafePath(path: string, providerBaseUrl: string): void {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("Operation path contains invalid encoding");
  }
  if (decoded.split(/[/?#]/).some((part) => part === "..")) {
    throw new Error("Operation path traversal is not allowed");
  }
  if (/^https?:\/\//i.test(path)) {
    if (new URL(path).origin !== new URL(providerBaseUrl).origin) {
      throw new Error("Absolute operation URL must use the provider's same origin");
    }
    return;
  }
  if (!path.startsWith("/")) throw new Error("Relative operation path must start with /");
}

function assertJsonShape(value: unknown, location: string, depth = 0): void {
  if (depth > 12) throw new Error(`${location} exceeds the maximum nesting depth`);
  if (typeof value === "string") {
    const templates = [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
    if ((value.includes("{{") || value.includes("}}")) && templates.length === 0) {
      throw new Error(`${location} contains a malformed template`);
    }
    for (const match of templates) {
      const parts = match[1].split(".").map((part) => part.trim()).filter(Boolean);
      if (!parts.length || !allowedTemplateRoots.has(parts[0])) {
        throw new Error(`${location} uses disallowed template root ${parts[0] || "<empty>"}`);
      }
      if (parts.some((part) => forbiddenObjectPathParts.has(part) || !/^(?:[A-Za-z_][A-Za-z0-9_]*|\d+)$/.test(part))) {
        throw new Error(`${location} uses a disallowed template path`);
      }
    }
    return;
  }
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return;
  if (Array.isArray(value)) {
    if (value.length > 256) throw new Error(`${location} contains too many array items`);
    value.forEach((item, index) => assertJsonShape(item, `${location}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") throw new Error(`${location} must be JSON serializable`);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 256) throw new Error(`${location} contains too many object keys`);
  for (const [key, item] of entries) {
    if (forbiddenObjectPathParts.has(key)) {
      throw new Error(`${location} uses a disallowed object key ${key}`);
    }
    if (["request_transform", "response_transform", "process", "multipart", "customCall", "script"].includes(key)) {
      throw new Error(`${location}.${key} is executable or privileged and is not allowed`);
    }
    assertJsonShape(item, `${location}.${key}`, depth + 1);
  }
}

function assertSafeResponsePath(path: string, location: string): void {
  const parts = path.split(".").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => forbiddenObjectPathParts.has(part) || !/^(?:[A-Za-z_][A-Za-z0-9_]*|\d+)$/.test(part))) {
    throw new Error(`${location} contains a disallowed response path`);
  }
}

function assertOperation(operation: HttpOperation, providerBaseUrl: string, location: string): void {
  const method = operation.method.toUpperCase();
  if (!allowedMethods.has(method)) throw new Error(`${location}.method is not allowed`);
  operation.method = method;
  assertSafePath(operation.path, providerBaseUrl);
  assertJsonShape(operation.headers, `${location}.headers`);
  assertJsonShape(operation.query, `${location}.query`);
  assertJsonShape(operation.body, `${location}.body`);
  assertJsonShape(operation.response_mapping, `${location}.response_mapping`);
  for (const [key, value] of Object.entries(operation.response_mapping || {})) {
    if (!allowedResponseMappingKeys.has(key)) throw new Error(`${location} uses unsupported response mapping key ${key}`);
    const paths = Array.isArray(value) ? value : [value];
    if (paths.length === 0 || paths.some((path) => typeof path !== "string" || !path.trim())) {
      throw new Error(`${location}.response_mapping.${key} must contain dot-path strings`);
    }
    for (const path of paths) assertSafeResponsePath(path as string, `${location}.response_mapping.${key}`);
  }
  assertJsonShape(operation.provider_meta_mapping, `${location}.provider_meta_mapping`);
  assertJsonShape(operation.defaultParams, `${location}.defaultParams`);
  if (operation.audioResponse && typeof operation.audioResponse === "object") {
    assertJsonShape(operation.audioResponse, `${location}.audioResponse`);
    if (operation.audioResponse.type === "json") {
      assertSafeResponsePath(operation.audioResponse.dataPath, `${location}.audioResponse.dataPath`);
    }
  }
  if (operation.multipart) {
    assertJsonShape(operation.multipart.fields, `${location}.multipart.fields`);
    assertJsonShape(operation.multipart.fileSource || operation.multipart.imageSource, `${location}.multipart.fileSource`);
    if (Object.keys(operation.headers || {}).some((key) => key.toLowerCase() === "content-type")) {
      throw new Error(`${location}.multipart must not declare Content-Type; fetch supplies the boundary`);
    }
  }
  const serialized = JSON.stringify(operation);
  if (serialized.length > 64_000) throw new Error(`${location} exceeds the maximum serialized size`);
}

export type AdapterModeDefectCode = "no_channel" | "async_without_query" | "reference_slot_missing" | "invalid_mode";

/**
 * 一条 mode 的语义缺陷（没有就是 null）。**判断只住这里**：校验器拿它抛错，免费自检拿它的码
 * 转成「我们这边缺什么」——自检不再自己判一遍（它那版把 image_to_prompt 也当成要参考槽）。
 */
export function adapterModeDefect(
  model: Pick<AdapterModelDraft, "modelKey" | "kind">,
  mode: AdapterModeDraft,
): { code: AdapterModeDefectCode; message: string } | null {
  const label = `${model.modelKey}/${mode.taskKind}`;
  if (!mode.create?.method || !mode.create?.path) {
    return { code: "no_channel", message: `Mode ${label} has no executable request channel` };
  }
  if (!taskKindFitsModelKind(mode.taskKind, model.kind)) {
    return { code: "invalid_mode", message: `Task ${mode.taskKind} does not match model kind ${model.kind}` };
  }
  const declaresReference = PROFILE_KIND_REFERENCE_CHANNEL[mode.taskKind] === "declared";
  if (declaresReference && !mode.referenceParam) {
    return { code: "reference_slot_missing", message: `Mode ${label} requires referenceParam` };
  }
  if (declaresReference && !mode.referenceShape) {
    return { code: "reference_slot_missing", message: `Mode ${label} requires referenceShape` };
  }
  const deliveryDefect = modeDeliveryDefect(mode);
  if (deliveryDefect) {
    return { code: "async_without_query", message: `Mode ${label} ${deliveryDefect}` };
  }
  if (mode.result && !mode.query) {
    return { code: "async_without_query", message: `Mode ${label} declares result without query` };
  }
  if (mode.create.mediaResponse || mode.query?.mediaResponse) return { code: "invalid_mode", message: "mediaResponse is only supported on GET result operations" };
  if (mode.result?.mediaResponse && (model.kind !== "video" || mode.result.method.toUpperCase() !== "GET" || mode.result.multipart || mode.result.audioResponse)) {
    return { code: "invalid_mode", message: "mediaResponse requires a video GET result" };
  }
  if (model.kind !== "text") {
    const resultKeys = new Set([
      ...Object.keys(mode.create.response_mapping || {}),
      ...Object.keys(mode.query?.response_mapping || {}),
      ...Object.keys(mode.result?.response_mapping || {}),
    ]);
    // 先判「这个键运行时根本消费不了」，再判「有没有媒体产物映射」。顺序不能反：
    // 写了个不支持的键时，用户要听的是「这个键不支持」，不是笼统的「缺媒体映射」。
    // 全量校验里这条由 assertOperation 更早抛出，抽取时必须保住同一顺序（改反了会被
    // validator.test.ts「rejects response mapping keys the runtime cannot consume」抓到）。
    for (const key of resultKeys) {
      if (!allowedResponseMappingKeys.has(key)) {
        return { code: "invalid_mode", message: `${model.modelKey}.${mode.taskKind} uses unsupported response mapping key ${key}` };
      }
    }
    const accepted = model.kind === "image"
      ? ["assets", "image_url"]
      : model.kind === "video"
        ? ["assets", "video_url"]
        : model.kind === "model3d"
          ? ["assets", "model_url"]
          : model.kind === "audio"
            ? (mode.taskKind === "transcribe" ? ["text"] : ["assets", "audio_url"])
            : ["assets"];
    const declaredMediaBody = model.kind === "video" && Boolean(mode.result?.mediaResponse);
    const declaredAudioBody = model.kind === "audio" && mode.taskKind !== "transcribe" && Boolean(mode.create.audioResponse);
    if (!declaredMediaBody && !declaredAudioBody && !accepted.some((key) => resultKeys.has(key))) {
      return { code: "no_channel", message: `Mode ${label} requires a media result mapping` };
    }
  }
  return null;
}

/**
 * 每条 mode 的**语义**不变量（与「这张卡从哪读来的」无关的那部分）。
 *
 * 为什么单独抽出来：说明卡有**两个生产者**——`compiler.ts`（抓文档 + AI 编译）和
 * `builtinOpenAiCompatibleDraft.ts`（自建/内网端点走的内置模板）。此前只有前者调
 * `validateProviderAdapterDraft`，后者一次都没调过，于是「参考类模式必须声明
 * referenceParam/referenceShape」这条对内置模板**结构性失效**：image_edit 漏声明多年没人拦，
 * 直到 2026-09-03 真中转实测才炸出来（认证探针注不进参考图 → 改图通道判死 → 界面反过来
 * 告诉用户「这模型没有改图通道」）。声明缺失必须在**构建/测试期**大声失败，不是运行期静默。
 *
 * 内置模板天然不满足全量校验里的三条**出处/形状**约束，故它们留在 validateProviderAdapterDraft：
 *   ① `sources.min(1)` / ② `sourceUrls.min(1)`：内置卡来自内置标准契约、不是从某页面读来的，
 *      诚实留空（D4），不编造来源；
 *   ③ `create` 的 `.strict()`：内置卡直接复用 catalog 的 op，带运行期键 `paramMap`
 *      （中性参数→线缆字段翻译表，catalog/types.ts:450），AI 那条路不产出它。
 * 除这三条外，两个生产者共用下面这一份。
 */
export function assertAdapterModeInvariants(
  model: Pick<AdapterModelDraft, "modelKey" | "kind" | "modes">,
): void {
  const seenModes = new Set<ProfileKind>();
  for (const mode of model.modes) {
    if (seenModes.has(mode.taskKind)) throw new Error(`Duplicate mode ${model.modelKey}/${mode.taskKind}`);
    seenModes.add(mode.taskKind);
    const defect = adapterModeDefect(model, mode);
    if (defect) throw new Error(defect.message);
  }
}

/**
 * 外部卡缺 `assetIngestion` 时的那一句：字段路径、现有码、合法取值都在里面，助手一轮就能改对。
 * 在 zod 之前判，因为 zod 的「Required」既不给码也不给取值。
 */
export function assertDeclaresAssetIngestion(input: unknown): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if ((input as Record<string, unknown>).assetIngestion !== undefined) return;
  throw new Error(
    `upload_strategy_unsupported: assetIngestion is required on every declaration card, including "none". ` +
    `Declare assetIngestion.strategy as one of: ${DECLARABLE_INGESTION_STRATEGIES.join(", ")} ` +
    `(with sourceUrl pointing at the documentation page that says how this provider receives reference media), then send the whole card again.`,
  );
}

function validateDraft(
  schema: z.ZodType<ProviderAdapterDraft>,
  input: unknown,
  options: { providerBaseUrl: string; selectedModelKeys: readonly string[] },
): ProviderAdapterDraft {
  const parsed = schema.parse(input);
  const expectedOrigin = new URL(options.providerBaseUrl).origin;
  if (new URL(parsed.provider.baseUrl).origin !== expectedOrigin) {
    throw new Error("Adapter provider base URL must use the configured provider's same origin");
  }
  const sourceUrls = new Set(parsed.sources.map((source) => source.url));
  const selected = new Set(options.selectedModelKeys);
  const seenModels = new Set<string>();
  for (const model of parsed.models) {
    if (!selected.has(model.modelKey)) throw new Error(`Model ${model.modelKey} was not selected by the user`);
    if (seenModels.has(model.modelKey)) throw new Error(`Duplicate model ${model.modelKey}`);
    seenModels.add(model.modelKey);
    // 语义不变量与内置模板共用同一份（见 assertAdapterModeInvariants 的注释）。
    assertAdapterModeInvariants(model);
    // 参数键必须是 Nomi 的中性键：在收件处拒，带字段路径（此前在登记里才判，会话那条路永远到不了）。
    assertNeutralDeclarationParameters(model);
    for (const mode of model.modes) {
      for (const sourceUrl of mode.sourceUrls) {
        if (!sourceUrls.has(sourceUrl)) {
          throw new Error(`Mode ${model.modelKey}/${mode.taskKind} source URL was not discovered from the provider site`);
        }
      }
      assertOperation(mode.create, parsed.provider.baseUrl, `${model.modelKey}.${mode.taskKind}.create`);
      if (mode.query) assertOperation(mode.query, parsed.provider.baseUrl, `${model.modelKey}.${mode.taskKind}.query`);
      if (mode.result) assertOperation(mode.result, parsed.provider.baseUrl, `${model.modelKey}.${mode.taskKind}.result`);
      assertJsonShape(mode.statusMapping, `${model.modelKey}.${mode.taskKind}.statusMapping`);
      assertJsonShape(mode.testParams, `${model.modelKey}.${mode.taskKind}.testParams`);
    }
  }
  for (const modelKey of selected) {
    if (!seenModels.has(modelKey)) throw new Error(`Adapter is missing selected model ${modelKey}`);
  }
  assertCardLevelOperations(parsed);
  return parsed;
}

/**
 * 外部交来的卡的唯一收件口：设置向导、接入会话、整卡提交、旧会话恢复都走这里。
 * 同一份卡从哪条路进来，收不收、拒在哪一格都一样（declarationEntryParity.test.ts 守）。
 */
export function validateProviderAdapterDraft(
  input: unknown,
  options: { providerBaseUrl: string; selectedModelKeys: readonly string[] },
): ProviderAdapterDraft {
  assertDeclaresAssetIngestion(input);
  return validateDraft(adapterDraftSchema, input, options);
}

/**
 * 内置编译器专用口：只比外部口少一条「必须声明 assetIngestion」。其余判据（mode 语义、中性参数键、
 * 同源、出处）一条不少。只有 compiler.ts 能 import 它（eslint 白名单）。
 */
export function validateCompiledAdapterDraft(
  input: unknown,
  options: { providerBaseUrl: string; selectedModelKeys: readonly string[] },
): ProviderAdapterDraft {
  return validateDraft(compiledAdapterDraftSchema, input, options);
}

/**
 * 卡顶层那两个**也会带着 key 出站**的端点：上传初始化与自检探针（§6.1「收卡时」）。
 *
 * 为什么和 mode 的端点同一条判据、写在同一个函数里：它们是同一个问题的两个出口。分两处判 =
 * 第二个同源分类器，而下一次只会有人补上其中一处（`check:outbound-policy` 反对的正是这件事）。
 *
 * 第二步上传目标（预签名 URL）**不在这里判**——它是上游动态返回的，且按策略不带 key
 * （`catalog/types.ts:151-153`），由私网策略照判。
 */
function assertCardLevelOperations(draft: ProviderAdapterDraft): void {
  const ingestion = draft.assetIngestion;
  if (ingestion && "endpoint" in ingestion && typeof ingestion.endpoint === "string") {
    // 与 mode 端点同一个判据函数：它除了同源还查穿越与编码，自己再比一次 origin 会漏掉那两样。
    assertSafePath(ingestion.endpoint, draft.provider.baseUrl);
  }
  const selfCheck = draft.selfCheck;
  if (selfCheck?.kind !== "liveness-probe") return;
  assertSafePath(selfCheck.request.path, draft.provider.baseUrl);
  assertJsonShape(selfCheck.request.headers, "selfCheck.request.headers");
  assertJsonShape(selfCheck.request.query, "selfCheck.request.query");
  assertJsonShape(selfCheck.request.body, "selfCheck.request.body");
  assertSafeResponsePath(selfCheck.successPath, "selfCheck.successPath");
  // 探针不许是生成端点：自检必须免费（09-12 拍板「接模型没有付费验证」）。同一条 path
  // 出现在任何一条 mode 的 create 上，就说明这张卡想拿一次真实生成当自检。
  const probesGenerationEndpoint = draft.models.some((model) =>
    model.modes.some((mode) => mode.create.path === selfCheck.request.path));
  if (probesGenerationEndpoint) {
    throw new Error("selfCheck must not probe a generation endpoint; the self-check is free and never spends the user's credit");
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableValue(item)]),
  );
}

export function adapterRevisionDigest(draft: ProviderAdapterDraft): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(draft))).digest("hex");
}

export { adapterDraftSchema };
