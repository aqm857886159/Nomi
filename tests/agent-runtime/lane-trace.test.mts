import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLaneFixture } from './laneFixture.mjs';
import { openLaneTraceDirectory, laneSessionsRoot } from '../../electron/agentLane/laneSession.mjs';
import { traceSafeValue, type LaneTraceTurn } from '../../electron/agentLane/laneTrace.mjs';

async function readTurns(directory: string): Promise<LaneTraceTurn[]> {
  return (await readFile(join(directory, 'trace.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('three real pi runs derive three complete rows, remain native-readable and rebuild on cold history', async t => {
  const fixture = await createLaneFixture(t, [
    { type: 'tool', calls: [{ id: 'trace-read', name: 'read_full_text', arguments: {} }] },
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
  assert.equal(rows[0].tools[0].name, 'read_full_text');
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
    { type: 'tool', calls: [{ id: 'denied-write', name: 'append_to_end', arguments: { content: 'Do not apply.' } }] },
    { type: 'text', text: 'Approval is required.' },
  ], { hasUserInterface: false, policy: () => ({ mode: 'step', spend: 'confirm' }) });
  const lane = await fixture.openLane(fixture.options);
  const before = fixture.document.text();
  await lane.execute({ kind: 'prompt', text: 'Append a line.' });
  const [row] = await readTurns(await openLaneTraceDirectory(fixture.projectDir, 'main'));
  assert.equal(fixture.document.text(), before);
  assert.equal(row.tools[0].failed, true);
  assert.ok(row.errors.length > 0);
  assert.equal((row.approvals[0] as { decision: string }).decision, 'denied-by-policy');
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
