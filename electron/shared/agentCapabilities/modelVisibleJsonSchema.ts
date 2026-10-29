// 契约 → **模型真正收到的那份 JSON Schema**，以及判断它有没有说谎的那几条判据。
//
// **为什么这是一个共享 owner 而不是两份**：这段逻辑有两个用户——
//   ① `electron/agentLane/laneToolSchema.mts`：在**生成的那一刻**拦住抹平（防线建在最早那层，R28）；
//   ② `scripts/check-model-schema.ts`：在**存量**上做棘轮，盯着已经发布出去的那些。
// 第一版把它们各写了一份，注释里写着「两边必须逐字相同」——那句话本身就是漂移预警：
// 靠人记得的相同，是还没发生的不同。所以判据只有这一份，两个用户 import 同一个函数。
//
// 三类判据，各自对应一条真实的失败：
//   · **结构**：`{}` / 没有 properties 且值也没类型的 object / 没有 items 的 array
//     ——模型看到的等于「随便填」，`canvas.write` 的 0/18 就长这样。
//   · **供应商**：根级 `anyOf`（Anthropic 静默丢弃，上游 pi #9134）、任意位置的 `const`
//     （Google 的 legacy `parameters` 路径是 OpenAPI 3.03，不认它）。
//     这一类的特点是「本地全绿、真机静默失效」——没有门岗就只能靠花钱买教训。
//   · **运输分支**：过渡补丁 T1 的「同一个值的 JSON 文本」那一支不进模型可见 schema。
import schemaValidator from "./modelSchemaMetaValidator.generated.cjs";
import { z, type ZodTypeAny } from "zod";
import { zodToJsonSchema, ignoreOverride, type OverrideCallback } from "zod-to-json-schema";


import { JSON_TEXT_BRANCH_MARKER } from "./jsonArgTolerance";

// `zodToJsonSchema` 的泛型签名会在 zod 的深层递归类型上把 tsc 顶爆
// （TS2589 "Type instantiation is excessively deep"）。仓库里已有先例，
// 同款处置：`mcpTransportSchemaFromZod.ts:29`。运行时行为一个字没变。
const convertToJsonSchema = zodToJsonSchema as unknown as (schema: unknown, options: Record<string, unknown>) => unknown;


export type JsonSchemaObject = Record<string, unknown>;

/** Preserve ancestor cycles and explicitly lazy/recursive shared subtrees with local references.
 * Ordinary non-recursive schemas stay inline, keeping existing published profiles stable.
 * https://json-schema.org/understanding-json-schema/structuring#recursion
 */
function containsLocalReference(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ("$ref" in value && typeof value.$ref === "string" && value.$ref.startsWith("#")) return true;
  return Object.values(value).some(containsLocalReference);
}

const preserveRecursiveReference: OverrideCallback = (_def, refs, seen, forceResolution) => {
  if (!forceResolution && seen && seen.path.join("/") !== refs.currentPath.join("/")) {
    const recursiveAncestor = seen.path.length < refs.currentPath.length
      && seen.path.every((part, index) => refs.currentPath[index] === part);
    if (recursiveAncestor || seen.jsonSchema && ((_def as { typeName?: string }).typeName === "ZodLazy" || containsLocalReference(seen.jsonSchema))) return { $ref: seen.path.join("/") };
  }
  return ignoreOverride;
};

/**
 * 生成选项与真正发布出去的那几处**逐字相同**（`harness/runtime/pi/tools.mts:44-46`、
 * MCP 传输层）。门岗量的必须是模型真正收到的东西，不是我们希望它收到的东西。
 */
const GENERATE_OPTIONS = {
  $refStrategy: "none",
  override: preserveRecursiveReference,
  effectStrategy: "input",
  removeAdditionalStrategy: "strict",
} as const;

/**
 * 把过渡补丁 T1 的「同一个值的 JSON 文本」那一支从 `anyOf` 里摘掉。
 *
 * 传输层今天已经在做同一件事（`mcpTransportSchemaFromZod.ts:42-48`），理由也一样：
 * 那条分支是给**执行边界**的运输容错，不是给模型的第二种写法；发布出去只会让模型
 * 以为「字符串也行」，然后一半的时候选它。新通路更进一步——容忍整个搬去
 * `prepareArguments`（校验之前），契约本身回到干净的 `z.array(...)`。
 *
 * 顺带解决的是 G-01 的字段级变种：留着这条分支，就算根扁平了，字段上还挂着 `anyOf`，
 * 而 Google 的 legacy 路径在**任何**位置都不支持它。
 */
