import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLaneFixture, mustConfirm } from './laneFixture.mjs';
import { openLaneTraceDirectory, laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import { traceSafeValue, type LaneTraceTurn } from '../../electron/agentLane/laneTrace.mjs';

async function readTurns(directory: string): Promise<LaneTraceTurn[]> {
  return (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('three real pi runs derive three complete rows, remain native-readable and rebuild on cold history', async t => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'trace-read', name: 'read_script', arguments: {} }] },
    { type: 'text', text: 'Read done.' },
    { type: 'text', text: 'Second.' },
    { type: 'text', text: 'Third.' },
  ], { hasUserInterface: true });
  const lane = await fixture.openLane({ ...fixture.options, model: { ...fixture.options.model,
    tokenPricing: { inputPerMTokUsd: 1, outputPerMTokUsd: 2 } } });
  for (const text of ['Read the story.', 'Continue.', 'Finish.']) await lane.execute({ kind: 'prompt', text });
  const directory = await openLaneTraceDirectory(fixture.projectDir, 'main');
  const rows = await readTurns(directory);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(row => row.prompt), ['Read the story.', 'Continue.', 'Finish.']);
  for (const row of rows) {
    assert.equal(row.sessionId, lane.sessionId);
    assert.equal(row.status, 'completed');
    assert.ok(row.turnId);
    assert.ok(row.timestamp > 0);
    assert.ok(row.durationMs !== null && row.durationMs >= 0);
    assert.ok(row.models.length > 0);
    assert.deepEqual(Object.keys(row.tokens), ['input', 'cacheRead', 'cacheWrite', 'output']);
    assert.equal(typeof row.estimatedCostUsd, 'number');
    assert.equal(row.pricing, 'priced');
    assert.ok(Array.isArray(row.approvals));
    assert.ok(Array.isArray(row.errors));
  }
  assert.equal(rows[0].tools[0].name, 'read_script');
  assert.equal(rows[0].tools[0].failed, false);
  assert.ok(rows[0].tools[0].durationMs !== null);
  assert.match(rows[0].tools[0].resultSummary!, /opening scene/);
  assert.ok(rows[0].approvals.length > 0);
  assert.equal((await stat(join(directory, 'trace.jsonl'))).mode & 0o777, 0o600);
  const root = await openLaneTraceDirectory(fixture.projectDir);
  assert.match(await readFile(join(root, 'index.md'), 'utf8'), /3 turns/);
  assert.equal((await readdir(laneSessionsRoot(fixture.projectDir))).filter(name => name.endsWith('.jsonl')).length, 0);
  await lane.close();
  const original = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  await rm(directory, { recursive: true });
  assert.equal(await openLaneTraceDirectory(fixture.projectDir, 'main'), directory);
  assert.equal(await readFile(join(directory, 'trace.jsonl'), 'utf8'), original);
});

test('unpriced costs stay unknown; two independent sessions never overwrite each other', async t => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'One.' }, { type: 'text', text: 'Two.' }]);
  const first = await fixture.openLane(fixture.options);
  await first.execute({ kind: 'prompt', text: 'First.' });
  const second = await fixture.openLane({ ...fixture.options, laneName: 'other' });
  await second.execute({ kind: 'prompt', text: 'Second.' });
  const a = await openLaneTraceDirectory(fixture.projectDir, 'main');
  const b = await openLaneTraceDirectory(fixture.projectDir, 'other');
  assert.notEqual(a, b);
  assert.equal((await readTurns(a))[0].estimatedCostUsd, null);
  assert.equal((await readTurns(b))[0].prompt, 'Second.');
});

test('trace copies redact nested credentials, known secrets and images without modifying source text', () => {
  const input = { prompt: 'Original manuscript.', arguments: { apiKey: 'hidden-secret' },
    response: 'Echo fixture-secret', error: 'Authorization: Bearer abcdefgh12345',
    content: [{ type: 'image', data: 'ORIGINAL_BINARY', mimeType: 'image/png' }], url: 'data:image/png;base64,YWJjZA==' };
  const safe = JSON.stringify(traceSafeValue(input, ['fixture-secret']));
  assert.match(safe, /Original manuscript/);
  for (const secret of ['hidden-secret', 'fixture-secret', 'abcdefgh12345', 'ORIGINAL_BINARY', 'YWJjZA==']) assert.ok(!safe.includes(secret));
  assert.equal(input.response, 'Echo fixture-secret');
});

test('policy denial and failed tool results remain explicit in the derived row', async t => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'denied-write', name: 'write_script', arguments: { where: 'end', content: 'Do not apply.' } }] },
    { type: 'text', text: 'Approval is required.' },
  ], mustConfirm({ hasUserInterface: false }));
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  await lane.execute({ kind: 'prompt', text: 'Append a line.' });
  const [row] = await readTurns(await openLaneTraceDirectory(fixture.projectDir, 'main'));
  assert.equal(fixture.document.text(), before);
  assert.equal(row.tools[0].failed, true);
  assert.equal(row.tools[0].failureCode, 'approval_denied_by_policy');
  assert.ok(row.errors.length > 0);
  assert.equal((row.approvals[0] as { decision: string }).decision, 'denied-by-policy');
});

