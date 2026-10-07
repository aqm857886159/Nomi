import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { migrateLaneLegacy } from '../../electron/agentLane/laneLegacyMigration.mjs';
import { openLaneHistory } from '../../electron/agentLane/laneHistory.mjs';
import { deleteLaneSession } from '../../electron/agentLane/laneSession.mjs';
import { openLegacyImportLane } from '../../electron/agentLane/laneLegacyImportLane.mjs';

const binding = { projectId: 'fixture', immutableProjectUuid: '12345678-1234-4234-8234-123456789abc', projectGeneration: 1 };
const labels = { summaryPrefix: 'Legacy summary: ', unverifiedToolResult: 'Legacy outcome unverified.' };
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectDir = join(root, 'project'); const userDataDir = join(root, 'userdata');
  fs.mkdirSync(join(projectDir, '.nomi'), { recursive: true }); fs.mkdirSync(userDataDir);
  const source = join(projectDir, '.nomi', 'agent-session.json');
  const bytes = Buffer.from(JSON.stringify({ sessions: { a: [
    { role: 'user', content: 'first' }, { role: 'assistant', content: 'second' },
  ] } }));
  fs.writeFileSync(source, bytes);
  const receipt = join(projectDir, '.nomi', 'project-agent-proposal-receipt.json'); fs.writeFileSync(receipt, 'G5 sentinel');
  return { projectDir, userDataDir, binding, labels: () => labels, locale: 'en' as const, source, bytes, receipt };
}

test('migration archives exact source bytes, imports once and never revives a user-deleted lane', async t => {
  const options = await fixture(t);
  const result = await migrateLaneLegacy(options);
  assert.equal(result.conversations, 1); assert.equal(result.sourceItems, 2);
  assert.equal(fs.existsSync(options.source), false);
  const manifest = JSON.parse(fs.readFileSync(join(options.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
  assert.equal(manifest.phase, 'completed');
  const archive = join(options.projectDir, '.nomi', 'legacy-archive', manifest.transactionId, 'agent-chat-v2.json');
  assert.deepEqual(fs.readFileSync(archive), options.bytes);
  const laneName = manifest.targets[0].laneName;
  const lane = await openLaneHistory({ projectDir: options.projectDir, laneName });
  try { assert.deepEqual(lane.projection().parts.filter(part => part.kind !== 'host-note').map(part => 'text' in part ? part.text : ''), ['first', 'second']); }
  finally { await lane.close(); }
  await deleteLaneSession(options.projectDir, laneName, BACKGROUND_CONTEXT);
  assert.deepEqual(await migrateLaneLegacy(options), result);
  assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
});

test('each interrupted append resumes only the committed prefix without duplicating source items', async t => {
  for (const boundary of [0, 1, 2, 3]) await t.test(`append ${boundary}`, async st => {
    const options = await fixture(st); let calls = 0;
    await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
      if (stage === 'append' && calls++ === boundary) throw new Error('injected-stop');
    } }));
    assert.deepEqual(fs.readFileSync(options.source), options.bytes);
    const result = await migrateLaneLegacy(options);
    assert.equal(result.conversations, 1);
    const manifest = JSON.parse(fs.readFileSync(join(options.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
    const lane = await openLaneHistory({ projectDir: options.projectDir, laneName: manifest.targets[0].laneName });
    try { assert.equal(lane.projection().parts.filter(part => part.kind !== 'host-note').length, 2); }
    finally { await lane.close(); }
  });
});

test('source changes after verified import stop cleanup and retain both source and archive', async t => {
  const options = await fixture(t);
  await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
    if (stage === 'verified') fs.writeFileSync(options.source, 'new source');
  } }));
  assert.equal(fs.readFileSync(options.source, 'utf8'), 'new source');
  assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
});

test('verified-phase recovery rejects a changed target before moving sources', async t => {
  const options = await fixture(t);
  await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
    if (stage === 'verified') throw new Error('injected-stop');
  } }));
  const manifest = JSON.parse(fs.readFileSync(join(options.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
  const target = manifest.targets[0];
  const lane = await openLegacyImportLane(options.projectDir, target.laneName, target.sessionId);
  try { await lane.appendCustomEntry('foreign-entry', {}); } finally { await lane.close(); }
  await assert.rejects(() => migrateLaneLegacy(options), /legacy-migration-evidence-mismatch/);
  assert.deepEqual(fs.readFileSync(options.source), options.bytes);
});

test('archive, verification and each cleanup boundary resume without loss', async t => {
  for (const stage of ['prepared', 'archived', 'cold-verified', 'verified', 'cleanup']) {
    for (let boundary = 0; boundary < (stage === 'cleanup' ? 5 : 1); boundary++) {
      await t.test(`${stage} ${boundary}`, async st => {
        const options = await fixture(st); let calls = 0;
        await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async current => {
          if (current === stage && calls++ === boundary) throw new Error('injected-stop');
        } }));
        assert.equal((await migrateLaneLegacy(options)).parts, 2);
        assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
      });
    }
  }
});

