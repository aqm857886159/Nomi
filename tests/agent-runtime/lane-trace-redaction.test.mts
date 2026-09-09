import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { JsonlSessionRepo, type Entry, type JsonValue } from '@earendil-works/pi-agent-core/harness/session';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { createLaneFileSystem } from '../../electron/agentLane/laneFileSystem.mjs';
import { deriveLaneTrace } from '../../electron/agentLane/laneTrace.mjs';
import { applyTraceRedactions, collectTraceRedactions, LANE_TRACE_REDACTIONS_NOTE } from '../../electron/agentLane/laneTraceRedaction.mjs';

function user(content: string, seq = 1): Entry {
  return { id: `user-${seq}`, parentId: null, seq, timestamp: seq, type: 'message', message: { role: 'user', content, timestamp: seq } };
}
function note(data: JsonValue, seq = 10): Entry {
  return { id: `note-${seq}`, parentId: null, seq, timestamp: seq, type: 'custom', customType: LANE_TRACE_REDACTIONS_NOTE, data };
}
function content(entry: Entry): string {
  assert.ok(entry.type === 'message' && entry.message.role === 'user');
  return String(entry.message.content);
}

test('a native custom location note protects a cold trace rebuild after the known key is unavailable', async () => {
  await mkdir('.tmp', { recursive: true });
  const projectDir = await mkdtemp(resolve('.tmp/trace-redaction-cold-'));
  const repo = new JsonlSessionRepo({ fileSystem: createLaneFileSystem(projectDir), sessionsRoot: join(projectDir, 'sessions') });
  const context = BACKGROUND_CONTEXT;
  const secret = 'fixture-credential-with-no-standard-prefix';
  try {
    const session = await repo.create({ cwd: projectDir }, context);
    const branch = await session.createBranch('main', null, context);
    await branch.appendMessage({ role: 'user', content: `Keep this manuscript. ${secret}`, timestamp: 1 }, context);
    const official = JSON.parse(await readFile(resolve('tests/fixtures/standard-formats/pi-session/conformance-messages.json'), 'utf8')) as { messages: AgentMessage[] };
    const assistant = structuredClone(official.messages.at(-1)!);
    assert.equal(assistant.role, 'assistant');
    if (assistant.role === 'assistant') assistant.content = [{ type: 'text', text: `Provider echoed ${secret}.` }];
    await branch.appendMessage(assistant, context);
    const entries = await session.findEntries({ order: 'asc' }, context);
    const locations = collectTraceRedactions(entries, [secret]);
    assert.notEqual(locations, null);
    const serialized = JSON.stringify(locations);
    assert.ok(!serialized.includes(secret));
    assert.ok(!serialized.includes('Keep this manuscript'));
    assert.ok(!serialized.includes('Provider echoed'));
    // Detached SDK custom entry: no model-context message or second recorder is introduced.
    await session.mutate(mutator => mutator.commit([{ kind: 'entry', entry: {
      id: session.idGenerator.next(), parentId: null, type: 'custom', customType: LANE_TRACE_REDACTIONS_NOTE, data: locations,
    } }], context), context);
    const metadata = session.metadata;
    await session.close(context);
    const reopened = await repo.open(metadata, context);
    const cold = await reopened.findEntries({ order: 'asc' }, context);
    const raw = JSON.stringify(cold);
    assert.ok(raw.includes(secret), 'this test does not rewrite the original user-supplied native transcript');
    const safe = applyTraceRedactions(cold);
    const rows = deriveLaneTrace(safe, metadata.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prompt, 'Keep this manuscript. «redacted»');
    assert.equal(rows[0].response, 'Provider echoed «redacted».');
    assert.ok(!JSON.stringify(rows).includes(secret));
    assert.equal(JSON.stringify(cold), raw, 'the native entry snapshot remains untouched');
    assert.equal(collectTraceRedactions(cold, [secret]), null, 'repeat scan appends no duplicate note');
    await reopened.close(context);
  } finally { await repo.close(context); await rm(projectDir, { recursive: true, force: true }); }
});

test('ordinary local text is unchanged and an empty known-key list writes no note', () => {
  const entries = [user('保留完整故事，连标点和 emoji 🌿 都不改。')];
  assert.equal(collectTraceRedactions(entries, []), null);
  assert.equal(collectTraceRedactions(entries, ['', 'not-present']), null);
  assert.deepEqual(applyTraceRedactions(entries), entries);
});

test('overlapping secrets and repeated annotations merge against original UTF-16 positions once', () => {
  const entry = user('😀 abcde abc tail');
  const first = note(collectTraceRedactions([entry], ['abc']));
  const second = note(collectTraceRedactions([entry, first], ['bcde']), 11);
  const entries = [entry, first, second];
  assert.equal(content(applyTraceRedactions(entries)[0]), '😀 «redacted» «redacted» tail');
  assert.equal(collectTraceRedactions(entries, ['abc', 'bcde']), null);
  assert.deepEqual(applyTraceRedactions(entries), applyTraceRedactions(entries));
  assert.equal(content(applyTraceRedactions([...entries, { ...second, id: 'duplicate', seq: 12 }])[0]), '😀 «redacted» «redacted» tail');
  assert.equal(content(entry), '😀 abcde abc tail');
});

test('secret object keys do not leak into path metadata, while unrelated fields remain readable', () => {
  const secret = 'fixture-key-as-property';
  const entry: Entry = { id: 'custom', parentId: null, seq: 1, timestamp: 1, type: 'custom', customType: 'fixture',
    data: { arguments: { [secret]: 'value' }, ordinary: 'original text' } };
  const locations = collectTraceRedactions([entry], [secret]);
  assert.ok(!JSON.stringify(locations).includes(secret));
  const safe = applyTraceRedactions([entry, note(locations)])[0];
  assert.equal(safe.type, 'custom');
  if (safe.type === 'custom') assert.deepEqual(safe.data, { arguments: '«redacted»', ordinary: 'original text' });
});

test('location notes cover earlier native entries only, and never traverse inherited object properties', () => {
  const entry = user('private', 20);
  const forward = note({ version: 1, redactions: [{ entryId: entry.id, path: ['message', 'content'], ranges: [[0, 7]] }] }, 10);
  assert.equal(content(applyTraceRedactions([forward, entry])[1]), 'private');
  const hostile = note({ version: 1, redactions: [{ entryId: entry.id, path: ['message', '__proto__', 'polluted'], omit: true }] }, 30);
  assert.equal(content(applyTraceRedactions([entry, hostile])[0]), 'private');
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});
