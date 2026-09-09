// 能力核 · 把一份 Zod 校验器**派生**成 MCP 传输层广播的 JSON Schema（单一真相源）。
//
// 治的是 R14.1 型「同一契约两份手写定义」：canvas.write 的执行边界是 canvasWrite.ts 的 Zod
// discriminated union（`.strict()`），而 tools/list 里对外广播的却是另一份**手抄的扁平超集**。
// 两份必然漂移，而且漂移的方向是致命的：广播那份 `additionalProperties:false` + 属性表漏了
// propose_storyboard_plan 的 title/anchors/shots、create_camera_move 的 shotClientId、
// create_staging_reference 的 characters/customBlocking —— 于是这些字段在到达 Zod **之前**就被打掉，
// 外部宿主无论怎么写都构造不出合法参数：9 个已发布 operation 里 7 个不可达。
// 顺带损失的是 Zod 里写得最有价值的东西：plannedNodeSchema.prompt 的提示词撰写指南、
// plannedEdgeSchema.mode 的参考槽语义 —— 一个字都没到宿主眼前。
//
// 领域 union 仍发布属性并集/必填交集，保留现有外部聚合工具的可构造形状；
// 分支互斥必填由 canonical Zod 执行。传输层 JSON Schema 由 Ajv 执行。
// 递归 generation schema 无需展平，直接走共享 toPublishedJsonSchema。
import { zodToJsonSchema } from "zod-to-json-schema";

import { JSON_TEXT_BRANCH_MARKER } from "../shared/agentCapabilities/jsonArgTolerance";
import { SUPPORTED_SCHEMA_KEYWORDS, findUnsupportedSchemaFeatures, type SchemaLike } from "./mcpArgValidation";

type JsonRecord = Record<string, unknown>;

const convert = zodToJsonSchema as unknown as (schema: unknown, options: JsonRecord) => unknown;