test('concurrent workspace openers share admission through asynchronous append', async t => {
  const options = await fixture(t);
  let release!: () => void; let entered!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  let secondEntered = false;
  const first = migrateLaneLegacy({ ...options, checkpoint: async stage => {
    if (stage === 'prepared') { entered(); await held; }
  } });
  await enteredPromise;
  const second = migrateLaneLegacy({ ...options, checkpoint: async () => { secondEntered = true; } });
  await Promise.resolve(); assert.equal(secondEntered, false);
  release();
  assert.deepEqual(await second, await first);
  assert.equal(secondEntered, false); // completed fast path, no second import
});

test('new source, linked archive and foreign target prefixes fail closed', async t => {
  for (const change of ['new-source', 'linked-archive', 'foreign-prefix']) await t.test(change, async st => {
    const options = await fixture(st);
    await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
      if (stage === 'archived') throw new Error('injected-stop');
    } }));
    const manifest = JSON.parse(fs.readFileSync(join(options.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
    if (change === 'new-source') fs.writeFileSync(join(options.projectDir, '.nomi', 'agent-thread-context-v1.json'), '{}');
    if (change === 'linked-archive') {
      const archive = join(options.projectDir, '.nomi', 'legacy-archive', manifest.transactionId, 'agent-chat-v2.json');
      fs.linkSync(archive, join(options.projectDir, 'foreign-link'));
    }
    if (change === 'foreign-prefix') {
      const target = manifest.targets[0];
      const lane = await openLegacyImportLane(options.projectDir, target.laneName, target.sessionId);
      try { await lane.appendCustomEntry('foreign', {}); } finally { await lane.close(); }
    }
    await assert.rejects(() => migrateLaneLegacy(options));
    assert.deepEqual(fs.readFileSync(options.source), options.bytes);
    assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
  });
});

const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

async function archiveOldSession(options: Awaited<ReturnType<typeof fixture>>) {
  const nomi = join(options.projectDir, '.nomi');
  const startedAt = '2026-09-01T12:34:56.000Z';
  const stamp = startedAt.replace(/[^0-9A-Za-z]/g, '_');
  const archiveDir = join(nomi, 'project-agent-legacy-archive-v1'); fs.mkdirSync(archiveDir);
  const archive = join(archiveDir, `${stamp}-agent-session.json`); fs.renameSync(options.source, archive);
  const evidence = { schemaVersion: 1, mode: 'archive-only', binding, sources: {
    conversationsHash: digest(''), contextHash: digest(options.bytes), proposalReceiptHash: digest('never-read-receipt'),
  } };
  fs.writeFileSync(join(nomi, 'project-agent-cutover-preparation.json'), JSON.stringify({ ...evidence, startedAt }));
  fs.writeFileSync(join(nomi, 'project-agent-cutover.json'), JSON.stringify({ ...evidence, completedAt: startedAt }));
  return { archive, nomi, stamp, evidence };
}

test('old archive recovery keeps provenance, resumes, and retains old rollback evidence', async t => {
  const options = await fixture(t); const prior = await archiveOldSession(options);
  await assert.rejects(() => migrateLaneLegacy({ ...options, checkpoint: async stage => {
    if (stage === 'append') throw new Error('injected-stop');
  } }));
  assert.equal((await migrateLaneLegacy(options)).parts, 2);
  const manifest = JSON.parse(fs.readFileSync(join(prior.nomi, 'lane-legacy-migration.json'), 'utf8'));
  assert.equal(manifest.sources[1].archiveStamp, prior.stamp);
  assert.deepEqual(fs.readFileSync(prior.archive), options.bytes);
  assert.deepEqual(fs.readFileSync(join(prior.nomi, 'legacy-archive', manifest.transactionId, 'agent-chat-v2.json')), options.bytes);
  assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
});

