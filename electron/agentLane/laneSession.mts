// Agent lane · 会话落盘（`pi-coding-agent@1.7.0` 的 `SessionManager` v3，不是自研第二份持久化）
//
// 会话的序列化、追加、恢复、分支树、版本迁移与上下文投影全部交给 pi 的 `SessionManager`
// （R29 登记表 `session-persistence`）。Nomi 在这里只回答四件事：
//   1. 写到哪儿（`<project>/.nomi/agent-sessions/--nomi-lane-<name>--/`，不绑宿主绝对路径）；
//   2. 谁在持有它（进程内同一份 `.jsonl` 只允许一个所有者，防双写损坏，见上游 #8852）；
//   3. 文件与目录权限（`0o600` / `0o700` fail-closed）；
//   4. 存量 `0.85.1` v4 JSONL 打开前单向无损升级至 v3（`laneSessionV4Migration.mts`）。
import { open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { JsonValue, Usage } from '@earendil-works/pi-ai';
import type {
  SessionEntry,
  SessionManager as PiSessionManager,
  SessionContext as PiSessionContext,
} from '@earendil-works/pi-coding-agent';
import type {
  LaneBranchQuery,
  LaneEntry,
  LaneSnapshot,
} from '../shared/agentLane/laneSnapshotTypes.js';
import {
  ensureLaneSessionsRoot,
  hardenLaneSessionFile,
  LANE_FILE_MODE,
  LANE_IDENTITY_ROOT,
} from './laneFileSystem.mjs';
import {
  parseAnyLaneSessionHeader,
  upgradeV4SessionFileIfNeeded,
} from './laneSessionV4Migration.mjs';
import { LANE_TRACE_REDACTIONS_NOTE } from './laneTraceRedaction.mjs';
import { laneTraceDirectory, LANE_TRACE_NOTE, writeLaneTrace, writeTraceFile, type LaneTraceTurn } from './laneTrace.mjs';
import { refreshLiveLaneTrace } from './laneTraceRecorder.mjs';

const LANE_LEAF_POINTER_NOTE = 'nomi.session.leaf';
const DETACHED_TRACE_NOTES = new Set<string>([LANE_TRACE_NOTE, LANE_TRACE_REDACTIONS_NOTE]);

function isDetachedTraceEntry(entry: SessionEntry): boolean {
  return entry.type === 'custom' && entry.parentId === null && DETACHED_TRACE_NOTES.has(entry.customType);
}

function isLeafPointerEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: 'custom' }> {
  return entry.type === 'custom' && entry.parentId === null && entry.customType === LANE_LEAF_POINTER_NOTE;
}

function restorePersistedLeaf(manager: PiSessionManager): void {
  const entries = manager.getEntries();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (isDetachedTraceEntry(entry)) continue;
    if (isLeafPointerEntry(entry)) {
      const targetId = entry.data && typeof entry.data === 'object' && 'targetId' in entry.data
        ? (entry.data as { targetId?: unknown }).targetId
        : undefined;
      if (targetId === null) {
        manager.resetLeaf();
        return;
      }
      if (typeof targetId === 'string' && entries.some((candidate) => candidate.id === targetId)) {
        manager.branch(targetId);
        return;
      }
      continue;
    }
    manager.branch(entry.id);
    return;
  }
  manager.resetLeaf();
}

interface SessionManagerStatic {
  create(cwd: string, sessionDir?: string, options?: { id?: string }): PiSessionManager;
  open(path: string, sessionDir?: string, cwdOverride?: string): PiSessionManager;
  inMemory(cwd?: string): PiSessionManager;
}

