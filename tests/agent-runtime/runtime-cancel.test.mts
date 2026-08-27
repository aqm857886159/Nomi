import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { z } from 'zod';
import type { RuntimeActivityEvent, RuntimeToolDecision } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('pre-cancelled runtime dispatches no request or approval and returns cancelled, not SDK error', async (t) => {
  const { request, http } = await createRuntimeFixture(t, []);
  const controller = new AbortController();
  controller.abort();
  let hosts = 0;
  const result = await runAgentTurn(request, { signal: controller.signal, emit: () => {},
    awaitToolConfirmation: async () => { hosts += 1; return { ok: true }; } });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.finishReason, 'aborted');
  assert.equal(result.error?.kind, 'abort');
  assert.equal(http.requests.length, 0);
  assert.equal(hosts, 0);
});

test('external cancellation settles an in-flight real HTTP request before its late response can arrive', { timeout: 5000 }, async (t) => {
  const started = gate<void>();
  const reply = gate<FixtureReply>();
  const { request, http } = await createRuntimeFixture(t, [{ type: 'deferred', beforeReply: () => {
    started.resolve(); return reply.promise;
  } }]);
  const controller = new AbortController();
  const events: RuntimeActivityEvent[] = [];
  const run = runAgentTurn(request, { signal: controller.signal, emit: (event) => events.push(event),
    awaitToolConfirmation: async () => ({ ok: true }) });
  await started.promise;
  controller.abort();
  const result = await run;
  assert.equal(result.status, 'cancelled');
  const history = result.snapshot;
  const eventCount = events.length;
  reply.resolve({ type: 'text', text: 'LATE_RESPONSE_MUST_NOT_APPEAR' });
  await setImmediate();
  assert.equal(http.requests.length, 1);
  assert.equal(events.length, eventCount);
  assert.equal(result.snapshot, history);
  assert.doesNotMatch(result.text, /LATE_RESPONSE/);
  assert.doesNotMatch(result.snapshot ?? '', /LATE_RESPONSE/);
});

for (const completion of ['resolve', 'reject'] as const) {
  test(`cancelled host approval ignores its late ${completion} and keeps stable actual history`, { timeout: 5000 }, async (t) => {
    const started = gate<void>();
    const approval = gate<RuntimeToolDecision>();
    const { request, http } = await createRuntimeFixture(t, [
      { type: 'tool', calls: [{ id: 'pending', name: 'write_shot', arguments: {} }] },
      { type: 'text', text: 'Must not continue.' },
    ]);
    request.tools = [{ name: 'write_shot', description: 'Await existing host approval.', schema: z.object({}) }];
    const controller = new AbortController();
    const events: RuntimeActivityEvent[] = [];
    let hosts = 0;
    const run = runAgentTurn(request, { signal: controller.signal, emit: (event) => events.push(event),
      awaitToolConfirmation: () => { hosts += 1; started.resolve(); return approval.promise; } });
    await started.promise;
    controller.abort();
    const result = await run;
    assert.equal(result.status, 'cancelled');
    assert.equal(result.toolCalls[0].status, 'cancelled');
    assert.equal(result.toolCalls[0].decision, undefined);
    assert.equal(hosts, 1);
    assert.equal(http.requests.length, 1);
    assert.match(result.snapshot ?? '', /toolResult/);
    const stableResult = JSON.stringify(result);
    const stableEvents = JSON.stringify(events);
    if (completion === 'resolve') approval.resolve({ ok: true, result: 'LATE_APPROVAL' });
    else approval.reject(new Error('LATE_HOST_FAILURE'));
    await setImmediate();
    assert.equal(JSON.stringify(result), stableResult);
    assert.equal(JSON.stringify(events), stableEvents);
  });
}

test('stop from the normalized tool-call listener prevents approval dispatch', async (t) => {
  const { request } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'cancel-on-call', name: 'write_shot', arguments: {} }] },
  ]);
  request.tools = [{ name: 'write_shot', description: 'Write only if still current.', schema: z.object({}) }];
  const controller = new AbortController();
  let hosts = 0;
  const result = await runAgentTurn(request, { signal: controller.signal,
    emit: (event) => { if (event.type === 'tool-call') controller.abort(); },
    awaitToolConfirmation: async () => { hosts += 1; return { ok: true }; } });
  assert.equal(result.status, 'cancelled');
  assert.equal(hosts, 0);
});

test('stop during asynchronous domain Zod parsing never reaches the host', { timeout: 5000 }, async (t) => {
  const parsing = gate<void>();
  const normalized = gate<{ shot: number }>();
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'async-zod', name: 'write_shot', arguments: {} }] },
  ]);
  request.tools = [{ name: 'write_shot', description: 'Use domain parsing first.',
    schema: z.object({}).transform(async () => { parsing.resolve(); return normalized.promise; }) }];
  const controller = new AbortController();
  let hosts = 0;
  const run = runAgentTurn(request, { signal: controller.signal, emit: () => {},
    awaitToolConfirmation: async () => { hosts += 1; return { ok: true }; } });
  await parsing.promise;
  controller.abort();
  const result = await run;
  normalized.resolve({ shot: 2 });
  await setImmediate();
  assert.equal(result.status, 'cancelled');
  assert.equal(hosts, 0);
  assert.equal(http.requests.length, 1);
});
