// 阶段 3 前置探针 **P5**（方案 §4.3）的零额度那两半：分镜写动词（20 动词起是 `draft_shots`）
// ① 有多大（token）② 三条真机见过的畸形参数经 `prepareArguments` 能不能过。
// ③（真实模型三次调用、首调 operation 命中率）在 `stage3-probe-p5-real.electron.mts`，
// 它要 Electron 的 safeStorage 才读得到 app 设置里的 key，不在这个 runner 里跑。
//
// ① 的数字是**估计**：pi 自己的 `estimateTokens`（保守的字符启发式）。真实 tokenizer 的数
// 由 ③ 用「带 / 不带这个工具」两次请求的 prompt_tokens 之差量出来，写进研究文档；这里只钉
// 「今天的估计值」，让它长大时有人看见。
// ② 带阳性对照：同一批畸形喂给摘掉 `prepareArguments` 的对照臂，必须红。
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { estimateTokens } from '@earendil-works/pi-agent-core';

import { createExtendedLaneTools, type LaneExtendedPort } from '../../electron/agentLane/laneExtendedTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { createLaneFixture } from './laneFixture.mjs';

const TOOL = 'draft_shots';
/**
 * 方案 §4.3 P5 写的预算。2026-09-12 由 1_200 提到 1_220：整片默认画幅贯通给 plan 顶层加了
 * `aspectRatio`（实测 schema 4673 → 4765 chars，估计 1_192 → 1_215 tokens，字段本身 92 chars ≈ 23 tokens）。
 * 为什么不压回 1_200：这个字段**不能更便宜**——它是 `.strict()` envelope 上唯一能写整片画幅的位置
 * （少它则规划师写的整片画幅在主进程边界被拒收，正是 2026-09-12 根因合同的第一格），
 * 而压预算的另外两条路都是症状修法：删别的字段/enum（契约变窄）或删工具描述（那 92 chars 也是 23 tokens）。
 * 这条断言的本意是「长大时有人看见」（见文件头），所以按看得见的方式记账：涨了 23，预算留 5 的余量。
 */
const TOKEN_BUDGET = 1_220;

const SHOTS = [
  { title: '天台', prompt: 'Wide: she steps onto the rooftop, dusk light behind her.', taskKind: 'text_to_image' },
  { title: '栏杆', prompt: 'Slow push-in as she leans on the railing and exhales.', taskKind: 'text_to_video', durationSec: 4 },
];
const PLAN = { shots: SHOTS };

/** 三条畸形，都是 #547 §3.2 那一族（结构化值被二次序列化），各打在扁平 schema 的不同层。 */
const MALFORMED: ReadonlyArray<{ label: string; args: unknown }> = [
  { label: 'A · whole argument object serialized as a JSON string', args: JSON.stringify(PLAN) },
  { label: 'B · `shots` array serialized as a JSON string', args: { shots: JSON.stringify(SHOTS) } },
  { label: 'C · a single shot object where the array goes', args: { shots: SHOTS[0] } },
];

function port(writes: unknown[]): LaneExtendedPort {
  return {
    execute: async (call) => { writes.push(call.args); return { ok: true, result: { operation: { operationId: 'op-1', state: 'draft', cardHidden: true } } }; },
  };
}

function withoutTolerance(descriptors: readonly LaneToolDescriptor[]): LaneToolDescriptor[] {
  return descriptors.map(({ prepareArguments: _dropped, ...rest }) => ({ ...rest }));
}

test('P5 ① · size of the draft_shots schema, by pi\'s own estimator', () => {
  const tools = createLaneTools(createExtendedLaneTools(port([])));
  const storyboard = tools.find((tool) => tool.name === TOOL);
  assert.ok(storyboard, `${TOOL} is on the lane`);
  const estimate = (text: string) => estimateTokens({ role: 'user', content: [{ type: 'text', text }], timestamp: 0 });
  const schema = JSON.stringify(storyboard.parameters);
  const schemaTokens = estimate(schema);
  const descriptionTokens = estimate(storyboard.description);
  console.log(`[P5①] ${TOOL}: schema ${schema.length} chars ≈ ${schemaTokens} tokens · description ${storyboard.description.length} chars ≈ ${descriptionTokens} tokens · total ≈ ${schemaTokens + descriptionTokens} (budget ${TOKEN_BUDGET})`);
  for (const tool of tools) {
    const size = estimate(JSON.stringify(tool.parameters)) + estimate(tool.description);
    console.log(`[P5①]   ${tool.name}: ≈ ${size} tokens`);
  }
  const properties = Object.keys((storyboard.parameters as { properties: Record<string, unknown> }).properties);
  assert.deepEqual(properties, ['draftId', 'taskKind', 'candidate', 'shots'], 'draft_shots root: the draft to revise, per-draft defaults, and the shots');
  // B1c moves full guidance/examples into the stable system prompt; the budget above records
  // the one deliberate growth since (film-level aspectRatio), not prose creeping back in.
  assert.ok(schemaTokens + descriptionTokens <= TOKEN_BUDGET,
    `pi's estimate (${schemaTokens + descriptionTokens}) must stay within the original ${TOKEN_BUDGET} budget`);
});

async function firstCallSucceeds(t: TestContext, arm: 'with-tolerance' | 'without-tolerance', args: unknown) {
  const writes: unknown[] = [];
  const tools = createExtendedLaneTools(port(writes));
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'first', name: TOOL, arguments: args }] },
    { type: 'text', text: 'Done.' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, tools: arm === 'with-tolerance' ? tools : withoutTolerance(tools) });
  await lane.execute({ kind: 'prompt', text: 'Save the storyboard.' });
  const result = lane.projection().parts.find((part) => part.kind === 'tool-result' && part.toolCallId === 'first');
  assert.ok(result?.kind === 'tool-result');
  return { ok: !result.isError, text: result.text, writes };
}

for (const shape of MALFORMED) {
  test(`P5 ② · ${shape.label} passes prepareArguments → ajv, and the shots arrive as an array`, async (t) => {
    const treated = await firstCallSucceeds(t, 'with-tolerance', shape.args);
    assert.equal(treated.ok, true, `first call is not an error: ${treated.text}`);
    assert.equal(treated.writes.length, 1, 'exactly one write reached the domain port');
    const written = treated.writes[0] as { shots?: unknown };
    assert.ok(Array.isArray(written.shots), 'the shots arrive as an array, not JSON text');
    assert.deepEqual(written.shots, shape.label.startsWith('C') ? [SHOTS[0]] : SHOTS);

    // 阳性对照：没有容忍钩子，同一条调用必须被拒——否则上面那个绿证明不了容忍在起作用。
    const control = await firstCallSucceeds(t, 'without-tolerance', shape.args);
    assert.equal(control.ok, false, 'the control arm (no prepareArguments) rejects the same call');
    assert.equal(control.writes.length, 0, 'and nothing reached the domain port');
  });
}
