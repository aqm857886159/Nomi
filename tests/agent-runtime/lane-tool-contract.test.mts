// 阶段 2 · 模型可见工具契约的结构断言。
//
// 这一族回答的是一句话：**模型第一次就把参数写对，靠的是结构还是运气。**
// 每条正面断言都配一个阳性对照（R17）——少了对照，这些测试只能证明「今天碰巧是对的」，
// 证明不了「明天有人写回旧形状会被拦下」。而这一族的失败**在本地全部是绿的**：
// 一个根级 `anyOf`、一个 `{}`、一个过不了自己 schema 的示例，编译得过、单测过、
// 广播得出去，只有真模型会在下一次付费运行里用一次失败告诉你。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';

import { flattenDiscriminatedUnion, ConflictingBranchField } from '../../electron/shared/agentCapabilities/flatModelInput.js';
import {
  collectStructuralFailures, collectVendorCompatibilityFailures, toPublishedJsonSchema,
} from '../../electron/shared/agentCapabilities/modelVisibleJsonSchema.js';
import { canvasWriteSemanticInputSchema } from '../../electron/shared/agentCapabilities/canvasWrite.js';
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET } from '../../electron/agentLane/laneToolCatalog.js';
import { renderLanePromptSections } from '../../electron/agentLane/lanePromptSections.js';
import {
  laneToolModelDescription, renderLaneToolFailure, laneToolFailureToRpc,
} from '../../electron/shared/agentLane/laneToolContract.js';
import { modelArgumentTolerance } from '../../electron/shared/agentCapabilities/modelArgumentTolerance.js';
import { VERB_EFFECTS } from '../../electron/shared/agentCapabilities/verbDeclaration.js';
import { laneToolBillable, laneToolMutates } from '../../electron/shared/agentLane/laneToolContract.js';

/** 产物按 JSON Schema 的形状读——`any` 会让门岗的字段名写错时静默通过。 */
interface PublishedSchema {
  type?: string;
  anyOf?: unknown[];
  required?: string[];
  properties?: Record<string, { type?: string; enum?: string[]; description?: string }>;
}

const published = (schema: z.ZodTypeAny): PublishedSchema => toPublishedJsonSchema(schema) as PublishedSchema;

function findings(schema: z.ZodTypeAny): string[] {
  const json = toPublishedJsonSchema(schema);
  const out: string[] = [];
  collectStructuralFailures(json, '', out);
  collectVendorCompatibilityFailures(json, '', out);
  return out;
}

// ── 目录本身 ────────────────────────────────────────────────────────────────

test('lane 的每个模型可见 schema 都干净：没有空 schema、没有根级 union、没有 const', () => {
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    assert.deepEqual(findings(spec.schema), [], `${spec.name} 的模型可见 schema 有问题`);
  }
  // 阳性对照：同一把尺子量一份「旧形状」——今天旧通路真正发给模型的那一份——必须报红。
  // 少了这条，上面那个 for 循环在尺子失效时也会全绿。
  const legacy = findings(canvasWriteSemanticInputSchema);
  assert.ok(legacy.length > 0, '旧的 canvas.write 契约必须被这把尺子判红，否则尺子是坏的');
  assert.ok(legacy.some((line) => /根是一个 anyOf/.test(line)), '旧形状的病灶就是根级 anyOf（G-01）');
});

test('每个示例都能通过它自己工具的 schema', () => {
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    assert.ok(spec.examples.length > 0, `${spec.name} 没有示例（#547：35/35 工具零示例）`);
    for (const example of spec.examples) {
      const parsed = spec.schema.safeParse(example.arguments);
      assert.ok(
        parsed.success,
        `${spec.name} 的示例「${example.when}」过不了自己的 schema：`
        + `${parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))}`,
      );
    }
  }
});

