import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { RuntimeActivityEvent, RuntimeToolDecision } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture } from './httpFixture.mjs';

test('a denied host decision stays denied without interpreting message text or granting a bypass tool', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'denied', name: 'write_shot', arguments: {} }] },
    { type: 'tool', calls: [{ id: 'bypass', name: 'write', arguments: { path: 'unsafe', content: 'unsafe' } }] },
    { type: 'text', text: 'The write was denied.' },
  ]);
  request.tools = [{ name: 'write_shot', description: 'Host-approved edits only.', schema: z.object({}) }];
  const decision: RuntimeToolDecision = { ok: false, message: 'The user chose no.', denied: true };
  let hosts = 0;
  const events: RuntimeActivityEvent[] = [];
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: async () => { hosts += 1; return decision; } });
  assert.equal(result.status, 'finished');
  assert.equal(hosts, 1);
  assert.equal(http.requests.length, 3);
  assert.deepEqual(result.toolCalls[0].decision, decision);
  assert.equal(result.toolCalls[0].status, 'denied');
  assert.equal(result.toolCalls[1].status, 'error');
  assert.equal(result.toolCalls[1].decision, undefined);
  assert.deepEqual(events.filter((event) => event.type === 'tool-call').map((event) => event.toolCallId), ['denied']);
  const errors = events.filter((event) => event.type === 'tool-error');
  assert.deepEqual(errors.map((event) => event.toolCallId), ['denied', 'bypass']);
  assert.equal(errors[0].denied, true);
  assert.equal(errors[1].denied, undefined);
});

test('a host failure whose text contains a denied marker is not silently reclassified as a decision', async (t) => {
  const { request } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'not-denied', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'Host error received.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const events: RuntimeActivityEvent[] = [];
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: async () => ({ ok: false, message: '[denied] is just text in this upstream error.' }) });
  assert.equal(result.toolCalls[0].status, 'error');
  const error = events.find((event) => event.type === 'tool-error');
  assert.equal(error?.denied, undefined);
  assert.equal(result.toolCalls[0].decision?.ok, false);
});

test('a successful result containing error-like text remains a successful approved result', async (t) => {
  const { request } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'success', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'Read successfully.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, { emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true, result: '[denied] appears in the document.' }) });
  assert.equal(result.toolCalls[0].status, 'ok');
  assert.equal(result.toolCalls[0].result, '[denied] appears in the document.');
});

test('a synchronous host throw is a single SDK tool error, never an extra repair request', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'tool', calls: [{ id: 'sync-error', name: 'read_shot', arguments: {} }] },
    { type: 'text', text: 'Host error received in the loop.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const events: RuntimeActivityEvent[] = [];
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: () => { throw new Error('HOST_SYNCHRONOUS_FAILURE'); } });
  assert.equal(result.status, 'finished');
  assert.equal(result.toolCalls[0].status, 'error');
  assert.equal(events.filter((event) => event.type === 'tool-error').length, 1);
  assert.match(JSON.stringify(http.requests[1].body), /HOST_SYNCHRONOUS_FAILURE/);
  assert.equal(http.requests.length, 2);
});
