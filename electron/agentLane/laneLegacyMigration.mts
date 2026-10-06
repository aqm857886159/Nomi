import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { Entry } from '@earendil-works/pi-agent-core';
import { assertProjectAgentBinding, projectAgentPartitionKey } from '../shared/projectBinding.js';
import { legacyMigrationCountsSchema, type LegacyMigrationOptions, type LegacyMigrationCounts } from '../shared/agentLane/laneLegacyMigrationContract.js';
import type { DesktopLocale } from '../desktopLocale.js';
import { stableProjectAgentJson } from '../shared/legacyAgentJson.js';
import { LANE_LEGACY_NOTE, LANE_LEGACY_COMPLETE_NOTE } from '../shared/agentLane/laneLegacyNote.js';
import { projectLaneSnapshot } from '../shared/agentLane/laneProjection.js';
import { createLegacyFileAccess, withLegacyMigrationLock } from './laneLegacyFiles.js';
import { parseLegacySource, type LegacySourceKind } from './laneLegacySources.js';
import { planLegacyImport, type LegacyAppendOperation, type LegacyConversationPlan } from './laneLegacyImportPlan.mjs';
import { BACKGROUND_CONTEXT } from '@earendil-works/pi-agent-core/harness/context';
import { listLaneSessions } from './laneSession.mjs';
import { readLaneWorkspaceSelection, writeLaneWorkspaceSelection } from './laneWorkspaceSelection.js';
import { readLegacyPriorArchive } from './laneLegacyPriorArchive.mjs';
import { openLegacyImportLane } from './laneLegacyImportLane.mjs';

const manifestSchema = z.object({ version: z.literal(1), parserVersion: z.literal(1),
  transactionId: z.string().uuid(), phase: z.enum(['prepared', 'verified', 'completed']),
  locale: z.custom<DesktopLocale>(value => value === 'en' || value === 'zh-CN'), binding: z.unknown(),
  sources: z.array(z.object({ id: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    archiveStamp: z.string().regex(/^[0-9A-Za-z_]+$/).optional() }).strict()),
  targets: z.array(z.object({ sourceId: z.string(), key: z.string(), laneName: z.string().regex(/^legacy-[a-f0-9]{32}$/),
    sessionId: z.string().uuid(), parts: z.number().int().nonnegative(), sourceItems: z.number().int().nonnegative() }).strict()),
  counts: legacyMigrationCountsSchema,
}).strict();
type Manifest = z.infer<typeof manifestSchema>;

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
function fail(): never { throw new Error('legacy-migration-evidence-mismatch'); }
function same(left: unknown, right: unknown): boolean { return stableProjectAgentJson(left) === stableProjectAgentJson(right); }

interface SourcePath { id: string; kind?: LegacySourceKind; file: string; archive: string; archiveStamp?: string }
function sourcePaths(options: LegacyMigrationOptions): SourcePath[] {
  const nomi = join(resolve(options.projectDir), '.nomi');
  const partition = projectAgentPartitionKey(options.binding);
  const host = join(resolve(options.userDataDir), 'project-agent-host', partition);
  return [
    { id: 'pi-snapshot', kind: 'pi-snapshot', file: join(nomi, 'agent-thread-context-v1.json'), archive: 'pi-snapshot.json' },
    { id: 'agent-chat-v2', kind: 'agent-chat-v2', file: join(nomi, 'agent-session.json'), archive: 'agent-chat-v2.json' },
    { id: 'host-snapshot', kind: 'host-snapshot', file: join(host, 'snapshot-v1.json'), archive: 'host-snapshot.json' },
    { id: 'host-backup', file: join(host, 'snapshot-v1.backup.json'), archive: 'host-backup.json' },
    { id: 'host-ledger', file: join(host, 'commands-v1.jsonl'), archive: 'host-ledger.jsonl' },
  ] satisfies Array<{ id: string; kind?: LegacySourceKind; file: string; archive: string }>;
}
function targetShape(plan: LegacyConversationPlan, sourceHash: string) {
  return { sourceId: plan.sourceKind, key: plan.key,
    laneName: `legacy-${hash(JSON.stringify([plan.sourceKind, plan.key, sourceHash])).slice(0, 32)}`,
    parts: plan.expectedParts, sourceItems: plan.sourceItems };
}
function entryShape(entry: Entry | LegacyAppendOperation): unknown {
  if (entry.type === 'message') return { type: 'message', message: entry.message };
  if (entry.type === 'custom') return { type: 'custom', customType: entry.customType, data: entry.data };
  return { type: entry.type };
}
function importOperations(manifest: Manifest, target: Manifest['targets'][number], plan: LegacyConversationPlan): LegacyAppendOperation[] {
  const sourceHash = manifest.sources.find(source => source.id === target.sourceId)!.hash!;
  return [{ sourceIndex: -1, type: 'custom', customType: LANE_LEGACY_NOTE,
    data: { version: 1, transactionId: manifest.transactionId, sourceHash, sourceKind: plan.sourceKind,
      conversationKey: plan.key, facts: plan.facts } }, ...plan.operations,
  { sourceIndex: -1, type: 'custom', customType: LANE_LEGACY_COMPLETE_NOTE,
    data: { transactionId: manifest.transactionId, parts: target.parts } }];
}
function assertPrefix(entries: Entry[], operations: LegacyAppendOperation[]): void {
  if (entries.length > operations.length) fail();
  for (let index = 0; index < entries.length; index++) {
    if (!same(entryShape(entries[index]), entryShape(operations[index]))) fail();
  }
}

