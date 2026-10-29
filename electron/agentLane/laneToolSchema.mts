// Agent lane · 模型可见 schema 的**单一生成点**（方案 §7 岔路 3 = A，2026-09-07 用户拍板）
//
// 它在解决哪个真实摩擦：今天模型给分镜表写 24 行，而它看到的 schema 只说
// 「shots 是一个由任意对象组成的数组」——25 个字段名一个都没告诉它，真实成功率 0/18
// （#547 §3.2）。原因不是「zod 不好」，是**校验发生了两次、错误来自两个不认识对方的
// 验证器**，而且中间那道转换器会静默把一整棵子树抹成 `{}`（`tools.mts:47-49`）。
//
// 所以这一层做两件事，一件都不能少：
//   ① 生成：zod（作者写法，62 个文件的既有投资）→ 一份 JSON Schema，pi 直接拿去 ajv 校验。
//   ② 门岗：**证明转换器没有吃掉信息**。`.describe()`、枚举值、min/max、对象字段名
//      逐项过桥；少一样就抛，而不是安静地生成一个更松的 schema。
//
// 为什么门岗必须长在生成点里、而不是做成一条 CI 规则：抹平是**运行时**发生的，
// CI 扫源码看不见它（`z.preprocess` 那处就是这样活了半年）。防线建在最早能拦住它的
// 那一层（R28）——这里就是最早的那一层。
//
// 模型 schema 只使用通用标准支持的声明；标准外约束保留在 description。
// laneTools.mts 的 descriptor.schema.safeParse 仍以原 Zod 校验，返回既有结构化错误。
import type { TSchema } from 'typebox';
import { z, type ZodTypeAny } from 'zod';
import { modelFacingBranch } from '../shared/agentCapabilities/jsonArgTolerance.js';
import {
  collectStructuralFailures, collectVendorCompatibilityFailures, collectStandardSchemaFailures, runtimeConstraintDescription, toPublishedJsonSchema,
} from '../shared/agentCapabilities/modelVisibleJsonSchema.js';

const KIND = z.ZodFirstPartyTypeKind;

/** 转换器吃掉了信息时抛这个。它带上「丢了什么」，因为「schema 不合法」这句话救不了任何人。 */
export class ModelSchemaInformationLoss extends Error {
  constructor(readonly toolName: string, readonly missing: readonly string[]) {
    super(`Model-visible schema for "${toolName}" lost information the contract declares: ${missing.join('; ')}`);
    this.name = 'ModelSchemaInformationLoss';
  }
}

interface Expectation {
  /** 人话，进报错。 */
  label: string
  satisfied(facts: JsonFacts): boolean
}

interface JsonFacts {
  descriptions: Set<string>
  enumValues: Set<string>
  numbers: Map<string, Set<number>>
  propertyNames: Set<string>
  requiredNames: Set<string>
}

function unwrap(schema: ZodTypeAny): ZodTypeAny {
  const def = schema._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny; type?: ZodTypeAny };
  switch (def.typeName) {
    case KIND.ZodOptional:
    case KIND.ZodNullable:
    case KIND.ZodDefault:
    case KIND.ZodReadonly:
    case KIND.ZodBranded:
      return def.innerType ? unwrap(def.innerType) : schema;
    case KIND.ZodEffects:
      return def.schema ? unwrap(def.schema) : schema;
    default:
      return schema;
  }
}

