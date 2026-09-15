// 阶段 3 前置探针 **P1**（方案 §4.3）：审批停在 `before_tool` 里等——abort 穿不穿得透、
// 崩溃恢复对「停在预检里的调用」给什么形状。
//
// 它裁决的是 §1.2 岔路 1 的 A 案（在钩子里 `await` 用户）能不能站住：
//   ① 等待期 `operation.status === "running"`、`runningTools` 为空、`queues` 里能看到 `kind:"write"`，
//      且**没有模型请求在飞**（loopback 计数不涨）——① 红 = 翻到 §1.2 方案 B。
//   ② `lane.abort()` 打断钩子里的 race，得到 `abortedOutcome`，`AbortResult` 带回未消费的 steer。
//   ③ 不 close 直接把进程杀掉 → 重开 `resume()`：是重跑，还是合成 `interruptedOutcome`——③ 红 = 恢复文案改。
//   ⊕ 阳性对照：钩子抛异常 = block（`hooks.js:113-118`），工具没跑、reason 逐字到模型。
//
// 结果与裁决写在 `docs/research/2026-09-07-agent-lane-stage3-probes.md`。这里只钉「今天是什么」。
import assert from 'node:assert/strict';
import { spawnLaneCrashChild } from './laneCrashFixture.mjs';
import { test } from 'node:test';
import type { Entry } from '@earendil-works/pi-agent-core';

import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createDocumentPort, createLaneFixture } from './laneFixture.mjs';
import {
  PROBE_CONTEXT, deferred, openProbeLane, rejectOnAbort, resolveOnAbort,
} from './stage3ProbeHarness.mjs';

const APPEND = { type: 'tool' as const, calls: [{ id: 'call-append', name: 'write_script', arguments: { where: 'end', content: 'unapproved' } }] };
const CLOSING = { type: 'text' as const, text: 'Understood.' };

/** 转录里那次调用的结果。**从 pi 的转录读**，不从我们的投影读——探针问的是 pi。 */
function toolResultOf(entries: readonly Entry[], toolCallId: string) {
  for (const entry of entries) {
    if (entry.type !== 'message' || entry.message.role !== 'toolResult') continue;
    if (entry.message.toolCallId !== toolCallId) continue;
    const content = entry.message.content;
    const text = content.filter((part): part is { type: 'text'; text: string } => part.type === 'text').map((part) => part.text).join('');
    return { text, isError: entry.message.isError };
  }
  return undefined;
}

