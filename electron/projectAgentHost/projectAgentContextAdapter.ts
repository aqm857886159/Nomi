import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { fsyncIfDurable } from "../durability";
import { writeJsonFileAtomic } from "../jsonFile";
import type {
  LegacyContextSourceRef,
  ProjectAgentContextBinding,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import { assertProjectAgentBinding, sameProjectAgentBinding } from "./projectAgentIdentity";
import {
  findUniqueLegacyContextSession,
  type LegacyContextArea,
  type LegacyContextSource,
} from "./projectAgentLegacyContextReader";
import { stableProjectAgentJson } from "./projectAgentSnapshot";
import { createProjectAgentContextBinding, assertProjectAgentContextBinding } from "./projectAgentContextBinding";

export const PROJECT_AGENT_CONTEXT_SCHEMA_VERSION = 1 as const;
export const PROJECT_AGENT_CONTEXT_FILE = "project-agent-context-v1.json" as const;

export type ProjectAgentLegacyContextCandidate = Readonly<{
  area: LegacyContextArea;
  legacyThreadId: string;
  threadId: string;
  conversationSourceHash: string;
}>;

export type ProjectAgentContextRecord = Readonly<{
  recordId: string;
  binding: ProjectAgentContextBinding;
  source: LegacyContextSourceRef;
  snapshot: unknown;
}>;

type ProjectAgentContextStore = Readonly<{
  schemaVersion: typeof PROJECT_AGENT_CONTEXT_SCHEMA_VERSION;
  binding: ProjectBinding;
  legacyContextHash: string;
  records: readonly ProjectAgentContextRecord[];
}>;

export class ProjectAgentContextAdapterError extends Error {
  readonly code = "project_agent_context_staging_failed" as const;
}

function contextPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".nomi", PROJECT_AGENT_CONTEXT_FILE);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function recordKey(area: LegacyContextArea, legacyThreadId: string): string {
  return `${area}\0${legacyThreadId}`;
}

function recordId(
  input: Readonly<{
    binding: ProjectBinding;
    area: LegacyContextArea;
    legacyThreadId: string;
    threadId: string;
    sessionKey: string;
    contextHash: string;
  }>,
): string {
  return `context-${crypto
    .createHash("sha256")
    .update(
      stableProjectAgentJson({
        binding: input.binding,
        area: input.area,
        legacyThreadId: input.legacyThreadId,
        threadId: input.threadId,
        sessionKey: input.sessionKey,
        contextHash: input.contextHash,
      }),
    )
    .digest("hex")}`;
}

function fsyncDirectory(directoryPath: string): void {
  if (process.platform === "win32") return;
  let fd: number | undefined;
  try {
    fd = fs.openSync(directoryPath, fs.constants.O_RDONLY);
    fsyncIfDurable(fd);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function canonicalSnapshot(value: unknown): unknown {
  try {
    return JSON.parse(stableProjectAgentJson(value)) as unknown;
  } catch (error) {
    throw new ProjectAgentContextAdapterError("Legacy context snapshot is not JSON-stable", { cause: error });
  }
}

function parseStore(value: unknown): ProjectAgentContextStore | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== PROJECT_AGENT_CONTEXT_SCHEMA_VERSION || !validHash(raw.legacyContextHash)) return null;
  try {
    assertProjectAgentBinding(raw.binding as ProjectBinding);
  } catch {
    return null;
  }
  if (!Array.isArray(raw.records)) return null;
  const records: ProjectAgentContextRecord[] = [];
  const storeBinding = raw.binding as ProjectBinding;
  for (const candidate of raw.records) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    if (typeof record.recordId !== "string" || !record.recordId.trim()) return null;
    let contextBinding: ProjectAgentContextBinding;
    try {
      contextBinding = assertProjectAgentContextBinding(record.binding);
    } catch {
      return null;
    }
    if (!sameProjectAgentBinding(contextBinding.project, storeBinding)) return null;
    const source = record.source;
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    const sourceRecord = source as Record<string, unknown>;
    if (
      (sourceRecord.legacyArea !== "creation" && sourceRecord.legacyArea !== "generation") ||
      typeof sourceRecord.legacySessionKey !== "string" ||
      !sourceRecord.legacySessionKey.trim() ||
      typeof sourceRecord.legacyThreadId !== "string" ||
      !sourceRecord.legacyThreadId.trim() ||
      !validHash(sourceRecord.sourceHash)
    ) {
      return null;
    }
    records.push(
      Object.freeze({
        recordId: record.recordId,
        binding: contextBinding,
        source: Object.freeze({ ...(source as LegacyContextSourceRef) }),
        snapshot: canonicalSnapshot(record.snapshot),
      }),
    );
  }
  return Object.freeze({
    schemaVersion: PROJECT_AGENT_CONTEXT_SCHEMA_VERSION,
    binding: Object.freeze({ ...(raw.binding as ProjectBinding) }),
    legacyContextHash: raw.legacyContextHash,
    records: Object.freeze(records),
  });
}

