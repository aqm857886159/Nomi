// 切换后的回归比对：同一份 loopback 剧本，对照删前真实旧路的固定控制输出。
//
// 它在解决哪个真实摩擦：重做期间最贵的失败模式不是「新的坏了」，是**「新的和旧的悄悄不一样，
// 而没人知道哪个对」**。切换那天才发现差异，回滚面积已经是一整个 PR。所以影子期每一轮
// CI 都要回答一次：新通路读到的文字、调的工具、工具的结果、它们的顺序、以及这一轮花了多少，
// 和用户此刻真正走的那条路**一模一样**吗。不一样就红。
//
// 刻意只比**两条路都声称拥有**的东西。新通路多出来的（思考段、宿主领域记录、运行中状态）
// 不进比对——旧通路结构上就没有它们，拿它去比只能证明「新的多」，那不是这条门要证的。
// 旧路已删除；本测试不再声称运行两套宿主，控制输出的捕获身份随夹具保存。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, type TestContext } from 'node:test';

import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { type FixtureReply } from './httpFixture.mjs';
import { createDocumentPort, createLaneFixture, LANE_SYSTEM_PROMPT } from './laneFixture.mjs';
import type { LaneProjection } from '../../electron/shared/agentLane/laneContracts.js';
import { compareSteps, stepsOfProjection, stepsOfRecorded } from './replayShadowEngine.mjs';

test('replay shadow · task identity survives projection comparison and exposes unexpected domain facts', () => {
  const projection: LaneProjection = {
    lane: 'replay-task', running: false, queues: [],
    thinking: { supportedLevels: ['off'], level: 'off', canTurnOff: true },
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0,
      cost: { state: 'known', value: 0 }, contextTokens: { state: 'known', value: 0 },
      reasoningTokens: { state: 'known', value: 0 } },
    parts: [],
  };
  for (const operationId of [undefined, 'operation-1']) {
    const identity = { productionRunId: 'run-1', ...(operationId === undefined ? {} : { operationId }) };
    const expected = [{ kind: 'task', ...identity }];
    for (const facts of [undefined, { status: 'running' as const, progress: 37 }]) {
      const actual = stepsOfProjection({ ...projection, parts: [
        { kind: 'task', sequence: 0, entrySeq: 1, contentIndex: 0, ...identity,
          ...(facts === undefined ? {} : { facts }) },
      ] });
      assert.deepEqual(actual, expected, 'compare stable task identity, never changing domain facts');
      assert.deepEqual(compareSteps(stepsOfRecorded([]), actual), {
        index: 0, expected: '<missing>', actual: `task: run-1${operationId ? ` ${operationId}` : ''}`,
      }, 'an unexpected task must be a mismatch, not dropped or reported as a host note');
    }
  }
});

/** 两条路都能说出口的那几件事，写成一串可逐项比对的字符串。 */
type Beat = string;

const PROMPT = 'Read the document, then append one closing line.';

/** 夹具剧本：读 → 写 → 收尾一句话。三步覆盖「文字 / 工具调用 / 工具结果 / 顺序」四样。 */
function script(): FixtureReply[] {
  return [
    { type: 'tool', calls: [{ id: 'call-read', name: 'read_script', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'call-write', name: 'write_script', arguments: { where: 'end', content: '\n\nThe end.' } }] },
    { type: 'text', text: 'I read the document and appended the closing line.' },
  ];
}

// Frozen output from the actual retired runtime, never a copied runtime implementation.
const oldControl: { beats: Beat[]; promptTokens: number; completionTokens: number; costUsd?: number; text: string; documentText: string } =
  JSON.parse(readFileSync('tests/agent-runtime/fixtures/legacy-lane-control.json', 'utf8'));

async function documentText(port: ReturnType<typeof createDocumentPort>): Promise<string> {
  const read = await port.read('full') as { text: string };
  return read.text;
}

/** 新通路：从有序段里读出同一串节拍。 */
async function runNewPath(t: TestContext): Promise<{ beats: Beat[]; promptTokens: number; completionTokens: number; costUsd?: number; text: string; documentText: string }> {
  const fixture = await createLaneFixture(t, script());
  const { http, projectDir: dir } = fixture;
  const document = createDocumentPort();
  const lane = await fixture.openLane({ fetch: globalThis.fetch,
    projectDir: dir, systemPrompt: LANE_SYSTEM_PROMPT,
    model: { kind: 'openai-compatible', providerId: 'nomi-shadow', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    tools: createDocumentLaneTools(document),
  });
  await lane.execute({ kind: 'prompt', text: PROMPT });
  const projection = lane.projection();
  const beats: Beat[] = [];
  const texts: string[] = [];
  for (const part of projection.parts) {
    if (part.kind === 'assistant-text') { beats.push(`text:${part.text}`); texts.push(part.text); continue; }
    if (part.kind === 'tool-call') { beats.push(`call:${part.toolName}:${JSON.stringify(part.args)}`); continue; }
    if (part.kind === 'tool-result') { beats.push(`result:${part.toolName}:${part.isError ? 'error' : 'ok'}`); }
  }
  // 花费在新通路上是**三态**（`LaneMetric`），不是一个可选数字：这条影子对照只关心
  // 「两边都拿不到金额」这件事对不对得上，所以只在 `known` 时才给出数字。
  const cost = projection.usage.cost;
  return { beats, promptTokens: projection.usage.inputTokens, completionTokens: projection.usage.outputTokens,
    ...(cost.state === 'known' ? { costUsd: cost.value } : {}), text: texts.join(''), documentText: await documentText(document) };
}

test('shadow parity · the two paths see the same beats, in the same order', async (t) => {
  const [oldPath, newPath] = [oldControl, await runNewPath(t)];

  // 阳性对照先行：如果比对的两串都是空的，下面的 deepEqual 恒真，而它看起来和真绿一模一样。
  assert.ok(oldPath.beats.length >= 5, `the control arm produced beats: ${JSON.stringify(oldPath.beats)}`);

  assert.deepEqual(newPath.beats, oldPath.beats,
    'text, tool calls (with arguments), tool results and their order must match the path users walk today');
});

test('shadow parity · the two paths report the same assistant text', async (t) => {
  const [oldPath, newPath] = [oldControl, await runNewPath(t)];
  assert.equal(newPath.text, oldPath.text);
  assert.match(newPath.text, /appended the closing line/);
});

test('shadow parity · the two paths report the same spend', async (t) => {
  const [oldPath, newPath] = [oldControl, await runNewPath(t)];
  assert.equal(newPath.promptTokens, oldPath.promptTokens, 'input tokens are counted once, by the runtime, on both paths');
  assert.equal(newPath.completionTokens, oldPath.completionTokens);
  assert.ok(newPath.promptTokens > 0 && newPath.completionTokens > 0, 'a zero-token turn would make this comparison vacuous');
  // 价目相同（本夹具的模型没有价目，两边就都必须**没有**这个字段，而不是一边 0 一边 undefined）：
  // 0 和「没量到」在面板上是两句不同的话，我们不许在这条缝里把它们混成一句。
  assert.deepEqual(
    Object.prototype.hasOwnProperty.call(newPath, 'costUsd'),
    Object.prototype.hasOwnProperty.call(oldPath, 'costUsd'));
  assert.equal(newPath.costUsd, oldPath.costUsd);
});

test('shadow parity · lane preserves the captured old document effect', async (t) => {
  const actual = await runNewPath(t);
  assert.equal(actual.documentText, oldControl.documentText);
  assert.match(actual.documentText, /The end\.$/);
});
