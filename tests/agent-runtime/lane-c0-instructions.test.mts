import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createExtendedLaneTools } from '../../electron/agentLane/laneExtendedTools.js';
import { createLaneFixture } from './laneFixture.mjs';

const title = '日落前的一分钟';
const shot = { title, prompt: '小禾合上电脑，看夕阳。', taskKind: 'text_to_video', durationSec: 8 };
const plan = { shots: [shot] };
const skill = () => readFile(path.resolve('skills/workbench-storyboard-planner/SKILL.md'), 'utf8');

async function run(t: Parameters<typeof createLaneFixture>[0], args: unknown[], systemPrompt: string) {
  const writes: unknown[] = [];
  const fixture = await createLaneFixture(t, [
    ...args.map((arguments_, i) => ({ type: 'tool' as const, calls: [{ id: `c0-${i}`, name: 'draft_shots', arguments: arguments_ }] })),
    { type: 'text', text: '分镜草稿已建好。' },
  ]);
  const lane = await fixture.openLane({ ...fixture.options, systemPrompt, tools: createExtendedLaneTools({
    execute: async (call) => { writes.push(call.args); return { ok: true, result: { operation: { operationId: 'c0-draft', state: 'draft', cardHidden: true } } }; },
  }) });
  await lane.execute({ kind: 'prompt', text: `标题保持“${title}”，八镜各八秒。` });
  return { writes, bodies: fixture.http.requests.map((r) => r.body), parts: lane.projection().parts };
}

test('C0 operation: active schema and skill agree; native rejection heals before exactly one write', async (t) => {
  const { shots: _omitted, ...missing } = plan;
  const result = await run(t, [{ ...missing, summary: '八镜分镜' }, plan], await skill());
  assert.equal(result.writes.length, 1);
  assert.match(JSON.stringify(result.bodies[1]), /required properties shots/);
  assert.match(JSON.stringify(result.bodies[1]), /must not have additional properties/);
  const first = JSON.stringify(result.bodies[0]);
  const wire = result.bodies[0] as { tools: Array<{ function: { name: string; parameters: { required: string[] } } }> };
  const tool = wire.tools.find((entry) => entry.function.name === 'draft_shots');
  assert.ok(tool, 'draft_shots is visible on the first request, without group activation.');
  assert.deepEqual(tool.function.parameters.required, ['shots']);
  assert.match(first, /shots 必填/);
  assert.doesNotMatch(first, /参数就是整份方案 `\{ title, anchors, shots \}`/);
  assert.doesNotMatch(first, /nomi_storyboard_write|propose_storyboard_plan/);
});

test('C0 language: planner skill removes English mandate and retains authored title guidance', async (t) => {
  const body = await skill();
  for (const prompt of [body]) {
    const result = await run(t, [plan], prompt);
    const wire = JSON.stringify(result.bodies[0]);
    assert.doesNotMatch(wire, /(?:Produce|produce) the entire storyboard plan in English/);
    // 「Opening」现在是 draft_shots 工具示例里的镜头标题（合法），不再当英文强制的证据。
    assert.doesNotMatch(wire, /一条简洁的英文方案名|必须中文/);
    assert.match(wire, /保持原文/);
    assert.deepEqual(result.writes, [plan]);
  }
});

test('C0 settings: explicit catalog choices survive and unspecified settings stay optional', async (t) => {
  const explicit = { shots: [{ ...shot, modelKey: 'catalog-video', parameters: { resolution: '768P', aspect_ratio: '16:9' } }] };
  const result = await run(t, [explicit, plan], await skill());
  assert.deepEqual(result.writes, [explicit, plan]);
  const wire = JSON.stringify(result.bodies[0]);
  assert.match(wire, /用户已指定/);
  assert.match(wire, /未指定/);
  assert.equal(result.parts.filter((p) => p.kind === 'tool-result' && p.isError).length, 0);
});
