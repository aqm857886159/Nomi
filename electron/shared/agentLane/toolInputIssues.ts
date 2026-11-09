// Agent 工具入参被拒收 → **一份** issue 清单 → **一个**格式器（2026-11-07）。
//
// 用户原话（11-07）：「经常出现什么参数不对 重试等问题」。拆开看是三个校验点各说各的话：
//   · pi 的形状校验（TypeBox）：`Validation failed for tool "X": - shots.0: must not have additional properties`
//     ——不说多了哪个键、不给合法值，后面再整份回显入参（12 镜一次 4–5k 字符）；
//   · 契约 parse（Zod）：裸 issue JSON，或只有「expected one of …」；
//   · 准入层（模型档案）：中文好句子，但字段事实只在散文里。
// 模型拿到的是三种格式，面板只能去正则其中一种。这里把三个来源先收成同一份结构化清单
// （字段路径、收到的短值、合法值或近似键、范围），再由同一个函数写成模型读的那几行；
// 面板读同一份清单的公开投影（不带收到的值），按 `kind` 出本地话。
//
// 本文件**零运行时依赖**（Zod / TypeBox 只取结构，不 import）：渲染层要读它的类型，主进程两种岛
// （NodeNext `.mts` 与 CommonJS）都要调它的函数。
import type { LaneToolPublicIssue } from "./laneToolFailureEnvelope";

export type { LaneToolPublicIssue, ToolInputIssueKind } from "./laneToolFailureEnvelope";

/** 进模型那一份：公开投影 + 两样只给模型的东西（收到的短值、我们自己写的约束原话）。 */
export interface ToolInputIssue extends LaneToolPublicIssue {
  /** 收到的值，**只在它是短标量时**带（数字、布尔、null、≤32 字的字符串）。模型刚自己发的，不是新泄露。 */
  readonly received?: string;
  /** 我们契约里写的约束原话（英文，给模型）。不进公开信封。 */
  readonly note?: string;
}

/** 一次拒收最多列几条。`anyOf` 每个分支各报一条，不封顶会刷屏。 */
export const TOOL_INPUT_ISSUE_LIMIT = 8;
/** 「这一层可填的字段」最多列几个。 */
const ALLOWED_FIELD_LIMIT = 24;
const RECEIVED_TEXT_LIMIT = 32;

type JsonSchemaNode = Readonly<{
  type?: unknown;
  properties?: Readonly<Record<string, JsonSchemaNode>>;
  additionalProperties?: unknown;
  items?: unknown;
  anyOf?: readonly JsonSchemaNode[];
  oneOf?: readonly JsonSchemaNode[];
  allOf?: readonly JsonSchemaNode[];
}>;

// ── 近似键 ────────────────────────────────────────────────────────────────

/** Levenshtein 距离。 */
function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const candidateCost = Math.min(previous[j]! + 1, previous[j - 1]! + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = previous[j]!;
      previous[j] = candidateCost;
    }
  }
  return previous[right.length]!;
}

// 点号也折掉：模型 id 的版本号两种写法都有（`doubao-seedream-4.5` ↔ `doubao-seedream-4-5-251128`，2026-11-08 真实轨迹）。
// 字段键里本来没有点号，这一条对它们不改任何结果。
const folded = (key: string): string => key.toLowerCase().replace(/[_\-.\s]/g, "");

/**
 * 「你是不是想写这个」——**只在真的接近时才给**。给一个不相干的键会把模型带去第二个错误答案。
 *
 * 接近有三种，按这个顺序认：
 *   ① 只差大小写 / 下划线 / 连字符 / 点号（`aspect_ratio` ↔ `aspectRatio`）；
 *   ② 一个是另一个的前缀或后缀，且写的那个至少 4 个字（`duration` → `durationSec`、`ratio` → `aspectRatio`）；
 *   ③ 编辑距离 ≤ 键长的 1/3（至少 1，最多 3）——准入层原来那条阈值，原样搬过来（它是唯一 owner 了）。
 */
