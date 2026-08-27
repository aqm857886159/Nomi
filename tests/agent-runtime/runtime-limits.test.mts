import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

function tool(index: number): FixtureReply {
  return { type: 'tool', calls: [{ id: `step-${index}`, name: 'read_shot', arguments: {} }] };
}

for (const maxSteps of [8, 24] as const) {
  test(`whole Nomi call stops at exactly ${maxSteps} requests and reports an unfinished tool boundary`, async (t) => {
    const { request, http } = await createRuntimeFixture(t,
      [...Array.from({ length: maxSteps + 1 }, (_, index) => tool(index)), { type: 'text', text: 'Must not request this.' }]);
    request.capability = { maxSteps };
    request.tools = [{ name: 'read_shot', description: 'Read one shot.', schema: z.object({}) }];
    let hosts = 0;
    const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => {
      hosts += 1; return { ok: true, result: 'Read.' };
    } });
    assert.equal(http.requests.length, maxSteps);
    assert.equal(hosts, maxSteps);
    assert.equal(result.status, 'error');
    assert.equal(result.error?.kind, 'step-limit');
    assert.equal(result.context?.normalRequests, maxSteps);
    assert.match(result.snapshot ?? '', /toolResult/);
  });

  test(`a normal stop on the last admitted request ${maxSteps} succeeds`, async (t) => {
    const { request, http } = await createRuntimeFixture(t,
      [...Array.from({ length: maxSteps - 1 }, (_, index) => tool(index)), { type: 'text', text: 'Finished at the limit.' }]);
    request.capability = { maxSteps };
    request.tools = [{ name: 'read_shot', description: 'Read one shot.', schema: z.object({}) }];
    const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
    assert.equal(http.requests.length, maxSteps);
    assert.equal(result.status, 'finished');
    assert.equal(result.text, 'Finished at the limit.');
  });
}

test('singleShot ignores supplied history and tools and makes exactly one request even for a malicious tool call', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [tool(1), { type: 'text', text: 'Must not continue.' }]);
  request.snapshot = 'Deliberately invalid: single-shot must never parse prior history.';
  request.capability = { singleShot: true, maxSteps: 1 };
  request.compaction = { enabled: true };
  request.tools = [{ name: 'read_shot', description: 'Not granted.', schema: z.object({}) }];
  let hosts = 0;
  const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => {
    hosts += 1; return { ok: true };
  } });
  assert.equal(http.requests.length, 1);
  assert.equal(hosts, 0);
  assert.ok(!http.requests[0].body.tools || (http.requests[0].body.tools as unknown[]).length === 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error?.kind, 'step-limit');
  assert.equal(result.snapshot, undefined, 'single-shot never publishes working history');
});

test('length on the last admitted normal call preserves the partial result without auto-continuation', async (t) => {
  const { request, http } = await createRuntimeFixture(t,
    [...Array.from({ length: 7 }, (_, index) => tool(index)), { type: 'text', text: 'Partial answer.', finishReason: 'length' }]);
  request.compaction = { enabled: true, reserveTokens: 1024, keepRecentTokens: 100 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
  assert.equal(http.requests.length, 8);
  assert.equal(result.status, 'finished');
  assert.equal(result.finishReason, 'length');
  assert.equal(result.text, 'Partial answer.');
});

test('ordinary model errors are not automatically retried', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'error', status: 529, message: 'Overloaded' }, { type: 'text', text: 'Do not retry.' },
  ]);
  const result = await runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }) });
  assert.equal(http.requests.length, 1);
  assert.equal(result.status, 'error');
});