function collectExpectations(rawSchema: ZodTypeAny, path: string, out: Expectation[], seen: Set<ZodTypeAny>): void {
  // 过渡补丁 T1 的「同一个值的 JSON 文本」那一支**不进模型可见 schema**
  // （`modelVisibleJsonSchema.ts` 会把它摘掉，理由是字段级 `anyOf` 在 Google legacy
  // 路径上同样不被支持）。所以也不能拿它当「必须过桥的信息」——不然门岗会要求产物里
  // 出现一段我们刚刚**故意**拿掉的文字，然后每个用了容错入参的工具都装配失败。
  // 容忍没有消失，它搬到了 `prepareArguments`（校验之前）。
  const schema = modelFacingBranch(rawSchema);
  if (seen.has(schema)) return;
  seen.add(schema);
  const description = schema.description;
  if (typeof description === 'string' && description.trim()) {
    const text = description;
    out.push({ label: `${path} 的 .describe() 文案「${text}」`, satisfied: (facts) => [...facts.descriptions].some((published) => published === text || published.startsWith(`${text}\n`)) });
  }
  const inner = unwrap(schema);
  if (inner !== schema) {
    collectExpectations(inner, path, out, seen);
    return;
  }
  const def = schema._def as Record<string, unknown>;
  switch (def.typeName) {
    case KIND.ZodObject: {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      for (const [key, value] of Object.entries(shape)) {
        out.push({ label: `${path}.${key} 这个字段名`, satisfied: (facts) => facts.propertyNames.has(key) });
        const optional = (value as ZodTypeAny).isOptional();
        if (!optional) {
          out.push({ label: `${path}.${key} 的「必填」`, satisfied: (facts) => facts.requiredNames.has(key) });
        }
        collectExpectations(value as ZodTypeAny, `${path}.${key}`, out, seen);
      }
      return;
    }
    case KIND.ZodEnum: {
      for (const value of def.values as readonly string[]) {
        out.push({ label: `${path} 的枚举值「${value}」`, satisfied: (facts) => facts.enumValues.has(value) });
      }
      return;
    }
    case KIND.ZodNativeEnum: {
      for (const value of Object.values(def.values as Record<string, unknown>)) {
        if (typeof value !== 'string') continue;
        out.push({ label: `${path} 的枚举值「${value}」`, satisfied: (facts) => facts.enumValues.has(value) });
      }
      return;
    }
    case KIND.ZodLiteral: {
      const value = def.value;
      if (typeof value === 'string') {
        out.push({ label: `${path} 的字面量「${value}」`, satisfied: (facts) => facts.enumValues.has(value) });
      }
      return;
    }
    case KIND.ZodString: {
      for (const check of (def.checks ?? []) as Array<{ kind: string; value?: number }>) {
        if (check.kind === 'min') expectNumber(out, path, 'minLength', check.value);
        if (check.kind === 'max') expectNumber(out, path, 'maxLength', check.value);
      }
      return;
    }
    case KIND.ZodNumber: {
      // `.positive()` 是 `min(0, inclusive:false)`，产物是 `exclusiveMinimum` 而不是
      // `minimum`。忽略这个标志会让门岗去找一个永远不存在的关键字，于是每个用了
      // `.positive()` 的契约都装配失败——一条把正确写法判红的规则，比没有规则更糟。
      for (const check of (def.checks ?? []) as Array<{ kind: string; value?: number; inclusive?: boolean }>) {
        if (check.kind === 'min') {
          expectNumber(out, path, check.inclusive === false ? 'exclusiveMinimum' : 'minimum', check.value);
        }
        if (check.kind === 'max') {
          expectNumber(out, path, check.inclusive === false ? 'exclusiveMaximum' : 'maximum', check.value);
        }
      }
      return;
    }
    case KIND.ZodArray: {
      const array = def as { minLength?: { value: number }; maxLength?: { value: number }; type: ZodTypeAny };
      if (array.minLength) expectNumber(out, path, 'minItems', array.minLength.value);
      if (array.maxLength) expectNumber(out, path, 'maxItems', array.maxLength.value);
      collectExpectations(array.type, `${path}[]`, out, seen);
      return;
    }
    case KIND.ZodUnion:
    case KIND.ZodDiscriminatedUnion: {
      const options = (def.options as ZodTypeAny[] | Map<unknown, ZodTypeAny>);
      const list = Array.isArray(options) ? options : [...options.values()];
      list.forEach((option, index) => collectExpectations(option, `${path}|${index}`, out, seen));
      return;
    }
    case KIND.ZodRecord: {
      collectExpectations(def.valueType as ZodTypeAny, `${path}{}`, out, seen);
      return;
    }
    default:
      return;
  }
}

/** 下界关键字：产物给的界只要**不比**契约松就算过桥。 */
const LOWER_BOUND_KEYWORDS = new Set(['minimum', 'exclusiveMinimum', 'minLength', 'minItems']);

/**
 * 一条数值界的「没丢」判据。
 *
 * **不是逐字相等**，是「产物不比契约松」。理由是生成器会合并同向的界：
 * `z.number().int().safe().nonnegative()` 声明了 `min(-2^53)` 和 `min(0)` 两条，
 * 产物只留更紧的 `minimum: 0`。逐字相等会把这个**正确**的合并判成信息丢失，
 * 于是每个用了 `.safe()` 的契约都装配失败——一条把正确写法判红的规则比没有规则更糟。
 *
 * 方向反过来同样安全：门岗要防的是「产物比契约松」（模型以为能填的比实际多，
 * 于是它填了，然后在执行边界被拒），产物更紧只会让模型少犯错。
 */
