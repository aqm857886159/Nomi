import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { createLegacyFileAccess, withLegacyMigrationLock } from '../../electron/agentLane/laneLegacyFiles.js';
import { deferred } from './stage3ProbeHarness.mjs';

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'nomi-legacy-files-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const access = createLegacyFileAccess([root]);
  access.directory(join(root, '.nomi'), true);
  return { root, access };
}

test('source admission rejects symlink, hardlink and replaced parent directories without reading outside roots', { skip: process.platform === 'win32' ? 'Windows symlink privilege is not guaranteed for this POSIX identity fixture' : false }, async t => {
  const { root, access } = await fixture(t);
  const file = join(root, '.nomi', 'source.json'); const other = join(root, 'private.json');
  fs.writeFileSync(other, 'private'); fs.symlinkSync(other, file);
  assert.throws(() => access.read(file));
  fs.unlinkSync(file); fs.linkSync(other, file);
  assert.throws(() => access.read(file));
  fs.unlinkSync(file); fs.unlinkSync(other); fs.writeFileSync(file, 'owned');
  assert.equal(access.read(file)?.bytes.toString(), 'owned');
  fs.renameSync(join(root, '.nomi'), join(root, 'old'));
  fs.mkdirSync(join(root, '.nomi')); fs.writeFileSync(file, 'replacement');
  assert.throws(() => access.read(file));
  assert.throws(() => access.read(join(root, '..', 'outside.json')));
});

test('archive preserves exact bytes, refuses conflicts, and source removal rechecks bytes', async t => {
  const { root, access } = await fixture(t);
  const source = join(root, '.nomi', 'source.json'); const target = join(root, '.nomi', 'legacy-archive', 'tx', 'source.json');
  const bytes = Buffer.from('original\0bytes'); fs.writeFileSync(source, bytes);
  access.archive(target, bytes);
  assert.deepEqual(access.read(target)?.bytes, bytes);
  assert.deepEqual(fs.readFileSync(source), bytes);
  access.archive(target, bytes);
  assert.throws(() => access.archive(target, Buffer.from('other')));
  fs.writeFileSync(source, 'changed');
  assert.throws(() => access.remove(source, target, bytes));
  assert.equal(fs.readFileSync(source, 'utf8'), 'changed');
  fs.writeFileSync(source, bytes); access.remove(source, target, bytes);
  assert.equal(fs.existsSync(source), false);
  assert.deepEqual(fs.readFileSync(target), bytes);
});

test('exclusive lock remains held through await, and live owners cannot be stolen', async t => {
  const { root, access } = await fixture(t);
  const entered = deferred(); const finish = deferred();
  const running = withLegacyMigrationLock(access, root, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  try { await assert.rejects(() => withLegacyMigrationLock(access, root, async () => {})); }
  finally { finish.resolve(); await running; }
  await withLegacyMigrationLock(access, root, async () => {});
});

test('failure releases its own lock but never removes a replacement lock', async t => {
  const { root, access } = await fixture(t);
  await assert.rejects(() => withLegacyMigrationLock(access, root, async () => { throw new Error('fixture'); }));
  const lock = join(root, '.nomi', 'lane-legacy-migration.lock');
  assert.equal(fs.existsSync(lock), false);
  await assert.rejects(() => withLegacyMigrationLock(access, root, async () => {
    fs.renameSync(lock, `${lock}.old`); fs.writeFileSync(lock, 'replacement');
  }));
  assert.equal(fs.readFileSync(lock, 'utf8'), 'replacement');
});

test('archive resumes interrupted writes and publication, and never adopts unrelated partial bytes', async t => {
  const { root, access } = await fixture(t);
  const directory = join(root, '.nomi', 'legacy-archive', 'tx'); access.directory(directory, true);
  const bytes = Buffer.from('complete archive');
  const partialWrite = join(directory, 'partial.json');
  fs.writeFileSync(`${partialWrite}.partial`, bytes.subarray(0, 5));
  access.archive(partialWrite, bytes);
  assert.deepEqual(fs.readFileSync(partialWrite), bytes);
  const partialPublish = join(directory, 'linked.json');
  fs.writeFileSync(`${partialPublish}.partial`, bytes, { mode: 0o400 }); fs.linkSync(`${partialPublish}.partial`, partialPublish);
  access.archive(partialPublish, bytes);
  assert.equal(fs.statSync(partialPublish).nlink, 1);
  assert.equal(fs.existsSync(`${partialPublish}.partial`), false);
  const foreign = join(directory, 'foreign.json'); fs.writeFileSync(`${foreign}.partial`, 'not ours');
  assert.throws(() => access.archive(foreign, bytes));
  assert.equal(fs.readFileSync(`${foreign}.partial`, 'utf8'), 'not ours');
});

test('manifest update requires the exact previous bytes and rejects symlinked archive parents', { skip: process.platform === 'win32' ? 'Windows symlink privilege is not guaranteed for this POSIX identity fixture' : false }, async t => {
  const { root, access } = await fixture(t);
  const manifest = join(root, '.nomi', 'manifest.json');
  const previous = access.writeManifest(manifest, { phase: 1 }, undefined);
  access.writeManifest(manifest, { phase: 2 }, previous);
  assert.throws(() => access.writeManifest(manifest, { phase: 3 }, previous));
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).phase, 2);
  const outside = join(root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, join(root, '.nomi', 'legacy-archive'));
  assert.throws(() => access.archive(join(root, '.nomi', 'legacy-archive', 'copy'), Buffer.from('no')));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('no source is removed without a distinct matching archive', async t => {
  const { root, access } = await fixture(t);
  const file = join(root, '.nomi', 'original'); const bytes = Buffer.from('preserve'); fs.writeFileSync(file, bytes);
  assert.throws(() => access.remove(file, file, bytes));
  assert.throws(() => access.remove(file, join(root, '.nomi', 'missing'), bytes));
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('dead-owner recovery has one winner; arbitrarily old live PID locks remain busy', async t => {
  const { root, access } = await fixture(t);
  const lock = join(root, '.nomi', 'lane-legacy-migration.lock');
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid })); fs.utimesSync(lock, 0, 0);
  await assert.rejects(() => withLegacyMigrationLock(access, root, async () => {}));
  fs.writeFileSync(lock, JSON.stringify({ pid: 99_999_999 }));
  const entered = deferred(); const finish = deferred();
  const first = withLegacyMigrationLock(access, root, async () => { entered.resolve(); await finish.promise; });
  await entered.promise;
  try { await assert.rejects(() => withLegacyMigrationLock(access, root, async () => {})); }
  finally { finish.resolve(); await first; }
  assert.equal(fs.existsSync(lock), false);
});
