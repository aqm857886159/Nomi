// 阶段 3a 的验收门（方案 §1.8 G3a / G3b）。
//
// 这里跑的是**真 lane**：真 pi 循环、真会话落盘、真 `before_tool`、真 HTTP 端点。
// 只有远端模型是假的。判据那一半（哪个动作该不该问）在
// `electron/shared/agentLane/laneApproval.test.ts`——纯函数，不需要这一层。
//
// 三条断言是「先红才有意义」的那一类，各自的阳性对照写在测试里：
//   G3a  审批模块自己坏了 → 拒，工具没跑，模型收到那句话；
//   G3b① 等待期零模型请求、工具没进过领域端口（= 3c 的超时计时器根本没被 arm）；
//   G3b② 按停止 → pi 自己的 cancelled 结果 + 一条 `cancelled` 记录落进同一条转录；
//   G3b③ 崩溃重启 → 卡不复活，那次调用被取消，模型读到「再发一次」。
import assert from 'node:assert/strict';
import { spawnLaneCrashChild } from './laneCrashFixture.mjs';
import test, { type TestContext } from 'node:test';
import { z } from 'zod';

import { LANE_APPROVAL_NOTE_TYPE, isLaneApprovalNote, type LaneProjection }
  from '../../electron/shared/agentLane/laneContracts.js';
import { LANE_WRITE_TOOL_TIMEOUT_MS } from '../../electron/shared/agentLane/laneToolContract.js';
import type { LaneApprovalOptions } from '../../electron/agentLane/laneRuntimePort.js';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createDocumentPort, createLaneFixture, FIXTURE_DESCRIBE } from './laneFixture.mjs';

const APPEND = { type: 'tool' as const, calls: [{ id: 'call-append', name: 'write_script', arguments: { where: 'end', content: ' and then she left.' } }] };
const CLOSING = { type: 'text' as const, text: 'Done.' };

/** 「每步问」：让文稿写入必然停下来等人，不靠某个能力恰好是硬闸。 */
const STEP: LaneApprovalOptions = { hasUserInterface: true, policy: () => ({ mode: 'step', spend: 'confirm' }) };

/** 等到投影里出现一张卡。**不用墙钟**：订阅推送，R18 的那条纪律。 */
function firstPending(lane: { subscribe(listener: (projection: LaneProjection) => void): () => void; projection(): LaneProjection }) {
  const now = lane.projection().pending;
  if (now) return Promise.resolve(now);
  return new Promise<NonNullable<LaneProjection['pending']>>((resolve) => {
    const stop = lane.subscribe((projection) => {
      if (!projection.pending) return;
      stop();
      resolve(projection.pending);
    });
  });
}

function approvalNotes(projection: LaneProjection) {
  return projection.parts.flatMap((part) =>
    part.kind === 'host-note' && part.noteType === LANE_APPROVAL_NOTE_TYPE && isLaneApprovalNote(part.data)
      ? [part.data] : []);
}

function toolResults(projection: LaneProjection) {
  return projection.parts.flatMap((part) => (part.kind === 'tool-result' ? [part] : []));
}

test('G3a · fail-closed：审批模块自己抛异常 = 拒收，工具没跑，模型收到那句话', async (t: TestContext) => {
  const boom = 'Approval service unavailable: ask the user to reopen the Nomi window before writing.';
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], {
    hasUserInterface: true,
    // 「必抛版」审批：它模拟的是策略层任何一处坏掉。fail-closed 的定义就是这时候**拒**，
    // 而不是「闸坏了就放行」——后者不会报错，只会在某一天替用户点了头。
    policy: () => { throw new Error(boom); },
  });
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  await lane.execute({ kind: 'prompt', text: 'Append a closing line.' });

  assert.equal(fixture.document.text(), before, 'the tool never reached the domain port');
  const [result] = toolResults(lane.projection());
  assert.ok(result?.isError, 'the call settles as an errored tool result');
  assert.equal(result.text, boom, 'the reason reaches the model verbatim (pi hooks.js:113-118)');
  const next = JSON.stringify(fixture.http.requests.at(-1)?.body ?? {});
  assert.ok(next.includes(boom), 'and it is in the next request, so the model can act on it');
});