test('examples and complete guidance move losslessly from schema into the system prompt', () => {
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    const rendered = laneToolModelDescription(spec);
    assert.ok(spec.description.startsWith(rendered));
    const prompt = renderLanePromptSections([spec]);
    assert.ok(prompt.includes(spec.description));
    for (const example of spec.examples) assert.ok(prompt.includes(JSON.stringify(example.arguments)));
  }
});

test('工具预算是一条会挡人的规则，不是一句注释', () => {
  assert.ok(LANE_MODEL_TOOL_CATALOG.length <= LANE_TOOL_BUDGET);
  assert.ok(LANE_MODEL_TOOL_CATALOG.length > 0);
});

// ── 描述三通道（G-03）────────────────────────────────────────────────────────

test('三条描述通道各就各位，且 Guidelines 跨工具去重', () => {
  const rendered = renderLanePromptSections(LANE_MODEL_TOOL_CATALOG);
  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    assert.ok(rendered.includes(`- ${spec.name}: ${spec.promptSnippet}`), `${spec.name} 不在 Available tools 菜单里`);
    assert.ok(!spec.promptSnippet.startsWith(spec.name), `${spec.name} 的 snippet 重复了自己的名字`);
  }
  // 去重是这条通道的**全部意义**：文档族有 5 个工具共享同 2 条纪律，渲染出来必须各只有一次。
  const lines = rendered.split('\n');
  const guidelineLines = lines.slice(lines.indexOf('Guidelines:') + 1);
  assert.equal(new Set(guidelineLines).size, guidelineLines.length, 'Guidelines 出现了重复行');
  const shared = 'Read the creation document before you change it';
  assert.equal(guidelineLines.filter((line) => line.includes(shared)).length, 1);
  // 阳性对照：把去重摘掉会怎样——同一条纪律来自 5 个工具，不去重就是 5 行。
  const naive = LANE_MODEL_TOOL_CATALOG.flatMap((spec) => spec.promptGuidelines ?? []);
  assert.ok(naive.filter((line) => line.includes(shared)).length > 1, '这一族本来就该有重复，否则去重什么也没证明');
});

// ── 扁平化（G-01 / G-05）────────────────────────────────────────────────────

test('扁平化后的 schema 与原 union 接受/拒绝完全相同', () => {
  const flat = flattenDiscriminatedUnion(canvasWriteSemanticInputSchema, { name: 'canvas.write' });
  const cases: unknown[] = [
    { operation: 'tidy_canvas' },
    { operation: 'set_node_prompt', nodeId: 'n1', prompt: 'hello' },
    { operation: 'set_node_prompt', nodeId: 'n1' },
    { operation: 'set_node_prompt', nodeId: 'n1', prompt: 'hello', summary: 'cross-branch field' },
    { operation: 'connect_canvas_edges', edges: [] },
    { operation: 'connect_canvas_edges', edges: [{ sourceClientId: 'a', targetClientId: 'b' }] },
    { operation: 'create_staging_reference' },
    { operation: 'patch_shots', select: { kind: 'all' }, patch: { prompt: 'x' } },
    { operation: 'patch_shots', select: { kind: 'indexes' }, patch: { prompt: 'x' } },
    { operation: 'not_a_real_operation' },
  ];
  for (const value of cases) {
    assert.equal(
      flat.safeParse(value).success,
      canvasWriteSemanticInputSchema.safeParse(value).success,
      `扁平版与 union 对 ${JSON.stringify(value)} 的判断不一致`,
    );
  }
  // 至少要有一个接受、一个拒绝——否则「两边一致」可能只是「两边都全拒」。
  assert.ok(cases.some((value) => flat.safeParse(value).success));
  assert.ok(cases.some((value) => !flat.safeParse(value).success));
});

