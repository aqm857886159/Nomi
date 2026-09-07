// **影子比对**：同一份 loopback 夹具喂给新旧两条通路，逐项断言两边看到的是同一件事。
//
// 它在解决哪个真实摩擦：重做期间最贵的失败模式不是「新的坏了」，是**「新的和旧的悄悄不一样，
// 而没人知道哪个对」**。切换那天才发现差异，回滚面积已经是一整个 PR。所以影子期每一轮
// CI 都要回答一次：新通路读到的文字、调的工具、工具的结果、它们的顺序、以及这一轮花了多少，
// 和用户此刻真正走的那条路**一模一样**吗。不一样就红。
//
// 刻意只比**两条路都声称拥有**的东西。新通路多出来的（思考段、宿主领域记录、运行中状态）
// 不进比对——旧通路结构上就没有它们，拿它去比只能证明「新的多」，那不是这条门要证的。
// 旧通路一行未改；这里也只**读**它。
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { z } from 'zod';

import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import type { RuntimeActivityEvent, RuntimeTurnRequest } from '../../electron/harness/runtime/runtimePort.js';
import { createHttpFixture, type FixtureReply } from './httpFixture.mjs';
import { createDocumentPort, LANE_SYSTEM_PROMPT } from './laneFixture.mjs';

/** 两条路都能说出口的那几件事，写成一串可逐项比对的字符串。 */
type Beat = string;

const PROMPT = 'Read the document, then append one closing line.';

/** 夹具剧本：读 → 写 → 收尾一句话。三步覆盖「文字 / 工具调用 / 工具结果 / 顺序」四样。 */
function script(): FixtureReply[] {
  return [
    { type: 'tool', calls: [{ id: 'call-read', name: 'read_full_text', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'call-write', name: 'append_to_end', arguments: { content: '\n\nThe end.' } }] },
    { type: 'text', text: 'I read the document and appended the closing line.' },
  ];
}

async function projectDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nomi-shadow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 旧通路：从它自己的活动事件流里读出同一串节拍。**不碰它一行代码，只订阅。** */
async function runOldPath(t: TestContext): Promise<{ beats: Beat[]; promptTokens: number; completionTokens: number; costUsd?: number; text: string }> {
  const http = await createHttpFixture(script());
  t.after(http.close);
  const dir = await projectDir(t);
  const document = createDocumentPort();
  const request: RuntimeTurnRequest = {
    cwd: dir, agentDir: join(dir, 'agent'), tempRoot: join(dir, 'scratch'),
    systemPrompt: LANE_SYSTEM_PROMPT,
    model: { kind: 'openai-compatible', providerId: 'nomi-shadow', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    user: { durableText: PROMPT },
    tools: [
      { name: 'read_full_text', description: 'Read the entire creation document as plain text.', schema: z.object({}).strict() },
      { name: 'append_to_end', description: 'Append text to the very end of the creation document.',
        schema: z.object({ content: z.string().min(1) }).strict() },
    ],
    capability: { maxSteps: 8 }, compaction: { enabled: false },
  };
  const beats: Beat[] = [];
  let pending = '';
  const flush = () => { if (pending) { beats.push(`text:${pending}`); pending = ''; } };
  const events: RuntimeActivityEvent[] = [];
  const result = await runAgentTurn(request, {
    emit: (event) => {
      events.push(event);
      if (event.type === 'content-delta') { pending += event.delta; return; }
      if (event.type === 'tool-call') { flush(); beats.push(`call:${event.toolName}:${JSON.stringify(event.args)}`); return; }
      if (event.type === 'tool-result') { flush(); beats.push(`result:${event.toolName}:ok`); }
      if (event.type === 'tool-error') { flush(); beats.push(`result:${event.toolName}:error`); }
    },
    // 旧通路的约定是「宿主已经执行了动作，运行时只等结果」。这里就是那个宿主。
    awaitToolConfirmation: async (call) => {
      if (call.toolName === 'read_full_text') return { ok: true, result: { text: await documentText(document) } };
      const { content } = call.args as { content: string };
      return { ok: true, result: await document.write({ operation: 'append', content }) };
    },
  });
  flush();
  assert.equal(result.status, 'finished', 'the old path is the control arm; a broken control proves nothing');
  return { beats, promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
    ...(result.usage.costUsd === undefined ? {} : { costUsd: result.usage.costUsd }), text: result.text };
}

async function documentText(port: ReturnType<typeof createDocumentPort>): Promise<string> {
  const read = await port.read('full') as { text: string };
  return read.text;
}

/** 新通路：从有序段里读出同一串节拍。 */
async function runNewPath(t: TestContext): Promise<{ beats: Beat[]; promptTokens: number; completionTokens: number; costUsd?: number; text: string }> {
  const http = await createHttpFixture(script());
  t.after(http.close);
  const dir = await projectDir(t);
  const document = createDocumentPort();
  const lane = await openLane({
    projectDir: dir, systemPrompt: LANE_SYSTEM_PROMPT,
    model: { kind: 'openai-compatible', providerId: 'nomi-shadow', modelId: 'chosen-model',
      baseURL: http.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    tools: createDocumentLaneTools(document),
  });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: PROMPT });
  const projection = lane.projection();
  const beats: Beat[] = [];
  const texts: string[] = [];
  for (const part of projection.parts) {
    if (part.kind === 'assistant-text') { beats.push(`text:${part.text}`); texts.push(part.text); continue; }
    if (part.kind === 'tool-call') { beats.push(`call:${part.toolName}:${JSON.stringify(part.args)}`); continue; }
    if (part.kind === 'tool-result') { beats.push(`result:${part.toolName}:${part.isError ? 'error' : 'ok'}`); }
  }
  return { beats, promptTokens: projection.usage.inputTokens, completionTokens: projection.usage.outputTokens,
    ...(projection.usage.costUsd === undefined ? {} : { costUsd: projection.usage.costUsd }), text: texts.join('') };
}

