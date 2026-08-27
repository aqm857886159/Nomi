import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { z } from 'zod';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture } from './httpFixture.mjs';

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((ready) => { resolve = ready; });
  return { promise, resolve };
}

test('actual runtime first-response watchdog is 90 seconds and surfaces plain timeout phase using a controlled clock', async (t) => {
  const { request, http } = await createRuntimeFixture(t, []);
  const payload = gate();
  const release = gate();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const run = runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }),
    onPayload: async () => { payload.resolve(); await release.promise; } }).then((result) => { settled = true; return result; });
  await payload.promise;
  t.mock.timers.tick(89_999);
  await setImmediate();
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  const result = await run;
  assert.equal(result.status, 'error');
  assert.equal(result.error?.kind, 'timeout');
  assert.equal(result.error?.timeoutPhase, 'first-response');
  assert.match(result.error?.message ?? '', /90000ms/);
  release.resolve();
  await setImmediate();
  assert.equal(http.requests.length, 0);
});

test('subsequent normal requests have a 120-second first-response budget', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'read-one', name: 'read_shot', arguments: {} }] },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const secondPayload = gate();
  const release = gate();
  let profiles = 0;
  let settled = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => ({ ok: true }),
    onPayload: async () => { if (++profiles === 2) { secondPayload.resolve(); await release.promise; } },
  }).then((result) => { settled = true; return result; });
  await secondPayload.promise;
  t.mock.timers.tick(90_000);
  await setImmediate();
  assert.equal(settled, false);
  t.mock.timers.tick(30_000);
  const result = await run;
  assert.equal(result.error?.kind, 'timeout');
  assert.match(result.error?.message ?? '', /120000ms/);
  assert.equal(result.context?.normalRequests, 2);
  release.resolve();
  await setImmediate();
  assert.equal(http.requests.length, 1);
});

test('native text activity starts the 120-second idle watchdog and preserves partial user-visible text', async (t) => {
  const release = gate();
  const { request } = await createRuntimeFixture(t, [
    { type: 'text', text: 'Partial native text.', beforeFinish: () => release.promise },
  ]);
  const content = gate();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = runAgentTurn(request, { emit: (event) => { if (event.type === 'content-delta') content.resolve(); },
    awaitToolConfirmation: async () => ({ ok: true }) });
  await content.promise;
  t.mock.timers.tick(120_000);
  const result = await run;
  assert.equal(result.status, 'error');
  assert.equal(result.error?.timeoutPhase, 'idle');
  assert.equal(result.text, 'Partial native text.');
  release.resolve();
});

test('a five-minute host approval does not count as model idle and the next request still completes', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'read-one', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'Approved after a long wait.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read after approval.', schema: z.object({}) }];
  const waiting = gate();
  const release = gate();
  let settled = false;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const run = runAgentTurn(request, { emit: () => {}, awaitToolConfirmation: async () => {
    waiting.resolve(); await release.promise; return { ok: true };
  } }).then((result) => { settled = true; return result; });
  await waiting.promise;
  t.mock.timers.tick(5 * 60_000);
  await setImmediate();
  assert.equal(settled, false);
  release.resolve();
  const result = await run;
  assert.equal(result.status, 'finished');
  assert.equal(result.text, 'Approved after a long wait.');
  assert.equal(http.requests.length, 2);
});
