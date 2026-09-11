// 阶段 3d 的验收门 G3e（方案 §1.3 / §1.4 规则三）：插话的队列。
//
// ── 这一族在防什么 ──
// 用户在模型跑着的时候连打三句话。pi 的默认排队模式是 `"all"`——下一次模型请求会把三句
// **一起**注入同一轮。测试里看不出区别（三句都到了模型那里），线上区别是致命的：
// 三条指令的效果搅进同一批改动，用户看不出哪一句造成了哪一处，也没法只撤其中一句。
// 所以这一族的核心断言不是「三句都送到了」，是「**第二次请求里只有第一句**」。
//
// 三条踩过的坑各有一条断言：
//   · `already_consumed` 不是 `cancelled`：用户点了撤回，而它上一次请求前刚被吃进去了。
//   · `kind:"write"` 不是排队的用户消息：那是宿主自己等着落盘的记录（§1.4 规则三）。
//   · 按停止时没送出去的话要**回到输入框**（G3b② 的非空侧，3a 只钉了空侧）。
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';

import type { LaneSnapshot } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';

import { projectLaneSnapshot, type LaneModelFacts } from '../../electron/shared/agentLane/laneProjection.js';
import type { LaneToolDescriptor, LaneApprovalOptions } from '../../electron/agentLane/laneRuntimePort.js';
import { LANE_APPROVAL_NOTE_TYPE, type LaneProjection } from '../../electron/shared/agentLane/laneContracts.js';
import { LANE_READ_TOOL_TIMEOUT_MS } from '../../electron/shared/agentLane/laneToolContract.js';
import { createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

/** 「每步问」：让写入必然停下来等人。abort 那条要一个稳定的等待点。 */
const STEP: LaneApprovalOptions = { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) };

/**
 * 一个**被测试握住**的工具：模型一调它就停在那儿，直到测试放行。
 *
 * 为什么需要它：要证明「一次请求只吃一句」，就得在两次请求之间有一个我们说了算的窗口，
 * 好把三句话打进去。靠 sleep 制造这个窗口是 R18 明令禁止的墙钟等待，而且它证不了顺序——
 * 这里的闸是因果的：`entered` 落定 = 模型确实在等这个工具。
 */
function heldTool(name: string) {
  let letGo: (() => void) | undefined;
  let announceEntry: (() => void) | undefined;
  let entered = new Promise<void>((resolve) => { announceEntry = resolve; });
  let held = new Promise<void>((resolve) => { letGo = resolve; });
  const tool: LaneToolDescriptor = {
    name,
    contractId: 'document.read',
    description: 'Reads the document, but only returns once the test lets it go.',
    promptSnippet: 'read the document.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
    effect: 'read',
    // 读类预算。这个工具会一直卡到测试放行它，所以预算大小不影响这一族——
    // 但契约要求每个工具都说出自己的上限（3c 的工具级超时），不许留空。
    execution: { timeoutMs: LANE_READ_TOOL_TIMEOUT_MS },
    schema: z.object({}).strict(),
    examples: [{ when: 'Call it with no arguments:', arguments: {} }],
    execute: async () => {
      announceEntry?.();
      await held;
      return { ok: true, text: 'The opening scene.' };
    },
  };
  return {
    tool,
    /** 模型已经调到这个工具、正卡在里面。 */
    entered: () => entered,
    /** 放行这一次调用，并为下一次重新上闸。 */
    release: () => {
      letGo?.();
      entered = new Promise<void>((resolve) => { announceEntry = resolve; });
      held = new Promise<void>((resolve) => { letGo = resolve; });
    },
  };
}

/** 每次模型请求里，用户角色说过的话。one-at-a-time 的判据就是这个数怎么长。 */
function userTextsPerRequest(requests: readonly { body: Record<string, unknown> }[]): string[][] {
  return requests.map((request) => {
    const messages = request.body.messages as Array<{ role: string; content?: unknown }> | undefined;
    return (messages ?? [])
      .filter((message) => message.role === 'user')
      .map((message) => (typeof message.content === 'string' ? message.content
        : Array.isArray(message.content)
          ? message.content.map((part: { text?: string }) => part.text ?? '').join('')
          : ''));
  });
}

