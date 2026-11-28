// Agent lane · 存量 `0.85.1` `JsonlSessionRepo` v4 单向无损升级至 `SessionManager` v3（★1c）
//
// 起因：`pi 0.85.1` 的 `pi-agent-core` 用 `JsonlSessionRepo` 写出 v4 事务格式
// （首行 `{"v":4,"kind":"header",...}`，后续每行一条或多条 `{seq,kind:"entry"|"usage"|"value"|"list",...}`）；
// `pi 1.7.0` 删除了 `pi-agent-core/harness`，正式主干统一在 `pi-coding-agent` 的 `SessionManager` v3
// （首行 `{"type":"session","version":3,"id":...,"timestamp":...,"cwd":...}`，后续每行一条 `SessionEntry`）。
// 上游 `SessionManager` 只内置了 v1→v2→v3 迁移，未内置 v4→v3 读取器。
//
// 本模块做两件干净的事：
//   1. `parseAnyLaneSessionHeader(line)`：零重型依赖读取第一行表头（v3 与 v4 都认），供打开项目时的对话列表扫描使用；
//   2. `upgradeV4SessionFileIfNeeded(filePath, laneName)`：打开会话前若检测到 v4 表头，完整重放全部已提交事务
//      （自动忽略崩溃留下的无换行残尾，与 0.85.1 `splitCompleteLines` 同构），保留原 entry id / parentId /
//      时间戳 / 消息体 / custom 记录 / 压缩摘要 / 用量与模型档位变更，原子替换成标准 `SessionManager` v3 文件并收紧 `0o600`。
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { renameWithRetry } from '../jsonFile.js';
import { hardenLaneSessionFile, LANE_FILE_MODE } from './laneFileSystem.mjs';

export interface ParsedLaneSessionHeader {
  readonly format: 'v3' | 'v4';
  readonly id: string;
  readonly cwd: string;
  readonly createdAt: number;
  readonly parentSession?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toIsoTimestamp(value: unknown, fallbackMs: number): string {
  if (typeof value === 'string' && Number.isFinite(Date.parse(value))) {
    return new Date(Date.parse(value)).toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return new Date(value).toISOString();
  }
  return new Date(fallbackMs).toISOString();
}

function normalizeLaneHeaderCwd(rawCwd: string): string {
  const forward = rawCwd.replace(/\\/g, '/');
  return forward.replace(/^[A-Za-z]:(?=\/nomi-lane\/)/, '');
}

export function parseAnyLaneSessionHeader(line: string): ParsedLaneSessionHeader | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (
    parsed.type === 'session'
    && (parsed.version === undefined || (typeof parsed.version === 'number' && parsed.version <= 3))
    && typeof parsed.id === 'string'
    && typeof parsed.cwd === 'string'
    && typeof parsed.timestamp === 'string'
  ) {
    const createdAt = Date.parse(parsed.timestamp);
    if (!Number.isFinite(createdAt)) return undefined;
    return {
      format: 'v3',
      id: parsed.id,
      cwd: normalizeLaneHeaderCwd(parsed.cwd),
      createdAt,
      ...(typeof parsed.parentSession === 'string' ? { parentSession: parsed.parentSession } : {}),
    };
  }
  if (
    parsed.kind === 'header'
    && parsed.v === 4
    && typeof parsed.id === 'string'
    && typeof parsed.cwd === 'string'
    && typeof parsed.createdAt === 'number'
    && Number.isSafeInteger(parsed.createdAt)
    && parsed.createdAt >= 0
  ) {
    return {
      format: 'v4',
      id: parsed.id,
      cwd: normalizeLaneHeaderCwd(parsed.cwd),
      createdAt: parsed.createdAt,
      ...(typeof parsed.parentSessionId === 'string'
        ? { parentSession: parsed.parentSessionId }
        : typeof parsed.legacyParentSessionPath === 'string'
          ? { parentSession: parsed.legacyParentSessionPath }
          : {}),
    };
  }
  return undefined;
}

function splitCompleteLines(content: string): string[] {
  if (content.endsWith('\n')) return content.slice(0, -1).split('\n');
  const lastNewline = content.lastIndexOf('\n');
  if (lastNewline === -1) return [];
  return content.slice(0, lastNewline).split('\n');
}

interface V4EntryRow {
  readonly seq: number;
  readonly id: string;
  readonly parentId: string | null;
  readonly timestamp: number;
  readonly type: string;
  readonly raw: Record<string, unknown>;
}

