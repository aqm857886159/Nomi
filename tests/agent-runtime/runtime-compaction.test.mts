import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import type { RuntimeActivityEvent } from '../../electron/harness/runtime/runtimePort.js';
import { runAgentTurn } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { createRuntimeFixture, type FixtureReply } from './httpFixture.mjs';

function tool(index: number): FixtureReply {
  return { type: 'tool', calls: [{ id: `compact-${index}`, name: 'read_shot', arguments: {} }] };
}

test('mid-step overflow uses one SDK summary, retains its prompt/budget/usage, and never resets the eight-request budget', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    tool(1), tool(2), { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'text', text: 'Summary: keep the approved creative decisions.' },
    ...Array.from({ length: 6 }, (_, index) => tool(index + 4)),
  ]);
  request.user = { durableText: 'CURRENT_INTENT '.repeat(500), currentContextText: 'TRANSIENT_WORK_NOT_A_SUMMARY' };
  request.model.maxOutputTokens = 30_000;
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  const events: RuntimeActivityEvent[] = [];
  const result = await runAgentTurn(request, { emit: (event) => events.push(event),
    awaitToolConfirmation: async () => ({ ok: true, result: 'TOOL_RESULT '.repeat(50) }) });
  assert.equal(result.context?.summaryRequests, 1);
  assert.equal(result.context?.normalRequests, 8);
  assert.equal(result.context?.compactions, 1);
  assert.equal(http.requests.length, 9);
  assert.equal(result.error?.kind, 'step-limit');
  const summary = http.requests[3].body;
  assert.notEqual((summary.messages as Array<{ content: unknown }>)[0].content, request.systemPrompt);
  assert.match(JSON.stringify(summary), /summar/i);
  assert.doesNotMatch(JSON.stringify(summary), /TRANSIENT_WORK_NOT_A_SUMMARY/);
  assert.equal(summary.max_tokens, 512, 'this one-current-turn compaction uses the SDK turn-prefix budget');
  assert.ok(!summary.tools || (summary.tools as unknown[]).length === 0);
  assert.equal(http.requests[0].body.max_tokens, 30_000);
  assert.equal(result.text.includes('Summary:'), false, 'summary output is not normal user-visible text');
  assert.equal(events.some((event) => event.type === 'content-delta' && event.delta.includes('Summary:')), false);
  // 夹具报的 reasoning 是 0——**报了 0** 和「没报」是两件事，字段在就说明这家报过。
  assert.deepEqual(result.usage, { promptTokens: 80, completionTokens: 32, cachedPromptTokens: 0, totalTokens: 112, reasoningTokens: 0 });
  assert.deepEqual(http.requests.map((call) => JSON.stringify(call.body).includes('TRANSIENT_WORK_NOT_A_SUMMARY')),
    [true, true, true, false, true, true, true, true, true]);
  assert.doesNotMatch(result.snapshot ?? '', /TRANSIENT_WORK_NOT_A_SUMMARY/);
});

test('an overflow on the last admitted request cannot launch a summary or ninth normal request', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    ...Array.from({ length: 7 }, (_, index) => tool(index)),
    { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'text', text: 'Must not summarize.' },
  ]);
  request.user.durableText = 'CURRENT_INTENT '.repeat(500);
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, { emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true, result: 'TOOL_RESULT '.repeat(50) }) });
  assert.equal(http.requests.length, 8);
  assert.equal(result.context?.summaryRequests, 0);
  assert.equal(result.status, 'error');
  assert.equal(result.error?.status, 400);
});

test('a recovered earlier overflow does not poison the final successful answer', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    tool(1), tool(2), { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'text', text: 'Summary: keep the references.' }, { type: 'text', text: 'Recovered final answer.' },
  ]);
  request.user = { durableText: 'CURRENT_INTENT '.repeat(500), currentContextText: 'CURRENT_WORK_PROBE_UNIQUE' };
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, { emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true, result: 'TOOL_RESULT '.repeat(50) }) });
  assert.equal(result.status, 'finished');
  assert.equal(result.error, undefined);
  assert.equal(result.text, 'Recovered final answer.');
  assert.equal(http.requests.length, 5);
  assert.equal(result.usage.totalTokens, 56);
  assert.deepEqual(http.requests.map((call) => JSON.stringify(call.body).includes('CURRENT_WORK_PROBE_UNIQUE')),
    [true, true, true, false, true]);
  assert.doesNotMatch(result.snapshot ?? '', /CURRENT_WORK_PROBE_UNIQUE/);
});

