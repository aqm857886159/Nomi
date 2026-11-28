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
import { createDocumentPort, createLaneFixture, FIXTURE_DESCRIBE, mustConfirm } from './laneFixture.mjs';
import { createAskUserLaneTools } from '../../electron/agentLane/laneAskUserTool.js';

const APPEND = { type: 'tool' as const, calls: [{ id: 'call-append', name: 'write_script', arguments: { where: 'end', content: ' and then she left.' } }] };
const CLOSING = { type: 'text' as const, text: 'Done.' };

/** 让文稿写入必然停下来等人（宿主说这一次必须当场确认；为什么不再用档位见 `mustConfirm`）。 */
const MUST_CONFIRM: LaneApprovalOptions = mustConfirm();

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
    ...MUST_CONFIRM, hasUserInterface: false,
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
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], MUST_CONFIRM);
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  const turn = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  const pending = await firstPending(lane);

  assert.equal(pending.toolCallId, 'call-append');
  assert.equal(pending.toolName, 'write_script');
  assert.equal(pending.pendingCount, 1);
  // 文稿写入是本地可撤销的，所以「本会话允许这类」那个按钮**该有**……
  assert.equal(pending.effectClass, 'reversible_local');
  // ……但宿主说这一次必须当场确认、且不给会话级放行，所以没有那个按钮。门槛不因为效果类可撤销就放宽。
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
  // 这一族**只可能是** `requiresPlanReview` 的能力：`request`（请求批准）下别的本地可撤销改动压根不弹卡。所以这里用一个
  // 声明 `timeline.write` 的工具——它的载荷是一份用户必须先读的计划，首次必弹。
  const plan = (id: string) => ({ type: 'tool' as const, calls: [{ id, name: 'plan_timeline', arguments: {} }] });
  const fixture = await createLaneFixture(t, [plan('call-plan-1'), plan('call-plan-2'), CLOSING], {
    hasUserInterface: true, policy: () => ({ mode: 'request' }),
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
    assert.equal(card.grantable, true, 'a plan-review card under request is the one that carries 「本会话允许这类」');
    void lane.execute({ kind: 'approval', toolCallId: card.toolCallId, action: 'allow-session' });
  });
  t.after(stop);
  await turn;

  assert.deepEqual(cards, ['call-plan-1'], '第二次调用没有再弹卡：grant 记在能力上，不是记在这一次调用上');
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['granted-session', 'auto-granted']);
  assert.equal(applied, 2, 'both calls ran — the second one without asking again');
});

test('G3b ② · 按停止：pi 自己合成 cancelled 结果，宿主在 abort 之后补一条取消记录', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], MUST_CONFIRM);
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  const turn = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  await firstPending(lane);

  const outcome = await lane.execute({ kind: 'abort' });
  await turn;

  assert.equal(fixture.document.text(), before, 'the tool never ran');
  assert.equal(lane.projection().pending, undefined, 'the card is gone');
  const [result] = toolResults(lane.projection());
  assert.equal(result?.text, 'Operation aborted',
    'resolve-on-abort 得到的是 pi 1.7.0 自己的 aborted 结果（agent-loop.js:509）—— reject 那一臂会被洗成异常 message');
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
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], MUST_CONFIRM);
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

// ── 「他答上了」是成功，不是失败（2026-09-22 · run4 发现 ①）──────────────────────────────
//
// 用户在提问卡上点完选项 / 打完字之后，这次 `ask_user` 的 tool result 带着 `isError: true` 回到模型，
// **正文恰好就是他那句答案**（run4 的 6 次 `ask_user` 全中）。链条：闸把「答上了」编码成 `allow: false`
// → 宿主一律翻成 pi 的 `block` → pi 对 block 硬编码 `immediateError(isError: true)` → `pi-ai` 映射成
// Anthropic `tool_result.is_error: true`。而 Nomi 自己还拿 `event.isError` 计「连续撞墙」——
// 用户每答一次卡，就给这一轮的熔断计数器加一格，撞满三次这个工具就被自己拦下来。
//
// 既是错误形状，又在教模型「问了会失败」。修在源头：`answered` 放行，`ask_user` 的 execute 读
// `context.approvalAnswer`，把原话作为成功形状交回去（`laneAskUserTool.ts`）。

