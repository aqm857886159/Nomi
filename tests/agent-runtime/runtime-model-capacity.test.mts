import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldCompact } from '@earendil-works/pi-coding-agent';
import type { RuntimeActivityEvent } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createControlledSession } from '../../electron/harness/runtime/pi/session.mjs';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

const hooks = () => ({ emit: () => {}, awaitToolConfirmation: async () => ({ ok: true as const }) });

for (const contextWindow of [32_768, 262_144]) {
  test(`the real SDK receives declared context window ${contextWindow}, separate from output capacity`, async (t) => {
    const { request, http } = await createRuntimeFixture(t, []);
    request.model = { ...request.model, contextWindow, maxOutputTokens: 2048 };
    const controlled = await createControlledSession({ ...request, tools: [] });
    t.after(controlled.dispose);
    const { session } = controlled;
    assert.equal(session.model?.contextWindow, contextWindow);
    assert.equal(session.model?.maxTokens, 2048);
    assert.equal(session.getContextUsage()?.contextWindow, contextWindow);
    session.setAutoCompactionEnabled(true);
    const settings = session.settingsManager.getCompactionSettings();
    assert.equal(settings.reserveTokens, 16_384, 'use the pinned SDK default, not a Nomi-derived budget');
    assert.equal(shouldCompact(contextWindow - settings.reserveTokens, session.model!.contextWindow, settings), false);
    assert.equal(shouldCompact(contextWindow - settings.reserveTokens + 1, session.model!.contextWindow, settings), true);
    assert.equal(shouldCompact(20_000, session.model!.contextWindow, settings), contextWindow === 32_768);
    assert.equal(http.requests.length, 0);
  });
}

test('an undeclared model window retains the explicit 128000 compatibility fallback, not a name-based capacity guess', async (t) => {
  const { request } = await createRuntimeFixture(t, []);
  assert.equal(Object.hasOwn(request.model, 'contextWindow'), false);
  const controlled = await createControlledSession({ ...request, tools: [] });
  t.after(controlled.dispose);
  assert.equal(controlled.session.model?.contextWindow, 128_000);
  assert.equal(controlled.session.model?.maxTokens, 16_384);
});

for (const contextWindow of [32_768, 262_144]) {
  for (const aboveThreshold of [false, true]) {
    test(`native auto-compaction at window ${contextWindow} ${aboveThreshold ? 'triggers above' : 'does not trigger at'} its threshold`, async (t) => {
      const total = contextWindow - 16_384 + Number(aboveThreshold);
      const { request, http } = await createRuntimeFixture(t, [
        { type: 'text', text: 'Completed the requested edit.', usage: { input: total - 4, output: 4 } },
        { type: 'text', text: 'Keep the approved creative intent.' },
      ]);
      request.model = { ...request.model, contextWindow, maxOutputTokens: 2048 };
      // Keep a compactable prefix in this tiny fixture; leave reserveTokens at
      // the actual SDK default so model capacity alone selects the threshold.
      request.compaction = { enabled: true, keepRecentTokens: 1 };
      const result = await runAgentTurn(request, hooks());
      assert.equal(result.status, 'finished');
      assert.equal(result.text, 'Completed the requested edit.');
      assert.equal(result.context?.normalRequests, 1);
      assert.equal(result.context?.summaryRequests, Number(aboveThreshold));
      assert.equal(result.context?.compactions, Number(aboveThreshold));
      assert.equal(http.requests.length, aboveThreshold ? 2 : 1);
      assert.equal(http.requests[0].body.max_tokens, 2048);
      if (aboveThreshold) {
        assert.match(JSON.stringify(http.requests[1].body), /summar/i);
        assert.equal(http.requests[1].body.max_tokens, 2048);
        assert.match(result.snapshot ?? '', /"type":"compaction"/);
      } else {
        assert.doesNotMatch(result.snapshot ?? '', /"type":"compaction"/);
      }
    });
  }
}

for (const contextWindow of [4096, 16_384]) {
  test(`SDK reserve at or above window ${contextWindow} does not summarize a fresh short history`, async (t) => {
    const { request, http } = await createRuntimeFixture(t, [{ type: 'text', text: 'Short answer.' }]);
    request.model.contextWindow = contextWindow;
    request.compaction = { enabled: true };
    const result = await runAgentTurn(request, hooks());
    assert.equal(result.status, 'finished');
    assert.equal(result.text, 'Short answer.');
    assert.equal(result.context?.normalRequests, 1);
    assert.equal(result.context?.summaryRequests, 0);
    assert.equal(result.context?.compactions, 0);
    assert.equal(http.requests.length, 1);
  });
}

for (const summaryFails of [false, true]) {
  test(`a reserve larger than the model window settles after one ${summaryFails ? 'failed' : 'successful'} SDK summary`, { timeout: 30_000 }, async (t) => {
    const summary: FixtureReply = summaryFails
      ? { type: 'error', status: 400, message: 'context_length_exceeded' }
      : { type: 'text', text: 'Approved intent retained.' };
    const { request, http } = await createRuntimeFixture(t, [
      { type: 'text', text: 'The requested edit is complete.' }, summary,
    ]);
    request.model = { ...request.model, contextWindow: 4096, maxOutputTokens: 512 };
    request.compaction = { enabled: true, keepRecentTokens: 1 };
    const events: RuntimeActivityEvent[] = [];
    const result = await runAgentTurn(request, { ...hooks(), emit: (event) => events.push(event) });
    assert.equal(result.status, 'finished');
    assert.equal(result.text, 'The requested edit is complete.');
    assert.equal(result.context?.normalRequests, 1, 'threshold summaries must not replay the user request');
    assert.equal(result.context?.summaryRequests, 1, 'a negative threshold must not create a summary loop');
    assert.equal(result.context?.compactions, summaryFails ? 0 : 1);
    assert.equal(http.requests.length, 2);
    assert.equal(events.filter((event) => event.type === 'warning').length, Number(summaryFails));
    assert.equal(http.requests[0].body.max_tokens, 512);
    assert.equal(http.requests[1].body.max_tokens, 512);
  });
}