test('扁平化产物的根是对象，且判别字段是 enum 不是 const', () => {
  const flat = flattenDiscriminatedUnion(canvasWriteSemanticInputSchema, { name: 'canvas.write' });
  const json = published(flat);
  assert.equal(json.type, 'object');
  assert.equal(json.anyOf, undefined);
  assert.deepEqual(json.required, ['operation']);
  assert.equal(json.properties?.operation.type, 'string');
  assert.equal(json.properties?.operation.enum?.length, 9, '9 个 operation 一个都不能在扁平化时掉');
});

test('扁平化保住跨字段约束——不是只把形状铺平', () => {
  // 这条是第一版实现真的犯过的错：从 `_def.schema` 取里面那个裸 union 做扁平化，
  // 外层 `superRefine` 的跨字段约束**静默消失**，`connect_canvas_edges` 给空数组当场合法。
  const flat = flattenDiscriminatedUnion(canvasWriteSemanticInputSchema, { name: 'canvas.write' });
  const rejected = flat.safeParse({ operation: 'connect_canvas_edges', edges: [] });
  assert.ok(!rejected.success);
  assert.match(rejected.error.issues[0].message, /at least one edge/);
});

test('lane 真正发布的三个画布工具带着跨字段约束，而不只是全量 union 的扁平版', () => {
  // 上一条测的是 `flattenDiscriminatedUnion(canvasWriteSemanticInputSchema)`——那不是 lane 发布的。
  // lane 发布的是三个语义分组，而分组是从 `.options` 拼出来的裸 union，**不会继承**外层的
  // `superRefine`。2026-09-07 合并评审实核：`connect_canvas_edges` 给空数组在发布版上是合法的。
  const byName = new Map(LANE_MODEL_TOOL_CATALOG.map((spec) => [spec.name, spec] as const));
  const rejects = (name: string, value: unknown, why: RegExp) => {
    const parsed = byName.get(name)!.schema.safeParse(value);
    assert.ok(!parsed.success, `${name} 应当拒绝 ${JSON.stringify(value)}`);
    assert.ok(parsed.error.issues.some((issue) => why.test(issue.message)), JSON.stringify(parsed.error.issues));
  };
  rejects('nomi_canvas_write', { operation: 'connect_canvas_edges', edges: [] }, /at least one edge/);
  // 别的 operation 的字段，形状合法（否则 ajv 那层就拒了，测不到组合那一层）。
  rejects('nomi_canvas_write', { operation: 'set_node_prompt', nodeId: 'n1', prompt: 'x', nodes: [{ clientId: 'c', kind: 'keyframe', title: 't', prompt: 'p' }] }, /Unrecognized key/);
  rejects('nomi_shot_reference_write', { operation: 'create_camera_move', shotClientId: 's1' }, /move or customMove/);
  rejects('nomi_shot_reference_write', { operation: 'create_staging_reference', shotClientId: 's1' }, /characters or customBlocking/);
  rejects('nomi_storyboard_write', { operation: 'patch_shots', select: { kind: 'indexes' }, patch: { prompt: 'x' } }, /needs an indexes array/);
  // 阳性对照：每个示例仍然通过（上面那条「每个示例都能通过」已经钉住），这里再钉一个最小合法值。
  assert.ok(byName.get('nomi_shot_reference_write')!.schema.safeParse({ operation: 'create_camera_move', shotClientId: 's1', move: 'push_in' }).success);
});

test('每个字段的说明都标明它属于哪几个 operation', () => {
  const json = published(flattenDiscriminatedUnion(canvasWriteSemanticInputSchema, { name: 'canvas.write' }));
  // 扁平化把 9 张说明书合成一张，模型必须知道「这个字段属于哪个 operation」才填得对。
  assert.match(json.properties?.summary.description ?? '', /\[for create_canvas_nodes\]/);
  assert.match(json.properties?.shots.description ?? '', /\[for propose_storyboard_plan\]/);
});

