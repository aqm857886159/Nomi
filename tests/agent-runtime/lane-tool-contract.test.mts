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
import { CANVAS_WRITE_OPERATIONS, canvasWriteSemanticInputSchema } from '../../electron/shared/agentCapabilities/canvasWrite.js';
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
  const shared = 'Read before you write';
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
  // 数量不再手抄：以契约自己的 operation 清单为准（新增 set_node_text 后是 10 个），一个都不能在扁平化时掉。
  assert.deepEqual([...(json.properties?.operation.enum ?? [])].sort(), [...CANVAS_WRITE_OPERATIONS].sort(), '每个 operation 一个都不能在扁平化时掉');
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
  // 20 动词：画布写是三个动词；跨字段约束挂在各自 schema 上（stage_shot 的 staging/cameraMove 二选一）。
  rejects('stage_shot', { shotId: 's1' }, /exactly one of staging or cameraMove/);
  rejects('stage_shot', { shotId: 's1', cameraMove: { move: 'push_in' }, staging: { characters: [] } }, /exactly one of staging or cameraMove/);
  // 别的动词的字段，形状合法（否则 ajv 那层就拒了，测不到组合那一层）。
  rejects('make_artifact', { fileType: 'table', title: 't', content: 'c', nodes: [{ clientId: 'c', kind: 'keyframe', title: 't', prompt: 'p' }] }, /Unrecognized key/);
  // 阳性对照：每个示例仍然通过（上面那条「每个示例都能通过」已经钉住），这里再钉一个最小合法值。
  assert.ok(byName.get('stage_shot')!.schema.safeParse({ shotId: 's1', cameraMove: { move: 'push_in' } }).success);
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
  assert.equal(byName.get('make_artifact')?.effect, 'reversible_local');
  assert.equal(byName.get('write_script')?.effect, 'reversible_local');
  assert.equal(byName.get('read_script')?.effect, 'read');

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

// ── 动词 → 宿主契约的**贯通**断言（2026-09-18 根因）。
//
// 上面那族证的是「模型看到的 schema 自洽」，但模型写对了参数**不等于**宿主收得下：
// 中间还隔着 `verbToTransportCall` 那层改形状的翻译。2026-09-18 真机实测，用户点「新建方案」让
// Agent 照剧本出分镜，`draft_shots` 连着三次被宿主判 `generation_input_invalid` —— 因为动词声明了
// 每镜 `title` 与 `durationSec`，翻译层原样递过去（还把 durationSec 改名成 durationSeconds），
// 而宿主 `generationPlanInputSchema` 的 `shots[]` 是 `.strict()`，这两个字段一个都不认。
// 分镜天生带标题和时长，于是这条路 100% 失败，用户看到的是「Agent 出不来分镜表」。
//
// 所以这条测试把**动词自己声明的示例**喂过翻译层、再喂进宿主 schema：两端对不上就当场红，
// 而不是等下一次真模型付费运行时才用一次失败告诉你。
test('动词 → 宿主契约贯通：声明的示例、以及真实分镜那种「字段填满」的调用，宿主都必须收得下', async () => {
  const { verbToTransportCall } = await import('../../electron/agentLane/laneVerbTransport.js');
  const { generationPlanInputSchema, generationStatusInputSchema } = await import('../../electron/shared/agentCapabilities/generationPlanSchemas.js');
  const { GENERATION_METHODS } = await import('../../electron/shared/agentCapabilities/generation.js');
  const { VERB_DECLARATIONS } = await import('../../electron/shared/agentCapabilities/verbDeclarations.js');
  type Parser = { safeParse: (value: unknown) => { success: boolean; error?: { issues: Array<{ path: Array<string | number>; message: string }> } } };
  const hostSchemaFor = (toolName: string): Parser | undefined =>
    toolName === GENERATION_METHODS.plan ? generationPlanInputSchema as unknown as Parser
      : toolName === GENERATION_METHODS.status ? generationStatusInputSchema as unknown as Parser
        : undefined;
  const failures: string[] = [];
  const check = (label: string, toolName: string, args: unknown): void => {
    const transported = verbToTransportCall({ toolCallId: 't-1', toolName, args });
    if (!transported) return;
    const hostSchema = hostSchemaFor(transported.call.toolName);
    if (!hostSchema) return;
    const parsed = hostSchema.safeParse(transported.call.args);
    if (parsed.success) return;
    const where = (parsed.error?.issues ?? []).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join(' · ');
    failures.push(`${label} 被宿主拒收：${where}`);
  };

  // ① 每个动词自己声明的示例（下限）。
  for (const verb of VERB_DECLARATIONS) {
    for (const [index, example] of (verb.examples ?? []).entries()) {
      check(`${verb.name} 示例 #${index + 1}`, verb.name, example.arguments);
    }
  }

  // ② 真实分镜那一形状（上限）。示例只证「照抄示例能过」，而 2026-09-18 真机失败的恰恰是
  //    示例没覆盖的那条路：**多镜 + 每镜带标题和时长**。分镜天生长这样，所以这条必须单列。
  check('draft_shots · 照剧本出分镜（多镜 + 标题 + 时长）', 'draft_shots', {
    shots: [
      { title: '锚 · 白色纸船', role: 'anchor', prompt: '白色纸船停在水盆里，中性背景', taskKind: 'text_to_image' },
      { title: '镜 1 · 全景', role: 'shot', prompt: '雨后清晨的窗边水盆，全景', taskKind: 'text_to_image', durationSec: 3 },
      { title: '镜 2 · 特写', role: 'shot', prompt: '纸船缓慢转向的特写', taskKind: 'text_to_image', durationSec: 3 },
    ],
  });

  assert.deepEqual(failures, [], `动词与宿主契约对不上：\n${failures.join('\n')}`);
});

