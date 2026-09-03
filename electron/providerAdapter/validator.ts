import crypto from "node:crypto";
import { z } from "zod";
import { BILLING_MODEL_KINDS, PROFILE_KINDS, type BillingModelKind, type HttpOperation, type ProfileKind } from "../catalog/types";
// 「哪些 taskKind 的参考媒体是**说明卡声明**进去的」由 PROFILE_KINDS 旁边那份完全划分拥有
// （新增 kind 不分类 = tsc 红）。这里只消费，不再手抄 Set——手抄那版没有穷尽检查，也说不清
// image_to_prompt / transcribe 这类「吃媒体但通道写死在运行期」的 kind 该不该要声明。
import { PROFILE_KIND_REFERENCE_CHANNEL } from "../shared/contracts/modelAccessCapabilities";
import type { AdapterModelDraft, ProviderAdapterDraft } from "./types";

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
  if (!generic && !legacy) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "multipart requires fileField/fileSource" });
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
        query: httpOperationSchema.optional(),
        result: httpOperationSchema.optional(),
        statusMapping: z.record(z.string(), z.array(z.string().max(128)).max(32)).optional(),
        referenceParam: z.string().min(1).max(128).optional(),
        referenceShape: z.enum(["single", "array"]).optional(),
        testParams: z.record(z.string(), z.unknown()).optional(),
        sourceUrls: z.array(z.string().url()).min(1).max(16),
      })
      .strict(),
  )
  .min(1)
  .max(16);

export const adapterModelContractSchema: z.ZodType<Pick<AdapterModelDraft, "parameters" | "modes">> = z
  .object({
    parameters: adapterParametersSchema.optional(),
    modes: adapterModesSchema,
  });

const adapterDraftSchema: z.ZodType<ProviderAdapterDraft> = z
  .object({
    provider: z
      .object({
        baseUrl: z.string().url(),
        authType: z.enum(["none", "bearer", "x-api-key", "query"]),
        authHeader: z.string().min(1).max(128).optional(),
        authQueryParam: z.string().min(1).max(128).optional(),
        providerKind: z.enum(["openai-compatible", "anthropic", "openai-responses"]).optional(),
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            url: z.string().url(),
            title: z.string().max(300).optional(),
            evidence: z.string().min(1).max(8_000),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    models: z
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
      .max(256),
  })
  .strict();

const taskKindToModelKind: Record<ProfileKind, BillingModelKind> = {
  chat: "text",
  prompt_refine: "text",
  image_to_prompt: "text",
  text_to_image: "image",
  image_edit: "image",
  text_to_video: "video",
  image_to_video: "video",
  text_to_audio: "audio",
  image_to_audio: "audio",
  transcribe: "audio",
  text_to_3d: "model3d",
  image_to_3d: "model3d",
};

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
    if (taskKindToModelKind[mode.taskKind] !== model.kind) {
      throw new Error(`Task ${mode.taskKind} does not match model kind ${model.kind}`);
    }
    const declaresReference = PROFILE_KIND_REFERENCE_CHANNEL[mode.taskKind] === "declared";
    if (declaresReference && !mode.referenceParam) {
      throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires referenceParam`);
    }
    if (declaresReference && !mode.referenceShape) {
      throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires referenceShape`);
    }
    if (mode.result && !mode.query) {
      throw new Error(`Mode ${model.modelKey}/${mode.taskKind} declares result without query`);
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
          throw new Error(`${model.modelKey}.${mode.taskKind} uses unsupported response mapping key ${key}`);
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
      const declaredAudioBody = model.kind === "audio" && mode.taskKind !== "transcribe" && Boolean(mode.create.audioResponse);
      if (!declaredAudioBody && !accepted.some((key) => resultKeys.has(key))) {
        throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires a media result mapping`);
      }
    }
  }
}

export function validateProviderAdapterDraft(
  input: unknown,
  options: { providerBaseUrl: string; selectedModelKeys: readonly string[] },
): ProviderAdapterDraft {
  const parsed = adapterDraftSchema.parse(input);
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
  return parsed;
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