const HOLD = (id: string) => ({ type: 'tool' as const, calls: [{ id, name: 'held_read', arguments: {} }] });
const CLOSING = { type: 'text' as const, text: 'Done.' };

test('G3e · one-at-a-time：连打三句，三轮各吃一句（默认的 "all" 会一次全灌进去）', async (t: TestContext) => {
  const held = heldTool('held_read');
  const fixture = await createLaneFixture(t, [HOLD('c1'), HOLD('c2'), HOLD('c3'), CLOSING]);
  const lane = await fixture.openLane({ ...fixture.options, tools: [held.tool] });

  const run = lane.execute({ kind: 'prompt', text: 'Read it.' });
  // 模型已经卡在工具里 = 第一次请求已经发过了，而第二次还没发。三句话打在这个窗口里。
  await held.entered();
  const queued = [];
  for (const text of ['一句', '两句', '三句']) {
    queued.push(await lane.execute({ kind: 'steer', text }));
  }

  // 队列在投影里看得见，顺序就是用户打字的顺序，每条都带着 pi 铸的 entryId。
  const waiting = lane.projection().queues;
  assert.deepEqual(waiting.map((item) => item.text), ['一句', '两句', '三句']);
  assert.deepEqual(waiting.map((item) => item.kind), ['steer', 'steer', 'steer']);
  assert.deepEqual(waiting.map((item) => item.entryId), queued.map((outcome) => outcome.queuedEntryId),
    '排队时回给渲染层的 id 就是队列里那条的 id —— 没有它，撤回只能靠「队里最后一条」去猜');

  held.release();
  await held.entered();
  held.release();
  await held.entered();
  held.release();
  await run;

  const perRequest = userTextsPerRequest(fixture.http.requests);
  const said = perRequest.map((texts) => ['一句', '两句', '三句'].filter((line) => texts.includes(line)).length);
  // 第一次请求：只有原始提示词。之后每一次**多一句**——这就是 one-at-a-time。
  // 阳性对照写在断言里：`"all"` 下这串是 [0, 3, 3, 3]，与下面这串一眼可分。
  assert.deepEqual(said, [0, 1, 2, 3],
    '每次模型请求只多吃一句；一次吃三句 = steeringMode 退回了 pi 的默认 "all"');
  assert.deepEqual(lane.projection().queues, [], '三句都被吃掉之后队列是空的');
});

test('G3e · 撤回排队插话的三态：撤回成功 / 晚了一步 / 根本不在队里', async (t: TestContext) => {
  const held = heldTool('held_read');
  const fixture = await createLaneFixture(t, [HOLD('c1'), HOLD('c2'), CLOSING]);
  const lane = await fixture.openLane({ ...fixture.options, tools: [held.tool] });

  const run = lane.execute({ kind: 'prompt', text: 'Read it.' });
  await held.entered();
  const first = await lane.execute({ kind: 'steer', text: '先说的' });
  const second = await lane.execute({ kind: 'steer', text: '后说的' });

  // ① 还没轮到它 → 真的撤回了，队列里少一条。
  const cancelled = await lane.execute({ kind: 'cancel-queued', entryId: second.queuedEntryId! });
  assert.equal(cancelled.cancelQueued, 'cancelled');
  assert.deepEqual(lane.projection().queues.map((item) => item.text), ['先说的']);

  // ② 队列里从来没有过这条 id。**不是**一次成功的撤回——它是「你手上那份队列过期了」。
  const missing = await lane.execute({ kind: 'cancel-queued', entryId: 'entry-that-never-existed' });
  assert.equal(missing.cancelQueued, 'not_found');

  // ③ 晚了一步：放行工具 → 下一次请求把「先说的」吃进去了，此时再撤回。
  held.release();
  await held.entered();
  assert.deepEqual(lane.projection().queues, [], '它已经不在队里了 —— 因为它已经被送出去了');
  const late = await lane.execute({ kind: 'cancel-queued', entryId: first.queuedEntryId! });
  assert.equal(late.cancelQueued, 'already_consumed',
    '「它已经听见了」和「已撤回」是两句相反的话；折成一个布尔就只能说错其中一句');

  held.release();
  await run;
});