export function closestKey(written: string, candidates: readonly string[]): string | undefined {
  const target = folded(written);
  if (!target) return undefined;
  const exact = candidates.find((candidate) => folded(candidate) === target);
  if (exact) return exact;
  if (target.length >= 4) {
    const contained = candidates
      .filter((candidate) => {
        const other = folded(candidate);
        return other.startsWith(target) || other.endsWith(target) || target.startsWith(other) && other.length >= 4;
      })
      .sort((left, right) => left.length - right.length)[0];
    if (contained) return contained;
  }
  const budget = Math.min(3, Math.max(1, Math.floor(written.length / 3)));
  let best: { key: string; distance: number } | undefined;
  for (const key of candidates) {
    const distance = editDistance(written.toLowerCase(), key.toLowerCase());
    if (distance <= budget && (!best || distance < best.distance)) best = { key, distance };
  }
  return best?.key;
}

// ── 小工具 ────────────────────────────────────────────────────────────────

function joinPath(segments: readonly (string | number)[]): string {
  return segments.length > 0 ? segments.map(String).join(".") : "(root)";
}

function valueAt(root: unknown, segments: readonly (string | number)[]): unknown {
  let current: unknown = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[segment as string | number];
  }
  return current;
}

function typeNameOf(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isInteger(value)) return "integer";
  return typeof value;
}

/** 收到的值能不能回给模型：只认短标量。对象、数组、长字符串（多半是用户正文）一律不带。 */
function receivedOf(value: unknown): string | undefined {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string" && value.length <= RECEIVED_TEXT_LIMIT) return JSON.stringify(value);
  return undefined;
}

function schemaBranches(node: JsonSchemaNode): JsonSchemaNode[] {
  return [node, ...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])];
}

/** 沿实例路径走模型可见的 JSON Schema，拿到那一层的对象 schema。 */
export function schemaNodeAt(schema: unknown, segments: readonly (string | number)[]): JsonSchemaNode | undefined {
  let node = schema as JsonSchemaNode | undefined;
  for (const raw of segments) {
    if (!node) return undefined;
    const segment = String(raw);
    let next: JsonSchemaNode | undefined;
    for (const branch of schemaBranches(node)) {
      if (branch.properties && Object.prototype.hasOwnProperty.call(branch.properties, segment)) { next = branch.properties[segment]; break; }
      if (/^\d+$/.test(segment) && branch.items && typeof branch.items === "object" && !Array.isArray(branch.items)) { next = branch.items as JsonSchemaNode; break; }
      if (branch.additionalProperties && typeof branch.additionalProperties === "object") { next = branch.additionalProperties as JsonSchemaNode; break; }
    }
    node = next;
  }
  return node;
}

/** 那一层能填的字段名（声明顺序）。 */
export function fieldsAt(schema: unknown, segments: readonly (string | number)[]): string[] {
  const node = schemaNodeAt(schema, segments);
  if (!node) return [];
  const names = new Set<string>();
  for (const branch of schemaBranches(node)) for (const key of Object.keys(branch.properties ?? {})) names.add(key);
  return [...names];
}

function unknownFieldIssue(objectPath: readonly (string | number)[], key: string, schema: unknown): ToolInputIssue {
  const allowed = schema === undefined ? [] : fieldsAt(schema, objectPath);
  const nearest = allowed.length > 0 ? closestKey(key, allowed) : undefined;
  return {
    path: joinPath([...objectPath, key]), kind: "unknown_field",
    ...(allowed.length > 0 ? { allowed: allowed.slice(0, ALLOWED_FIELD_LIMIT) } : {}),
    ...(nearest ? { nearest } : {}),
  };
}

function dedupe(issues: readonly ToolInputIssue[]): ToolInputIssue[] {
  const seen = new Set<string>();
  const out: ToolInputIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.path}\u0000${issue.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
    if (out.length >= TOOL_INPUT_ISSUE_LIMIT) break;
  }
  return out;
}

// ── 来源一：Zod（契约 parse） ─────────────────────────────────────────────