test('同名字段在两支上形状不同时，扁平化拒收而不是替作者挑一个', () => {
  const conflicting = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('a'), value: z.string() }).strict(),
    z.object({ kind: z.literal('b'), value: z.number() }).strict(),
  ]);
  assert.throws(
    () => flattenDiscriminatedUnion(conflicting, { name: 'probe' }),
    (error: unknown) => error instanceof ConflictingBranchField && error.field === 'value',
  );
  // 阳性对照：同名同形状就该通过——否则这条规则等于禁掉了所有共享字段。
  const compatible = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('a'), value: z.string() }).strict(),
    z.object({ kind: z.literal('b'), value: z.string() }).strict(),
  ]);
  assert.doesNotThrow(() => flattenDiscriminatedUnion(compatible, { name: 'probe' }));
});

test('没有判别字段的 union 拒绝扁平化，而不是把语义放宽', () => {
  const noDiscriminator = z.union([
    z.object({ a: z.string() }).strict(),
    z.object({ b: z.string() }).strict(),
  ]);
  assert.throws(() => flattenDiscriminatedUnion(noDiscriminator, { name: 'probe' }), /判别字段/);
});

// ── 容忍是一族（§3.4 / G-06）─────────────────────────────────────────────────

test('容忍收下四种「意思对、形状错」，且不放宽任何语义', () => {
  const prepare = modelArgumentTolerance({
    arrayFields: ['nodes'],
    objectFields: ['camera'],
    fieldAliases: { content: ['text', 'body'] },
  });
  const items = [{ clientId: 'c1' }];
  // A · 整包参数被序列化成 JSON 字符串
  assert.deepEqual(prepare(JSON.stringify({ nodes: items })), { nodes: items });
  // B · 某个数组字段被序列化成 JSON 字符串（真机 18 次失败 100% 是这一条）
  assert.deepEqual(prepare({ nodes: JSON.stringify(items) }), { nodes: items });
  // C · 该给一元数组的地方给了单个对象（上游 pi 为它单开过 issue #7835）
  assert.deepEqual(prepare({ nodes: items[0] }), { nodes: items });
  // D · 字段名近义写错；认下之后别名键要**删掉**，否则 .strict() 会把这次正确意图毙掉
  assert.deepEqual(prepare({ text: 'hi' }), { content: 'hi' });
  // 嵌套对象字段同族
  assert.deepEqual(prepare({ camera: '{"angle":"front"}' }), { camera: { angle: 'front' } });

  // 阳性对照 ①：捏不出来就原样交给校验器，**不编一个空值**——
  // pi 的报错会带上路径和期望，那比我们瞎猜强得多。
  assert.deepEqual(prepare({ nodes: 'not json at all' }), { nodes: 'not json at all' });
  // 阳性对照 ②：正名在场时不认别名（否则别名会覆盖用户真正给的值）。
  assert.deepEqual(prepare({ content: 'right', text: 'wrong' }), { content: 'right', text: 'wrong' });
  // 阳性对照 ③：没声明成数组的字段不做单对象→数组的捏合。
  assert.deepEqual(prepare({ other: { a: 1 } }), { other: { a: 1 } });
});

test('容忍不做 pi 已经做的两件事', () => {
  // `normalizeOptionalNulls`（可选字段收到 null → 删键）与 `Value.Convert`（"5" → 5）
  // 是 pi 校验器内部的两道（`pi-ai/dist/utils/validation.js:280-296`）。我们再做一遍
  // 就是第二个容忍器——而两个互不认识的验证器正是 #547 §2.2③「8 行报错只有 1 行是真的」
  // 的成因。所以这里断言我们**没有**碰它们。
  const prepare = modelArgumentTolerance({ arrayFields: ['nodes'] });
  assert.deepEqual(prepare({ count: '5', maybe: null }), { count: '5', maybe: null });
});

// ── 错误契约（G-02 / §3.3）───────────────────────────────────────────────────