test('G3a · 没有窗口可问的调用（MCP stdio / 走查 / 后台批）被策略拒，且从没弹过卡', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], {
    ...STEP, hasUserInterface: false,
  });
  const lane = await fixture.openLane(fixture.options);
  const seenPending: boolean[] = [];
  lane.subscribe((projection) => seenPending.push(projection.pending !== undefined));
  const before = fixture.document.text();
  await lane.execute({ kind: 'prompt', text: 'Append a closing line.' });

  assert.equal(fixture.document.text(), before, 'the tool never ran');
  assert.ok(!seenPending.includes(true), 'no card was ever shown — there is nobody to show it to');
  const [result] = toolResults(lane.projection());
  assert.ok(result?.isError);
  assert.match(result.text, /Nomi window/, 'the model is told where this can be confirmed');
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['denied-by-policy'],
    'the transcript records that policy refused it — not that the tool broke');
});

test('G3b ① · 等待期：零模型请求在飞，工具没进过领域端口，「在等你」由宿主投影出来', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], STEP);
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  const turn = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  const pending = await firstPending(lane);

  assert.equal(pending.toolCallId, 'call-append');
  assert.equal(pending.toolName, 'write_script');
  assert.equal(pending.pendingCount, 1);
  // 文稿写入是本地可撤销的，所以「本会话允许这类」那个按钮**该有**……
  assert.equal(pending.effectClass, 'reversible_local');
  // ……但这条 lane 现在是「每步问」，那个档位下谁都没有。门槛不因为效果类可撤销就放宽。
  assert.equal(pending.grantable, false);
  assert.equal(lane.projection().running, true, 'the lane is still an open operation while it waits');
  assert.equal(fixture.http.requests.length, 1, 'G3b ①：等待期不发第二次模型请求（不花钱）');
  assert.equal(fixture.document.text(), before, 'the tool has not started');
  // 「等待期不 arm 工具超时计时器」的机器形式：闸整段跑在 `before_tool` 里，`execute` 一次
  // 都没被进过——3c 在 `execute` 里 arm 的那个 `AbortSignal.timeout` 结构上不可能被 arm。
  assert.deepEqual(approvalNotes(lane.projection()), [], '等待本身不写进转录——它不是发生了的事');

  await lane.execute({ kind: 'approval', toolCallId: pending.toolCallId, action: 'allow-once' });
  await turn;
  assert.notEqual(fixture.document.text(), before, 'allowing it lets the same call through — no second model round-trip');
  assert.equal(lane.projection().pending, undefined);
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['granted-once']);
});

test('G3b ① · 「本会话允许这类」按能力记：同一个能力的下一次调用不再弹卡', async (t: TestContext) => {
  // 这一族**只可能是** `requiresPlanReview` 的能力：`safe-auto` 下别的本地可撤销改动压根不弹卡，
  // 而 `step` 档下谁都拿不到这个按钮（那是「每步问」这三个字的意思）。所以这里用一个
  // 声明 `timeline.write` 的工具——它的载荷是一份用户必须先读的计划，首次必弹。
  const plan = (id: string) => ({ type: 'tool' as const, calls: [{ id, name: 'plan_timeline', arguments: {} }] });
  const fixture = await createLaneFixture(t, [plan('call-plan-1'), plan('call-plan-2'), CLOSING], {
    hasUserInterface: true, policy: () => ({ mode: 'safe-auto', spend: 'confirm' }),
  });
  let applied = 0;
  const lane = await fixture.openLane({
    ...fixture.options,
    tools: [{
      name: 'plan_timeline',
      contractId: 'timeline.write',
      description: 'Apply a timeline edit plan, used here to exercise the plan-review approval path.',
      promptSnippet: 'apply a timeline edit plan.', nextAction: 'none', describe: FIXTURE_DESCRIBE,
      effect: 'reversible_local',
      execution: { timeoutMs: LANE_WRITE_TOOL_TIMEOUT_MS },
      schema: z.object({}).strict(),
      examples: [{ when: 'Call it with no arguments:', arguments: {} }],
      execute: async () => { applied += 1; return { ok: true as const, text: 'Applied.' }; },
    }],
  });

  const cards: string[] = [];
  const turn = lane.execute({ kind: 'prompt', text: 'Lay the shots onto the timeline, twice.' });
  const stop = lane.subscribe((projection) => {
    const card = projection.pending;
    if (!card || cards.includes(card.toolCallId)) return;
    cards.push(card.toolCallId);
    assert.equal(card.grantable, true, 'a plan-review card under safe-auto is the one that carries 「本会话允许这类」');
    void lane.execute({ kind: 'approval', toolCallId: card.toolCallId, action: 'allow-session' });
  });
  t.after(stop);
  await turn;

  assert.deepEqual(cards, ['call-plan-1'], '第二次调用没有再弹卡：grant 记在能力上，不是记在这一次调用上');
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['granted-session', 'auto-granted']);
  assert.equal(applied, 2, 'both calls ran — the second one without asking again');
});