test('an overflow whose summary fails remains the failed normal call and includes consumed requests', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    tool(1), tool(2), { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'error', status: 500, message: 'Summary unavailable' },
  ]);
  request.user.durableText = 'CURRENT_INTENT '.repeat(500);
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, { emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true, result: 'TOOL_RESULT '.repeat(50) }) });
  assert.equal(http.requests.length, 4);
  assert.equal(result.status, 'error');
  assert.equal(result.error?.status, 400, 'the original failed normal request is the terminal failure');
  assert.equal(result.usage.totalTokens, 28);
  assert.match(result.snapshot ?? '', /context_length_exceeded/);
});

test('usage from a successful first summary is retained when the SDK turn-prefix summary later fails', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'APPROVED_PRIOR' }, tool(1), tool(2),
    { type: 'error', status: 400, message: 'context_length_exceeded' },
    { type: 'text', text: 'Successful history summary.' },
    { type: 'error', status: 400, message: 'deterministic turn-prefix summary failure' },
  ]);
  const hooks = { emit: () => {},
    awaitToolConfirmation: async () => ({ ok: true as const, result: 'TOOL_RESULT '.repeat(50) }) };
  request.user.durableText = 'PRIOR_BRIEF '.repeat(500);
  const seeded = await runAgentTurn(request, hooks);
  request.snapshot = seeded.snapshot;
  request.user.durableText = 'CURRENT_INTENT '.repeat(500);
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  request.tools = [{ name: 'read_shot', description: 'Read.', schema: z.object({}) }];
  const result = await runAgentTurn(request, hooks);
  assert.equal(result.context?.summaryRequests, 2);
  assert.equal(result.context?.normalRequests, 3);
  assert.equal(result.context?.compactions, 0);
  assert.equal(result.usage.totalTokens, 42, 'two normal calls + one consumed summary, not just successful compactions');
  assert.equal(result.error?.status, 400);
  assert.match(result.error?.body ?? '', /context_length_exceeded/);
  assert.equal(http.requests.length, 6);
  assert.equal(http.requests[4].body.max_tokens, 819);
  assert.equal(http.requests[5].body.max_tokens, 512);
  assert.doesNotMatch(result.snapshot ?? '', /"type":"compaction"/);
});

test('threshold summary failure after a real answer warns while retaining the successful answer and old history', async (t) => {
  const { request, http } = await createRuntimeFixture(t, [
    { type: 'text', text: 'APPROVED_PRIOR' },
    { type: 'text', text: 'The real answer is complete.', usage: { input: 3500, output: 4 } },
    { type: 'error', status: 400, message: 'Threshold summary failed' },
  ]);
  const events: RuntimeActivityEvent[] = [];
  const hooks = { emit: (event: RuntimeActivityEvent) => events.push(event),
    awaitToolConfirmation: async () => ({ ok: true as const }) };
  request.user.durableText = 'PRIOR_BRIEF '.repeat(500);
  const first = await runAgentTurn(request, hooks);
  request.snapshot = first.snapshot;
  request.model.contextWindow = 4096;
  request.user = { durableText: 'CURRENT_INTENT '.repeat(500), currentContextText: 'LATEST_FULL_WORK' };
  request.compaction = { enabled: true, keepRecentTokens: 100, reserveTokens: 1024 };
  const result = await runAgentTurn(request, hooks);
  assert.equal(http.requests.length, 3);
  assert.equal(result.context?.summaryRequests, 1);
  assert.equal(result.status, 'finished');
  assert.equal(result.text, 'The real answer is complete.');
  assert.equal(result.error, undefined);
  assert.equal(events.filter((event) => event.type === 'warning').length, 1);
  assert.equal(result.usage.totalTokens, 3504);
  assert.match(result.snapshot ?? '', /APPROVED_PRIOR/);
  assert.doesNotMatch(result.snapshot ?? '', /"type":"compaction"/);
  assert.doesNotMatch(JSON.stringify(http.requests[2].body), /LATEST_FULL_WORK/);
});
