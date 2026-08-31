import crypto from "node:crypto";
import { z } from "zod";
import { BILLING_MODEL_KINDS, PROFILE_KINDS, type BillingModelKind, type HttpOperation, type ProfileKind } from "../catalog/types";
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
  "model_url",
  "text",
  "error_message",
]);
const referenceTaskKinds = new Set<ProfileKind>(["image_edit", "image_to_video", "image_to_audio", "image_to_3d"]);

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
  const serialized = JSON.stringify(operation);
  if (serialized.length > 64_000) throw new Error(`${location} exceeds the maximum serialized size`);
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
    const seenModes = new Set<ProfileKind>();
    for (const mode of model.modes) {
      if (seenModes.has(mode.taskKind)) throw new Error(`Duplicate mode ${model.modelKey}/${mode.taskKind}`);
      seenModes.add(mode.taskKind);
      if (taskKindToModelKind[mode.taskKind] !== model.kind) {
        throw new Error(`Task ${mode.taskKind} does not match model kind ${model.kind}`);
      }
      if (referenceTaskKinds.has(mode.taskKind) && !mode.referenceParam) {
        throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires referenceParam`);
      }
      if (referenceTaskKinds.has(mode.taskKind) && !mode.referenceShape) {
        throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires referenceShape`);
      }
      for (const sourceUrl of mode.sourceUrls) {
        if (!sourceUrls.has(sourceUrl)) {
          throw new Error(`Mode ${model.modelKey}/${mode.taskKind} source URL was not discovered from the provider site`);
        }
      }
      assertOperation(mode.create, parsed.provider.baseUrl, `${model.modelKey}.${mode.taskKind}.create`);
      if (mode.query) assertOperation(mode.query, parsed.provider.baseUrl, `${model.modelKey}.${mode.taskKind}.query`);
      if (model.kind !== "text") {
        const resultKeys = new Set([
          ...Object.keys(mode.create.response_mapping || {}),
          ...Object.keys(mode.query?.response_mapping || {}),
        ]);
        const accepted = model.kind === "image"
          ? ["assets", "image_url"]
          : model.kind === "video"
            ? ["assets", "video_url"]
            : model.kind === "model3d"
              ? ["assets", "model_url"]
              : ["assets"];
        if (!accepted.some((key) => resultKeys.has(key))) {
          throw new Error(`Mode ${model.modelKey}/${mode.taskKind} requires a media result mapping`);
        }
      }
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