test('immediate shape rejection, retry wall, and structured upstream vendor diagnostics derive closed failureCode and error kinds', async t => {
  const { deriveLaneTrace } = await import('../../electron/agentLane/laneTrace.mjs');
  const { describeAgentError } = await import('../../electron/ai/agentError.js');
  const { VendorRequestError } = await import('../../electron/shared/vendorFailure.js');
  const { LANE_OUTPUT_TRUNCATED_DIAGNOSTIC, LANE_VENDOR_FAILURE_DIAGNOSTIC } = await import('../../electron/shared/agentLane/laneAssistantFault.js');

  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'bad-shape', name: 'write_script', arguments: { unexpected: 123 } }] },
    { type: 'text', text: 'Fixed call skipped.' },
  ]);
  const lane = await fixture.openLane(fixture.options);
  await lane.execute({ kind: 'prompt', text: 'Try invalid tool arguments.' });
  const [liveRow] = await readTurns(await openLaneTraceDirectory(fixture.projectDir, 'main'));
  assert.equal(liveRow.tools[0].failed, true);
  assert.equal(liveRow.tools[0].failureCode, 'tool_arguments_invalid');

  const authPayload = describeAgentError(new VendorRequestError('HTTP 401', {
    vendorKey: 'apimart',
    method: 'POST',
    url: 'https://api.example.com/v1/chat/completions',
    httpStatus: 401,
    category: 'auth',
    retryable: false,
    upstreamMsg: 'invalid key sk-secret-echo',
  }));
  const rateLimitPayload = describeAgentError(new VendorRequestError('HTTP 429', {
    vendorKey: 'apimart',
    method: 'POST',
    url: 'https://api.example.com/v1/chat/completions',
    httpStatus: 429,
    category: 'quota',
    retryable: true,
    upstreamMsg: 'too many requests',
  }));
  const derived = deriveLaneTrace([
    { id: 'u1', parentId: null, timestamp: 1000, type: 'message', message: { role: 'user', content: 'hi', timestamp: 1000 } },
    {
      id: 'a1', parentId: 'u1', timestamp: 1010, type: 'message',
      message: {
        role: 'assistant', provider: 'apimart', model: 'gpt-5.5', api: 'openai-completions', timestamp: 1010,
        content: [{ type: 'toolCall', id: 'c-stop', name: 'write_script', arguments: {} }],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: '401 Unauthorized',
        diagnostics: [{ type: LANE_VENDOR_FAILURE_DIAGNOSTIC, timestamp: 1010, details: { message: authPayload } }],
      },
    },
    {
      id: 't1', parentId: 'a1', timestamp: 1012, type: 'message',
      message: {
        role: 'toolResult', toolCallId: 'c-stop', toolName: 'write_script', isError: true, timestamp: 1012,
        content: [{ type: 'text', text: 'write_script was not run (tool_retry_stopped). Retry limit reached.' }],
      },
    },
    {
      id: 'a2', parentId: 't1', timestamp: 1020, type: 'message',
      message: {
        role: 'assistant', provider: 'apimart', model: 'gpt-5.5', api: 'openai-completions', timestamp: 1020,
        content: [],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: '429 Too Many Requests',
        diagnostics: [
          { type: LANE_VENDOR_FAILURE_DIAGNOSTIC, timestamp: 1020, details: { message: rateLimitPayload } },
          { type: LANE_OUTPUT_TRUNCATED_DIAGNOSTIC, timestamp: 1020, details: { reason: 'output_cap_tool_call' } },
        ],
      },
    },
  ] as never, 'sess-1');
  assert.equal(derived[0].tools[0].failureCode, 'tool_retry_stopped');
  assert.deepEqual(derived[0].errors, ['auth', 'tool_retry_stopped', 'rate-limit', 'output-truncated']);
});

test('onTurnCompleted reports retryCount=0 on first-try success and breakerTripped=true on retry-wall stop', async t => {
  const completed: Array<Record<string, unknown>> = [];
  const fixture = await createLaneFixture(t, [
    // Turn 1: 1 clean tool call -> retryCount: 0, result: 'success'
    { type: 'tool', calls: [{ id: 'clean-read', name: 'read_script', arguments: {} }] },
    { type: 'text', text: 'Done on first try.' },
    // Turn 2: 4 consecutive invalid calls to hit the 3-strike retry wall -> breakerTripped: true, result: 'failure', faultCategory: 'tool_refused'
    { type: 'tool', calls: [{ id: 'bad-1', name: 'write_script', arguments: { bad: 1 } }] },
    { type: 'tool', calls: [{ id: 'bad-2', name: 'write_script', arguments: { bad: 2 } }] },
    { type: 'tool', calls: [{ id: 'bad-3', name: 'write_script', arguments: { bad: 3 } }] },
    { type: 'tool', calls: [{ id: 'bad-4', name: 'write_script', arguments: { bad: 4 } }] },
    { type: 'text', text: 'Unreachable.' },
  ]);
  const lane = await fixture.openLane({
    ...fixture.options,
    onTurnCompleted: (turn) => { completed.push({ ...turn }); },
  });
  await lane.execute({ kind: 'prompt', text: 'Read cleanly.' });
  await lane.execute({ kind: 'prompt', text: 'Keep calling invalid args.' }).catch(() => undefined);

  assert.equal(completed.length, 2);
  assert.equal(completed[0].result, 'success');
  assert.equal(completed[0].retryCount, 0);
  assert.equal(completed[0].toolCallCount, 1);
  assert.equal(completed[0].breakerTripped, false);
  assert.equal('faultCategory' in completed[0], false);

  assert.equal(completed[1].result, 'failure');
  assert.equal(completed[1].breakerTripped, true);
  assert.equal(completed[1].faultCategory, 'tool_refused');
  assert.ok((completed[1].retryCount as number) >= 3);
});

