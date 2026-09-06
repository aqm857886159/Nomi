import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { exportSnapshot, importSnapshot } from '../../electron/harness/runtime/pi/snapshot.mjs';

const usage = {
  input: 20, output: 10, cacheRead: 4, cacheWrite: 2, totalTokens: 36,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
function assistant(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return { role: 'assistant', content, api: 'openai-completions', provider: 'nomi-test',
    model: 'fixture-model', usage, stopReason, timestamp: 1 };
}
function transcript(cwd: string) {
  const manager = SessionManager.inMemory(cwd);
  manager.appendModelChange('nomi-test', 'fixture-model');
  manager.appendThinkingLevelChange('off');
  const userId = manager.appendMessage({ role: 'user', content: 'Prepare shot 2', timestamp: 1 });
  manager.appendMessage(assistant([{ type: 'toolCall', id: 'call-1', name: 'read_shot', arguments: { shot: 2 } }], 'toolUse'));
  manager.appendMessage({ role: 'toolResult', toolCallId: 'call-1', toolName: 'read_shot',
    content: [{ type: 'text', text: '{"shot":2,"approved":true}' }], isError: false, timestamp: 2 });
  manager.appendMessage(assistant([{ type: 'text', text: 'Shot 2 is approved.' }], 'stop'));
  return { manager, userId };
}
function serialize(manager: SessionManager) {
  return exportSnapshot({ sessionManager: manager, isIdle: true, isCompacting: false });
}
function altered(serialized: string, change: (data: Record<string, unknown>) => void) {
  const envelope = JSON.parse(serialized);
  change(envelope.data);
  envelope.sha256 = createHash('sha256').update(JSON.stringify(envelope.data)).digest('hex');
  return JSON.stringify(envelope);
}

test('round-trips full tool pairs, usage, entries and selected leaf through the public loader', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-snapshot-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager } = transcript(root);
  const snapshot = serialize(manager);
  const restored = await importSnapshot(snapshot, { cwd: root, tempRoot: root });
  // JSON has no undefined values (pi's fresh header has parentSession: undefined).
  assert.deepEqual(restored.getHeader(), JSON.parse(JSON.stringify(manager.getHeader())));
  assert.deepEqual(restored.getEntries(), manager.getEntries());
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
  assert.equal(restored.getLeafId(), manager.getLeafId());
  assert.deepEqual(await readdir(root), [], 'private materialization must be removed');
  restored.appendMessage({ role: 'user', content: 'Continue', timestamp: 3 });
  assert.deepEqual(await readdir(root), [], 'resumed manager must remain in memory');
});

test('preserves compaction boundary, summary usage, custom attachment metadata and an earlier branch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-compaction-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager, userId } = transcript(root);
  manager.appendCompaction('Keep the approved coffee brand.', userId, 2200, { policy: 'retain-brand' }, false, usage);
  const branchId = manager.appendCustomMessageEntry('nomi-attachment', 'PDF reference', false,
    { mediaType: 'application/pdf', data: 'JVBERi0xLjc=' });
  manager.appendMessage({ role: 'user', content: 'Abandoned direction', timestamp: 5 });
  manager.branch(branchId);
  const restored = await importSnapshot(serialize(manager), { cwd: root, tempRoot: root });
  assert.equal(restored.getLeafId(), branchId, 'do not silently pick the last physical entry');
  assert.deepEqual(restored.getEntries(), manager.getEntries(), 'preserve other branches without merging them');
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
  assert.equal(restored.buildSessionContext().messages.some((m) => m.role === 'compactionSummary'), true);
});

test('preserves an explicitly empty leaf without reviving abandoned history', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-empty-leaf-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager } = transcript(root);
  manager.resetLeaf();
  const restored = await importSnapshot(serialize(manager), { cwd: root, tempRoot: root });
  assert.equal(restored.getLeafId(), null);
  assert.deepEqual(restored.getEntries(), manager.getEntries());
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
});

test('does not export while a turn or compaction is in flight', () => {
  const { manager } = transcript(tmpdir());
  assert.throws(() => exportSnapshot({ sessionManager: manager, isIdle: false, isCompacting: false }), /stable|idle/i);
  assert.throws(() => exportSnapshot({ sessionManager: manager, isIdle: true, isCompacting: true }), /stable|idle/i);
});