function convertV4EntryToV3(row: V4EntryRow, fallbackMs: number): Record<string, unknown> | undefined {
  const timestamp = toIsoTimestamp(row.timestamp, fallbackMs);
  const base = { id: row.id, parentId: row.parentId, timestamp };
  switch (row.type) {
    case 'message':
      return isRecord(row.raw.message) ? { ...base, type: 'message', message: row.raw.message } : undefined;
    case 'custom':
      return typeof row.raw.customType === 'string'
        ? { ...base, type: 'custom', customType: row.raw.customType, ...(row.raw.data === undefined ? {} : { data: row.raw.data }) }
        : undefined;
    case 'compaction':
      return typeof row.raw.summary === 'string'
        ? {
            ...base,
            type: 'compaction',
            summary: row.raw.summary,
            firstKeptEntryId: typeof row.raw.firstKeptEntryId === 'string' ? row.raw.firstKeptEntryId : row.id,
            tokensBefore: typeof row.raw.tokensBefore === 'number' && Number.isFinite(row.raw.tokensBefore) ? row.raw.tokensBefore : 0,
            ...(row.raw.details === undefined ? {} : { details: row.raw.details }),
            ...(isRecord(row.raw.usage) ? { usage: row.raw.usage } : {}),
            ...(typeof row.raw.fromHook === 'boolean' ? { fromHook: row.raw.fromHook } : {}),
          }
        : undefined;
    case 'branch_summary':
      return typeof row.raw.summary === 'string' && typeof row.raw.fromId === 'string'
        ? {
            ...base,
            type: 'branch_summary',
            fromId: row.raw.fromId,
            summary: row.raw.summary,
            ...(row.raw.details === undefined ? {} : { details: row.raw.details }),
            ...(isRecord(row.raw.usage) ? { usage: row.raw.usage } : {}),
          }
        : undefined;
    case 'model_change':
      return typeof row.raw.provider === 'string' && typeof row.raw.modelId === 'string'
        ? { ...base, type: 'model_change', provider: row.raw.provider, modelId: row.raw.modelId }
        : undefined;
    case 'thinking_level_change':
      return typeof row.raw.thinkingLevel === 'string'
        ? { ...base, type: 'thinking_level_change', thinkingLevel: row.raw.thinkingLevel }
        : undefined;
    default:
      return undefined;
  }
}

