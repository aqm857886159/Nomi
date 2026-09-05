import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fsyncIfDurable } from '../../durability';
import { writeJsonFileAtomic } from '../../jsonFile';
import { captureAgentContextBinding, contextBindingKey, type AgentContextBinding } from './contextBinding';

export type AgentContextSource = 'native' | 'legacy-limited';
export interface StoredAgentContext extends AgentContextBinding {
  readonly source: AgentContextSource;
  readonly state: 'ready' | 'cleared';
  readonly snapshot?: string;
}
export interface AgentContextSeed {
  readonly source: AgentContextSource;
  readonly snapshot?: string;
}
export interface AgentContextStore {
  read(binding: AgentContextBinding): StoredAgentContext | undefined;
  ensure(binding: AgentContextBinding, seed: AgentContextSeed): StoredAgentContext;
  save(binding: AgentContextBinding, snapshot: string): StoredAgentContext;
  clear(binding: AgentContextBinding): StoredAgentContext;
}

type Container = { version: 4; records: Record<string, unknown>; [key: string]: unknown };
type ReadContainer = { container: Container; legacyBytes?: Buffer };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readContainer(file: string): ReadContainer {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { container: { version: 4, records: {} } };
    throw error;
  }
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!isRecord(raw)) throw new Error('Invalid Agent context container');
  if (raw.version === 2 && isRecord(raw.sessions) && Object.values(raw.sessions).every(Array.isArray)) {
    // v2 has no provable thread ownership. Only the exact backup retains its Core history.
    return { container: { version: 4, records: {} }, legacyBytes: bytes };
  }
  if (raw.version === 3 && isRecord(raw.records)) {
    // v3 keyed records by a `nomi:workbench:<projectId>:<area>` session key that no
    // production caller ever produced; its project identity cannot be proven against
    // the canonical immutable UUID. Back the file up rather than re-binding it.
    return { container: { version: 4, records: {} }, legacyBytes: bytes };
  }
  if (raw.version !== 4 || !isRecord(raw.records)) {
    throw new Error('Unsupported or invalid Agent context container version');
  }
  return { container: raw as Container };
}

function readTarget(container: Container, binding: AgentContextBinding): StoredAgentContext | undefined {
  const key = contextBindingKey(binding);
  if (!Object.hasOwn(container.records, key)) return undefined;
  const record = container.records[key];
  if (!isRecord(record)) throw new Error('Invalid Agent context record');
  let storedBinding: AgentContextBinding;
  try {
    storedBinding = captureAgentContextBinding({
      project: record.project, threadId: record.threadId, sessionKey: record.sessionKey,
    });
  } catch (error) {
    throw new Error('Invalid Agent context record binding', { cause: error });
  }
  if (storedBinding.sessionKey !== binding.sessionKey || storedBinding.threadId !== binding.threadId
    || storedBinding.project.projectId !== binding.project.projectId) {
    throw new Error('Agent context record binding tuple mismatch');
  }
  if ((record.source !== 'native' && record.source !== 'legacy-limited')
    || (record.state !== 'ready' && record.state !== 'cleared')
    || (record.snapshot !== undefined && (typeof record.snapshot !== 'string' || !record.snapshot))
    || (record.state === 'cleared' && record.snapshot !== undefined)) {
    throw new Error('Invalid Agent context record');
  }
  // Snapshots are opaque here. Only the private SDK codec can validate their contents.
  return record as unknown as StoredAgentContext;
}

function backupLegacy(file: string, bytes: Buffer): void {
  const backup = `${file}.legacy-${createHash('sha256').update(bytes).digest('hex')}.bak`;
  let fd: number;
  try {
    fd = fs.openSync(backup, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!fs.lstatSync(backup).isFile() || !fs.readFileSync(backup).equals(bytes)) {
      throw new Error('Agent context legacy backup does not match the original bytes', { cause: error });
    }
    return;
  }
  try {
    fs.writeFileSync(fd, bytes);
    fsyncIfDurable(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!fs.readFileSync(backup).equals(bytes)) throw new Error('Agent context legacy backup verification failed');
}

export function createAgentContextStore(options: {
  resolveFile(binding: AgentContextBinding): string | null;
}): AgentContextStore {
  function fileFor(binding: AgentContextBinding): string {
    const file = options.resolveFile(captureAgentContextBinding(binding));
    if (!file || !path.isAbsolute(file)) throw new Error('Cannot resolve a persistent Agent context path');
    return file;
  }

  function update(binding: AgentContextBinding,
    next: (current: StoredAgentContext | undefined) => StoredAgentContext): StoredAgentContext {
    const file = fileFor(binding);
    // No await between this latest read, merge and atomic publication. Different
    // threads can finish in either order without overwriting one another's records.
    const { container, legacyBytes } = readContainer(file);
    const current = readTarget(container, binding);
    const record = next(current);
    if (record === current) return record;
    if (legacyBytes) backupLegacy(file, legacyBytes);
    writeJsonFileAtomic(file, { ...container, records: { ...container.records, [contextBindingKey(binding)]: record } });
    return record;
  }

  return {
    read: (binding) => readTarget(readContainer(fileFor(binding)).container, binding),
    ensure: (binding, seed) => update(binding, (current) => current ?? { ...binding, ...seed, state: 'ready' }),
    save: (binding, snapshot) => update(binding, (current) => ({
      ...binding, source: current?.source ?? 'native', state: 'ready', snapshot,
    })),
    clear: (binding) => update(binding, (current) => ({ ...binding, source: current?.source ?? 'native', state: 'cleared' })),
  };
}
