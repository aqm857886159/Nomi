// zod → 模型可见 schema 的**单一生成点**，与它自带的「信息不丢」门岗（岔路 3 = A）。
//
// **每一条正面断言都配一个阳性对照**（R17：加规则必须先验它会红）。少了对照，这一族测试
// 只能证明「今天的转换器碰巧没丢东西」，证明不了「明天有人换个更松的生成器会被拦下」——
// 而 `tools.mts:47-49` 那个 override 正是这样活了半年：它把一整棵子树抹成 `{}`，
// 没有任何测试红过，因为没有任何测试问过「抹平会不会红」。
//
// 阳性对照的做法：把门岗（`assertModelVisibleSchemaLossless`）单独喂一份**刻意抹平过**的
// JSON Schema，断言它报出丢了哪一样。抹平的那份就是「明天出事时生成器会吐出来的东西」。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  ModelSchemaInformationLoss,
  assertModelVisibleSchemaLossless,
  toModelVisibleSchema,
} from '../../electron/agentLane/laneToolSchema.mjs';

const build = (schema: z.ZodTypeAny) =>
  toModelVisibleSchema(schema, { toolName: 'probe' }) as unknown as Record<string, unknown>;

/** 把「作者写的契约」与「被抹平后的产物」对上，返回门岗报出的缺失清单。 */
function lossFrom(contract: z.ZodTypeAny, flattened: z.ZodTypeAny): string[] {
  const json = zodToJsonSchema(flattened, { $refStrategy: 'none' }) as Record<string, unknown>;
  try {
    assertModelVisibleSchemaLossless(contract, json, { toolName: 'probe' });
  } catch (error) {
    if (error instanceof ModelSchemaInformationLoss) return [...error.missing].sort();
    throw error;
  }
  throw new Error('expected the gate to refuse the flattened schema, but it passed');
}

test('.describe() crosses the bridge — and a stripped description is caught, not silently shipped', () => {
  const contract = z.object({
    content: z.string().describe('The exact text to write. Never a diff.'),
  }).strict();
  assert.equal((build(contract).properties as Record<string, { description?: string }>).content.description,
    'The exact text to write. Never a diff.');

  assert.deepEqual(lossFrom(contract, z.object({ content: z.string() }).strict()),
    ['probe.content 的 .describe() 文案「The exact text to write. Never a diff.」']);
});

test('enum values cross the bridge — and a widened enum is caught, value by value', () => {
  const contract = z.object({ operation: z.enum(['insert', 'replace', 'append']) }).strict();
  assert.deepEqual((build(contract).properties as Record<string, { enum?: string[] }>).operation.enum,
    ['insert', 'replace', 'append']);

  // 阳性对照：枚举被放松成裸 string。模型看到的从「三选一」变成「随便写」——
  // 这正是真机上模型给 `modelKey` 编出一个 `"seedance"` 的形状（#547）。
  assert.deepEqual(lossFrom(contract, z.object({ operation: z.string() }).strict()), [
    'probe.operation 的枚举值「append」',
    'probe.operation 的枚举值「insert」',
    'probe.operation 的枚举值「replace」',
  ]);
});

test('min/max cross the bridge for strings, numbers and arrays — and dropped bounds are caught', () => {
  const contract = z.object({
    title: z.string().min(1).max(80),
    count: z.number().int().min(1).max(24),
    shots: z.array(z.string()).min(1).max(10),
  }).strict();
  const properties = build(contract).properties as Record<string, Record<string, unknown>>;
  assert.equal(properties.title.minLength, 1);
  assert.equal(properties.title.maxLength, 80);
  assert.equal(properties.count.minimum, 1);
  assert.equal(properties.count.maximum, 24);
  assert.equal(properties.shots.minItems, 1);
  assert.equal(properties.shots.maxItems, 10);

  assert.deepEqual(
    lossFrom(contract, z.object({ title: z.string(), count: z.number(), shots: z.array(z.string()) }).strict()),
    [
      'probe.count 的 maximum=24', 'probe.count 的 minimum=1',
      'probe.shots 的 maxItems=10', 'probe.shots 的 minItems=1',
      'probe.title 的 maxLength=80', 'probe.title 的 minLength=1',
    ].sort());
});

test('field names and required-ness cross the bridge — a dropped field is caught by name', () => {
  const contract = z.object({ content: z.string().min(1), note: z.string().optional() }).strict();
  const json = build(contract);
  assert.deepEqual(json.required, ['content']);
  assert.deepEqual(Object.keys(json.properties as object).sort(), ['content', 'note']);

  assert.deepEqual(lossFrom(contract, z.object({ note: z.string().optional() }).strict()), [
    'probe.content 的 minLength=1',
    'probe.content 的「必填」',
    'probe.content 这个字段名',
  ].sort());
});

test('a nested description deep inside an array of objects still crosses the bridge', () => {
  // 抹平最爱发生在深处：顶层看着挺全，第三层是个 `{}`。
  const contract = z.object({
    shots: z.array(z.object({
      anchor: z.string().describe('The shot anchor id, kebab-case.'),
    }).strict()).min(1),
  }).strict();
  assert.doesNotThrow(() => build(contract));

  // 报出来的既有「声明的东西丢了」（后三条），也有「产物本身在结构上什么都没说」（前两条）。
  // 两类都要在，因为它们各自能单独发生：字段名还在但说明没了，和整棵子树被抹成 `{}`。
  assert.deepEqual(lossFrom(contract, z.object({ shots: z.array(z.record(z.unknown())) }).strict()), [
    'probe.properties.shots.items 是一个没有 properties 的 object（字段名一个都没告诉模型）',
    'probe.properties.shots.items.additionalProperties 是一个空 schema {}（模型看到的等于「随便填」）',
    'probe.shots 的 minItems=1',
    'probe.shots[].anchor 的 .describe() 文案「The shot anchor id, kebab-case.」',
    'probe.shots[].anchor 这个字段名',
    'probe.shots[].anchor 的「必填」',
  ].sort());
});

