import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ProjectAgentLegacyArea = "creation" | "generation";

export type ProjectAgentLegacyMessage = Readonly<{
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  storyboardPlan?: true;
}>;

export type ProjectAgentLegacyThread = Readonly<{
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: readonly ProjectAgentLegacyMessage[];
}>;

export type ProjectAgentLegacyConversationSource = Readonly<{
  path: string;
  sourceHash: string;
  rawBytes: number;
  creation: readonly ProjectAgentLegacyThread[];
  creationActiveId: string | null;
  generation: readonly ProjectAgentLegacyThread[];
  generationActiveId: string | null;
  committedProposal: unknown;
}>;

export class ProjectAgentLegacyConversationError extends Error {
  readonly code = "project_agent_legacy_conversations_invalid" as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseRawJson(bytes: Buffer, filePath: string): unknown {
  try {
    // Buffer.toString() silently replaces malformed UTF-8. Migration must
    // reject those bytes instead of creating an apparently complete archive.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProjectAgentLegacyConversationError(`Legacy conversation source is not valid UTF-8 JSON: ${filePath}`, {
      cause: error,
    } as ErrorOptions);
  }
}

function finiteTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readMessage(value: unknown): ProjectAgentLegacyMessage | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || !record.id.trim() || typeof record.content !== "string") return null;
  const role = record.role;
  if (role !== "user" && role !== "assistant" && role !== "tool") return null;
  return Object.freeze({
    id: record.id,
    role,
    content: record.content,
    ...(record.storyboardPlan === true ? { storyboardPlan: true as const } : {}),
  });
}

function readThread(value: unknown, fallbackNow: number): ProjectAgentLegacyThread | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || !record.id.trim() || !Array.isArray(record.messages)) return null;
  const messages = record.messages.map(readMessage).filter((item): item is ProjectAgentLegacyMessage => item !== null);
  const createdAt = finiteTimestamp(record.createdAt, fallbackNow);
  const updatedAt = Math.max(createdAt, finiteTimestamp(record.updatedAt, createdAt));
  return Object.freeze({
    id: record.id,
    title: typeof record.title === "string" ? record.title : "",
    createdAt,
    updatedAt,
    messages: Object.freeze(messages),
  });
}

type LegacyAreaRead = Readonly<{
  activeId: string | null;
  threads: readonly ProjectAgentLegacyThread[];
}>;

function readArea(value: unknown, fallbackNow: number): LegacyAreaRead {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.threads)) return Object.freeze({ activeId: null, threads: Object.freeze([]) });
  const threads = record.threads
    .map((item) => readThread(item, fallbackNow))
    .filter((item): item is ProjectAgentLegacyThread => item !== null);
  const ids = new Set<string>();
  for (const thread of threads) {
    if (ids.has(thread.id))
      throw new ProjectAgentLegacyConversationError("Legacy conversation contains duplicate thread ids");
    ids.add(thread.id);
  }
  const activeId = typeof record.activeId === "string" && ids.has(record.activeId) ? record.activeId : null;
  return Object.freeze({ activeId, threads: Object.freeze(threads) });
}

function migrateV1Area(value: unknown, sourceHash: string, fallbackNow: number): LegacyAreaRead {
  if (!Array.isArray(value)) return Object.freeze({ activeId: null, threads: Object.freeze([]) });
  const messages = value.map(readMessage).filter((item): item is ProjectAgentLegacyMessage => item !== null);
  if (messages.length === 0) return Object.freeze({ activeId: null, threads: Object.freeze([]) });
  const id = `legacy-v1-${sourceHash.slice(0, 24)}`;
  const thread = Object.freeze({
    id,
    title: messages.find((message) => message.role === "user")?.content.slice(0, 24) ?? "",
    createdAt: fallbackNow,
    updatedAt: fallbackNow,
    messages: Object.freeze(messages),
  });
  return Object.freeze({ activeId: id, threads: Object.freeze([thread]) });
}

/** Reads the source file without normalization, clipping, or message replay. */
export function readProjectAgentLegacyConversations(
  projectRoot: string,
  now = Date.now(),
): ProjectAgentLegacyConversationSource {
  const filePath = path.join(path.resolve(projectRoot), ".nomi", "conversations.json");
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      bytes = Buffer.alloc(0);
    } else {
      throw error;
    }
  }
  const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length === 0) {
    return Object.freeze({
      path: filePath,
      sourceHash,
      rawBytes: 0,
      creation: [],
      creationActiveId: null,
      generation: [],
      generationActiveId: null,
      committedProposal: null,
    });
  }
  const raw = asRecord(parseRawJson(bytes, filePath));
  if (!raw) throw new ProjectAgentLegacyConversationError(`Legacy conversation source is not an object: ${filePath}`);

  const isV2 = raw.v === 2;
  const creationArea = isV2 ? readArea(raw.creation, now) : migrateV1Area(raw.creationMessages, sourceHash, now);
  const generationArea = isV2 ? readArea(raw.generation, now) : migrateV1Area(raw.generationMessages, sourceHash, now);
  return Object.freeze({
    path: filePath,
    sourceHash,
    rawBytes: bytes.length,
    creation: creationArea.threads,
    creationActiveId: creationArea.activeId,
    generation: generationArea.threads,
    generationActiveId: generationArea.activeId,
    committedProposal: raw.committedProposal ?? null,
  });
}