function expectNumber(out: Expectation[], path: string, keyword: string, value: number | undefined): void {
  if (typeof value !== 'number') return;
  const tighter = LOWER_BOUND_KEYWORDS.has(keyword)
    ? (published: number) => published >= value
    : (published: number) => published <= value;
  out.push({
    label: `${path} 的 ${keyword}=${value}`,
    satisfied: (facts) => {
      if (['minLength', 'maxLength'].includes(keyword) && [...facts.descriptions].some((text) => text.split('\n').includes(runtimeConstraintDescription(keyword, value)))) return true;
      const published = facts.numbers.get(keyword);
      if (!published) return false;
      return [...published].some(tighter);
    },
  });
}

function collectFacts(node: unknown, facts: JsonFacts): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFacts(item, facts);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (typeof record.description === 'string') facts.descriptions.add(record.description);
  if (Array.isArray(record.enum)) {
    for (const value of record.enum) if (typeof value === 'string') facts.enumValues.add(value);
  }
  if (typeof record.const === 'string') facts.enumValues.add(record.const);
  for (const keyword of [
    'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems',
  ]) {
    const value = record[keyword];
    if (typeof value !== 'number') continue;
    const bucket = facts.numbers.get(keyword) ?? new Set<number>();
    bucket.add(value);
    facts.numbers.set(keyword, bucket);
  }
  if (record.properties && typeof record.properties === 'object' && !Array.isArray(record.properties)) {
    for (const key of Object.keys(record.properties as Record<string, unknown>)) facts.propertyNames.add(key);
  }
  if (Array.isArray(record.required)) {
    for (const key of record.required) if (typeof key === 'string') facts.requiredNames.add(key);
  }
  for (const value of Object.values(record)) collectFacts(value, facts);
}

/**
 * 判据不住在这个文件里——生成点与 `scripts/check-model-schema.ts` 的存量棘轮用的是
 * **同一份** `../shared/agentCapabilities/modelVisibleJsonSchema.ts`。
 *
 * 上一版这里各写了一份，注释写着「两边必须逐字相同」。那句话本身就是漂移预警：
 * 靠人记得的相同，是还没发生的不同。生成点拦新的、门岗拦存量，**判据只有一条**。
 * 三类判据（结构 / 供应商 / 运输分支）与它们各自对应的真实失败，都写在那个文件的头部。
 */

export interface ModelVisibleSchemaOptions {
  /** 进报错用。它是这条信息里唯一能让人「知道去哪儿看」的东西。 */
  toolName: string
}

/**
 * zod → 模型可见 JSON Schema，**并且证明信息没丢**。
 *
 * 刻意不接受任何 `override` / `effectStrategy` 之外的旋钮：那些旋钮正是上一版
 * 静默抹平的入口。要容忍畸形输入请写 `prepareArguments`（pi 官方钩子，
 * `pi-agent-core/dist/types.d.ts:347`），不要去松 schema——松 schema 松的是**所有**调用，
 * 而 `prepareArguments` 只捏合这一次。
 */
export function toModelVisibleSchema(schema: ZodTypeAny, options: ModelVisibleSchemaOptions): TSchema {
  const json = toPublishedJsonSchema(schema);
  assertModelVisibleSchemaLossless(schema, json, options);
  return json as unknown as TSchema;
}

/**
 * 门岗本体：给定「作者写的 zod」与「生成出来的 JSON Schema」，证明后者没有丢掉前者声明的东西。
 *
 * 它和生成器分开导出，是为了它能被**真正测到**——测试可以直接喂一份刻意抹平过的 JSON
 * 进来，证明门岗会红（R17：加规则必须先验它会红）。如果只有 `toModelVisibleSchema` 一个出口，
 * 想验「抹平会红」就只能往生产代码上开一个 `generate` 旋钮，而那种旋钮正是
 * `tools.mts:47-49` 的来历——一个为了方便开的口子，最后成了静默抹平的入口。
 */
export function assertModelVisibleSchemaLossless(
  schema: ZodTypeAny, json: Record<string, unknown>, options: ModelVisibleSchemaOptions,
): void {
  const facts: JsonFacts = {
    descriptions: new Set(), enumValues: new Set(), numbers: new Map(),
    propertyNames: new Set(), requiredNames: new Set(),
  };
  collectFacts(json, facts);
  const expectations: Expectation[] = [];
  collectExpectations(schema, options.toolName, expectations, new Set());
  const missing = expectations.filter((expectation) => !expectation.satisfied(facts)).map((e) => e.label);
  collectStructuralFailures(json, options.toolName, missing);
  collectVendorCompatibilityFailures(json, options.toolName, missing);
  collectStandardSchemaFailures(json, options.toolName, missing);
  if (missing.length > 0) throw new ModelSchemaInformationLoss(options.toolName, missing);
}