for (const arm of ['resolve-on-abort', 'reject-on-abort'] as const) {
  test(`P1 ①② · a gate that awaits inside before_tool: status while waiting, and what abort() hands back (${arm})`, async (t) => {
    const fixture = await createLaneFixture(t, [APPEND, CLOSING]);
    const entered = deferred<{ hasSignal: boolean }>();
    let hookSettledBy: 'abort' | 'never' = 'never';
    const probe = await openProbeLane(fixture, fixture.options, {
      beforeTool: async (_event, hookContext) => {
        const signal = hookContext.abortSignal;
        entered.resolve({ hasSignal: signal !== undefined });
        // §1.2 实核：pi 只在**进入前** throwIfAborted，等待中的 promise 它不替我们打断。
        // 宿主的 gate 必须自己 race 这个 signal。两臂只差「被打断时是 resolve 还是 reject」。
        const never = new Promise<undefined>(() => {});
        if (arm === 'resolve-on-abort') {
          await Promise.race([never, resolveOnAbort(signal)]);
          hookSettledBy = 'abort';
          return undefined;
        }
        try {
          return await Promise.race([never, rejectOnAbort(signal)]);
        } finally { hookSettledBy = 'abort'; }
      },
    });
    const { lane } = probe;
    const watch = await lane.watch(PROBE_CONTEXT);
    t.after(() => watch.unsubscribe());
    watch.start(() => {});

    const run = lane.prompt('Append something.', undefined, PROBE_CONTEXT);
    const { hasSignal } = await entered.promise;
    assert.equal(hasSignal, true, 'the hook context carries the operation abort signal (hooks.js:40-47)');

    // ① 等待期：pi 眼里这条 lane 是什么状态。
    const note = await lane.appendCustomEntry('nomi.probe.note', { while: 'waiting' }, PROBE_CONTEXT);
    const steer = await lane.steer('不对，横屏', undefined, PROBE_CONTEXT);
    assert.ok(steer.ok, 'steer is accepted while the gate waits');
    const waiting = await watch.resnapshot(PROBE_CONTEXT);
    assert.ok(waiting.operation, 'there is an operation while the gate waits');
    // 方案 §4.3 P1 写的是 `status === "running"`。实跑：0.85.1 的快照**从不产出 "running"**——
    // 快照与 `inspectExecution` 只在 `open` / `aborting` 之间取值（`lane.js:1444`、`:864`；
    // 归约器 `reducer.js:22` 起手就是 `open`）。「在等人」还是「在跑请求」pi 一律写 `open`，
    // 所以这条断言按 pi 的词表钉：有操作、且不在 aborting。
    assert.equal(waiting.operation.status, 'open', 'pi 0.85.1 never reports "running" on a snapshot — the waiting lane is "open"');
    assert.deepEqual(waiting.operation.runningTools, [], 'a call stuck in preflight is NOT in runningTools — the host must project "waiting for you" itself');
    assert.ok(waiting.queues.some((item) => item.kind === 'write' && item.type === 'custom' && item.customType === 'nomi.probe.note'),
      'appendCustomEntry during an operation is queued as kind:"write", not written between toolCall and toolResult (lane.js:1490-1545)');
    assert.ok(waiting.queues.some((item) => item.kind === 'steer'), 'the steer is visible in queues while waiting');
    const inspected = await lane.inspectExecution(PROBE_CONTEXT);
    assert.equal(inspected.current?.status, 'open', 'inspectExecution says the same word as the snapshot');
    assert.equal(fixture.http.requests.length, 1, 'no model request is in flight while the gate waits (G3b ①)');
    assert.equal(fixture.document.text(), 'The opening scene.', 'the tool has not run');

    // ② abort 穿透钩子里的 race。
    const aborted = await lane.abort(PROBE_CONTEXT);
    assert.ok(aborted.ok, 'abort() succeeds against an operation parked in before_tool');
    assert.equal(hookSettledBy, 'abort', 'the race inside the hook was broken by the operation signal');
    assert.deepEqual(aborted.value.steer.map((message) => message.role === 'user' ? JSON.stringify(message.content) : message.role), [JSON.stringify([{ type: 'text', text: '不对，横屏' }])],
      'AbortResult hands back the unconsumed steer so the host can put it back in the input box (lane.js:1082)');
    const result = await run;
    assert.ok(result.ok, `the run settles instead of faulting: ${result.ok ? '' : JSON.stringify(result.error)}`);
    const entries = await lane.findEntries(undefined, PROBE_CONTEXT);
    const settled = toolResultOf(entries, 'call-append');
    assert.ok(settled, 'the parked call settles as a toolResult entry');
    assert.equal(settled.isError, true);
    assert.equal(fixture.document.text(), 'The opening scene.', 'the tool never ran');
    assert.equal(fixture.http.requests.length, 1, 'abort does not spend another model request');
    if (arm === 'resolve-on-abort') {
      assert.equal(settled.text, 'Tool execution was cancelled before completion.',
        'resolving the hook on abort yields pi\'s own abortedOutcome (drive/tools.js:96-101)');
    } else {
      // 拒绝那一臂：`hooks.js:121-125` 把任何异常变成 `block = { reason: error.message }`——
      // 所以模型看到的不是 abortedOutcome，而是 signal.reason 的 message。钉住它，宿主别走这一臂。
      assert.notEqual(settled.text, 'Tool execution was cancelled before completion.',
        'rejecting the hook on abort is laundered into a block reason by hooks.js:121-125 — not the cancelled outcome');
      assert.equal(settled.text, 'Abort requested', 'the block reason is AbortRequested.message, an internal string the user never asked for');
    }
    // 等待期排进 inbox 的宿主记录：abort 之后它**没有**落盘——还在 `queues` 里（§1.4 说的
    // 「落盘延迟到边界」，而 abort 不是一个边界）。它要等下一次 idle 时的 append 或下一轮
    // 才被一起冲出去。宿主若在钩子里写「你取消了」的记录，再 abort，那条记录就悬在这里。
    const landedNow = entries.some((entry) => entry.type === 'custom' && entry.customType === 'nomi.probe.note');
    assert.equal(landedNow, false, `custom entry ${note} appended during the wait is NOT flushed by abort`);
    const afterAbort = await watch.resnapshot(PROBE_CONTEXT);
    assert.equal(afterAbort.operation, null);
    assert.ok(afterAbort.queues.some((item) => item.kind === 'write' && item.type === 'custom' && item.customType === 'nomi.probe.note'),
      'it is still parked in queues after the operation settled');
    await lane.appendCustomEntry('nomi.probe.after', undefined, PROBE_CONTEXT);
    // 顺序从快照的 transcript 读（那是投影用的那条有序流）；`findEntries` 是按 tip 往回扫的。
    const flushed = (await watch.resnapshot(PROBE_CONTEXT)).transcript;
    const customTypes = flushed.filter((entry) => entry.type === 'custom').map((entry) => entry.customType);
    assert.deepEqual(customTypes, ['nomi.probe.note', 'nomi.probe.after'],
      'an idle-time append flushes the stranded write first, in order (lane.js:1502-1512)');
  });
}

