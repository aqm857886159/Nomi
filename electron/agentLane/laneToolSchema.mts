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
// 校验只发生一次：pi 的 ajv 那次。宿主不再用 zod 复验，因为①的产物**不弱于** zod，
// 这正是②保证的东西。两者是一件事的两半，拆开任何一半这个设计就不成立。
import type { TSchema } from 'typebox';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

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

function collectExpectations(schema: ZodTypeAny, path: string, out: Expectation[], seen: Set<ZodTypeAny>): void {
  if (seen.has(schema)) return;
  seen.add(schema);
  const description = schema.description;
  if (typeof description === 'string' && description.trim()) {
    const text = description;
    out.push({ label: `${path} 的 .describe() 文案「${text}」`, satisfied: (facts) => facts.descriptions.has(text) });
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
      for (const check of (def.checks ?? []) as Array<{ kind: string; value?: number }>) {
        if (check.kind === 'min') expectNumber(out, path, 'minimum', check.value);
        if (check.kind === 'max') expectNumber(out, path, 'maximum', check.value);
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

function expectNumber(out: Expectation[], path: string, keyword: string, value: number | undefined): void {
  if (typeof value !== 'number') return;
  out.push({
    label: `${path} 的 ${keyword}=${value}`,
    satisfied: (facts) => facts.numbers.get(keyword)?.has(value) === true,
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
  for (const keyword of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) {
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
 * 结构底线：模型可见 schema 里不许出现「什么都没说」的节点。
 * 一个**显式的空对象**（`{type:'object', properties:{}, additionalProperties:false}`）是合法的——
 * 它说的是「这个工具不收参数」，那是一句真话；`{}` 说的是「随便你」，那是 0/18 的来历。
 */
function collectStructuralFailures(node: unknown, path: string, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => collectStructuralFailures(item, `${path}[${index}]`, out));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length === 0) {
    out.push(`${path} 是一个空 schema {}（模型看到的等于「随便填」）`);
    return;
  }
  if (record.type === 'object' && record.properties === undefined && record.additionalProperties !== false
    && !record.anyOf && !record.oneOf && !record.allOf && !record.$ref) {
    out.push(`${path} 是一个没有 properties 的 object（字段名一个都没告诉模型）`);
  }
  if (record.type === 'array' && record.items === undefined && !record.prefixItems) {
    out.push(`${path} 是一个没有 items 的 array（元素长什么样一个字没说）`);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === 'enum' || key === 'required' || key === 'const') continue;
    // `properties` / `patternProperties` / `$defs` 是**容器**，不是 schema。空容器说的是
    // 「这个对象没有字段」——对一个不收参数的工具而言那是一句真话；把容器本身当 schema 检查，
    // 会把 `z.object({}).strict()` 判成「随便填」，而它恰恰是最严的那个。
    if (key === 'properties' || key === 'patternProperties' || key === '$defs' || key === 'definitions') {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, child] of Object.entries(value as Record<string, unknown>)) {
          collectStructuralFailures(child, `${path}.${key}.${name}`, out);
        }
      }
      continue;
    }
    collectStructuralFailures(value, `${path}.${key}`, out);
  }
}

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
  const json = zodToJsonSchema(schema, {
    $refStrategy: 'none',
    effectStrategy: 'input',
    removeAdditionalStrategy: 'strict',
  }) as Record<string, unknown>;
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
  if (missing.length > 0) throw new ModelSchemaInformationLoss(options.toolName, missing);
}