/** Zod v3 issue 的结构子集（只取结构，不 import zod）。 */
type ZodLikeIssue = Readonly<{
  code: string;
  path: readonly (string | number)[];
  message: string;
  expected?: unknown;
  received?: unknown;
  options?: readonly unknown[];
  keys?: readonly string[];
  minimum?: unknown;
  maximum?: unknown;
  type?: string;
}>;

/** 一个异常是不是 ZodError（按结构认：跨包、跨岛的 `instanceof` 不可靠）。 */
export function zodIssuesOfError(error: unknown): readonly ZodLikeIssue[] | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { name?: unknown; issues?: unknown };
  if (candidate.name !== "ZodError" || !Array.isArray(candidate.issues)) return undefined;
  return candidate.issues as ZodLikeIssue[];
}

export function issuesFromZod(zodIssues: readonly ZodLikeIssue[], args: unknown, schema?: unknown): ToolInputIssue[] {
  const out: ToolInputIssue[] = [];
  // 执行期抛出的 ZodError 校验的是契约语义输入，不是模型发来的那份参数——那时手里没有 args，
  // 「值不在」不能当「缺字段」读，只认 Zod 自己说的 `received: "undefined"`。
  const known = args !== undefined;
  for (const issue of zodIssues) {
    const path = joinPath(issue.path);
    const value = known ? valueAt(args, issue.path) : undefined;
    const received = receivedOf(value);
    switch (issue.code) {
      case "invalid_type":
        out.push(issue.received === "undefined" || (known && value === undefined && issue.received === undefined)
          ? { path, kind: "missing", ...(typeof issue.expected === "string" ? { expected: issue.expected } : {}) }
          : { path, kind: "wrong_type", ...(typeof issue.expected === "string" ? { expected: issue.expected } : {}),
            ...(typeof issue.received === "string" ? { receivedType: issue.received } : known ? { receivedType: typeNameOf(value) } : {}),
            ...(received ? { received } : {}) });
        break;
      case "invalid_enum_value":
      case "invalid_union_discriminator": {
        const allowed = (issue.options ?? []).map(String);
        const nearest = typeof value === "string" ? closestKey(value, allowed) : undefined;
        out.push({ path, kind: "not_allowed", allowed, ...(nearest ? { nearest } : {}), ...(received ? { received } : {}) });
        break;
      }
      case "invalid_literal":
        out.push({ path, kind: "not_allowed", allowed: [String(issue.expected)], ...(received ? { received } : {}) });
        break;
      case "unrecognized_keys":
        for (const key of issue.keys ?? []) out.push(unknownFieldIssue(issue.path, key, schema));
        break;
      case "too_small":
        if (issue.type === "array") out.push({ path, kind: "too_few", ...(typeof issue.minimum === "number" ? { min: issue.minimum } : {}) });
        else if (issue.type === "string" && issue.minimum === 1) out.push({ path, kind: "missing", expected: "string" });
        else if (issue.type === "number" || issue.type === "bigint") out.push({ path, kind: "out_of_range", ...(typeof issue.minimum === "number" ? { min: issue.minimum } : {}), ...(received ? { received } : {}) });
        else out.push({ path, kind: "invalid", note: issue.message });
        break;
      case "too_big":
        if (issue.type === "array") out.push({ path, kind: "too_many", ...(typeof issue.maximum === "number" ? { max: issue.maximum } : {}) });
        else if (issue.type === "number" || issue.type === "bigint") out.push({ path, kind: "out_of_range", ...(typeof issue.maximum === "number" ? { max: issue.maximum } : {}), ...(received ? { received } : {}) });
        else out.push({ path, kind: "invalid", note: issue.message });
        break;
      default:
        // 我们自己写的约束（`a new shot needs a prompt …`）：原话就是最好的说明。缺字段的那一种按缺字段认。
        out.push(known && value === undefined && issue.code === "custom"
          ? { path, kind: "missing", note: issue.message }
          : { path, kind: "invalid", note: issue.message, ...(received ? { received } : {}) });
    }
  }
  return dedupe(out);
}