test('P1 ⊕ positive control · a hook that throws is a block: the tool never runs and the message reaches the model verbatim', async (t) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING]);
  const reason = 'Approval service crashed: ask the user to reopen the panel before appending.';
  const probe = await openProbeLane(fixture, fixture.options, {
    beforeTool: async () => { throw new Error(reason); },
  });
  const result = await probe.lane.prompt('Append something.', undefined, PROBE_CONTEXT);
  assert.ok(result.ok);
  const settled = toolResultOf(await probe.lane.findEntries(undefined, PROBE_CONTEXT), 'call-append');
  assert.deepEqual(settled, { text: reason, isError: true }, 'hooks.js:113-118 — a throwing before_tool is fail-closed into a block whose reason is the error message');
  assert.equal(fixture.document.text(), 'The opening scene.', 'the tool never reached the domain port');
  const nextRequest = JSON.stringify(fixture.http.requests[1]?.body ?? {});
  assert.ok(nextRequest.includes(reason), 'the model reads the reason in the next request');
});

/**
 * ③ 真崩溃：子进程打开同一条会话、停在 gate 里，父进程 `SIGKILL` 它，再用**正常重开路径**打开。
 * 不在同一进程里假装崩溃：同一进程里第二次打开会撞 `laneSession.mts` 的单持有者名单，
 * 绕过它就等于测了一条生产走不到的路。
 */
test('P1 ③ · after a hard crash while parked in before_tool, resume() re-plans the call (before_tool runs again) instead of synthesizing an interrupted result', async (t) => {
  const fixture = await createLaneFixture(t, [APPEND, CLOSING]);
  const crash = spawnLaneCrashChild(fixture);
  const sessionId = await crash.sessionId;
  assert.equal(fixture.http.requests.length, 1, 'the child got exactly one model reply (the tool call) before parking');
  await crash.close();

  // 父进程：一个**新的**端口 + 新的 harness，钩子这次记录它有没有被再次问到。
  const document = createDocumentPort();
  const hookCalls: string[] = [];
  const reopened = await openProbeLane(fixture, { ...fixture.options, tools: createDocumentLaneTools(document) }, {
    sessionId,
    beforeTool: async (event) => { hookCalls.push(event.toolCallId); return undefined; },
  });
  const before = await reopened.lane.inspectExecution(PROBE_CONTEXT);
  assert.ok(before.current, 'the crashed operation is still open on disk — "crash" is an open operation, not a reason code (§1.5)');
  assert.equal(before.current.status, 'open');

  const resumed = await reopened.lane.resume(PROBE_CONTEXT);
  assert.ok(resumed.ok, `resume settles: ${resumed.ok ? '' : JSON.stringify(resumed.error)}`);
  const settled = toolResultOf(await reopened.lane.findEntries(undefined, PROBE_CONTEXT), 'call-append');
  assert.ok(settled, 'the parked call has a result after resume');

  // 今天的形状（钉住，不是期望）：调用还在 `planned`（intent 没发布），`runSequential` 走
  // `startToolInvocation` 而不是 `recoverToolInvocation`（drive/tools.js:376-386）——
  // 于是 before_tool **再问一次**，钩子放行就真的跑了。不是 interruptedOutcome。
  assert.deepEqual(hookCalls, ['call-append'], 'before_tool is asked again for the call that was parked when the process died');
  assert.equal(settled.isError, false, 'with the gate answering "allow" on resume, the tool executes for real');
  assert.doesNotMatch(settled.text, /interrupted|cancelled/i, 'no synthetic interrupted/cancelled outcome is written');
  assert.equal(document.text(), 'The opening scene.unapproved', 'the domain port in the resumed process received the write');
  assert.equal(fixture.http.requests.length, 2, 'resume continues the turn with one more model request, not a replay from the start');
});