function stripJsonTextBranches(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripJsonTextBranches);
  if (!node || typeof node !== "object") return node;
  const record = node as JsonSchemaObject;

  const branches = record.anyOf;
  if (Array.isArray(branches)) {
    const structured = branches.filter((branch) => {
      const description = (branch as JsonSchemaObject | null)?.description;
      return typeof description !== "string" || !description.startsWith(JSON_TEXT_BRANCH_MARKER);
    });
    if (structured.length === 1 && structured.length !== branches.length) {
      // 只剩一支时把它**就地展开**，而不是留一个一元 `anyOf`——一元 union 在 JSON Schema
      // 里语义等价，但在丢 `anyOf` 的适配器上依然会被整条丢掉。
      const { anyOf: _dropped, ...rest } = record;
      return stripJsonTextBranches({ ...(structured[0] as JsonSchemaObject), ...rest });
    }
    if (structured.length !== branches.length) {
      return { ...record, anyOf: structured.map(stripJsonTextBranches) };
    }
  }

  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, stripJsonTextBranches(value)]));
}

/** Execution schema retains the converter's original constraints; never sent as the model view. */
export function toRuntimeJsonSchema(schema: ZodTypeAny): JsonSchemaObject {
  return stripJsonTextBranches(convertToJsonSchema(schema, GENERATE_OPTIONS)) as JsonSchemaObject;
}

/** 契约 → 模型真正收到的那份 JSON Schema。**唯一生成点。** */
export function toPublishedJsonSchema(schema: ZodTypeAny): JsonSchemaObject {
  return toStandardModelSchema(toRuntimeJsonSchema(schema));
}