const admissions = new Map<string, Promise<void>>();
export async function migrateLaneLegacy(options: LegacyMigrationOptions): Promise<LegacyMigrationCounts> {
  assertProjectAgentBinding(options.binding);
  const projectDir = resolve(options.projectDir);
  const before = admissions.get(projectDir) ?? Promise.resolve();
  const operation = before.then(() => migrate(options));
  const finished = operation.then(() => undefined, () => undefined);
  admissions.set(projectDir, finished);
  try { return await operation; }
  finally { if (admissions.get(projectDir) === finished) admissions.delete(projectDir); }
}

const NO_LEGACY_COUNTS: LegacyMigrationCounts = Object.freeze({
  projects: 0, sourceFiles: 0, conversations: 0, sourceItems: 0, parts: 0, archivedOnlyConversations: 0 });

/**
 * 打开项目每次都会走到迁移，而迁移只有两种终态是「什么都不用做」：从来没有旧版对话（没清单、没源文件、没旧归档），
 * 或者早就迁完了（清单已 completed）。这两种终态不会自己变回去，所以先**不拿锁**看一眼：
 * 命中就直接返回，不建锁文件、不 fsync——打开项目是读，不该写盘；进程中途被杀时也不会留下一把拦住下次打开的锁。
 * 看不准（读失败、证据不齐、清单没迁完、绑定对不上）一律 undefined，交给下面加锁的完整流程按原规则处理或报错。
 */
function settledWithoutLock(access: ReturnType<typeof createLegacyFileAccess>, file: string, specs: SourcePath[],
  nomi: string, options: LegacyMigrationOptions): LegacyMigrationCounts | undefined {
  try {
    const manifestBytes = access.read(file)?.bytes;
    if (manifestBytes) {
      const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
      const sameSources = manifest.sources.length === specs.length && manifest.sources.every((source, index) => source.id === specs[index].id);
      return manifest.phase === 'completed' && same(manifest.binding, options.binding) && sameSources ? manifest.counts : undefined;
    }
    if (specs.some(spec => access.read(spec.file))) return undefined;
    return readLegacyPriorArchive(access, nomi, options.binding) ? undefined : NO_LEGACY_COUNTS;
  } catch { return undefined; }
}