test('the structural floor refuses the three shapes that told the model nothing (0/18 lived here)', () => {
  // ① `z.any()` → `{}`：模型读到的是「随便填」（`canvasWrite.ts:143-144` 的形状）。
  assert.throws(() => build(z.object({ anchors: z.any() }).strict()), ModelSchemaInformationLoss);
  // ② 无 items 的数组：元素长什么样一个字没说（`mcpGenerationToolCatalog.ts:33` 的形状）。
  assert.throws(() => build(z.object({ shots: z.array(z.any()) }).strict()), ModelSchemaInformationLoss);
  // ③ `z.record(z.unknown())`：字段名一个都没告诉模型。
  assert.throws(() => build(z.object({ nodes: z.record(z.unknown()) }).strict()), ModelSchemaInformationLoss);
});

test('an explicitly empty object is a true statement, not an empty schema', () => {
  // 「这个工具不收参数」和「随便你填」在 JSON Schema 里长得像，含义相反。
  // `read_full_text` 是前者——它的 scope 由工具名定死了，不该再让模型选一次。
  const json = build(z.object({}).strict());
  assert.equal(json.type, 'object');
  assert.deepEqual(json.properties, {});
  assert.equal(json.additionalProperties, false);
});

/** 门岗拒收时报出的那份清单。`assert.throws` 只回 undefined，拿不到理由。 */
function refusal(schema: z.ZodTypeAny): string[] {
  try {
    build(schema);
  } catch (error) {
    if (error instanceof ModelSchemaInformationLoss) return [...error.missing];
    throw error;
  }
  throw new Error('expected the vendor floor to refuse this schema, but it passed');
}

// —— 供应商底线：G-01（根级 anyOf）与 G-05（const） ——
//
// 这两条防的是同一类错觉：**「信息不丢」证明不了「模型看得见」**。
// 一份根级 `anyOf` 的 schema 逐项都在，只是 Anthropic 的适配器把它整个丢掉了（pi #9134）；
// 一个 `const` 一个字没漏，只是 Google 的 OpenAPI 3.03 路径不认（`pi-ai` google-shared.js:278-281）。
// 门岗到此之前的每一条断言，对这两种情况**全部是绿的**——所以它们必须单列。

test('G-01 · a root-level union is refused: the adapters that drop it leave the model with no schema at all', () => {
  const rootUnion = z.discriminatedUnion('operation', [
    z.object({ operation: z.literal('insert'), content: z.string() }).strict(),
    z.object({ operation: z.literal('append'), content: z.string() }).strict(),
  ]);
  const missing = refusal(rootUnion);
  assert.ok(missing.some((line) => line.includes('根是一个 anyOf')),
    `the refusal must name the root union; got ${JSON.stringify(missing)}`);

  // 阳性对照：**同样的语义**写成扁平对象就通过。少了这一半，上面那条只证明了
  // 「门岗会拒东西」，证明不了「它拒的正好是那一种」——而处方（判别字段降成 enum、
  // 分支字段设 optional）能不能落地，全靠这一半。
  const flattened = z.object({
    operation: z.enum(['insert', 'append']).describe('Which write to perform.'),
    content: z.string().min(1).describe('The exact text to write.'),
  }).strict();
  assert.doesNotThrow(() => build(flattened));
  const json = build(flattened);
  assert.equal(json.anyOf, undefined);
  assert.deepEqual((json.properties as Record<string, { enum?: string[] }>).operation.enum, ['insert', 'append']);
});

test('G-05 · const is refused even though nothing was lost — Google’s legacy path cannot read it', () => {
  const withLiteral = z.object({ scope: z.literal('full') }).strict();
  // 先证明这确实是「信息没丢」的那一类：值就在产物里，`enum` 那条期望是满足的。
  const raw = zodToJsonSchema(withLiteral, { $refStrategy: 'none' }) as Record<string, unknown>;
  assert.equal((raw.properties as Record<string, { const?: string }>).scope.const, 'full');

  assert.equal(refusal(withLiteral).filter((line) => line.includes('const')).length, 1,
    'exactly one line, and it says which construct to use instead');

  // 阳性对照：同一个值写成 `z.enum` 就通过，产物是 `{"type":"string","enum":["full"]}`
  // ——上游 `StringEnum()` 的等价物。
  const asEnum = z.object({ scope: z.enum(['full']) }).strict();
  assert.doesNotThrow(() => build(asEnum));
  assert.deepEqual((build(asEnum).properties as Record<string, unknown>).scope, { type: 'string', enum: ['full'] });
});

test('the two shipped lane schemas satisfy the vendor floor — this is the regression the slice actually carries', () => {
  // 切片今天只有两份 schema，两份都过。这条测试的价值不在今天，在阶段 2：
  // 那时 22 个能力搬进来，其中 11 个今天写的是 `z.discriminatedUnion`。
  assert.doesNotThrow(() => build(z.object({}).strict()));
  assert.doesNotThrow(() => build(z.object({ content: z.string().min(1).describe('Text.') }).strict()));
});