// ── 来源二：TypeBox（pi 的形状校验，`typebox/compile` 的 `Errors()`） ──────────

/** TypeBox 1.x 的结构化错误（与 AJV 同形）。 */
export type TypeBoxLikeError = Readonly<{
  keyword: string;
  instancePath: string;
  params?: Readonly<Record<string, unknown>>;
  message: string;
}>;

function pointerSegments(pointer: string): string[] {
  if (!pointer) return [];
  return pointer.replace(/^\//, "").split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function issuesFromTypeBox(errors: readonly TypeBoxLikeError[], args: unknown, schema: unknown): ToolInputIssue[] {
  const out: ToolInputIssue[] = [];
  const branchy = new Set(["anyOf", "oneOf", "allOf", "if", "then", "else", "not"]);
  const specific = errors.filter((error) => !branchy.has(error.keyword));
  for (const error of specific.length > 0 ? specific : errors) {
    const segments = pointerSegments(error.instancePath);
    const path = joinPath(segments);
    const value = valueAt(args, segments);
    const received = receivedOf(value);
    const params = error.params ?? {};
    switch (error.keyword) {
      case "required":
        for (const name of (params.requiredProperties as readonly string[] | undefined) ?? []) {
          out.push({ path: joinPath([...segments, name]), kind: "missing" });
        }
        break;
      case "additionalProperties":
        for (const key of (params.additionalProperties as readonly string[] | undefined) ?? []) {
          out.push(unknownFieldIssue(segments, key, schema));
        }
        break;
      case "enum":
      case "const": {
        const allowed = (error.keyword === "enum" ? (params.allowedValues as readonly unknown[] | undefined) ?? [] : [params.allowedValue]).map(String);
        const nearest = typeof value === "string" ? closestKey(value, allowed) : undefined;
        out.push({ path, kind: "not_allowed", allowed, ...(nearest ? { nearest } : {}), ...(received ? { received } : {}) });
        break;
      }
      case "type": {
        const expected = Array.isArray(params.type) ? (params.type as unknown[]).map(String).join(" or ") : String(params.type ?? "");
        out.push({ path, kind: "wrong_type", ...(expected ? { expected } : {}), receivedType: typeNameOf(value), ...(received ? { received } : {}) });
        break;
      }
      case "minItems":
        out.push({ path, kind: "too_few", ...(typeof params.limit === "number" ? { min: params.limit } : {}) });
        break;
      case "maxItems":
        out.push({ path, kind: "too_many", ...(typeof params.limit === "number" ? { max: params.limit } : {}) });
        break;
      case "minimum":
      case "exclusiveMinimum":
        out.push({ path, kind: "out_of_range", ...(typeof params.limit === "number" ? { min: params.limit } : {}), ...(received ? { received } : {}) });
        break;
      case "maximum":
      case "exclusiveMaximum":
        out.push({ path, kind: "out_of_range", ...(typeof params.limit === "number" ? { max: params.limit } : {}), ...(received ? { received } : {}) });
        break;
      case "minLength":
        out.push(params.limit === 1 ? { path, kind: "missing", expected: "string" } : { path, kind: "invalid", note: error.message });
        break;
      default:
        out.push({ path, kind: "invalid", note: error.message, ...(received ? { received } : {}) });
    }
  }
  return dedupe(out);
}

// ── 来源三：准入层（模型档案的参数事实） ─────────────────────────────────

/** `executionContract.ParameterRejection` 的结构子集（不 import 主进程那一层）。 */
export type ParameterRejectionLike = Readonly<{
  code: string;
  path: string;
  allowedKeys?: readonly string[];
  closestKey?: string;
  expectedType?: string;
  allowedValues?: readonly (string | number | boolean)[];
  min?: number;
  max?: number;
  allowedVariantIds?: readonly string[];
  useField?: string;
}>;

export function issuesFromParameterRejection(rejection: ParameterRejectionLike): ToolInputIssue[] {
  const path = rejection.path || "(root)";
  switch (rejection.code) {
    case "unknown_parameter":
      return [{ path, kind: "unknown_field",
        ...(rejection.allowedKeys?.length ? { allowed: rejection.allowedKeys.slice(0, ALLOWED_FIELD_LIMIT) } : {}),
        ...(rejection.useField ? { nearest: rejection.useField, note: `this belongs in the draft field ${rejection.useField}, not in parameters` }
          : rejection.closestKey ? { nearest: rejection.closestKey } : {}) }];
    case "parameter_type_mismatch":
      return [{ path, kind: "wrong_type", ...(rejection.expectedType ? { expected: rejection.expectedType } : {}) }];
    case "parameter_not_in_enum":
      return [{ path, kind: "not_allowed", allowed: (rejection.allowedValues ?? []).map(String) }];
    case "parameter_out_of_range":
      return [{ path, kind: "out_of_range", ...(rejection.min !== undefined ? { min: rejection.min } : {}), ...(rejection.max !== undefined ? { max: rejection.max } : {}) }];
    case "missing_required_parameter":
      return [{ path, kind: "missing" }];
    case "unknown_variant":
      return [{ path, kind: "not_allowed", allowed: [...(rejection.allowedVariantIds ?? [])],
        ...(rejection.allowedVariantIds?.length === 0 ? { note: "this model has no variants; omit variantId" } : {}) }];
    default:
      return [{ path, kind: "invalid" }];
  }
}

// ── 唯一的格式器 ──────────────────────────────────────────────────────────

const list = (values: readonly string[]): string => values.join(", ");

/** 一条 issue → 模型读的那一行（英文，模型只读文本）。 */
export function renderToolInputIssue(issue: ToolInputIssue): string {
  const got = issue.received ? ` (received ${issue.received})` : "";
  let line: string;
  switch (issue.kind) {
    case "unknown_field":
      line = issue.nearest ? `no such field here; did you mean "${issue.nearest}"?` : "no such field here; remove it.";
      if (issue.allowed?.length) line += ` Fields allowed here: ${list(issue.allowed)}.`;
      break;
    case "not_allowed":
      line = `value${got} is not allowed.`;
      if (issue.nearest) line += ` Did you mean "${issue.nearest}"?`;
      if (issue.allowed?.length) line += ` Use one of: ${list(issue.allowed)}.`;
      break;
    case "wrong_type":
      // 收到的类型不知道（准入层只说期望什么）就不写「received another type」：0 也是数字，那句话是假的。
      line = `expected ${issue.expected ?? "another type"}${issue.receivedType ? `, received ${issue.receivedType}` : ""}${got}.`;
      break;
    case "missing":
      line = `required, but missing${issue.expected ? ` (expected ${issue.expected})` : ""}.`;
      break;
    case "out_of_range":
      line = issue.min !== undefined && issue.max !== undefined ? `must be between ${issue.min} and ${issue.max}${got}.`
        : issue.min !== undefined ? `must be at least ${issue.min}${got}.`
          : issue.max !== undefined ? `must be at most ${issue.max}${got}.` : `is out of range${got}.`;
      break;
    case "too_few":
      line = `needs at least ${issue.min ?? 1} item(s).`;
      break;
    case "too_many":
      line = `allows at most ${issue.max ?? "fewer"} item(s).`;
      break;
    default:
      line = `is invalid${got}.`;
  }
  if (issue.note) line += ` ${issue.note.replace(/\.?$/, ".")}`;
  return `  - ${issue.path}: ${line}`;
}

/** 公开那一份：去掉收到的值和只给模型的原话（面板 / 对外 MCP / 转录信封都只拿这一份）。 */
export function publicToolInputIssues(issues: readonly ToolInputIssue[]): LaneToolPublicIssue[] {
  return issues.map(({ received: _received, note: _note, ...rest }) => rest);
}

/** 墙用的字段路径（熔断按「工具 + 码 + 字段」认墙）。 */
export function issuePaths(issues: readonly { readonly path: string }[]): string[] {
  return issues.map((issue) => issue.path);
}