test('shadow parity · the two paths see the same beats, in the same order', async (t) => {
  const [oldPath, newPath] = [await runOldPath(t), await runNewPath(t)];

  // 阳性对照先行：如果比对的两串都是空的，下面的 deepEqual 恒真，而它看起来和真绿一模一样。
  assert.ok(oldPath.beats.length >= 5, `the control arm produced beats: ${JSON.stringify(oldPath.beats)}`);

  assert.deepEqual(newPath.beats, oldPath.beats,
    'text, tool calls (with arguments), tool results and their order must match the path users walk today');
});

test('shadow parity · the two paths report the same assistant text', async (t) => {
  const [oldPath, newPath] = [await runOldPath(t), await runNewPath(t)];
  assert.equal(newPath.text, oldPath.text);
  assert.match(newPath.text, /appended the closing line/);
});

test('shadow parity · the two paths report the same spend', async (t) => {
  const [oldPath, newPath] = [await runOldPath(t), await runNewPath(t)];
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

test('shadow parity · the two paths leave the document in the same state', async (t) => {
  // 节拍一致但效果不一致，是最难发现的那种不一致：面板上两边长得一模一样，
  // 而只有一边真的改了用户的文稿。
  const oldDocument = createDocumentPort();
  const newDocument = createDocumentPort();
  await runBoth(t, oldDocument, newDocument);
  assert.equal(await documentText(newDocument), await documentText(oldDocument));
  assert.match(await documentText(newDocument), /The end\.$/);
});

/** 同一份剧本、两个独立文稿端口，跑完比状态。抽出来是因为上面那条门要的是**效果**不是节拍。 */
async function runBoth(
  t: TestContext,
  oldDocument: ReturnType<typeof createDocumentPort>,
  newDocument: ReturnType<typeof createDocumentPort>,
): Promise<void> {
  const oldHttp = await createHttpFixture(script());
  t.after(oldHttp.close);
  const oldDir = await projectDir(t);
  await runAgentTurn({
    cwd: oldDir, agentDir: join(oldDir, 'agent'), tempRoot: join(oldDir, 'scratch'),
    systemPrompt: LANE_SYSTEM_PROMPT,
    model: { kind: 'openai-compatible', providerId: 'nomi-shadow', modelId: 'chosen-model',
      baseURL: oldHttp.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    user: { durableText: PROMPT },
    tools: [
      { name: 'read_full_text', description: 'Read the entire creation document as plain text.', schema: z.object({}).strict() },
      { name: 'append_to_end', description: 'Append text to the very end of the creation document.',
        schema: z.object({ content: z.string().min(1) }).strict() },
    ],
    capability: { maxSteps: 8 }, compaction: { enabled: false },
  }, {
    emit: () => {},
    awaitToolConfirmation: async (call) => {
      if (call.toolName === 'read_full_text') return { ok: true, result: { text: await documentText(oldDocument) } };
      const { content } = call.args as { content: string };
      return { ok: true, result: await oldDocument.write({ operation: 'append', content }) };
    },
  });

  const newHttp = await createHttpFixture(script());
  t.after(newHttp.close);
  const newDir = await projectDir(t);
  const lane = await openLane({
    projectDir: newDir, systemPrompt: LANE_SYSTEM_PROMPT,
    model: { kind: 'openai-compatible', providerId: 'nomi-shadow', modelId: 'chosen-model',
      baseURL: newHttp.baseURL, authType: 'api-key', apiKey: 'fixture-key' },
    tools: createDocumentLaneTools(newDocument),
  });
  t.after(() => lane.close());
  await lane.execute({ kind: 'prompt', text: PROMPT });
}
