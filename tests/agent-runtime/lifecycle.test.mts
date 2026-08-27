import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { createControlledSession } from '../../electron/harness/runtime/pi/session.mjs';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

function gate<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ready) => { resolve = ready; });
  return { promise, resolve };
}

for (const phase of ['prompt-preflight', 'post-normal'] as const) {
  test(`stop drains automatic summary auth in ${phase}, without late requests or summary history`, { timeout: 5000 }, async (t) => {
    const { request, http } = await createRuntimeFixture(t,
      phase === 'post-normal' ? [{ type: 'text', text: 'Actual answer.', usage: { input: 3500, output: 4 } }] : []);
    request.model.contextWindow = 4096;
    const manager = SessionManager.inMemory(request.cwd);
    manager.appendMessage({ role: 'user', content: 'PRIOR_BRIEF '.repeat(500), timestamp: 1 });
    manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Prior answer.' }],
      api: 'openai-completions', provider: request.model.providerId, model: request.model.modelId,
      timestamp: 2, stopReason: 'stop', usage: { input: 10, output: 4, cacheRead: 0, cacheWrite: 0,
        totalTokens: 14, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    if (phase === 'prompt-preflight') {
      manager.appendMessage({ role: 'user', content: 'SECOND_PRIOR_BRIEF '.repeat(500), timestamp: 3 });
      manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Second prior answer.' }],
        api: 'openai-completions', provider: request.model.providerId, model: request.model.modelId,
        timestamp: 4, stopReason: 'stop', usage: { input: 3500, output: 4, cacheRead: 0, cacheWrite: 0,
          totalTokens: 3504, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    }
    const controlled = await createControlledSession({ ...request, tools: [], sessionManager: manager });
    t.after(controlled.dispose);
    controlled.session.settingsManager.applyOverrides({ compaction: { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 } });
    const authStarted = gate<void>();
    const releaseAuth = gate<void>();
    const getAuth = controlled.modelRuntime.getAuth.bind(controlled.modelRuntime);
    let delayAuth = phase === 'prompt-preflight';
    const events: string[] = [];
    controlled.session.subscribe((event) => {
      events.push(event.type);
      if (event.type === 'message_end' && event.message.role === 'assistant') delayAuth = true;
    });
    controlled.modelRuntime.getAuth = async (selected, overrides) => {
      if (delayAuth) { authStarted.resolve(); await releaseAuth.promise; }
      return typeof selected === 'string' ? getAuth(selected, overrides) : getAuth(selected, overrides);
    };
    const run = controlled.session.prompt('CURRENT_INTENT '.repeat(500)).catch((error: unknown) => error);
    await authStarted.promise;
    assert.equal(http.requests.length, phase === 'post-normal' ? 1 : 0);
    assert.equal(events.includes('compaction_start'), false, 'SDK has not created its summary controller yet');
    let stopped = false;
    const stopping = controlled.stop().then(() => { stopped = true; });
    await setImmediate();
    assert.equal(stopped, false, 'stop must drain accepted asynchronous preflight/post-run work');
    releaseAuth.resolve();
    await stopping;
    await run;
    const entries = JSON.stringify(manager.getEntries());
    const eventCount = events.length;
    await setImmediate();
    assert.equal(http.requests.length, phase === 'post-normal' ? 1 : 0);
    assert.equal(controlled.session.isCompacting, false);
    assert.doesNotMatch(entries, /"type":"compaction"/);
    assert.equal(JSON.stringify(manager.getEntries()), entries);
    assert.equal(events.length, eventCount);
  });
}

test('a synchronous compaction-start stop covers the controller-created-after-event race', { timeout: 5000 }, async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'Prior answer.' },
    { type: 'text', text: 'Actual answer.', usage: { input: 3500, output: 4 } },
  ]);
  request.model.contextWindow = 4096;
  const controlled = await createControlledSession({ ...request, tools: [] });
  t.after(controlled.dispose);
  await controlled.session.prompt('PRIOR_BRIEF '.repeat(500));
  controlled.session.settingsManager.applyOverrides({ compaction: { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 } });
  let stop: Promise<void> | undefined;
  controlled.session.subscribe((event) => { if (event.type === 'compaction_start') stop = controlled.stop(); });
  await controlled.session.prompt('CURRENT_INTENT '.repeat(500));
  assert.ok(stop);
  await stop;
  assert.equal(http.requests.length, 2);
  assert.equal(controlled.session.isCompacting, false);
  assert.doesNotMatch(JSON.stringify(controlled.sessionManager.getEntries()), /"type":"compaction"/);
});

test('public run cancellation interrupts result-only automatic summary and suppresses its late completion', { timeout: 5000 }, async (t) => {
  const summaryStarted = gate<void>();
  const releaseSummary = gate<FixtureReply>();
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'first', name: 'read_shot', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'second', name: 'read_shot', arguments: {} }] },
    { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'deferred', beforeReply: () => { summaryStarted.resolve(); return releaseSummary.promise; } },
  ]);
  request.user.durableText = 'CURRENT_INTENT '.repeat(500);
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const controller = new AbortController();
  const run = runAgentTurn(request, { signal: controller.signal, emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true, result: 'TOOL_RESULT '.repeat(50) }) });
  await summaryStarted.promise;
  controller.abort();
  const result = await run;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error?.kind, 'abort');
  assert.equal(result.context?.summaryRequests, 1);
  assert.equal(result.usage.totalTokens, 28);
  const stable = JSON.stringify(result);
  releaseSummary.resolve({ type: 'text', text: 'LATE_SUMMARY_MUST_NOT_BE_SAVED' });
  await setImmediate();
  assert.equal(JSON.stringify(result), stable);
  assert.equal(http.requests.length, 4);
  assert.doesNotMatch(result.snapshot ?? '', /"type":"compaction"|LATE_SUMMARY/);
});