async function migrate(options: LegacyMigrationOptions): Promise<LegacyMigrationCounts> {
  const access = createLegacyFileAccess([options.projectDir, options.userDataDir]);
  const projectDir = resolve(options.projectDir); const nomi = join(projectDir, '.nomi');
  const file = join(nomi, 'lane-legacy-migration.json'); const specs = sourcePaths(options);
  // 无锁这一眼用自己的一份访问器：它记下的目录身份不和加锁流程的混用。
  const settled = settledWithoutLock(createLegacyFileAccess([options.projectDir, options.userDataDir]), file, specs, nomi, options);
  if (settled) return settled;
  return withLegacyMigrationLock(access, projectDir, async () => {
    let manifestBytes = access.read(file)?.bytes;
    let manifest: Manifest | undefined;
    if (manifestBytes) {
      manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString()));
      if (!same(manifest.binding, options.binding) || manifest.sources.length !== specs.length
        || manifest.sources.some((source, index) => source.id !== specs[index].id)) fail();
      if (manifest.phase === 'completed') return manifest.counts;
    }
    const sessionSource = specs[1];
    const activeSessionFile = sessionSource.file;
    const savedStamp = manifest?.sources[1].archiveStamp;
    if ((!manifest && !access.read(activeSessionFile)) || savedStamp !== undefined) {
      const prior = readLegacyPriorArchive(access, nomi, options.binding);
      if (savedStamp !== undefined && (prior?.stamp !== savedStamp || access.read(activeSessionFile))) fail();
      if (prior) { sessionSource.file = prior.file; sessionSource.archiveStamp = prior.stamp; }
    }
    if (manifest?.sources.some((source, index) => index !== 1 && source.archiveStamp !== undefined)) fail();
    const transactionId = manifest?.transactionId ?? randomUUID();
    const directory = join(nomi, 'legacy-archive', transactionId);
    const loaded = specs.map((spec, index) => {
      const live = access.read(spec.file)?.bytes;
      const expected = manifest?.sources[index].hash;
      const archived = manifest ? access.read(join(directory, spec.archive))?.bytes : undefined;
      if (manifest) {
        if (live !== undefined && hash(live) !== expected) fail();
        if (archived !== undefined && hash(archived) !== expected) fail();
        if (expected !== null && live === undefined && archived === undefined) fail();
      }
      return { spec, bytes: archived ?? live };
    });
    const parsed = loaded.flatMap(({ spec, bytes }) => spec.kind && bytes !== undefined ? [parseLegacySource(spec.kind, bytes)] : []);
    const plan = planLegacyImport(parsed, options.binding, options.labels(manifest?.locale ?? options.locale));
    const sources = loaded.map(({ spec, bytes }) => ({ id: spec.id, hash: bytes === undefined ? null : hash(bytes),
      ...(spec.archiveStamp ? { archiveStamp: spec.archiveStamp } : {}) }));
    const counts: LegacyMigrationCounts = { projects: sources.some(source => source.hash !== null) ? 1 : 0,
      sourceFiles: sources.filter(source => source.hash !== null).length,
      conversations: plan.conversations.length, sourceItems: parsed.reduce((sum, source) => sum
        + source.conversations.reduce((count, conversation) => count + conversation.items.length, 0), 0),
      parts: plan.conversations.reduce((sum, conversation) => sum + conversation.expectedParts, 0),
      archivedOnlyConversations: plan.archivedOnly.length + plan.suppressed.length };
    const targets = plan.conversations.map(conversation => targetShape(conversation,
      sources.find(source => source.id === conversation.sourceKind)!.hash!));
    if (manifest) {
      if (!same(manifest.sources, sources) || !same(manifest.counts, counts)
        || !same(manifest.targets.map(({ sessionId: _sessionId, ...target }) => target), targets)) fail();
    } else {
      if (!counts.sourceFiles) return counts;
      manifest = { version: 1, parserVersion: 1, transactionId, phase: 'prepared', locale: options.locale,
        binding: options.binding, sources, counts, targets: targets.map(target => ({ ...target, sessionId: randomUUID() })) };
      manifestBytes = access.writeManifest(file, manifest, undefined);
    }
    await options.checkpoint?.('prepared'); access.check();
    for (const { spec, bytes } of loaded) if (bytes !== undefined) {
      access.archive(join(directory, spec.archive), bytes);
      await options.checkpoint?.('archived'); access.check();
    }
    for (const [index, target] of manifest.targets.entries()) {
      const operations = importOperations(manifest, target, plan.conversations[index]);
      if (manifest.phase === 'prepared') {
        const lane = await openLegacyImportLane(projectDir, target.laneName, target.sessionId);
        try {
          access.check(); const entries = await lane.entries(); assertPrefix(entries, operations);
          for (let cursor = entries.length; cursor < operations.length; cursor++) {
            access.check(); const operation = operations[cursor];
            if (operation.type === 'message') await lane.appendMessage(operation.message);
            else await lane.appendCustomEntry(operation.customType, operation.data);
            await options.checkpoint?.('append');
          }
        } finally { await lane.close(); }
      }
      const cold = await openLegacyImportLane(projectDir, target.laneName, target.sessionId);
      try {
        const entries = await cold.entries(); assertPrefix(entries, operations);
        if (entries.length !== operations.length) fail();
        const projection = projectLaneSnapshot(await cold.snapshot(), { pricing: 'unpriced', supportedThinkingLevels: ['off'] });
        if (projection.parts.length !== target.parts || !projection.legacy) fail();
      } finally { await cold.close(); }
      await options.checkpoint?.('cold-verified'); access.check();
    }
    if (manifest.phase === 'prepared') {
      manifest.phase = 'verified'; manifestBytes = access.writeManifest(file, manifest, manifestBytes);
    }
    await options.checkpoint?.('verified'); access.check();
    const first = manifest.targets[0];
    if (first && !readLaneWorkspaceSelection(projectDir)) {
      const sessions = await listLaneSessions(projectDir, BACKGROUND_CONTEXT);
      if (sessions.every(session => manifest.targets.some(target => target.sessionId === session.sessionId))) {
        writeLaneWorkspaceSelection(projectDir, { laneName: first.laneName, sessionId: first.sessionId });
      }
    }
    access.check();
    for (const { spec, bytes } of loaded) {
      if (spec.archiveStamp) {
        if (!access.read(spec.file)?.bytes.equals(bytes!) || access.read(activeSessionFile)) fail();
      } else if (bytes !== undefined) access.remove(spec.file, join(directory, spec.archive), bytes);
      else if (access.read(spec.file)) fail();
      await options.checkpoint?.('cleanup'); access.check();
    }
    manifest.phase = 'completed'; access.writeManifest(file, manifest, manifestBytes);
    return manifest.counts;
  });
}