let cachedSessionManagerClass: Promise<SessionManagerStatic> | undefined;
function loadSessionManagerClass(): Promise<SessionManagerStatic> {
  // 直接定位包内 `./core/session-manager.js`，避免在打开项目只读历史路径上拖进 `pi-coding-agent/dist/index.js` CLI 桶。
  const moduleUrl = new URL('./core/session-manager.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href;
  return (cachedSessionManagerClass ??= (import(moduleUrl) as Promise<{ SessionManager: SessionManagerStatic }>)
    .then((mod) => mod.SessionManager));
}

/**
 * 一条对话的稳定身份串（写进表头 `cwd` 并决定目录 slug，不是宿主文件系统路径）。
 * 用户重命名或移动项目文件夹后，列表与重开仍认出同一条历史。
 */
export function laneSessionCwd(laneName: string): string {
  return `${LANE_IDENTITY_ROOT}${laneName}`;
}

/** 会话根目录。跟着项目走，删项目即删历史。 */
export function laneSessionsRoot(projectDir: string): string {
  return join(projectDir, '.nomi', 'agent-sessions');
}

/** 与 pi 默认会话目录同构的稳定 slug（`--nomi-lane-<name>--`），不随宿主盘符变化。 */
export function laneSessionSlug(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

export function laneSessionDirectory(projectDir: string, laneName: string): string {
  return join(laneSessionsRoot(projectDir), laneSessionSlug(laneSessionCwd(laneName)));
}

export interface LaneSessionMetadata {
  readonly id: string;
  readonly cwd: string;
  readonly path: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
}

export interface LaneSessionSummary {
  laneName: string;
  sessionId: string;
  createdAt: number;
  updatedAt: number;
}

const HEADER_READ_BYTES = 4_096;

async function readFirstLine(filePath: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(filePath, 'r');
    const buffer = Buffer.allocUnsafe(HEADER_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_READ_BYTES, 0);
    if (bytesRead === 0) return undefined;
    const chunk = buffer.subarray(0, bytesRead).toString('utf8');
    const newline = chunk.indexOf('\n');
    return newline === -1 ? chunk : chunk.slice(0, newline);
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function scanSessionDirectory(directory: string): Promise<LaneSessionMetadata[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const found: LaneSessionMetadata[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    const filePath = join(directory, name);
    const firstLine = await readFirstLine(filePath);
    if (!firstLine) continue;
    const header = parseAnyLaneSessionHeader(firstLine);
    if (!header) continue;
    try {
      const info = await stat(filePath);
      found.push({
        id: header.id,
        cwd: header.cwd,
        path: resolve(filePath),
        createdAt: header.createdAt,
        modifiedAt: Math.trunc(info.mtimeMs),
      });
    } catch {
      // Skip concurrently removed files.
    }
  }
  return found;
}

async function listAllSessionMetadata(projectDir: string, laneName?: string): Promise<LaneSessionMetadata[]> {
  if (laneName !== undefined) {
    return scanSessionDirectory(laneSessionDirectory(projectDir, laneName));
  }
  const root = laneSessionsRoot(projectDir);
  let subdirs;
  try {
    subdirs = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const all: LaneSessionMetadata[] = [];
  for (const entry of subdirs) {
    if (!entry.isDirectory()) continue;
    all.push(...(await scanSessionDirectory(join(root, entry.name))));
  }
  return all;
}

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function addUsage(target: Usage, delta: Usage | undefined): void {
  if (!delta) return;
  target.input += delta.input ?? 0;
  target.output += delta.output ?? 0;
  target.cacheRead += delta.cacheRead ?? 0;
  target.cacheWrite += delta.cacheWrite ?? 0;
  target.totalTokens += delta.totalTokens ?? 0;
  if (delta.cost) {
    target.cost.input += delta.cost.input ?? 0;
    target.cost.output += delta.cost.output ?? 0;
    target.cost.cacheRead += delta.cost.cacheRead ?? 0;
    target.cost.cacheWrite += delta.cost.cacheWrite ?? 0;
    target.cost.total += delta.cost.total ?? 0;
  }
}

function toTimestampMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toLaneEntry(entry: SessionEntry, seq: number): LaneEntry {
  const base = {
    id: entry.id,
    parentId: entry.parentId,
    seq,
    timestamp: toTimestampMs(entry.timestamp),
  };
  switch (entry.type) {
    case 'message':
      return { ...base, type: 'message', message: entry.message as AgentMessage };
    case 'custom':
      return { ...base, type: 'custom', customType: entry.customType, ...(entry.data === undefined ? {} : { data: entry.data as JsonValue }) };
    case 'compaction':
      return {
        ...base,
        type: 'compaction',
        summary: entry.summary,
        firstKeptEntryId: entry.firstKeptEntryId,
        tokensBefore: entry.tokensBefore,
        ...(entry.details === undefined ? {} : { details: entry.details as JsonValue }),
        ...(entry.usage ? { usage: entry.usage } : {}),
        ...(entry.fromHook === undefined ? {} : { fromHook: entry.fromHook }),
      };
    case 'branch_summary':
      return {
        ...base,
        type: 'branch_summary',
        fromId: entry.fromId,
        summary: entry.summary,
        ...(entry.details === undefined ? {} : { details: entry.details as JsonValue }),
        ...(entry.usage ? { usage: entry.usage } : {}),
        ...(entry.fromHook === undefined ? {} : { fromHook: entry.fromHook }),
      };
    case 'context_edit':
      return { ...base, type: 'context_edit', targetId: entry.targetId, replacement: entry.replacement };
    case 'model_change':
      return { ...base, type: 'model_change', provider: entry.provider, modelId: entry.modelId };
    case 'thinking_level_change':
      return { ...base, type: 'thinking_level_change', thinkingLevel: entry.thinkingLevel };
    case 'usage':
      return {
        ...base,
        type: 'usage',
        kind: entry.kind,
        provider: entry.provider,
        model: entry.model,
        usage: entry.usage,
        ...(entry.note === undefined ? {} : { note: entry.note }),
      };
    case 'label':
      return { ...base, type: 'label', targetId: entry.targetId, label: entry.label };
    case 'session_info':
      return { ...base, type: 'session_info', ...(entry.name === undefined ? {} : { name: entry.name }) };
    case 'custom_message':
      return {
        ...base,
        type: 'message',
        message: {
          role: 'custom',
          customType: entry.customType,
          content: entry.content,
          display: entry.display,
          ...(entry.details === undefined ? {} : { details: entry.details }),
          timestamp: base.timestamp,
        } as AgentMessage,
      };
  }
}

export interface LaneSession {
  readonly metadata: LaneSessionMetadata;
  readonly manager: PiSessionManager;
  entries(): LaneEntry[];
  branchEntries(fromId?: string | null): LaneEntry[];
  activeTranscript(): LaneEntry[];
  findBranchEntries(query?: LaneBranchQuery): LaneEntry[];
  getEntry(id: string): LaneEntry | undefined;
  getEntries(ids: readonly string[]): Map<string, LaneEntry>;
  getTipId(): string | null;
  getStats(): LaneSnapshot['stats'];
  buildSessionContext(): PiSessionContext;
  branchTo(parentId: string | null): void;
  appendMessage(message: AgentMessage): Promise<string>;
  appendCustomEntry(customType: string, data?: JsonValue): Promise<string>;
  appendDetachedCustomEntry(customType: string, data?: JsonValue): Promise<string>;
  appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: JsonValue,
    fromHook?: boolean,
    usage?: Usage,
  ): Promise<string>;
  appendContextEdit(targetId: string, replacement: { content: Array<{ type: 'text'; text: string }> } | null): Promise<string>;
  appendModelChange(provider: string, modelId: string): Promise<string>;
  appendThinkingLevelChange(thinkingLevel: string): Promise<string>;
  close(): Promise<void>;
}

function createLaneSessionAdapter(manager: PiSessionManager, metadata: LaneSessionMetadata, onClose: () => void): LaneSession {
  let closed = false;
  const assertOpen = () => {
    if (closed) throw new Error('Closed');
  };

  const indexedEntries = (): { list: LaneEntry[]; byId: Map<string, LaneEntry> } => {
    const raw = manager.getEntries();
    const list: LaneEntry[] = [];
    const byId = new Map<string, LaneEntry>();
    let seq = 0;
    for (let index = 0; index < raw.length; index += 1) {
      const item = raw[index]!;
      if (isLeafPointerEntry(item)) continue;
      seq += 1;
      const converted = toLaneEntry(item, seq);
      list.push(converted);
      byId.set(converted.id, converted);
    }
    return { list, byId };
  };

  const branchEntries = (fromId?: string | null): LaneEntry[] => {
    if (fromId === null) return [];
    const { byId } = indexedEntries();
    const rawBranch = fromId === undefined ? manager.getBranch() : manager.getBranch(fromId);
    return rawBranch.map((entry) => byId.get(entry.id)!).filter(Boolean);
  };

  const activeTranscript = (): LaneEntry[] => {
    const branch = branchEntries();
    let latestCompactionIndex = -1;
    for (let index = branch.length - 1; index >= 0; index -= 1) {
      if (branch[index]!.type === 'compaction') {
        latestCompactionIndex = index;
        break;
      }
    }
    if (latestCompactionIndex === -1) return branch;
    const compaction = branch[latestCompactionIndex]!;
    if (compaction.type !== 'compaction') return branch;
    const keptIndex = compaction.firstKeptEntryId
      ? branch.findIndex((entry, idx) => idx < latestCompactionIndex && entry.id === compaction.firstKeptEntryId)
      : -1;
    if (keptIndex === -1) return branch.slice(latestCompactionIndex);
    return [
      compaction,
      ...branch.slice(keptIndex, latestCompactionIndex),
      ...branch.slice(latestCompactionIndex + 1),
    ];
  };

  const findBranchEntries = (query: LaneBranchQuery = {}): LaneEntry[] => {
    const tip = query.start === undefined ? manager.getLeafId() : query.start;
    if (!tip) return [];
    const branch = branchEntries(tip);
    const newestFirst = query.order === 'newestFirst';
    const ordered = newestFirst ? [...branch].reverse() : branch;
    const out: LaneEntry[] = [];
    for (const entry of ordered) {
      if (query.cursor !== undefined) {
        if (newestFirst ? entry.seq >= query.cursor.seq : entry.seq <= query.cursor.seq) continue;
      }
      const matchesFilter = (query.type === undefined || entry.type === query.type)
        && (query.customType === undefined || (entry.type === 'custom' && entry.customType === query.customType));
      if (matchesFilter) {
        out.push(entry);
      }
      if (query.stopAtId !== undefined && entry.id === query.stopAtId) break;
      if (query.stopAtType !== undefined && entry.type === query.stopAtType) break;
      if (query.limit !== undefined && out.length >= query.limit) break;
    }
    return out;
  };

  const harden = async (): Promise<void> => {
    if (!metadata.path) return;
    await hardenLaneSessionFile(metadata.path);
  };

  return {
    metadata,
    manager,
    entries: () => indexedEntries().list,
    branchEntries,
    activeTranscript,
    findBranchEntries,
    getEntry: (id) => indexedEntries().byId.get(id),
    getEntries: (ids) => {
      const { byId } = indexedEntries();
      const result = new Map<string, LaneEntry>();
      for (const id of ids) {
        const entry = byId.get(id);
        if (entry) result.set(id, entry);
      }
      return result;
    },
    getTipId: () => manager.getLeafId(),
    getStats: () => {
      const { list } = indexedEntries();
      const usage = emptyUsage();
      let messageCount = 0;
      for (const entry of list) {
        if (entry.type === 'message') {
          messageCount += 1;
          if (entry.message.role === 'assistant') addUsage(usage, entry.message.usage);
        } else if ((entry.type === 'compaction' || entry.type === 'branch_summary') && entry.usage) {
          addUsage(usage, entry.usage);
        } else if (entry.type === 'usage') {
          addUsage(usage, entry.usage);
        }
      }
      return { messageCount, usage };
    },
    buildSessionContext: () => manager.buildSessionContext(),
    branchTo: (parentId) => {
      assertOpen();
      if (manager.isPersisted()) {
        manager.resetLeaf();
        manager.appendCustomEntry(LANE_LEAF_POINTER_NOTE, { targetId: parentId });
      }
      if (parentId === null) manager.resetLeaf();
      else manager.branch(parentId);
    },
    appendMessage: async (message) => {
      assertOpen();
      const id = manager.appendMessage(message as Parameters<PiSessionManager['appendMessage']>[0]);
      await harden();
      return id;
    },
    appendCustomEntry: async (customType, data) => {
      assertOpen();
      const id = manager.appendCustomEntry(customType, data);
      await harden();
      return id;
    },
    appendDetachedCustomEntry: async (customType, data) => {
      assertOpen();
      const prevLeaf = manager.getLeafId();
      manager.resetLeaf();
      const id = manager.appendCustomEntry(customType, data);
      if (prevLeaf === null) manager.resetLeaf();
      else manager.branch(prevLeaf);
      await harden();
      return id;
    },
    appendCompaction: async (summary, firstKeptEntryId, tokensBefore, details, fromHook, usage) => {
      assertOpen();
      const id = manager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromHook, usage);
      await harden();
      return id;
    },
    appendContextEdit: async (targetId, replacement) => {
      assertOpen();
      const id = manager.appendContextEdit(targetId, replacement);
      await harden();
      return id;
    },
    appendModelChange: async (provider, modelId) => {
      assertOpen();
      const id = manager.appendModelChange(provider, modelId);
      await harden();
      return id;
    },
    appendThinkingLevelChange: async (thinkingLevel) => {
      assertOpen();
      const id = manager.appendThinkingLevelChange(thinkingLevel);
      await harden();
      return id;
    },
    close: async () => {
      if (closed) return;
      closed = true;
      onClose();
    },
  };
}

/**
 * 进程内单持有者登记（上游 #8852：同一条 JSONL 会话在同进程内被打开两次会交错写坏文件）。
 * 同时锁会话文件路径与正在打开中的 `(projectDir, laneName)`，并发打开同一条对话当场拒之门外。
 */
const openSessionPaths = new Set<string>();
const openingLaneKeys = new Set<string>();

function alreadyOpenError(target: string): Error {
  return new Error(
    `Nomi lane session ${target} already has an owner in this process. `
    + 'One session has exactly one owner: opening the same JSONL twice writes duplicate entries '
    + 'and corrupts the transcript (upstream pi #8852).',
  );
}

export interface LaneSessionOpen {
  session: LaneSession;
  sessionId: string;
  release(): Promise<void>;
}

/**
 * 这个项目盘上有哪些对话，最近更新的在前。
 * 只读每个 `.jsonl` 文件首行表头（v3 与 v4 都认），绝不创建目录或写盘（冷开零写入）。
 */
export async function listLaneSessions(projectDir: string): Promise<LaneSessionSummary[]> {
  const all = await listAllSessionMetadata(projectDir);
  const byLane = new Map<string, LaneSessionSummary>();
  for (const metadata of all) {
    if (!metadata.cwd.startsWith(LANE_IDENTITY_ROOT)) continue;
    const laneName = metadata.cwd.slice(LANE_IDENTITY_ROOT.length);
    if (!laneName) continue;
    const summary: LaneSessionSummary = {
      laneName,
      sessionId: metadata.id,
      createdAt: metadata.createdAt,
      updatedAt: metadata.modifiedAt,
    };
    const existing = byLane.get(laneName);
    if (!existing || existing.createdAt < summary.createdAt) byLane.set(laneName, summary);
  }
  return [...byLane.values()].sort((left, right) => right.updatedAt - left.updatedAt
    || left.laneName.localeCompare(right.laneName));
}

/** 删掉一条对话的落盘转录与派生轨迹；若该会话正被持有则直接抛错。 */
export async function deleteLaneSession(projectDir: string, laneName: string): Promise<boolean> {
  const known = await listAllSessionMetadata(projectDir, laneName);
  if (known.length === 0) return false;
  for (const metadata of known) {
    if (openSessionPaths.has(metadata.path)) {
      throw alreadyOpenError(metadata.id);
    }
  }
  for (const metadata of known) {
    await rm(metadata.path, { force: true });
    await rm(laneTraceDirectory(metadata), { recursive: true, force: true });
  }
  return true;
}

async function openExistingMetadata(metadata: LaneSessionMetadata, laneName: string): Promise<LaneSessionOpen> {
  if (openSessionPaths.has(metadata.path)) {
    throw alreadyOpenError(metadata.id);
  }
  openSessionPaths.add(metadata.path);
  let transferred = false;
  const releaseOwner = () => {
    openSessionPaths.delete(metadata.path);
  };
  try {
    await upgradeV4SessionFileIfNeeded(metadata.path, laneName);
    const SessionManager = await loadSessionManagerClass();
    const manager = SessionManager.open(metadata.path, join(metadata.path, '..'), metadata.cwd);
    restorePersistedLeaf(manager);
    const session = createLaneSessionAdapter(manager, metadata, releaseOwner);
    transferred = true;
    return {
      session,
      sessionId: metadata.id,
      release: async () => { await session.close(); },
    };
  } finally {
    if (!transferred) releaseOwner();
  }
}

async function createNewSession(projectDir: string, laneName: string, explicitId?: string): Promise<LaneSessionOpen> {
  const root = laneSessionsRoot(projectDir);
  const dir = laneSessionDirectory(projectDir, laneName);
  const cwd = laneSessionCwd(laneName);
  await ensureLaneSessionsRoot(root);
  await ensureLaneSessionsRoot(dir);
  const SessionManager = await loadSessionManagerClass();
  const manager = SessionManager.create(cwd, dir, explicitId ? { id: explicitId } : undefined);
  const rawFile = manager.getSessionFile();
  if (!rawFile) throw new Error('agent_lane_execute_failed');
  const filePath = resolve(rawFile);
  if (openSessionPaths.has(filePath)) {
    throw alreadyOpenError(manager.getSessionId());
  }
  openSessionPaths.add(filePath);
  let transferred = false;
  const releaseOwner = () => {
    openSessionPaths.delete(filePath);
  };
  try {
    const header = manager.getHeader();
    if (!header) throw new Error('agent_lane_execute_failed');
    // 以 `0o600` 原子建好首行表头并交给 `setSessionFile` 激活 `flushed = true`：
    //   1. 新项目第一次打开后列表与按 sessionId 重开立即可见（与 0.85.1 行为完全一致）；
    //   2. `nomi.input` 自定义 role 与纯 custom 笔记无需等首条 `user`/`assistant` 就能落盘；
    //   3. 文件从诞生起即为 `0o600`，不存在先 `0o644` 再 chmod 的竞争窗口。
    await writeFile(filePath, `${JSON.stringify(header)}\n`, { mode: LANE_FILE_MODE, flag: 'wx' });
    await hardenLaneSessionFile(filePath);
    manager.setSessionFile(filePath);
    const info = await stat(filePath);
    const metadata: LaneSessionMetadata = {
      id: manager.getSessionId(),
      cwd,
      path: filePath,
      createdAt: toTimestampMs(header.timestamp),
      modifiedAt: Math.trunc(info.mtimeMs),
    };
    const session = createLaneSessionAdapter(manager, metadata, releaseOwner);
    transferred = true;
    return {
      session,
      sessionId: metadata.id,
      release: async () => { await session.close(); },
    };
  } finally {
    if (!transferred) releaseOwner();
  }
}

export async function openLaneSession(
  options: { projectDir: string; laneName?: string; sessionId?: string; createSessionId?: string },
): Promise<LaneSessionOpen> {
  const laneName = options.laneName ?? 'main';
  const laneKey = `${resolve(options.projectDir)}\u0000${laneName}`;
  if (openingLaneKeys.has(laneKey)) {
    throw alreadyOpenError(options.sessionId ?? `"${laneName}"`);
  }
  openingLaneKeys.add(laneKey);
  try {
    const known = await listAllSessionMetadata(options.projectDir, laneName);
    if (options.createSessionId !== undefined) {
      if (
        options.sessionId !== undefined
        || known.length > 1
        || (known.length === 1 && known[0]!.id !== options.createSessionId)
      ) {
        throw new Error('legacy-target-session-conflict');
      }
      return known[0]
        ? await openExistingMetadata(known[0], laneName)
        : await createNewSession(options.projectDir, laneName, options.createSessionId);
    }
    if (options.sessionId === undefined) {
      const newest = known.reduce<LaneSessionMetadata | undefined>(
        (best, candidate) => (best && best.createdAt >= candidate.createdAt ? best : candidate),
        undefined,
      );
      return newest
        ? await openExistingMetadata(newest, laneName)
        : await createNewSession(options.projectDir, laneName);
    }
    const metadata = known.find((candidate) => candidate.id === options.sessionId);
    if (!metadata) {
      throw new Error(`Nomi lane session ${options.sessionId} is not on disk under ${laneSessionsRoot(options.projectDir)}`);
    }
    return await openExistingMetadata(metadata, laneName);
  } finally {
    openingLaneKeys.delete(laneKey);
  }
}

async function readTraceRows(directory: string): Promise<LaneTraceTurn[]> {
  return (await readFile(join(directory, 'trace.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LaneTraceTurn);
}

export async function readLaneTraceTurns(projectDir: string, laneName: string): Promise<LaneTraceTurn[]> {
  return readTraceRows(await openLaneTraceDirectory(projectDir, laneName));
}

/** Resolve from pi session headers on disk, never from a renderer-supplied filesystem path. */
export async function openLaneTraceDirectory(projectDir: string, laneName?: string): Promise<string> {
  const all = await listAllSessionMetadata(projectDir, laneName);
  const known = all.filter((item) => item.cwd.startsWith(LANE_IDENTITY_ROOT));
  if (laneName !== undefined && !known.length) throw new Error('agent_lane_conversation_missing');
  const root = laneSessionsRoot(projectDir);
  if (laneName === undefined) {
    await ensureLaneSessionsRoot(root);
  }
  const summaries: string[] = [];
  let selected: { createdAt: number; directory: string } | undefined;
  for (const metadata of known) {
    const itemLane = metadata.cwd.slice(LANE_IDENTITY_ROOT.length);
    let directory = await refreshLiveLaneTrace(metadata.path);
    if (!directory) {
      const opened = await openExistingMetadata(metadata, itemLane);
      try {
        directory = await writeLaneTrace(opened.session);
      } finally {
        await opened.release();
      }
    }
    const rows = await readTraceRows(directory);
    const total = rows.every((row) => row.estimatedCostUsd !== null)
      ? rows.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0)
      : null;
    const link = relative(root, join(directory, 'trace.md')).split(sep).map(encodeURIComponent).join('/');
    summaries.push(`- [${metadata.id}](${link}) · ${rows.length} turns · estimated USD ${total ?? 'unknown'}`);
    if (!selected || metadata.createdAt > selected.createdAt) {
      selected = { createdAt: metadata.createdAt, directory };
    }
  }
  if (laneName !== undefined) return selected!.directory;
  await writeTraceFile(root, 'index.md', ['# Agent traces', '', 'Local pi sessions · costs are estimates, not a bill.', '', ...summaries, ''].join('\n'));
  return root;
}
