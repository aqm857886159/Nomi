import fs from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
// 目录 fsync 只许走 durability 的唯一实现：Windows 上 fsync 只读目录句柄会抛 EPERM，平台不支持码只在那里判一次
// （docs/fixes/2026-09-03-windows-directory-fsync-barrier.root-cause.json；electron/durability.test.ts 的类级测试拦新副本）
import { fsyncDirectoryIfDurable, fsyncIfDurable } from '../durability';
import { writeJsonFileAtomic } from '../jsonFile';

function fail(): never { throw new Error('legacy-file-identity-or-content-changed'); }
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function stat(path: string): fs.Stats | undefined {
  try { return fs.lstatSync(path); } catch (error) { if (missing(error)) return; throw error; }
}
function sameIdentity(left: fs.Stats, right: fs.Stats | undefined): boolean {
  return !!right && left.dev === right.dev && left.ino === right.ino && !right.isSymbolicLink();
}
function readRegular(path: string, links = 1): { bytes: Buffer; identity: fs.Stats } | undefined {
  const linked = stat(path);
  if (!linked) return;
  if (!linked.isFile() || linked.isSymbolicLink() || linked.nlink !== links) fail();
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!sameIdentity(linked, opened) || !opened.isFile() || opened.nlink !== links) fail();
    const bytes = fs.readFileSync(fd); const after = fs.fstatSync(fd);
    if (!sameIdentity(opened, after) || after.nlink !== links || after.size !== opened.size
      || after.mtimeMs !== opened.mtimeMs || !sameIdentity(after, stat(path))) fail();
    return { bytes, identity: after };
  } finally { fs.closeSync(fd); }
}