const ASK_CALLS = ['call-ask-1', 'call-ask-2', 'call-ask-3'] as const;
const ANSWERS = ['给我妈看，她不爱看快剪', '横屏', '第二镜改短点'] as const;

function askReply(id: string, question: string) {
  return { type: 'tool' as const, calls: [{ id, name: 'ask_user', arguments: { questions: [{ question }] } }] };
}

/** 等到投影里出现**这一张**卡（答完一张之后还会有下一张，所以不能只等「有卡」）。 */
function pendingCard(lane: { subscribe(listener: (projection: LaneProjection) => void): () => void; projection(): LaneProjection }, toolCallId: string) {
  const now = lane.projection().pending;
  if (now?.toolCallId === toolCallId) return Promise.resolve(now);
  return new Promise<NonNullable<LaneProjection['pending']>>((resolve) => {
    const stop = lane.subscribe((projection) => {
      if (projection.pending?.toolCallId !== toolCallId) return;
      stop();
      resolve(projection.pending);
    });
  });
}

test('答上了的 ask_user 以成功形状回给模型，正文就是他的原话——连答三次也不进熔断', async (t: TestContext) => {
  const fixture = await createLaneFixture(t, [
    askReply(ASK_CALLS[0], '这条片子是给谁看的？'),
    askReply(ASK_CALLS[1], '要横屏还是竖屏？'),
    askReply(ASK_CALLS[2], '第二镜想怎么改？'),
    CLOSING,
  ], MUST_CONFIRM);
  const lane = await fixture.openLane({ ...fixture.options, tools: createAskUserLaneTools() });
  const turn = lane.execute({ kind: 'prompt', text: '帮我剪一条片子。' });
  for (const [index, toolCallId] of ASK_CALLS.entries()) {
    const card = await pendingCard(lane, toolCallId);
    assert.equal(card.toolName, 'ask_user');
    await lane.execute({ kind: 'approval', toolCallId, action: 'answer', reason: ANSWERS[index] });
  }
  await turn;

  const results = toolResults(lane.projection());
  assert.equal(results.length, 3, '三次提问各有一条结果');
  for (const [index, result] of results.entries()) {
    assert.equal(result.isError, false, '「他答上了」不是一次工具失败——错误形状会让模型重试、进熔断、向用户报「出错了」');
    assert.equal(result.text, ANSWERS[index], '正文一字不改就是他的原话');
  }
  // 熔断计数不动的机器形式：阈值是 3（`LANE_REPEATED_FAILURE_BLOCK`）。旧行为下第三次提问会被
  // 宿主自己拦下来，模型读到的是「ask_user has failed 3 times in a row since it last succeeded」。
  assert.ok(!results.some((result) => /failed 3 times in a row|tool_retry_stopped/.test(result.text)),
    '连答三次，没有一次被熔断拦下');
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['answered', 'answered', 'answered'],
    '转录上仍然记的是「他回答了」，不是「他拒绝了」');
  const lastRequest = JSON.stringify(fixture.http.requests.at(-1)?.body ?? {});
  assert.ok(lastRequest.includes(ANSWERS[2]), '他那句话进了下一次模型请求，回合据此继续');
});

test('阳性对照：真的「不要」仍然是错误形状，而且带的是他那句话', async (t: TestContext) => {
  const denial = '别动我的文稿';
  const fixture = await createLaneFixture(t, [APPEND, CLOSING], MUST_CONFIRM);
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  const turn = lane.execute({ kind: 'prompt', text: 'Append a closing line.' });
  const pending = await firstPending(lane);
  await lane.execute({ kind: 'approval', toolCallId: pending.toolCallId, action: 'deny', reason: denial });
  await turn;

  assert.equal(fixture.document.text(), before, '拒了就没跑');
  const [result] = toolResults(lane.projection());
  assert.equal(result?.isError, true, '「他说不要」照旧是错误形状：那一支没被这一刀带走');
  assert.equal(result.text, denial);
  assert.deepEqual(approvalNotes(lane.projection()).map((note) => note.decision), ['denied']);
});