test('history-only owner can open and rebuild the trace without opening the native session twice', async t => {
  const fixture = await createLaneFixture(t, [{ type: 'text', text: 'Remember this.' }]);
  const live = await fixture.openLane(fixture.options);
  await live.execute({ kind: 'prompt', text: 'A history prompt.' });
  await live.close();
  const { openLaneHistory } = await import('../../electron/agentLane/laneHistory.mjs');
  const history = await openLaneHistory({ projectDir: fixture.projectDir });
  fixture.after(() => history.close());
  const directory = await openLaneTraceDirectory(fixture.projectDir, 'main');
  assert.equal((await readTurns(directory))[0].prompt, 'A history prompt.');
});

test('copied projects with the same native session id retain independent live trace owners', async t => {
  const { cp } = await import('node:fs/promises');
  const first = await createLaneFixture(t, [{ type: 'text', text: 'Source.' }]);
  const a = await first.openLane(first.options);
  await a.execute({ kind: 'prompt', text: 'Source prompt.' });
  const second = await createLaneFixture(t, [{ type: 'text', text: 'Copy.' }]);
  await cp(join(first.projectDir, '.nomi'), join(second.projectDir, '.nomi'), { recursive: true });
  const b = await second.openLane(second.options);
  assert.equal(a.sessionId, b.sessionId);
  await b.execute({ kind: 'prompt', text: 'Copy prompt.' });
  const original = await openLaneTraceDirectory(first.projectDir, 'main');
  const copy = await openLaneTraceDirectory(second.projectDir, 'main');
  assert.ok(original.startsWith(first.projectDir));
  assert.ok(copy.startsWith(second.projectDir));
  assert.equal((await readTurns(original)).length, 1);
  assert.equal((await readTurns(copy)).length, 2);
});

test('live credential echo stays redacted after deleting derived files and rebuilding without model credentials', async t => {
  const secret = 'fixture-key-without-a-common-prefix';
  const fixture = await createLaneFixture(t, [{ type: 'text', text: `Echo ${secret}.` }]);
  const lane = await fixture.openLane({ ...fixture.options, model: { ...fixture.options.model, apiKey: secret } });
  await lane.execute({ kind: 'prompt', text: `Keep this original sentence. ${secret}` });
  const directory = await openLaneTraceDirectory(fixture.projectDir, 'main');
  const before = await readFile(join(directory, 'trace.jsonl'), 'utf8');
  assert.ok(!before.includes(secret));
  assert.match(before, /Keep this original sentence/);
  await lane.close();
  await rm(directory, { recursive: true });
  await openLaneTraceDirectory(fixture.projectDir, 'main');
  assert.equal(await readFile(join(directory, 'trace.jsonl'), 'utf8'), before);
});

test('rewriting an unchanged derived trace is a read: same file, no temp, no rename', async t => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { writeTraceFile } = await import('../../electron/agentLane/laneTrace.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'nomi-trace-same-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeTraceFile(directory, 'trace.md', 'same\n');
  const before = await stat(join(directory, 'trace.md'));
  await writeTraceFile(directory, 'trace.md', 'same\n');
  const after = await stat(join(directory, 'trace.md'));
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readdir(directory), ['trace.md']);
  await writeTraceFile(directory, 'trace.md', 'changed\n');
  assert.equal(await readFile(join(directory, 'trace.md'), 'utf8'), 'changed\n');
});

test('an unchanged trace still re-tightens a loosened trace directory (skip the write, not the permission repair)', { skip: process.platform === 'win32' && 'POSIX modes only' }, async t => {
  const { mkdtemp, chmod } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { writeTraceFile } = await import('../../electron/agentLane/laneTrace.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'nomi-trace-mode-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeTraceFile(directory, 'trace.md', 'same\n');
  const tightened = (await stat(directory)).mode & 0o777;
  await chmod(directory, 0o777);
  await writeTraceFile(directory, 'trace.md', 'same\n');
  assert.equal((await stat(directory)).mode & 0o777, tightened);
});
