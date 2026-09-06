import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { z } from 'zod';
import type { RuntimeActivityEvent, RuntimeToolDecision } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture as setup } from './httpFixture.mjs';

test('compiled CommonJS loader invokes the real native ESM runtime and returns one accumulated result', async (t) => {
  const { request, http } = await setup(t, [
    { type: 'tool', calls: [{ id: 'read-one', name: 'read_shot', arguments: { shot: 2 } }] },
    { type: 'text', text: 'Shot two is ready.' },
  ]);
  request.tools = [{ name: 'read_shot', description: 'Read one approved shot.', schema: z.object({ shot: z.number() }) }];
  const decision: RuntimeToolDecision = { ok: true, result: { shot: 2, caption: 'Morning' },
    effectiveArgs: { shot: 3 }, overridesDelta: { shot: { from: 2, to: 3 } }, silent: true, proposalId: 'proposal-1' };
  const events: RuntimeActivityEvent[] = [];
  let executions = 0;
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: async (call) => {
      assert.deepEqual(call, { toolCallId: 'read-one', toolName: 'read_shot', args: { shot: 2 } });
      executions += 1;
      return decision;
    } });
  assert.equal(result.status, 'finished');
  assert.equal(result.text, 'Shot two is ready.');
  assert.equal(executions, 1);
  assert.equal(http.requests.length, 2);
  assert.equal(events.filter((event) => event.type === 'tool-call').length, 1);
  assert.equal(events.filter((event) => event.type === 'tool-result').length, 1);
  assert.equal(events.filter((event) => event.type === 'content-delta').map((event) => event.delta).join(''), result.text);
  assert.equal(events.some((event) => ['finish', 'done', 'result', 'error'].includes(event.type)), false);
  assert.deepEqual(result.toolCalls, [{ toolCallId: 'read-one', toolName: 'read_shot', args: { shot: 2 },
    status: 'ok', decision, result: decision.result }]);
  assert.deepEqual(result.usage, { promptTokens: 20, completionTokens: 8, cachedPromptTokens: 0, totalTokens: 28, reasoningTokens: 0 });
  assert.equal(result.context?.normalRequests, 2);
  assert.ok(result.snapshot);
  assert.match(result.snapshot, /Shot two is ready/);
  const loader = await readFile(new URL('../../electron/harness/runtime/pi/nativeLoader.cjs', import.meta.url), 'utf8');
  assert.match(loader, /import\(['"]\.\/run\.mjs['"]\)/);
  assert.doesNotMatch(loader, /require\(['"]\.\/run\.mjs['"]\)/);
});

test('raw Zod errors stay inside the same SDK loop; only normalized corrected args reach approval', async (t) => {
  const { request, http } = await setup(t, [
    { type: 'tool', calls: [{ id: 'invalid', name: 'frames', arguments: { frames: 'wrong' } }] },
    { type: 'tool', calls: [{ id: 'corrected', name: 'frames', arguments: { frames: 'auto' } }] },
    { type: 'text', text: 'Corrected in place.' },
  ]);
  request.tools = [{ name: 'frames', description: 'Use a normalized frame count.',
    schema: z.object({ frames: z.preprocess((value) => value === 'auto' ? 24 : value, z.number().positive()) })
      .transform(({ frames }) => ({ frameCount: frames })) }];
  const events: RuntimeActivityEvent[] = [];
  const calls: unknown[] = [];
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: async (call) => { calls.push(call.args); return { ok: true, result: '24 approved' }; } });
  assert.equal(result.status, 'finished');
  assert.deepEqual(calls, [{ frameCount: 24 }]);
  assert.equal(http.requests.length, 3);
  assert.deepEqual(events.filter((event) => event.type === 'tool-call').map((event) => event.toolCallId), ['corrected']);
  assert.deepEqual(events.filter((event) => event.type === 'tool-error').map((event) => event.toolCallId), ['invalid']);
  assert.equal(result.toolCalls[0].decision, undefined);
  assert.equal(result.toolCalls[0].status, 'error');
  assert.equal(result.toolCalls[1].status, 'ok');
});