export function convertV4SessionContentToV3(content: string, laneName?: string): { migrated: false } | { migrated: true; v3Content: string } {
  const lines = splitCompleteLines(content);
  if (lines.length === 0) return { migrated: false };
  const header = parseAnyLaneSessionHeader(lines[0]!);
  if (!header || header.format !== 'v4') return { migrated: false };

  const entriesById = new Map<string, V4EntryRow>();
  const entriesInOrder: V4EntryRow[] = [];
  const scalarValues = new Map<string, unknown>();
  const adjustmentUsages: Array<{ id: string; timestamp: number; usage: Record<string, unknown> }> = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as unknown;
    const writes = Array.isArray(parsed) ? parsed : [parsed];
    let syntheticSeq = 0;
    for (const write of writes) {
      if (!isRecord(write)) continue;
      if (write.kind === 'entry') {
        const entryPayload = isRecord(write.entry) ? write.entry : write;
        if (typeof entryPayload.id === 'string' && typeof entryPayload.type === 'string') {
          syntheticSeq += 1;
          const row: V4EntryRow = {
            seq: typeof write.seq === 'number'
              ? write.seq
              : typeof entryPayload.seq === 'number'
                ? entryPayload.seq
                : syntheticSeq,
            id: entryPayload.id,
            parentId: typeof entryPayload.parentId === 'string' ? entryPayload.parentId : null,
            timestamp: typeof entryPayload.timestamp === 'number' ? entryPayload.timestamp : header.createdAt,
            type: entryPayload.type,
            raw: entryPayload,
          };
          entriesById.set(row.id, row);
          entriesInOrder.push(row);
        }
      } else if (write.kind === 'value' && typeof write.key === 'string') {
        let key: string | undefined;
        if (typeof write.namespace === 'string') {
          key = `${write.namespace}\u0000${write.key}`;
        } else {
          const colon = write.key.lastIndexOf(':');
          if (colon > 0) key = `${write.key.slice(0, colon)}\u0000${write.key.slice(colon + 1)}`;
        }
        const op = typeof write.op === 'string' ? write.op : typeof write.action === 'string' ? write.action : undefined;
        if (key && op === 'delete') scalarValues.delete(key);
        else if (key && op === 'set') scalarValues.set(key, write.value);
      } else if (write.kind === 'usage' && write.adjustment === true && typeof write.id === 'string' && isRecord(write.usage)) {
        adjustmentUsages.push({
          id: write.id,
          timestamp: typeof write.timestamp === 'number' ? write.timestamp : header.createdAt,
          usage: write.usage,
        });
      }
    }
  }

  // Resolve target branch tip: `pi.session.branch` -> `<laneName>` (or sole branch tip) so SessionManager's
  // default leaf (the last entry in file order) lands on the exact active tip of this lane.
  let tipId: string | undefined;
  if (laneName) {
    const candidate = scalarValues.get(`pi.session.branch\u0000${laneName}`);
    if (typeof candidate === 'string' && entriesById.has(candidate)) tipId = candidate;
  }
  if (!tipId) {
    for (const [key, value] of scalarValues) {
      if (key.startsWith('pi.session.branch\u0000') && typeof value === 'string' && entriesById.has(value)) {
        tipId = value;
      }
    }
  }
  tipId ??= entriesInOrder.at(-1)?.id;

  // Emit non-active entries first (if any), then the active root->tip chain last so `SessionManager`'s leafId === tipId.
  const activeChain: V4EntryRow[] = [];
  const activeSet = new Set<string>();
  let cursor = tipId ? entriesById.get(tipId) : undefined;
  while (cursor && !activeSet.has(cursor.id)) {
    activeChain.push(cursor);
    activeSet.add(cursor.id);
    cursor = cursor.parentId ? entriesById.get(cursor.parentId) : undefined;
  }
  activeChain.reverse();

  const orderedRows = [
    ...entriesInOrder.filter((row) => !activeSet.has(row.id)),
    ...activeChain,
  ];

  const v3Records: Record<string, unknown>[] = [
    {
      type: 'session',
      version: 3,
      id: header.id,
      timestamp: toIsoTimestamp(header.createdAt, header.createdAt),
      cwd: header.cwd,
      ...(header.parentSession ? { parentSession: header.parentSession } : {}),
    },
  ];

  let lastParentId: string | null = null;
  for (const row of orderedRows) {
    const converted = convertV4EntryToV3(row, header.createdAt);
    if (!converted) continue;
    v3Records.push(converted);
    lastParentId = row.id;
  }

  // Preserve v3-import usage adjustments if any existed in v4 storage without affecting model context.
  for (const adjustment of adjustmentUsages) {
    if (entriesById.has(adjustment.id)) continue;
    v3Records.push({
      type: 'usage',
      id: adjustment.id,
      parentId: lastParentId,
      timestamp: toIsoTimestamp(adjustment.timestamp, header.createdAt),
      kind: 'v4_import_adjustment',
      provider: 'legacy',
      model: 'legacy',
      usage: adjustment.usage,
    });
    lastParentId = adjustment.id;
  }

  // Preserve lane configuration stored in v4 scalar values (`pi.lane.config`) if not already represented by entries.
  const configKey = laneName ? `pi.lane.config\u0000${laneName}` : undefined;
  const rawConfig = configKey ? scalarValues.get(configKey) : undefined;
  if (isRecord(rawConfig)) {
    if (isRecord(rawConfig.model) && typeof rawConfig.model.provider === 'string' && typeof rawConfig.model.modelId === 'string') {
      const modelObj = rawConfig.model;
      const hasSameModel = v3Records.some(
        (rec) =>
          (rec.type === 'model_change' && rec.provider === modelObj.provider && rec.modelId === modelObj.modelId)
          || (rec.type === 'message' && isRecord(rec.message) && rec.message.role === 'assistant'
            && rec.message.provider === modelObj.provider
            && rec.message.model === modelObj.modelId),
      );
      if (!hasSameModel && rawConfig.model.provider && rawConfig.model.modelId) {
        const id = `cfg-m-${randomUUID().slice(0, 8)}`;
        v3Records.push({
          type: 'model_change',
          id,
          parentId: lastParentId,
          timestamp: toIsoTimestamp(header.createdAt, header.createdAt),
          provider: rawConfig.model.provider,
          modelId: rawConfig.model.modelId,
        });
        lastParentId = id;
      }
    }
    if (typeof rawConfig.thinkingLevel === 'string' && rawConfig.thinkingLevel !== 'off') {
      const id = `cfg-t-${randomUUID().slice(0, 8)}`;
      v3Records.push({
        type: 'thinking_level_change',
        id,
        parentId: lastParentId,
        timestamp: toIsoTimestamp(header.createdAt, header.createdAt),
        thinkingLevel: rawConfig.thinkingLevel,
      });
      lastParentId = id;
    }
    if (Array.isArray(rawConfig.activeToolNames)) {
      const names = rawConfig.activeToolNames.filter((n): n is string => typeof n === 'string');
      const id = `cfg-tools-${randomUUID().slice(0, 8)}`;
      v3Records.push({
        type: 'custom',
        id,
        parentId: lastParentId,
        timestamp: toIsoTimestamp(header.createdAt, header.createdAt),
        customType: 'nomi.ui.active-tools',
        data: { names },
      });
      lastParentId = id;
    }
  }

  const v3Content = `${v3Records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  return { migrated: true, v3Content };
}

export async function upgradeV4SessionFileIfNeeded(filePath: string, laneName?: string): Promise<boolean> {
  const content = await readFile(filePath, 'utf8');
  const firstNewline = content.indexOf('\n');
  const firstLine = firstNewline === -1 ? content : content.slice(0, firstNewline);
  const header = parseAnyLaneSessionHeader(firstLine);
  if (!header || header.format !== 'v4') return false;
  const converted = convertV4SessionContentToV3(content, laneName);
  if (!converted.migrated) return false;
  const tempPath = `${filePath}.${randomUUID()}.v3.tmp`;
  try {
    await writeFile(tempPath, converted.v3Content, { mode: LANE_FILE_MODE, flag: 'wx' });
    await renameWithRetry(tempPath, filePath);
    await hardenLaneSessionFile(filePath);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
  return true;
}