function readStore(filePath: string): ProjectAgentContextStore | null {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
      throw new ProjectAgentContextAdapterError("Project Agent context staging file is not private");
    }
    const parsed = parseStore(JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown);
    if (!parsed) throw new ProjectAgentContextAdapterError("Project Agent context staging envelope is invalid");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ProjectAgentContextAdapterError) throw error;
    throw new ProjectAgentContextAdapterError("Project Agent context staging file is unreadable", { cause: error });
  }
}

/**
 * Stages only exact, validated legacy snapshots. The returned map is consumed
 * by migration when it builds Host contextRefs; an absent entry means a fresh
 * canonical context, never a legacy fallback.
 */
export function stageProjectAgentLegacyContext(
  input: Readonly<{
    projectRoot: string;
    binding: ProjectBinding;
    source: LegacyContextSource;
    candidates: readonly ProjectAgentLegacyContextCandidate[];
  }>,
): Readonly<{ path: string; legacyContextHash: string; recordIds: ReadonlyMap<string, string> }> {
  assertProjectAgentBinding(input.binding);
  if (!validHash(input.source.sourceHash)) throw new ProjectAgentContextAdapterError("Legacy context hash is invalid");

  const records: ProjectAgentContextRecord[] = [];
  const recordIds = new Map<string, string>();
  const seen = new Set<string>();
  for (const candidate of input.candidates) {
    const key = recordKey(candidate.area, candidate.legacyThreadId);
    if (seen.has(key)) throw new ProjectAgentContextAdapterError("Duplicate legacy context candidate");
    seen.add(key);
    const session = findUniqueLegacyContextSession(
      input.source,
      input.binding.projectId,
      candidate.area,
      candidate.legacyThreadId,
    );
    if (!session) continue;
    if (!validHash(candidate.conversationSourceHash)) {
      throw new ProjectAgentContextAdapterError("Legacy conversation source hash is invalid");
    }
    const binding = createProjectAgentContextBinding(input.binding, candidate.threadId);
    const source: LegacyContextSourceRef = Object.freeze({
      legacyArea: candidate.area,
      legacySessionKey: session.sessionKey,
      legacyThreadId: candidate.legacyThreadId,
      sourceHash: candidate.conversationSourceHash,
    });
    const id = recordId({
      binding: input.binding,
      area: candidate.area,
      legacyThreadId: candidate.legacyThreadId,
      threadId: candidate.threadId,
      sessionKey: session.sessionKey,
      contextHash: input.source.sourceHash,
    });
    const record: ProjectAgentContextRecord = Object.freeze({
      recordId: id,
      binding,
      source,
      snapshot: canonicalSnapshot(session.snapshot),
    });
    records.push(record);
    recordIds.set(key, id);
  }

  const filePath = contextPath(input.projectRoot);
  const existing = readStore(filePath);
  const store: ProjectAgentContextStore = Object.freeze({
    schemaVersion: PROJECT_AGENT_CONTEXT_SCHEMA_VERSION,
    binding: Object.freeze({ ...input.binding }),
    legacyContextHash: input.source.sourceHash,
    records: Object.freeze(records),
  });
  if (existing) {
    if (
      !sameProjectAgentBinding(existing.binding, input.binding) ||
      existing.legacyContextHash !== store.legacyContextHash ||
      stableProjectAgentJson(existing.records) !== stableProjectAgentJson(store.records)
    ) {
      throw new ProjectAgentContextAdapterError("Legacy context staging changed after cutover preparation");
    }
    return Object.freeze({ path: filePath, legacyContextHash: store.legacyContextHash, recordIds });
  }

  writeJsonFileAtomic(filePath, store, { mode: 0o600 });
  try {
    fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    throw new ProjectAgentContextAdapterError("Legacy context staging directory is not durable", { cause: error });
  }
  return Object.freeze({ path: filePath, legacyContextHash: store.legacyContextHash, recordIds });
}

export function projectAgentContextPath(projectRoot: string): string {
  return contextPath(projectRoot);
}

export function legacyContextRecordKey(area: LegacyContextArea, legacyThreadId: string): string {
  return recordKey(area, legacyThreadId);
}