/** The existing aggregate profile flattens alternative operation branches. */
const UNION_KEYS = ["anyOf", "oneOf"] as const;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function branchesOf(node: JsonRecord): JsonRecord[] | null {
  for (const key of UNION_KEYS) {
    const value = node[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    const branches = value.filter(isRecord);
    // `jsonTolerantArray` 给的「同一个数组的 JSON 文本」那一支**不进传输层**。
    // 本聚合投影的扁平化会把「数组 ∪ 字符串」并成一个没有 `type`、
    // 描述被拼成两段的四不像——广播出去是一份「像在校验其实没有」的 schema，
    // 而 `check:mcp-operation-constructible` 会照着它造出一个字符串样本当场红。
    // 丢掉它不削弱容错：执行边界仍是同一份 Zod，二次序列化的写法照样收得下，
    // 只是**不对外宣传**那种写法——外部宿主看到的是干净的数组契约。
    const structured = branches.filter((branch) => typeof branch.description !== "string" || !branch.description.startsWith(JSON_TEXT_BRANCH_MARKER));
    return structured.length ? structured : branches;
  }
  return null;
}

function uniqueDescription(left: unknown, right: unknown): string | undefined {
  const parts = [left, right].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (parts.length === 0) return undefined;
  return [...new Set(parts)].join("\n");
}

function numericMerge(left: unknown, right: unknown, pick: (a: number, b: number) => number): number | undefined {
  const a = typeof left === "number" ? left : undefined;
  const b = typeof right === "number" ? right : undefined;
  if (a === undefined || b === undefined) return undefined; // 一个分支没界 = 超集无界
  return pick(a, b);
}

/**
 * 合并同名属性的两份 schema：结果必须是两者的**超集**（任一分支的合法值都要能过）。
 * 冲突的约束一律放宽（取更松的界、并集 enum、类型不一致就不再声明 type），
 * 严格判定留给 Zod。
 */
function mergeSchema(left: JsonRecord, right: JsonRecord): JsonRecord {
  if (JSON.stringify(left) === JSON.stringify(right)) return left;
  // 空壳不是「无约束的分支」，而是「这一侧没有说法」（union 兄弟位置常见）。按无说法处理，
  // 否则会把另一侧的 type/required 一起放宽掉 —— 那正是 select 丢了 type:"object" 的那个 bug。
  if (Object.keys(left).length === 0) return right;
  if (Object.keys(right).length === 0) return left;
  const merged: JsonRecord = {};

  if (left.type === right.type && typeof left.type === "string") merged.type = left.type;

  if (Array.isArray(left.enum) && Array.isArray(right.enum)) {
    merged.enum = [...new Set([...left.enum, ...right.enum])];
  }

  const description = uniqueDescription(left.description, right.description);
  if (description) merged.description = description;

  const minimum = numericMerge(left.minimum, right.minimum, Math.min);
  if (minimum !== undefined) merged.minimum = minimum;
  const maximum = numericMerge(left.maximum, right.maximum, Math.max);
  if (maximum !== undefined) merged.maximum = maximum;
  const minLength = numericMerge(left.minLength, right.minLength, Math.min);
  if (minLength !== undefined) merged.minLength = minLength;
  const maxLength = numericMerge(left.maxLength, right.maxLength, Math.max);
  if (maxLength !== undefined) merged.maxLength = maxLength;
  const minItems = numericMerge(left.minItems, right.minItems, Math.min);
  if (minItems !== undefined) merged.minItems = minItems;
  const maxItems = numericMerge(left.maxItems, right.maxItems, Math.max);
  if (maxItems !== undefined) merged.maxItems = maxItems;

  if (isRecord(left.items) && isRecord(right.items)) merged.items = mergeSchema(left.items, right.items);
  else if (isRecord(left.items)) merged.items = left.items;
  else if (isRecord(right.items)) merged.items = right.items;

  if (isRecord(left.properties) || isRecord(right.properties)) {
    const leftProperties = isRecord(left.properties) ? left.properties : {};
    const rightProperties = isRecord(right.properties) ? right.properties : {};
    const properties: JsonRecord = {};
    for (const key of new Set([...Object.keys(leftProperties), ...Object.keys(rightProperties)])) {
      const a = leftProperties[key];
      const b = rightProperties[key];
      if (isRecord(a) && isRecord(b)) properties[key] = mergeSchema(a, b);
      else properties[key] = isRecord(a) ? a : isRecord(b) ? b : {};
    }
    merged.properties = properties;
    // 必填取交集：只有每个分支都要的字段，才是这份超集的必填。
    const leftRequired = Array.isArray(left.required) ? left.required : [];
    const rightRequired = Array.isArray(right.required) ? right.required : [];
    const required = leftRequired.filter((key) => rightRequired.includes(key));
    if (required.length) merged.required = required;
    merged.additionalProperties = left.additionalProperties === false && right.additionalProperties === false ? false : true;
  }

  return merged;
}

/** Aggregate union → property superset/required intersection; preserve the published keyword profile. */
function flatten(node: unknown): JsonRecord {
  if (!isRecord(node)) return {};
  const branches = branchesOf(node);
  if (branches) {
    const flattenedBranches = branches.map(flatten);
    const [first, ...rest] = flattenedBranches;
    const union = rest.reduce<JsonRecord>((accumulator, branch) => mergeSchema(accumulator, branch), first ?? {});
    // union 兄弟位置上的其它关键字（例如 description）也要带上。
    const siblings = flatten({ ...node, anyOf: undefined, oneOf: undefined });
    return mergeSchema(union, siblings);
  }
  if (Array.isArray(node.allOf)) {
    return node.allOf.filter(isRecord).map(flatten).reduce<JsonRecord>((accumulator, part) => mergeSchema(accumulator, part), {});
  }

  const out: JsonRecord = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || key === "$schema") continue;
    if (key === "const") { out.enum = [value]; continue; }
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) continue; // format/nullable/discriminator… 校验器不认，丢
    if (key === "properties" && isRecord(value)) {
      const properties: JsonRecord = {};
      for (const [child, childSchema] of Object.entries(value)) properties[child] = flatten(childSchema);
      out.properties = properties;
      continue;
    }
    if (key === "items") {
      out.items = flatten(value);
      continue;
    }
    if (key === "additionalProperties") {
      // Existing aggregate profile keeps open dictionaries; recursive typed generation uses the shared publisher directly.
      out.additionalProperties = value === false ? false : true;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export type TransportSchemaOptions = Readonly<{
  /** 传输层独有、语义层没有的字段（租约句柄等）。 */
  extraProperties?: Readonly<Record<string, SchemaLike>>;
  /** 传输层最终必填名单；缺省用派生出的交集。 */
  required?: readonly string[];
  /** 诊断用标签，出现在不支持关键字的报错里。 */
  label: string;
}>;

/**
 * 从一份 Zod schema 派生传输层 JSON Schema（校验器子集内的扁平超集）。
 * 派生失败（出现校验器不认的关键字）**当场抛**：宁可启动时红，也不要广播一份「像在校验其实没有」的 schema。
 */
export function transportSchemaFromZod(schema: unknown, options: TransportSchemaOptions): SchemaLike {
  const converted = convert(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
    effectStrategy: "input",
    removeAdditionalStrategy: "strict",
  });
  const flattened = flatten(JSON.parse(JSON.stringify(converted)));
  const properties: JsonRecord = {
    ...(isRecord(flattened.properties) ? flattened.properties : {}),
    ...(options.extraProperties ?? {}),
  };
  const derivedRequired = Array.isArray(flattened.required)
    ? flattened.required.filter((key): key is string => typeof key === "string")
    : [];
  const result: SchemaLike = {
    type: "object",
    properties,
    required: [...(options.required ?? derivedRequired)],
    additionalProperties: false,
  };
  const unsupported = findUnsupportedSchemaFeatures(result);
  if (unsupported.length) {
    throw new Error(`Derived MCP transport schema for ${options.label} is outside the validator subset: ${unsupported.join("; ")}`);
  }
  return result;
}
