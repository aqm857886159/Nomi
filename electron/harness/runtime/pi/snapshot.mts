import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CURRENT_SESSION_VERSION, SessionManager, type AgentSession } from '@earendil-works/pi-coding-agent';
import { z } from 'zod';
import { snapshotEntrySchema } from './snapshotSchema.mjs';

export type SnapshotSource = Pick<AgentSession, 'sessionManager' | 'isIdle' | 'isCompacting'>;

const envelopeSchema = z.object({
  format: z.literal('nomi.pi-work-context'),
  version: z.literal(1),
  piVersion: z.literal('0.84.3'),
  data: z.unknown(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const dataSchema = z.object({
  header: z.object({
    type: z.literal('session'), version: z.literal(CURRENT_SESSION_VERSION),
    id: z.string().min(1), timestamp: z.string().datetime(), cwd: z.string(),
  }).passthrough(),
  entries: z.array(snapshotEntrySchema),
  leafId: z.string().min(1).nullable(),
}).strict();
function digest(data: unknown): string {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

// This is a private, version-locked working cache, never a project/approval ledger.
// The checksum detects truncation/corruption; it is not an authenticity signature.
function validateData(raw: unknown) {
  const data = dataSchema.parse(raw);
  const ids = new Set<string>();
  const parents = new Map<string, string | null>();
  for (const entry of data.entries) {
    if (ids.has(entry.id)) throw new Error(`Duplicate snapshot entry: ${entry.id}`);
    if (entry.parentId !== null && !ids.has(entry.parentId)) {
      throw new Error(`Broken snapshot parent: ${entry.id}`);
    }
    if (entry.type === 'compaction') {
      let ancestor = entry.parentId;
      while (ancestor !== null && ancestor !== entry.firstKeptEntryId) {
        ancestor = parents.get(ancestor) ?? null;
      }
      if (ancestor === null) {
        throw new Error('Broken snapshot compaction boundary');
      }
    }
    ids.add(entry.id);
    parents.set(entry.id, entry.parentId);
  }
  if (data.leafId !== null && !ids.has(data.leafId)) throw new Error('Broken snapshot leaf');
  return data;
}

export function exportSnapshot(source: SnapshotSource): string {
  if (!source.isIdle || source.isCompacting) throw new Error('Snapshot requires a stable, idle session');
  const data = {
    header: source.sessionManager.getHeader(),
    entries: source.sessionManager.getEntries(),
    leafId: source.sessionManager.getLeafId(),
  };
  validateData(data);
  return JSON.stringify({ format: 'nomi.pi-work-context', version: 1, piVersion: '0.84.3', data, sha256: digest(data) });
}

// pi 0.84.3 has no fromSnapshot/storage-adapter API. Use its public in-memory
// manager + file loader, then restore the separate leaf pointer. Never replay tools.
export async function importSnapshot(
  serialized: string,
  options: { cwd: string; tempRoot: string },
): Promise<SessionManager> {
  const envelope = envelopeSchema.parse(JSON.parse(serialized));
  if (digest(envelope.data) !== envelope.sha256) throw new Error('Snapshot integrity check failed');
  const data = validateData(envelope.data);
  const materializationDir = await mkdtemp(join(options.tempRoot, 'nomi-pi-snapshot-'));
  try {
    const file = join(materializationDir, 'context.jsonl');
    await writeFile(file, [data.header, ...data.entries].map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      { mode: 0o600, flag: 'wx' });
    const manager = SessionManager.inMemory(options.cwd);
    manager.setSessionFile(file);
    if (data.leafId === null) manager.resetLeaf();
    else manager.branch(data.leafId);
    // pi's loader can migrate/skip malformed entries. A version-locked cache must
    // not silently become a different transcript when that happens.
    if (digest(manager.getEntries()) !== digest(data.entries)) throw new Error('Snapshot entries changed during restore');
    return manager;
  } finally {
    await rm(materializationDir, { recursive: true, force: true });
  }
}