// One common profile, derived from these sources, never a provider/model switch:
// https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
// https://developers.openai.com/api/docs/guides/function-calling#strict-mode
// https://json-schema.org/draft/2020-12/json-schema-core
const OPENAI_SCHEMAS = "https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas";
export const SUPPORTED_SCHEMA_KEYWORDS = new Set([
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
export const SUPPORTED_SCHEMA_TYPES = new Set(["object", "string", "array", "number", "integer", "boolean", "null"]);
const SUPPORTED_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"]);
const isObject = (value: unknown): value is JsonSchemaObject => !!value && typeof value === "object" && !Array.isArray(value);
const escapePointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");

/** Machine-stable wording shared with the information-preservation check, not a second schema. */
export function runtimeConstraintDescription(keyword: string, value: unknown): string {
  return `${keyword}=${JSON.stringify(value)}.`;
}

/** Derive standard shapes without changing the canonical Zod validator or JSON input shape. */
export function toStandardModelSchema(schema: JsonSchemaObject): JsonSchemaObject {
  const relocated = new Map<string, string>();
  const visit = (node: unknown, from: string, to: string): unknown => {
    relocated.set(from, to);
    if (!isObject(node)) return node;
    const out: JsonSchemaObject = {};
    const notes: string[] = [];
    for (const [key, value] of Object.entries(node)) {
      // Converter dialect metadata is not part of function parameters (MCP defaults to 2020-12).
      if (key === "$schema") continue;
      // Not explicitly listed by OpenAI supported schemas. Preserve the constraints as instructions;
      // canonical Zod still owns defaults, string length and dynamic dictionary key validation.
      if (["default", "minLength", "maxLength", "propertyNames"].includes(key)) {
        notes.push(runtimeConstraintDescription(key, value));
        continue;
      }
      if ((key === "items" || key === "prefixItems") && Array.isArray(value)) continue;
      const targetKey = key === "definitions" ? "$defs" : key;
      if (["properties", "$defs", "definitions"].includes(key) && isObject(value)) {
        out[targetKey] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name,
          visit(child, `${from}/${key}/${escapePointer(name)}`, `${to}/${targetKey}/${escapePointer(name)}`)]));
      } else if (["items", "additionalProperties"].includes(key)) {
        out[key] = visit(value, `${from}/${key}`, `${to}/${key}`);
      } else if (key === "anyOf" && Array.isArray(value)) {
        out[key] = value.map((child, index) => visit(child, `${from}/${key}/${index}`, `${to}/${key}/${index}`));
      } else out[key] = value;
    }
    // zod-to-json-schema emits draft-07 items arrays. Accept prefixItems as a derivation input too;
    // neither positional form may escape to the model (2020-12 §10.3.1 + OpenAI array examples).
    const tupleKey = Array.isArray(node.items) ? "items" : Array.isArray(node.prefixItems) ? "prefixItems" : null;
    if (tupleKey) {
      const tuple = node[tupleKey] as unknown[];
      const rest = tupleKey === "items" ? node.additionalItems : node.items;
      const openRest = isObject(rest);
      const homogeneous = tuple.length > 0 && tuple.every((item) => JSON.stringify(item) === JSON.stringify(tuple[0])) && !openRest;
      const members = [...tuple, ...(openRest ? [rest] : [])];
      out.items = homogeneous
        ? visit(tuple[0], `${from}/${tupleKey}/0`, `${to}/items`)
        : members.length ? { anyOf: members.map((child, index) => visit(child,
          index < tuple.length ? `${from}/${tupleKey}/${index}` : `${from}/${tupleKey === "items" ? "additionalItems" : "items"}`,
          `${to}/items/anyOf/${index}`)) }
          : { type: "string" }; // No values are reachable when maxItems=0.
      if (homogeneous) tuple.forEach((_child, index) => relocated.set(`${from}/${tupleKey}/${index}`, `${to}/items`));
      out.minItems = node.minItems ?? tuple.length;
      if (!openRest) out.maxItems = node.maxItems ?? tuple.length;
      delete out.additionalItems;
      if (!homogeneous && tuple.length) notes.push(`Tuple positions (runtime validated): ${JSON.stringify(tuple)}.`);
    }
    if (notes.length) out.description = [node.description, ...notes].filter(Boolean).join("\n");
    return out;
  };
  const result = visit(schema, "#", "#") as JsonSchemaObject;
  // Moving tuple members / definitions also moves local reference targets. Rewrite only schemas,
  // never enum data or business property names. Longest-prefix matching handles deduplicated tuples.
  const locations = [...relocated].sort(([a], [b]) => b.length - a.length);
  const rewrite = (node: unknown): void => {
    if (!isObject(node)) return;
    if (typeof node.$ref === "string" && node.$ref.startsWith("#")) {
      const ref = node.$ref;
      const match = locations.find(([old]) => ref === old || ref.startsWith(`${old}/`));
      if (match) node.$ref = match[1] + ref.slice(match[0].length);
    }
    for (const key of ["properties", "$defs"]) if (isObject(node[key])) Object.values(node[key]).forEach(rewrite);
    for (const key of ["items", "additionalProperties"]) rewrite(node[key]);
    if (Array.isArray(node.anyOf)) node.anyOf.forEach(rewrite);
  };
  rewrite(result);
  return result;
}

// The maintained 2020-12 meta-schema is precompiled with Ajv: no eval in either Electron context.
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

