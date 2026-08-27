import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { bubblesToSeedTurns } from '../../electron/harness/context/legacyBubbles.js';
import { snapshotCodec } from '../../electron/harness/runtime/pi/nativeLoader.cjs';
import { exportSnapshot, importSnapshot } from '../../electron/harness/runtime/pi/snapshot.mjs';

async function scratch(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-context-codec-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { cwd: root, tempRoot: root };
}

test('real SDK imports explicit UI text with honest unknown metadata and no fabricated tools or approvals', async (t) => {
  const options = await scratch(t);
  const turns = bubblesToSeedTurns([
    { role: 'user', content: 'Read my shot.' },
    { role: 'assistant', content: 'I read it.' },
    { role: 'tool', content: 'Old UI operation note\nDETAILS_NOT_IMPORTED' },
  ]);
  const serialized = await snapshotCodec.importLegacy(turns, options);
  assert.notEqual(serialized, '', 'a real opaque SDK snapshot must be returned');
  const restored = await importSnapshot(serialized, options);
  const messages = restored.buildSessionContext().messages;
  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant']);
  assert.deepEqual(messages.map((message) => message.timestamp), [0, 0]);
  const assistant = messages.find((message): message is AssistantMessage => message.role === 'assistant');
  assert.ok(assistant);
  assert.deepEqual(assistant.content, [{ type: 'text', text: 'I read it.\n\n（已执行操作：Old UI operation note）' }]);
  assert.equal(assistant.api, 'nomi-legacy-import');
  assert.equal(assistant.provider, 'nomi-legacy-import');
  assert.equal(assistant.model, 'unknown');
  assert.deepEqual(assistant.usage, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
  const entries = restored.getEntries();
  assert.equal(entries.length, 3);
  const provenance = entries.find((entry) => entry.type === 'custom');
  assert.ok(provenance && provenance.type === 'custom');
  assert.equal(provenance.customType, 'nomi-legacy-import');
  assert.deepEqual(provenance.data, { source: 'legacy-limited', provider: 'unknown', model: 'unknown',
    timestamps: 'unknown', usage: 'unknown', toolNotes: 'ui-text-only' });
  assert.equal(messages.filter((message) => message.role === 'toolResult').length, 0);
  assert.equal(assistant.content.filter((item) => item.type === 'toolCall').length, 0);
  assert.doesNotMatch(serialized, /DETAILS_NOT_IMPORTED|approvalId|internalSpendGrant/);
  assert.deepEqual(await snapshotCodec.inspect(serialized, options), { retainedMessages: 2 });
  assert.deepEqual(await readdir(options.tempRoot), [], 'SDK materializations leave no files behind');
});

test('empty legacy input exports an actually empty SDK context without inventing an old turn', async (t) => {
  const options = await scratch(t);
  const serialized = await snapshotCodec.importLegacy([], options);
  assert.notEqual(serialized, '');
  const restored = await importSnapshot(serialized, options);
  assert.deepEqual(restored.getEntries(), []);
  assert.deepEqual(restored.buildSessionContext().messages, []);
  assert.deepEqual(await snapshotCodec.inspect(serialized, options), { retainedMessages: 0 });
  assert.deepEqual(await readdir(options.tempRoot), []);
});

test('inspection uses the real loader for native tool pairs, image/PDF metadata and compaction, returning only plain counts', async (t) => {
  const options = await scratch(t);
  const manager = SessionManager.inMemory(options.cwd);
  const first = manager.appendMessage({ role: 'user', content: [{ type: 'text', text: 'The reference.' },
    { type: 'image', data: 'cG5n', mimeType: 'image/png' }], timestamp: 1 });
  manager.appendMessage({ role: 'assistant', api: 'openai-completions', provider: 'fixture', model: 'chosen',
    content: [{ type: 'toolCall', id: 'read-1', name: 'read_shot', arguments: {} }], timestamp: 2,
    stopReason: 'toolUse', usage: { input: 10, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 13,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
  manager.appendMessage({ role: 'toolResult', toolCallId: 'read-1', toolName: 'read_shot',
    content: [{ type: 'text', text: 'Read once, not an approval to replay.' }], isError: false, timestamp: 3 });
  manager.appendCustomMessageEntry('nomi-attachment', 'PDF reference', false,
    { mediaType: 'application/pdf', data: 'JVBERi0xLjc=' });
  manager.appendCompaction('Keep the reference.', first, 500);
  const serialized = exportSnapshot({ sessionManager: manager, isIdle: true, isCompacting: false });
  const metadata = await snapshotCodec.inspect(serialized, options);
  assert.equal(metadata.retainedMessages, manager.buildSessionContext().messages.length);
  assert.deepEqual(Object.keys(metadata), ['retainedMessages']);
  const restored = await importSnapshot(serialized, options);
  assert.deepEqual(restored.getEntries(), JSON.parse(JSON.stringify(manager.getEntries())));
  assert.deepEqual(await readdir(options.tempRoot), []);
});

test('inspection rejects a corrupt snapshot instead of pretending the binding is empty', async (t) => {
  const options = await scratch(t);
  await assert.rejects(() => snapshotCodec.inspect('{broken', options));
  assert.deepEqual(await readdir(options.tempRoot), []);
});