test('G3b ② · 按停止：pi 自己合成 cancelled 结果，宿主在 abort 之后补一条取消记录', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], STEP);
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  const turn = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  await firstPending(lane);

  const outcome = await lane.execute({ kind: 'abort' });
  await turn;

  assert.equal(fixture.document.text(), before, 'the tool never ran');
  assert.equal(lane.projection().pending, undefined, 'the card is gone');
  const [result] = toolResults(lane.projection());
  assert.equal(result?.text, 'Tool execution was cancelled before completion.',
    'resolve-on-abort 得到的是 pi 自己的 abortedOutcome —— reject 那一臂会被洗成内部串 "Abort requested"');
  assert.equal(fixture.http.requests.length, 1, 'stopping does not spend another model request');
  // 记录**在 abort 之后**才落进转录：abort 不是一个转录边界，写在钩子里的那条会悬在
  // `queues` 里，用户永远看不到（探针 §2.1）。
  const notes = approvalNotes(lane.projection());
  assert.deepEqual(notes.map((note) => [note.decision, note.cause]), [['cancelled', 'stopped']]);
  // 「你按了停」和「你说了不要」在用户那里是两件事，所以它们不是同一个 decision。
  assert.notEqual(notes[0]?.reason, undefined);
  // 没有排队的插话时不编一个空数组：`restoredInput` 缺席就是「没有东西要还给你」。
  assert.equal(outcome.restoredInput, undefined);
});

test('G3b ③ · 崩溃重启：不复活确认卡，那次调用被取消，模型读到「再发一次」', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], STEP);
  // 子进程走**生产路径** `openLane` 打开会话、停在卡上，然后被 SIGKILL。用的就是探针
  // P1③ 那个子进程（`stage3-probe-crash-child.mts`）——两边要的是同一件事，抄第二份出来
  // 的代价不是重复，是两份会慢慢长得不一样。
  // 同一进程里假装崩溃会撞 `laneSession.mts` 的单持有者名单，等于测一条生产走不到的路。
  const crash = spawnLaneCrashChild(fixture);
  const sessionId = await crash.sessionId;
  assert.equal(fixture.http.requests.length, 1, 'the child parked on the card after exactly one model reply');
  await crash.close();

  // 重开：新的领域端口（这个进程从没写过那份文稿），同一条会话。
  const document = createDocumentPort();
  const seenPending: boolean[] = [];
  const lane = await fixture.openLane({ ...fixture.options, sessionId, tools: reopenTools(document) });
  lane.subscribe((projection) => seenPending.push(projection.pending !== undefined));

  // `resume()` 会对停在预检里的调用**再问一次** `before_tool`（探针 ③）——闸把它挡在那里。
  const settled = await new Promise<LaneProjection>((resolve) => {
    const stop = lane.subscribe((projection) => {
      if (toolResults(projection).length === 0 || approvalNotes(projection).length === 0) return;
      stop();
      resolve(projection);
    });
  });

  assert.ok(!seenPending.includes(true), '不复活那张卡：用户从没看见过它，重启后凭空冒出来更吓人');
  assert.equal(document.text(), 'The opening scene.', '重启前没确认的写入没有偷偷发生');
  assert.match(toolResults(settled)[0].text, /restarted|cancelled/i);
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => [note.decision, note.cause]),
    [['cancelled', 'restart']]);
});

/** 重开那一侧的工具：和子进程用的是同一族说明书，只是接了一个**新的**领域端口。 */
function reopenTools(document: ReturnType<typeof createDocumentPort>) {
  return createDocumentLaneTools(document);
}
