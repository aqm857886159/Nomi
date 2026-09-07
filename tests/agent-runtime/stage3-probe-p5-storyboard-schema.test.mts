// 阶段 3 前置探针 **P5**（方案 §4.3）的零额度那两半：扁平版 `nomi_storyboard_write`
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

import { createCanvasLaneTools, type CanvasLanePort } from '../../electron/agentLane/laneCanvasTools.js';
import type { LaneToolDescriptor } from '../../electron/agentLane/laneRuntimePort.js';
import { createLaneTools } from '../../electron/agentLane/laneTools.mjs';
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createLaneFixture } from './laneFixture.mjs';

const TOOL = 'nomi_storyboard_write';
/** 方案 §4.3 P5 写的预算。 */
const TOKEN_BUDGET = 1_200;

const ANCHOR = { id: 'anchor-1', kind: 'character', name: '林夏', description: '17-year-old girl, short black hair, school uniform.', carrier: 'visual' };
const SHOTS = [
  { index: 1, shotKind: 'image', durationSec: 0, anchorIds: ['anchor-1'], prompt: 'Wide: she steps onto the rooftop, dusk light behind her.' },
  { index: 2, shotKind: 'video', durationSec: 4, anchorIds: ['anchor-1'], prompt: 'Slow push-in as she leans on the railing and exhales.' },
];
const PLAN = { operation: 'propose_storyboard_plan', title: '天台的三分钟', anchors: [ANCHOR], shots: SHOTS };

/** 三条畸形，都是 #547 §3.2 那一族（结构化值被二次序列化），各打在扁平 schema 的不同层。 */
const MALFORMED: ReadonlyArray<{ label: string; args: unknown; operation: string }> = [
  { label: 'A · whole argument object serialized as a JSON string', args: JSON.stringify(PLAN), operation: 'propose_storyboard_plan' },
  { label: 'B · `anchors` and `shots` arrays serialized as JSON strings', args: { ...PLAN, anchors: JSON.stringify([ANCHOR]), shots: JSON.stringify(SHOTS) }, operation: 'propose_storyboard_plan' },
  { label: 'B\' · `select` / `patch` objects serialized as JSON strings', args: { operation: 'patch_shots', select: JSON.stringify({ kind: 'indexes', indexes: [2, 3] }), patch: JSON.stringify({ shotKind: 'video', durationSec: 4 }) }, operation: 'patch_shots' },
];

function port(writes: unknown[]): CanvasLanePort {
  return {
    read: async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
    write: async (input) => {
      writes.push(input);
      const base = { applied: true as const, proposalId: 'proposal-1', result: {}, reconciliation: { ok: true, deviationCount: 0 } };
      if (input.operation === 'patch_shots') return { ...base, operation: 'patch_shots', changedShotIndexes: [2, 3], changedFields: ['shotKind', 'durationSec'] } as never;
      return { ...base, operation: input.operation } as never;
    },
  };
}

function withoutTolerance(descriptors: readonly LaneToolDescriptor[]): LaneToolDescriptor[] {
  return descriptors.map(({ prepareArguments: _dropped, ...rest }) => ({ ...rest }));
}

test('P5 ① · size of the flat nomi_storyboard_write schema, by pi\'s own estimator', () => {
  const tools = createLaneTools(createCanvasLaneTools(port([])));
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
  assert.deepEqual(properties, ['operation', 'title', 'anchors', 'shots', 'select', 'patch', 'nodeIds'], 'flat root: one enum + every branch field as optional');
  // 钉住今天的数：估计值已经**超过**方案写的 1 200。这不是让测试红，是让它在长得更大、
  // 或有人把预算当成已达成时红。真实 tokenizer 的数见 ③ 与研究文档。
  assert.ok(schemaTokens + descriptionTokens > TOKEN_BUDGET, `pi's estimate (${schemaTokens + descriptionTokens}) is over the §4.3 budget of ${TOKEN_BUDGET} — recorded as red in the probe report`);
  assert.ok(schemaTokens + descriptionTokens < 2_200, 'and it has not grown past the value the probe report was written against');
});

async function firstCallSucceeds(t: TestContext, arm: 'with-tolerance' | 'without-tolerance', args: unknown) {
  const writes: unknown[] = [];
  const tools = createCanvasLaneTools(port(writes));
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'first', name: TOOL, arguments: args }] },
    { type: 'text', text: 'Done.' },
  ]);
  const lane = await openLane({ ...fixture.options, tools: arm === 'with-tolerance' ? tools : withoutTolerance(tools) });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: 'Save the storyboard.' });
  const result = lane.projection().parts.find((part) => part.kind === 'tool-result' && part.toolCallId === 'first');
  assert.ok(result?.kind === 'tool-result');
  return { ok: !result.isError, text: result.text, writes };
}

for (const shape of MALFORMED) {
  test(`P5 ② · ${shape.label} passes prepareArguments → ajv → contract parse, and lands on the right operation`, async (t) => {
    const treated = await firstCallSucceeds(t, 'with-tolerance', shape.args);
    assert.equal(treated.ok, true, `first call is not an error: ${treated.text}`);
    assert.equal(treated.writes.length, 1, 'exactly one write reached the domain port');
    const written = treated.writes[0] as { operation: string; anchors?: unknown; shots?: unknown; select?: unknown; patch?: unknown };
    assert.equal(written.operation, shape.operation);
    if (written.operation === 'propose_storyboard_plan') {
      assert.ok(Array.isArray(written.anchors) && Array.isArray(written.shots), 'the arrays arrive as arrays, not JSON text');
      assert.deepEqual(written.shots, SHOTS);
    } else {
      assert.deepEqual(written.select, { kind: 'indexes', indexes: [2, 3] });
      assert.deepEqual(written.patch, { shotKind: 'video', durationSec: 4 });
    }

    // 阳性对照：没有容忍钩子，同一条调用必须被拒——否则上面那个绿证明不了容忍在起作用。
    const control = await firstCallSucceeds(t, 'without-tolerance', shape.args);
    assert.equal(control.ok, false, 'the control arm (no prepareArguments) rejects the same call');
    assert.equal(control.writes.length, 0, 'and nothing reached the domain port');
  });
}
