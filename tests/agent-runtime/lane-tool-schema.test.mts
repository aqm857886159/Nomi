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