test('old archives require exact bound preparation, completion and hash, never directory guesses', async t => {
  for (const change of ['missing-preparation', 'binding', 'hash', 'timestamp', 'empty', 'symlink']) await t.test(change, async st => {
    const options = await fixture(st); const prior = await archiveOldSession(options);
    const file = join(prior.nomi, 'project-agent-cutover-preparation.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (change === 'missing-preparation') fs.unlinkSync(file);
    if (change === 'binding') { raw.binding.projectGeneration = 2; fs.writeFileSync(file, JSON.stringify(raw)); }
    if (change === 'hash') fs.writeFileSync(prior.archive, 'changed');
    if (change === 'timestamp') { raw.startedAt = '2026-09-02T12:34:56.000Z'; fs.writeFileSync(file, JSON.stringify(raw)); }
    if (change === 'empty') fs.writeFileSync(prior.archive, '');
    if (change === 'symlink') {
      fs.unlinkSync(prior.archive);
      // Windows without symlink privilege cannot create the fixture; the identity rule itself is pinned in electron/fileIdentity.test.ts.
      try { fs.symlinkSync(options.receipt, prior.archive); }
      catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return st.skip('symlink privilege'); throw error; }
    }
    await assert.rejects(() => migrateLaneLegacy(options), /legacy-prior-archive-evidence-mismatch/);
    assert.equal(fs.existsSync(join(prior.nomi, 'lane-legacy-migration.json')), false);
    assert.equal(fs.readFileSync(options.receipt, 'utf8'), 'G5 sentinel');
  });
});

test('first import selects the first source conversation, preserving an existing workspace choice', async t => {
  for (const existing of [false, true]) await t.test(String(existing), async st => {
    const options = await fixture(st);
    fs.writeFileSync(options.source, JSON.stringify({ sessions: {
      first: [{ role: 'user', content: 'one' }], last: [{ role: 'user', content: 'two' }],
    } }));
    const selection = join(options.projectDir, '.nomi', 'agent-workspace.json');
    const saved = { laneName: 'existing', sessionId: '22345678-1234-4234-8234-123456789abc' };
    if (existing) fs.writeFileSync(selection, JSON.stringify(saved));
    await migrateLaneLegacy(options);
    const manifest = JSON.parse(fs.readFileSync(join(options.projectDir, '.nomi', 'lane-legacy-migration.json'), 'utf8'));
    assert.deepEqual(JSON.parse(fs.readFileSync(selection, 'utf8')), existing ? saved
      : { laneName: manifest.targets[0].laneName, sessionId: manifest.targets[0].sessionId });
  });
});

test('opening a project with nothing (left) to migrate is a pure read: no lock file, no write, even while another opener holds the lock', async t => {
  const options = await fixture(t);
  const nomi = join(options.projectDir, '.nomi');
  const lock = join(nomi, 'lane-legacy-migration.lock');
  const listing = () => fs.readdirSync(nomi, { recursive: true }).map(String).sort();
  // 1) 迁完之后再打开：清单是 completed，答案只从清单读。
  const migrated = await migrateLaneLegacy(options);
  // 一把活着的锁（本进程 pid）：加锁流程会立刻 legacy-migration-busy；无锁终态检查不该碰它。
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  const before = listing();
  assert.deepEqual(await migrateLaneLegacy(options), migrated);
  assert.deepEqual(listing(), before);
  fs.unlinkSync(lock);
  // 2) 从来没有旧版对话的项目：没有清单、没有源文件。
  const fresh = await fixture(t);
  fs.unlinkSync(fresh.source);
  const freshNomi = join(fresh.projectDir, '.nomi');
  fs.writeFileSync(join(freshNomi, 'lane-legacy-migration.lock'), JSON.stringify({ pid: process.pid }));
  const freshBefore = fs.readdirSync(freshNomi).sort();
  assert.deepEqual(await migrateLaneLegacy(fresh), { projects: 0, sourceFiles: 0, conversations: 0, sourceItems: 0, parts: 0, archivedOnlyConversations: 0 });
  assert.deepEqual(fs.readdirSync(freshNomi).sort(), freshBefore);
  // 3) 有源文件还没迁：仍然走加锁流程（这把活锁把它拦成 busy，证明没被无锁检查放过去）。
  const pending = await fixture(t);
  fs.writeFileSync(join(pending.projectDir, '.nomi', 'lane-legacy-migration.lock'), JSON.stringify({ pid: process.pid }));
  await assert.rejects(() => migrateLaneLegacy(pending), /legacy-migration-busy/);
});
