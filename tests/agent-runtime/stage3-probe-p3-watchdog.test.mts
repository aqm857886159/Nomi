// 阶段 3 前置探针 **P3**（方案 §4.3）：lane 无看门狗，以及超时挂上看门狗后会被归成什么。
//
// 两个问题，各一条**只写探针不修**的断言（修在 3c，另一位工人并行在做）：
//   ① 首字节永不返回时，lane 今天**挂死**——用有界等待证明它超过 N 秒仍无结果（阳性对照：
//      同一条 loopback 挂上 `observeNativeStream` 就会结束）。这是 G3c 「今天会红」的那半。
//   ② `observeStream.mts:66` 的 `fail()` 走 `controller.abort(error)`。方案 §1.6 预测它「极可能
//      落成 `aborted` → 永不重试」。实跑记录：stopReason 是什么、`retry_scheduled` 有没有触发、
//      harness 有没有 fault。这决定 3c 的归一策略。
//
// 等待纪律（`check:test-waits`）：这里没有私有 waitFor、没有 Date.now() 截止轮询。
// ① 的「N 秒仍无结果」是一条**只可能因为看门狗存在而翻红**的断言——机器越慢它越真。
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import type { Provider } from '@earendil-works/pi-ai';
import type { HarnessEvent } from '@earendil-works/pi-agent-core';

import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { observeNativeStream } from '../../electron/harness/runtime/pi/observeStream.mjs';
import { createLaneFixture } from './laneFixture.mjs';
import { PROBE_CONTEXT, openProbeLane } from './stage3ProbeHarness.mjs';

/** 首字节永不返回：服务器收到请求后**什么都不写**。 */
const NEVER_FIRST_BYTE = { type: 'deferred' as const, beforeReply: () => new Promise<never>(() => {}) };
const HANG_PROOF_MS = 5_000;

/** 把 `createNomiProvider` 的产物包进 `observeNativeStream`——3c 要做的那件事，先在测试里做一遍。 */
function withWatchdog(provider: Provider, firstResponseMs: number): Provider {
  const watched: Provider = Object.create(provider) as Provider;
  Object.defineProperty(watched, 'streamSimple', {
    value: (model: Parameters<Provider['streamSimple']>[0], context: Parameters<Provider['streamSimple']>[1], options?: Parameters<Provider['streamSimple']>[2]) =>
      observeNativeStream((signal) => provider.streamSimple(model, context, { ...options, signal }), {
        ...(options?.signal ? { signal: options.signal } : {}), firstResponseMs, idleMs: firstResponseMs,
      }),
  });
  return watched;
}

test('P3 ① · today the lane has no watchdog: a stream that never sends its first byte hangs the turn', async (t) => {
  const fixture = await createLaneFixture(t, [NEVER_FIRST_BYTE]);
  const lane = await openLane(fixture.options);
  t.after(() => lane.close());
  const turn = lane.execute({ kind: 'prompt', text: 'Hello?' }).then(() => 'settled' as const);
  const verdict = await Promise.race([turn, sleep(HANG_PROOF_MS).then(() => 'still-hanging' as const)]);
  assert.equal(verdict, 'still-hanging', `no watchdog: the turn is still pending after ${HANG_PROOF_MS}ms with the request in flight`);
  assert.equal(fixture.http.requests.length, 1, 'exactly one request is in flight — nothing retried, nothing timed out');
  assert.equal(lane.projection().running, true);
  // 解锁：用户按停止是今天唯一能结束这一轮的东西。
  await lane.execute({ kind: 'abort' });
  assert.equal(await turn, 'settled');
});

test('P3 ① positive control · the same stalled stream ends within the budget once observeNativeStream is on the provider', async (t) => {
  const fixture = await createLaneFixture(t, [NEVER_FIRST_BYTE, { type: 'text', text: 'Recovered.' }]);
  const events: HarnessEvent[] = [];
  const probe = await openProbeLane(t, fixture.options, { wrapProvider: (provider) => withWatchdog(provider, 300) });
  probe.harness.events.on('retry_scheduled', (event) => { events.push(event); });
  probe.harness.events.on('retry_end', (event) => { events.push(event); });
  probe.harness.events.on('fault', (event) => { events.push(event); });
  const result = await Promise.race([
    probe.lane.prompt('Hello?', undefined, PROBE_CONTEXT).then((value) => ({ kind: 'settled' as const, value })),
    sleep(HANG_PROOF_MS).then(() => ({ kind: 'still-hanging' as const })),
  ]);
  assert.equal(result.kind, 'settled', 'with the watchdog the turn ends instead of hanging');
  if (result.kind !== 'settled') return;

  // ② 归一：超时被 pi 记成了什么。
  const transcript = (await probe.lane.watch(PROBE_CONTEXT)).snapshot.transcript;
  const assistants = transcript.flatMap((entry) => entry.type === 'message' && entry.message.role === 'assistant' ? [entry.message] : []);
  const stopReasons = assistants.map((message) => message.stopReason);
  const scheduled = events.filter((event) => event.type === 'retry_scheduled');
  const faults = events.filter((event) => event.type === 'fault');
  assert.deepEqual(faults, [], 'the harness does not fault on a watchdog timeout');
  // 方案 §1.6 预测「极可能落成 aborted → 永不重试」。实跑推翻了它：`observeNativeStream` 把
  // 上游流关掉之后**自己**以 `NativeStreamTimeout` 拒绝 `result()`，harness 拿到的是
  // `stopReason:"error"` + 含 "timeout" 的文本——`isRetryableAssistantError` 认它，于是重试。
  assert.ok(scheduled.length >= 1, `a retry is scheduled after the timeout; events=${JSON.stringify(events.map((event) => event.type))}`);
  assert.match(scheduled[0].type === 'retry_scheduled' ? scheduled[0].errorMessage : '', /timeout/i,
    'the retry reason is the watchdog\'s own sentence, which is what the English regex keys on');
  assert.equal(stopReasons.includes('aborted'), false, `no assistant message was recorded as aborted: ${JSON.stringify(stopReasons)}`);
  assert.ok(result.value.ok, `the retried turn finishes: ${result.value.ok ? '' : JSON.stringify(result.value.error)}`);
  assert.equal(fixture.http.requests.length, 2, 'the second request is the retry that got the queued reply');
  const finalText = assistants.at(-1)?.content.map((part) => part.type === 'text' ? part.text : '').join('');
  assert.equal(finalText, 'Recovered.');
});