/** roots are captured main-process project/userData directories, never renderer paths. */
export function createLegacyFileAccess(inputRoots: readonly string[]) {
  const roots = inputRoots.map(root => resolve(root));
  const directories = new Map<string, fs.Stats>();
  for (const root of roots) {
    const identity = stat(root);
    if (!identity?.isDirectory() || identity.isSymbolicLink()) fail();
    directories.set(root, identity);
  }
  function rootFor(path: string): string {
    const absolute = resolve(path);
    const root = roots.find(root => absolute === root || absolute.startsWith(root + sep));
    if (!root) fail();
    return root;
  }
  function check(): void {
    for (const [path, identity] of directories) {
      const current = stat(path);
      if (!sameIdentity(identity, current) || !current?.isDirectory()) fail();
    }
  }
  function directory(path: string, create = false): boolean {
    check();
    const absolute = resolve(path); const root = rootFor(absolute);
    let current = root;
    for (const segment of relative(root, absolute).split(sep).filter(Boolean)) {
      current = join(current, segment);
      let identity = stat(current);
      if (!identity && create) { fs.mkdirSync(current, { mode: 0o700 }); identity = stat(current); }
      if (!identity) return false;
      if (!identity.isDirectory() || identity.isSymbolicLink()) fail();
      const previous = directories.get(current);
      if (previous && !sameIdentity(previous, identity)) fail();
      directories.set(current, identity);
      if (create && process.platform !== 'win32' && (identity.mode & 0o777) !== 0o700) {
        const fd = fs.openSync(current, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY ?? 0) | (fs.constants.O_NOFOLLOW ?? 0));
        try { if (!sameIdentity(identity, fs.fstatSync(fd))) fail(); fs.fchmodSync(fd, 0o700); }
        finally { fs.closeSync(fd); }
      }
    }
    check(); return true;
  }
  function read(path: string): ReturnType<typeof readRegular> {
    path = resolve(path);
    rootFor(path);
    if (!directory(dirname(path))) return;
    const result = readRegular(path); check(); return result;
  }
  function archive(path: string, bytes: Buffer): void {
    path = resolve(path);
    directory(dirname(path), true);
    const partial = `${path}.partial`;
    const published = stat(path); const temporary = stat(partial);
    // link publishes without overwriting. If the process died between link and
    // unlink, finish removing its second name only after byte/identity proof.
    if (published?.nlink === 2 && temporary && sameIdentity(published, temporary)) {
      if (!readRegular(path, 2)?.bytes.equals(bytes)) fail();
      check(); fs.unlinkSync(partial); fsyncDirectoryIfDurable(dirname(path));
    }
    const existing = read(path);
    if (existing) {
      if (!existing.bytes.equals(bytes)
        || (process.platform !== 'win32' && (existing.identity.mode & 0o077) !== 0)) fail();
      return;
    }
    const abandoned = read(partial);
    if (abandoned) {
      // Only a prefix of this exact archive can be a prior interrupted write.
      if (!bytes.subarray(0, abandoned.bytes.length).equals(abandoned.bytes)) fail();
      check(); if (!sameIdentity(abandoned.identity, stat(partial))) fail(); fs.unlinkSync(partial);
    }
    const fd = fs.openSync(partial, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, 0o400); fsyncIfDurable(fd); }
    finally { fs.closeSync(fd); }
    check(); fs.linkSync(partial, path); fs.unlinkSync(partial); fsyncDirectoryIfDurable(dirname(path));
    if (!read(path)?.bytes.equals(bytes)) fail();
  }
  function remove(path: string, archivedPath: string, bytes: Buffer): void {
    path = resolve(path); archivedPath = resolve(archivedPath);
    if (resolve(path) === resolve(archivedPath) || !read(archivedPath)?.bytes.equals(bytes)) fail();
    const source = read(path);
    if (!source) return;
    if (!source.bytes.equals(bytes)) fail();
    check(); const current = stat(path);
    if (!sameIdentity(source.identity, current) || current?.nlink !== 1
      || current.size !== source.identity.size || current.mtimeMs !== source.identity.mtimeMs) fail();
    fs.unlinkSync(path); fsyncDirectoryIfDurable(dirname(path));
  }
  function writeManifest(path: string, value: unknown, expected: Buffer | undefined): Buffer {
    path = resolve(path);
    directory(dirname(path), true);
    const previous = read(path)?.bytes;
    if (previous ? !expected?.equals(previous) : expected !== undefined) fail();
    writeJsonFileAtomic(path, value, { mode: 0o600 }); check();
    return read(path)!.bytes;
  }
  return { directory, check, read, archive, remove, writeManifest };
}
export async function withLegacyMigrationLock<T>(access: ReturnType<typeof createLegacyFileAccess>, root: string, run: () => Promise<T>): Promise<T> {
  const lock = join(resolve(root), '.nomi', 'lane-legacy-migration.lock');
  access.directory(dirname(lock), true);
  const existing = access.read(lock);
  if (existing) {
    let pid = 0;
    try { const raw = JSON.parse(existing.bytes.toString()); if (Number.isSafeInteger(raw.pid) && raw.pid > 0) pid = raw.pid; }
    catch { /* old plain lock: only the age rule below can establish abandonment */ }
    let stale = pid === 0 && Date.now() - existing.identity.mtimeMs >= 5 * 60_000;
    if (pid) {
      try { process.kill(pid, 0); }
      catch (error) { stale = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }
    if (!stale) throw new Error('legacy-migration-busy');
    access.check(); if (!sameIdentity(existing.identity, stat(lock))) fail(); fs.unlinkSync(lock);
  }
  // No await between stale-owner comparison, removal and O_EXCL acquisition.
  // The app's single-instance owner and this process's admission serialize recovery.
  const fd = fs.openSync(lock, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  const identity = fs.fstatSync(fd);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); fsyncIfDurable(fd);
    return await run();
  } finally {
    try {
      access.check(); if (!sameIdentity(identity, stat(lock))) fail();
      fs.unlinkSync(lock); fsyncDirectoryIfDurable(dirname(lock));
    } finally { fs.closeSync(fd); }
  }
}
