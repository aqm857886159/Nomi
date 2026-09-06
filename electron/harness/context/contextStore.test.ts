import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { contextBindingKey } from './contextBinding';
import { createAgentContextStore } from './contextStore';
import { createProjectAgentContextBinding } from '../../shared/contracts/projectAgentContextBinding';

const PROJECT = Object.freeze({
  projectId: 'project-1',
  immutableProjectUuid: '4d80f2e0-4a45-4a8f-8fe1-78ac659177c8',
  projectGeneration: 3,
});
const OTHER_PROJECT = Object.freeze({ ...PROJECT, projectGeneration: 4 });
const creation = createProjectAgentContextBinding(PROJECT, 'same-thread');
const generation = createProjectAgentContextBinding(OTHER_PROJECT, 'same-thread');
const legacyBytes = Buffer.from(' { "version": 2, "sessions": { "nomi:workbench:project-1:creation": [{"role":"user","content":"UNBOUND_CORE"}] } }\r\n');

describe('v4 Agent working-context storage', () => {
  let root: string;
  let file: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-context-store-'));
    file = path.join(root, '.nomi', 'agent-thread-context-v1.json');
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });
  const store = () => createAgentContextStore({ resolveFile: () => file });
  const readContainer = () => JSON.parse(fs.readFileSync(file, 'utf8')) as { version: number; records: Record<string, unknown> };
  const writeRaw = (raw: string | Buffer) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, raw);
  };
  const backupPath = () => `${file}.legacy-${createHash('sha256').update(legacyBytes).digest('hex')}.bak`;

  it('persists the exact binding tuple and keeps same-thread records of different project generations separate', () => {
    const first = store();
    first.save(creation, 'opaque-creation');
    first.save(generation, 'opaque-generation');
    expect(store().read(creation)).toEqual({ ...creation, source: 'native', state: 'ready', snapshot: 'opaque-creation' });
    expect(store().read(generation)?.snapshot).toBe('opaque-generation');
    expect(readContainer()).toEqual({ version: 4, records: {
      [contextBindingKey(creation)]: { ...creation, source: 'native', state: 'ready', snapshot: 'opaque-creation' },
      [contextBindingKey(generation)]: { ...generation, source: 'native', state: 'ready', snapshot: 'opaque-generation' },
    } });
  });

  it('re-reads the project container synchronously before each merge so late thread saves retain peers', () => {
    const first = store();
    const second = store();
    const other = createProjectAgentContextBinding(PROJECT, 'thread-2');
    expect(first.read(creation)).toBeUndefined();
    expect(second.read(other)).toBeUndefined();
    second.save(other, 'second-finished-first');
    first.save(creation, 'first-finished-last');
    expect(first.read(other)?.snapshot).toBe('second-finished-first');
    expect(second.read(creation)?.snapshot).toBe('first-finished-last');
  });

  it('makes ensure-if-absent preserve native, empty, and cleared records regardless of a later seed', () => {
    const storage = store();
    storage.ensure(creation, { source: 'native' });
    expect(storage.ensure(creation, { source: 'legacy-limited', snapshot: 'old-ui' })).toEqual({ ...creation, source: 'native', state: 'ready' });
    storage.save(creation, 'full-native-history');
    storage.ensure(creation, { source: 'native' });
    expect(storage.read(creation)?.snapshot).toBe('full-native-history');
    storage.clear(creation);
    storage.ensure(creation, { source: 'legacy-limited', snapshot: 'old-ui' });
    expect(storage.read(creation)).toEqual({ ...creation, source: 'native', state: 'cleared' });
    storage.save(creation, 'fresh-turn');
    expect(storage.read(creation)?.snapshot).toBe('fresh-turn');
  });

  it('preserves legacy-limited provenance after native continuation', () => {
    const storage = store();
    storage.ensure(creation, { source: 'legacy-limited', snapshot: 'limited-import' });
    storage.save(creation, 'continued-native-snapshot');
    expect(storage.read(creation)?.source).toBe('legacy-limited');
  });

  it('backs up exact v2 bytes before replacing unbound Core history, and reuses a verified backup', () => {
    writeRaw(legacyBytes);
    expect(store().read(creation)).toBeUndefined();
    expect(fs.existsSync(backupPath()), 'a read alone never migrates').toBe(false);
    store().ensure(creation, { source: 'legacy-limited', snapshot: 'explicit-thread-bubbles' });
    expect(fs.existsSync(backupPath())).toBe(true);
    expect(fs.readFileSync(backupPath())).toEqual(legacyBytes);
    expect(fs.readFileSync(file, 'utf8')).not.toContain('UNBOUND_CORE');
    const stat = fs.statSync(backupPath());
    writeRaw(legacyBytes); // Replay a crash after backup creation but before v4 publication.
    store().ensure(generation, { source: 'native' });
    expect(fs.readFileSync(backupPath())).toEqual(legacyBytes);
    expect(fs.statSync(backupPath()).ino, 'exclusive creation never replaces an existing backup').toBe(stat.ino);
    expect(fs.readdirSync(path.dirname(file)).filter((name) => name.endsWith('.bak'))).toHaveLength(1);
    expect(store().read(generation)?.state).toBe('ready');
  });

  it('blocks a mismatching existing backup without changing either original or backup', () => {
    writeRaw(legacyBytes);
    fs.writeFileSync(backupPath(), 'NOT_THE_ORIGINAL_BYTES');
    expect(() => store().save(creation, 'unsafe')).toThrow(/backup/i);
    expect(fs.readFileSync(file)).toEqual(legacyBytes);
    expect(fs.readFileSync(backupPath(), 'utf8')).toBe('NOT_THE_ORIGINAL_BYTES');
  });

  it('blocks a backup creation failure and leaves v2 byte-for-byte intact', () => {
    writeRaw(legacyBytes);
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((target, ...args) => {
      if (target === backupPath()) throw Object.assign(new Error('backup permission denied'), { code: 'EACCES' });
      return open(target, ...args);
    });
    expect(() => store().ensure(creation, { source: 'native' })).toThrow(/backup|permission/i);
    expect(fs.readFileSync(file)).toEqual(legacyBytes);
  });

  it.each(['{"version":5,"records":{}}', '{"version":4,"records":[]}', '{"version":3,"records":[]}', '{"version":2,"sessions":null}', '{broken'])('refuses corrupt or unsupported whole containers without overwrite: %s', (raw) => {
    writeRaw(raw);
    expect(() => store().read(creation)).toThrow();
    expect(() => store().save(creation, 'unsafe')).toThrow();
    expect(() => store().clear(creation)).toThrow();
    expect(fs.readFileSync(file, 'utf8')).toBe(raw);
    expect(fs.readdirSync(path.dirname(file))).toEqual(['agent-thread-context-v1.json']);
  });

  it('treats only ENOENT as absent, not an unreadable path', () => {
    fs.mkdirSync(file, { recursive: true });
    expect(() => store().read(creation)).toThrow();
    expect(() => store().save(creation, 'unsafe')).toThrow();
    expect(fs.statSync(file).isDirectory()).toBe(true);
  });

  it('preserves unknown or corrupt non-target records while allowing another binding to operate', () => {
    const damaged = { ...generation, source: 'future-origin', state: 'ready', snapshot: 'broken-but-preserved' };
    const unknown = { future: ['keep', 'all', 'of', 'this'] };
    writeRaw(JSON.stringify({ version: 4, records: { [contextBindingKey(generation)]: damaged, unknown } }));
    expect(() => store().read(generation)).toThrow(/record/i);
    store().save(creation, 'good-context');
    expect(store().read(creation)?.snapshot).toBe('good-context');
    expect(readContainer().records[contextBindingKey(generation)]).toEqual(damaged);
    expect(readContainer().records.unknown).toEqual(unknown);
  });

  it('validates the stored tuple as well as the hash rather than trusting the map key', () => {
    writeRaw(JSON.stringify({ version: 4, records: { [contextBindingKey(creation)]: {
      ...generation, source: 'native', state: 'ready', snapshot: 'wrong-binding',
    } } }));
    expect(() => store().read(creation)).toThrow(/binding|tuple/i);
    expect(() => store().save(creation, 'unsafe')).toThrow(/binding|tuple/i);
    expect(readContainer().records[contextBindingKey(creation)]).toMatchObject({ snapshot: 'wrong-binding' });
  });

  it('rejects unresolved or relative persistent paths rather than falling back to memory', () => {
    expect(() => createAgentContextStore({ resolveFile: () => null }).ensure(creation, { source: 'native' })).toThrow(/resolv|path/i);
    expect(() => createAgentContextStore({ resolveFile: () => 'relative.json' }).read(creation)).toThrow(/path/i);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});