test('失败正文带机器码之外的人话与可行动下一步，且内外同源', () => {
  const failure = {
    code: 'capability_input_invalid',
    message: 'canvas.write does not have an operation called "make_video".',
    nextAction: 'Call it again with one of the listed operations.',
    allowed: ['tidy_canvas', 'set_node_prompt'],
    issues: [{ path: 'operation', expected: 'enum', receivedType: 'string' }],
  } as const;
  const rendered = renderLaneToolFailure(failure);
  assert.notEqual(rendered, failure.code, '模型收到错误码等于什么都没收到');
  assert.ok(rendered.includes(failure.message));
  assert.ok(rendered.includes('Next: '), '没有下一步的拒绝会让模型把同一个调用再发一遍');
  assert.ok(rendered.includes('tidy_canvas'), '合法值是模型自纠时最有用的一样东西');
  assert.ok(rendered.includes('operation: expected enum'));
  // 隐私边界：只带类型名，**绝不回传收到的值**——用户文稿正文、素材路径都可能在参数里。
  assert.ok(!rendered.includes('make_video') || rendered.indexOf('make_video') === rendered.indexOf(failure.message) + failure.message.indexOf('make_video'));

  // 内外同源：同一个描述符的两个投影，字段一致。
  const rpc = laneToolFailureToRpc(failure) as Record<string, unknown>;
  assert.equal(rpc.code, failure.code);
  assert.equal(rpc.nextAction, failure.nextAction);
  assert.deepEqual(rpc.allowed, failure.allowed);
  // 阳性对照：没有 allowed/issues 时两个投影都不该凭空造出字段。
  const bare = { code: 'x', message: 'y', nextAction: 'z' } as const;
  assert.deepEqual(Object.keys(laneToolFailureToRpc(bare)).sort(), ['code', 'message', 'nextAction']);
  assert.ok(!renderLaneToolFailure(bare).includes('Allowed values'));
});

// ── 副作用自声明（阶段 2 评审第 ⑨ 维）─────────────────────────────────────────

test('每个工具恰好一个效果，而 replay 从中派生', async () => {
  const { createLaneTools } = await import('../../electron/agentLane/laneTools.mjs');

  for (const spec of LANE_MODEL_TOOL_CATALOG) {
    assert.ok(VERB_EFFECTS.includes(spec.effect), `${spec.name}：effect 必须在四值词表里`);
    assert.equal(laneToolBillable(spec.effect), false, `${spec.name}：阶段 2 的 lane 上不该有花钱的工具`);
  }
  // 事实断言而不是同义反复：画布写入与文稿写入都是可撤的本地写；读是读。
  const byName = new Map(LANE_MODEL_TOOL_CATALOG.map((spec) => [spec.name, spec] as const));
  assert.equal(byName.get('nomi_canvas_write')?.effect, 'reversible_local');
  assert.equal(byName.get('append_to_end')?.effect, 'reversible_local');
  assert.equal(byName.get('read_full_text')?.effect, 'read');

  const descriptors = LANE_MODEL_TOOL_CATALOG.map((spec) => ({
    ...spec, execute: async () => ({ ok: true as const, text: '' }),
  }));
  const built = createLaneTools(descriptors);
  for (const [index, tool] of built.entries()) {
    // 唯一的派生点。重放一次读只是多读一次，重放一次写就是写了两遍。
    assert.equal(tool.replay, laneToolMutates(descriptors[index].effect) ? 'never' : 'safe', tool.name);
  }
  assert.ok(built.some((tool) => tool.replay === 'safe'), '全是 never 就说明派生没生效——上一版正是如此');

  // 阳性对照：词表外的效果必须在**装配期**被拒，而不是等崩溃恢复时多跑一次才发现。
  const readOnly = { ...LANE_MODEL_TOOL_CATALOG[0], execute: async () => ({ ok: true as const, text: '' }) };
  assert.throws(
    () => createLaneTools([{ ...readOnly, effect: 'undoable' as never }]),
    /declares effect "undoable"/,
  );
});