// ── 「整份计划不能只有锚」这条约束，模型必须在发出调用之前就被告知 ──────────────
//
// 2026-09-18 真机 23 轮：`draft_shots` 剩余的 27 次失败里 **11 次**是它。而模型的意图完全正确——
// 它在做标准分镜流程，先单独立视觉锚再排镜头（标题写着「角色锚｜林野」「陈默·人物设定」），
// 那正是我们自己的导演技能教它的。宿主拦得对（锚 = 被别的镜头复用的参考卡，全是锚自相矛盾），
// 但那条拦截住在宿主里，模型只能撞上去才知道。6 次里 5 次靠错误信息自纠了，每次白费一个来回，
// 还有 1 次整轮没救回来。约束搬到动词面之后，它在调用发出前就知道（R17）。
test('draft_shots：只建参考卡（全是锚）是一条正常路径，动词面不拦', async () => {
  const { VERB_DECLARATIONS } = await import('../../electron/shared/agentCapabilities/verbDeclarations.js');
  const draftShots = VERB_DECLARATIONS.find((verb) => verb.name === 'draft_shots');
  assert.ok(draftShots, 'draft_shots 必须在动词表里');
  const parse = (args: unknown) => draftShots!.schema.safeParse(args) as
    { success: boolean; error?: { issues: Array<{ message: string; path: Array<string | number> }> } };

  // ① 全是锚 → **过**（2026-09-22 第二轮第 2 项，用户点名）：「先帮我把三个角色的参考卡建出来」是一条正常路径，
  //    不是一次拒绝。此前这里在动词面拒收，真实回合里模型因此连撞三次墙。落地侧的安静说明由
  //    `anchorsOnlyDraftIsAllowed.test.ts` 钉；这里只守「动词面不再拦」。
  const anchorsOnly = parse({ shots: [
    { role: 'anchor', prompt: '角色锚：林野，25 岁，短发' },
    { role: 'anchor', prompt: '场景锚：旧房子客厅，午后' },
  ] });
  assert.equal(anchorsOnly.success, true, `只建参考卡必须放行：${JSON.stringify(anchorsOnly.error?.issues ?? [])}`);

  // ② 锚 + 镜 → 过（这是我们教它的那条路，不能连带拦掉）
  assert.equal(parse({ shots: [
    { role: 'anchor', prompt: '角色锚：林野' },
    { role: 'shot', prompt: '镜 1：林野推开门' },
  ] }).success, true, '锚 + 镜是标准分镜写法，必须放行');

  // ③ 省掉 role → 过。**这条是合法用例的出路**：用户只要那几张参考图本身时，
  //    它们没有被任何镜头复用，就不是锚、是普通镜头。拦掉它等于禁掉「给我画三张定妆照」。
  assert.equal(parse({ shots: [
    { prompt: '定妆照一：正面' }, { prompt: '定妆照二：侧面' },
  ] }).success, true, '省掉 role 的纯图片计划必须放行');

  // ④ 改已有草稿那条路不受影响——它连 role 都不许带，本来就走另一条判据。
  const revise = parse({ operationId: 'op-1', shots: [{ shotId: 'shot-1', prompt: '改一下提示词' }] });
  assert.equal(revise.success, true, '改草稿这条路不该被新约束连带拦住');
});