test('G3b② 非空侧 · 按停止：没送出去的那句话回到输入框，不是被丢掉', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'call-append', name: 'append_to_end', arguments: { content: ' and then she left.' } }] },
    CLOSING,
  ], STEP);
  const lane = await fixture.openLane(fixture.options);

  const run = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  await new Promise<void>((resolve) => {
    const stop = lane.subscribe((projection: LaneProjection) => { if (projection.pending) { stop(); resolve(); } });
  });

  // 用户一边等着答那张卡，一边又打了一句给下一步的话，然后按了停止。
  await lane.execute({ kind: 'steer', text: '横屏，不要竖的' });
  const outcome = await lane.execute({ kind: 'abort' });
  await run.catch(() => undefined);

  assert.deepEqual(outcome.restoredInput, [{ text: '横屏，不要竖的' }],
    'AbortResult 里那条没被消费的插话必须交回调用方 —— 抄 pi TUI 的 restoreQueuedMessagesToEditor');
  // 阳性对照在 3a：没有排队插话时 `restoredInput` **缺席**，不是一个空数组。
});

// ── §1.4 规则三：`kind:"write"` 不是排队的用户消息 ──────────────────────────────
//
// 这一条只能用合成快照钉：真机上要制造「等待期队列里同时躺着一条 write 和一条 steer」
// 需要精确的时序，而时序一抖，测试红的就是时序不是规则。合成快照把规则单独拎出来，
// 阳性对照就在同一份快照里——两条并排，一条该画一条不该画。

const AT = 1_757_154_000_000;
const FACTS: LaneModelFacts = {
  // 只有 `off` 一档 = 不会思考的模型（pi 对 `reasoning: false` 算出来的就是这一个）。
  supportedThinkingLevels: ['off'],
  pricing: 'unpriced',
};
const USAGE = { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 14,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function snapshotWithQueues(queues: LaneSnapshot['queues']): LaneSnapshot {
  const message: AssistantMessage = {
    role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }],
    api: 'openai-completions', provider: 'nomi-lane', model: 'fixture-model',
    usage: USAGE, stopReason: 'stop', timestamp: AT,
  };
  return {
    lane: 'main',
    transcript: [{ id: 'e1', parentId: null, seq: 1, timestamp: AT, type: 'message', message }],
    tipId: 'e1',
    configuration: { model: { provider: 'nomi-lane', modelId: 'fixture-model' }, thinkingLevel: 'off', activeToolNames: [] },
    stats: { messageCount: 1, usage: USAGE },
    operation: { id: 'op-1', kind: 'run', startedAt: AT, fromTipId: null, status: 'running', runningTools: [] },
    queues,
    faulted: false,
  };
}

test('§1.4 规则三 · 等着落盘的宿主记录不画成排队的用户消息', () => {
  const projection = projectLaneSnapshot(snapshotWithQueues([
    // 宿主自己那条审批记录：pi 把操作进行中的 appendCustomEntry 排进**同一个** inbox。
    { entryId: 'w-1', kind: 'write', type: 'custom', customType: LANE_APPROVAL_NOTE_TYPE,
      data: { toolCallId: 'call-1', toolName: 'append_to_end', decision: 'denied' } },
    // 阳性对照：紧挨着的一条真插话。少了它，一个「什么都不画」的实现也能通过上面那句。
    { entryId: 'q-1', kind: 'steer', type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: '横屏' }], timestamp: AT } },
    // 另一条 write，这次是消息形态的（pi 的联合体两种都有）。同样不画。
    { entryId: 'w-2', kind: 'write', type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: 'host bookkeeping' }], timestamp: AT } },
  ]), FACTS);

  assert.deepEqual(projection.queues, [{ entryId: 'q-1', kind: 'steer', text: '横屏' }],
    'write 是「宿主等着落盘的记录」，画成排队指令 = 用户在队列里读到一句他从没打过的话');
});

test('nextRun 今天没人发，但它照样被投影 —— 排在队里却看不见的话，用户取消不了', () => {
  const projection = projectLaneSnapshot(snapshotWithQueues([
    { entryId: 'n-1', kind: 'nextRun', type: 'message',
      message: { role: 'user', content: [{ type: 'text', text: '下一轮再说' }], timestamp: AT } },
  ]), FACTS);
  assert.deepEqual(projection.queues, [{ entryId: 'n-1', kind: 'next-run', text: '下一轮再说' }]);
});
