// 模型可见 schema 的标准判据：官方 2020-12 元 schema + 通用子集白名单。
// Agent 工具生成时（`laneToolSchema.mts`）、MCP 发布时（`mcpTransportSchemaFromZod.ts`）和存量棘轮
// （`scripts/check-model-schema.ts`）用同一个函数，没有第二份关键字名单。
//
// 住主进程这一侧，不进 `electron/shared/`：能进浏览器的只有 shared，渲染层只用转换函数，用不上判据；
// 而校验器是 CJS 生成物，渲染层的依赖图里不许有它（`.dependency-cruiser.mjs` 的 R-B7）。
import schemaValidator from "./modelSchemaMetaValidator.generated.cjs";
import { escapePointer, isObject, type JsonSchemaObject } from "../shared/agentCapabilities/modelVisibleJsonSchema";

// One common profile, derived from these sources, never a provider/model switch:
// https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
// https://developers.openai.com/api/docs/guides/function-calling#strict-mode
// https://json-schema.org/draft/2020-12/json-schema-core
const OPENAI_SCHEMAS = "https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas";
const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  // Basic types, enums, object/array examples and nullable type arrays: OpenAI supported schemas.
  "type", "enum", "properties", "required", "items", "description", "anyOf",
  // Ordinary function parameters are JSON Schema; strict:false keeps open/typed dictionaries.
  // https://json-schema.org/draft/2020-12/json-schema-core#section-10.3.2.3
  "additionalProperties",
  // Explicit number/string/array restrictions in OpenAI supported properties.
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "pattern", "format", "minItems", "maxItems",
  // OpenAI definitions and recursive-schema examples; 2020-12 uses $defs.
  "$ref", "$defs",
]);
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);

// The maintained 2020-12 meta-schema is precompiled with Ajv: no eval in the main process.
// https://ajv.js.org/security.html#content-security-policy

/** Standards whitelist: generation and inventory ratchet import this exact function. */
export function collectStandardSchemaFailures(json: JsonSchemaObject, pointer: string, out: string[]): void {
  if (!isObject(json)) { out.push(`${pointer || "(root)"} model parameters require an object schema`); return; }
  try {
    JSON.stringify(json, (_key, value: unknown) => {
      if (value === undefined || ["function", "symbol", "bigint"].includes(typeof value)
        || typeof value === "number" && !Number.isFinite(value)) throw new Error("non-JSON value");
      return value;
    });
  } catch { out.push(`${pointer || "(root)"} schema must contain finite JSON values without cycles`); return; }
  if (!schemaValidator(json)) {
    for (const error of schemaValidator.errors ?? []) out.push(`${pointer || "(root)"}${error.instancePath} ${error.message}`);
  }
  const schemaNodes = new Set<unknown>();
  const referenceTargets: Array<{ target: unknown; at: string }> = [];
  const visit = (node: unknown, at: string): void => {
    if (!isObject(node)) return;
    schemaNodes.add(node);
    for (const key of Object.keys(node)) {
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) out.push(`${at || "(root)"}/${key} outside the common model schema profile (${OPENAI_SCHEMAS})`);
    }
    if (Array.isArray(node.enum) && node.enum.length === 0) out.push(`${at}/enum requires at least one documented choice`);
    if (Array.isArray(node.items)) out.push(`${at || "(root)"}/items must be a single schema (JSON Schema 2020-12)`);
    for (const key of ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems"]) {
      if (typeof node[key] === "number" && !Number.isFinite(node[key])) out.push(`${at}/${key} must be finite JSON`);
    }
    if (typeof node.pattern === "string") {
      try { new RegExp(node.pattern); } catch { out.push(`${at}/pattern must be a valid regular expression`); }
    }
    if (node.items !== undefined && !isObject(node.items)) out.push(`${at}/items requires a schema object`);
    if (Array.isArray(node.anyOf) && node.anyOf.some(child => !isObject(child))) out.push(`${at}/anyOf requires schema objects`);
    if (node.format !== undefined && !SUPPORTED_FORMATS.has(String(node.format))) out.push(`${at}/format is not in the documented format list`);
    if (typeof node.$ref === "string") {
      try {
        if (!node.$ref.startsWith("#")) throw new Error("external reference");
        const fragment = decodeURIComponent(node.$ref.slice(1));
        if (fragment && !fragment.startsWith("/")) throw new Error("non-pointer reference");
        const target = fragment ? fragment.slice(1).split("/").reduce<unknown>((value, token) =>
          isObject(value) || Array.isArray(value) ? (value as JsonSchemaObject)[token.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined, json) : json;
        if (!isObject(target)) throw new Error("missing target");
        referenceTargets.push({ target, at });
      } catch { out.push(`${at}/$ref must resolve to a local schema`); }
    }
    for (const key of ["properties", "$defs"]) {
      if (isObject(node[key])) for (const [name, child] of Object.entries(node[key])) {
        if (!isObject(child)) out.push(`${at}/${key}/${escapePointer(name)} requires a schema object`);
        visit(child, `${at}/${key}/${escapePointer(name)}`);
      }
    }
    for (const key of ["items", "additionalProperties"]) visit(node[key], `${at}/${key}`);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach((child, index) => visit(child, `${at}/anyOf/${index}`));
  };
  visit(json, pointer);
  for (const { target, at } of referenceTargets) if (!schemaNodes.has(target)) out.push(`${at}/$ref must target a schema node, not instance data or a container`);
}