/** `additionalProperties` 说清了值的形状吗？`false`（封闭）和一个非空 schema（开放但有类型）都算说清了。 */
function isDeclaredValueSchema(value: unknown): boolean {
  if (value === false) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

/**
 * 结构底线：不许出现「什么都没说」的节点。
 *
 * 一个**显式的空对象**（`{type:'object', properties:{}, additionalProperties:false}`）是合法的——
 * 它说的是「这个工具不收参数」，那是一句真话。`{}` 说的是「随便你」，那才是 0/18 的来历。
 *
 * `z.record(z.enum([...]))` 这类**开放键名、值有类型**的对象同样是真话：键名确实不可枚举
 * （模型参数名由所选模型的档案决定），但值长什么样说清了。把它一并判红会逼作者去编一份
 * 假的键名清单——那比 `{}` 更糟，因为它看起来很具体。
 */
export function collectStructuralFailures(node: unknown, pointer: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectStructuralFailures(item, `${pointer}/${index}`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as JsonSchemaObject;
  const where = pointer || "(root)";
  if (Object.keys(record).length === 0) {
    out.push(`${where} 是一个空 schema {}（模型看到的等于「随便填」）`);
    return;
  }
  if (
    record.type === "object" && record.properties === undefined
    && !record.anyOf && !record.oneOf && !record.allOf && !record.$ref
    && !isDeclaredValueSchema(record.additionalProperties)
  ) {
    out.push(`${where} 是一个既没有 properties、值也没有类型的 object（字段名和值一个都没告诉模型）`);
  }
  if (record.type === "array" && record.items === undefined && !record.prefixItems) {
    out.push(`${where} 是一个没有 items 的 array（元素长什么样一个字没说）`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "enum" || key === "required" || key === "const" || key === "default" || key === "examples") continue;
    // `properties` / `$defs` 是**容器**不是 schema：空容器说的是「这个对象没有字段」，
    // 对一个不收参数的工具而言那是真话。把容器当 schema 检查，会把最严的那个判成最松的。
    if (key === "properties" || key === "patternProperties" || key === "$defs" || key === "definitions") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [name, child] of Object.entries(value as JsonSchemaObject)) {
          collectStructuralFailures(child, `${pointer}/${key}/${name}`, out);
        }
      }
      continue;
    }
    collectStructuralFailures(value, `${pointer}/${key}`, out);
  }
}

/**
 * 供应商底线（G-01 / G-05）。
 *
 * **「信息没丢」和「模型看得见」是两件事**——这一条存在的全部理由。
 * `z.literal()` 直译成 `{"const":"x"}`：信息一个字没丢，但 Google 系不认。
 * 一个根级 `anyOf`：分支全在那儿，但 Anthropic 的适配器会把它整条丢掉。
 *
 * 判别式 union 的正确写法不是「分支少一点」，是**根必须扁平**：`operation` 降成一个
 * `z.enum` 判别字段，分支专属字段设为 optional，跨字段约束在 refine 里做。
 * 派生器见 `flatModelInput.ts`——不要手抄，手抄就是第二个真相源。
 */
export function collectVendorCompatibilityFailures(json: JsonSchemaObject, pointer: string, out: string[]): void {
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    if (json[keyword] === undefined) continue;
    const branches = Array.isArray(json[keyword]) ? (json[keyword] as unknown[]).length : 0;
    out.push(
      `${pointer || "(root)"} 的根是一个 ${keyword}（${branches} 支）——Anthropic 适配器会静默丢弃它，`
      + "Google legacy 路径不支持它，模型会看到一个没有 schema 的工具。"
      + "用 flattenDiscriminatedUnion 派生扁平版：判别字段降成 z.enum，分支专属字段设为 optional",
    );
  }
  collectConstFailures(json, pointer, out);

}

function collectConstFailures(node: unknown, pointer: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectConstFailures(item, `${pointer}/${index}`, out));
    return;
  }
  if (!node || typeof node !== "object") return;
  const record = node as JsonSchemaObject;
  if ("const" in record) {
    out.push(
      `${pointer || "(root)"} 用了 const（Google 的 OpenAPI 3.03 路径不认它）——改成 z.enum([…])，`
      + '生成 {"type":"string","enum":[…]}，那是上游 StringEnum() 的等价物',
    );
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "enum" || key === "required" || key === "default" || key === "examples") continue;
    collectConstFailures(value, `${pointer}/${key}`, out);
  }
}

/** 判别式 union 的分支值——给错误正文列「合法动作有哪些」用，不另抄一份名单。 */
export function discriminatorValuesOf(schema: ZodTypeAny): readonly string[] {
  let current: ZodTypeAny = schema;
  for (;;) {
    const def = current._def as { typeName?: string; schema?: ZodTypeAny };
    if (def.typeName === z.ZodFirstPartyTypeKind.ZodDiscriminatedUnion) break;
    if (def.typeName === z.ZodFirstPartyTypeKind.ZodEffects && def.schema) {
      current = def.schema;
      continue;
    }
    return [];
  }
  const union = current as unknown as z.ZodDiscriminatedUnion<string, z.ZodObject<z.ZodRawShape>[]>;
  return union.options.map((option) => {
    const field = option.shape[union.discriminator as string];
    return String((field._def as { value?: unknown }).value ?? "");
  });
}