test('rejects truncated, wrong-version, damaged and broken graph snapshots without creating files', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-corrupt-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager } = transcript(root);
  const snapshot = serialize(manager);
  const bad = [snapshot.slice(0, -2), snapshot.replace('fixture-model', 'tampered-model'),
    JSON.stringify({ ...JSON.parse(snapshot), version: 99 }),
    altered(snapshot, (data) => { data.leafId = 'missing'; }),
    altered(snapshot, (data) => {
      const entries = data.entries as Array<Record<string, unknown>>;
      entries[0].parentId = entries[entries.length - 1].id;
    }),
    altered(snapshot, (data) => {
      const entries = data.entries as Array<Record<string, unknown>>;
      entries.push(entries[0]);
    }),
  ];
  for (const serialized of bad) {
    await assert.rejects(() => importSnapshot(serialized, { cwd: root, tempRoot: root }));
  }
  assert.deepEqual(await readdir(root), []);
});

test('retains an interrupted tool call as history without inventing a result or invoking an executor', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-interrupted-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: 'user', content: 'Read shot 3', timestamp: 1 });
  manager.appendMessage(assistant([{ type: 'toolCall', id: 'pending-1', name: 'read_shot', arguments: { shot: 3 } }], 'toolUse'));
  const restored = await importSnapshot(serialize(manager), { cwd: root, tempRoot: root });
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
  assert.equal(restored.buildSessionContext().messages.filter((m) => m.role === 'toolResult').length, 0);
});

test('rejects malformed message bodies rather than silently losing their content', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-bad-message-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager } = transcript(root);
  const snapshot = serialize(manager);
  const corruptions = [
    (entry: Record<string, unknown>) => { delete entry.message; },
    (entry: Record<string, unknown>) => { (entry.message as Record<string, unknown>).content = null; },
    (entry: Record<string, unknown>) => { (entry.message as Record<string, unknown>).content = [{ type: 'text' }]; },
    (entry: Record<string, unknown>) => { (entry.message as Record<string, unknown>).role = 'compactionSummary'; },
  ];
  for (const corrupt of corruptions) {
    await assert.rejects(() => importSnapshot(altered(snapshot, (data) => {
      const entries = data.entries as Array<Record<string, unknown>>;
      corrupt(entries.find((entry) => entry.type === 'message')!);
    }), { cwd: root, tempRoot: root }));
  }
  assert.deepEqual(await readdir(root), []);
});

test('compaction cannot keep entries from an abandoned sibling branch', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-bad-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = SessionManager.inMemory(root);
  const rootId = manager.appendMessage({ role: 'user', content: 'Original brief', timestamp: 1 });
  const siblingId = manager.appendMessage({ role: 'user', content: 'Abandoned direction', timestamp: 2 });
  manager.branch(rootId);
  const keptId = manager.appendMessage({ role: 'user', content: 'Must remain', timestamp: 3 });
  manager.appendCompaction('Keep the current direction.', keptId, 100);
  const snapshot = serialize(manager);
  const restored = await importSnapshot(snapshot, { cwd: root, tempRoot: root });
  assert.deepEqual(restored.buildSessionContext(), manager.buildSessionContext());
  await assert.rejects(() => importSnapshot(altered(snapshot, (data) => {
    const entries = data.entries as Array<Record<string, unknown>>;
    entries.find((entry) => entry.type === 'compaction')!.firstKeptEntryId = siblingId;
  }), { cwd: root, tempRoot: root }), /compaction|ancestor/i);
  assert.deepEqual(await readdir(root), []);
});

// PR-1 (pi 0.85.1) singled this out: the envelope's `piVersion` was a `z.literal`
// on both sides, so upgrading pi without widening the reader would have made every
// snapshot already sitting in a user's project unreadable — a silent history loss
// that no other test would have caught (they all write and read in one process).
test('writes the running pi version and still reads snapshots written by the previous one', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nomi-pi-version-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { manager } = transcript(root);
  const serialized = serialize(manager);
  assert.equal(JSON.parse(serialized).piVersion, '0.85.1', 'the writer emits the version this build runs');

  const legacy = JSON.parse(serialized);
  legacy.piVersion = '0.84.3';
  // Only the envelope's version field changes; the checksum covers `data`, so a
  // genuine 0.84.3 file differs from this one in nothing that the reader checks.
  const restored = await importSnapshot(JSON.stringify(legacy), { cwd: root, tempRoot: root });
  assert.deepEqual(restored.getEntries(), manager.getEntries());
  assert.equal(restored.getLeafId(), manager.getLeafId());

  const unknown = JSON.parse(serialized);
  unknown.piVersion = '0.86.0';
  await assert.rejects(() => importSnapshot(JSON.stringify(unknown), { cwd: root, tempRoot: root }),
    'an unregistered pi version must fail closed, not be read on a guess');
});
