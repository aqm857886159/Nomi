import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type LegacyContextArea = "creation" | "generation";

export type LegacyContextSource = Readonly<{
  path: string;
  sourceHash: string;
  rawBytes: number;
  sessions: ReadonlyMap<string, unknown>;
}>;

export type LegacyContextSession = Readonly<{
  sessionKey: string;
  snapshot: unknown;
}>;

export class ProjectAgentLegacyContextError extends Error {
  readonly code = "project_agent_legacy_context_invalid" as const;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parse(bytes: Buffer, filePath: string): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProjectAgentLegacyContextError(`Legacy agent context is not valid UTF-8 JSON: ${filePath}`, {
      cause: error,
    });
  }
}

function validMessageArray(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      const record = asRecord(item);
      return (
        !!record &&
        (record.role === "user" || record.role === "assistant" || record.role === "tool" || record.role === "system") &&
        typeof record.content === "string"
      );
    })
  );
}

/**
 * The migration keeps the old SDK value opaque. This shape check is deliberately
 * conservative: arbitrary objects must never become an active context merely
 * because a key happens to look familiar.
 */
function validSnapshot(value: unknown, legacyThreadId?: string): boolean {
  if (typeof value === "string") return value.length > 0;
  if (validMessageArray(value)) return true;
  const record = asRecord(value);
  if (!record) return false;
  if (record.threadId !== undefined && record.threadId !== legacyThreadId) return false;
  if (typeof record.snapshot === "string") return record.snapshot.length > 0;
  if (validMessageArray(record.messages)) return true;
  return false;
}

/** Reads the old context envelope as opaque values. It never hydrates or replays SDK messages. */
export function readProjectAgentLegacyContext(projectRoot: string): LegacyContextSource {
  const filePath = path.join(path.resolve(projectRoot), ".nomi", "agent-session.json");
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") bytes = Buffer.alloc(0);
    else throw error;
  }
  const sourceHash = crypto.createHash("sha256").update(bytes).digest("hex");
  if (bytes.length === 0) return Object.freeze({ path: filePath, sourceHash, rawBytes: 0, sessions: new Map() });
  const parsed = asRecord(parse(bytes, filePath));
  if (!parsed) throw new ProjectAgentLegacyContextError(`Legacy agent context is not an object: ${filePath}`);
  const rawSessions = asRecord(parsed.sessions) ?? parsed;
  const sessions = new Map<string, unknown>();
  for (const [key, value] of Object.entries(rawSessions)) {
    if (key.trim()) sessions.set(key, value);
  }
  return Object.freeze({ path: filePath, sourceHash, rawBytes: bytes.length, sessions });
}

export function legacyContextSessionKey(projectId: string, area: LegacyContextArea): string {
  const id = projectId.trim();
  if (!id) throw new ProjectAgentLegacyContextError("Project id is required for legacy context mapping");
  return `nomi:workbench:${id}:${area}`;
}

/** Only an exact old key is eligible for provenance; ambiguous sessions stay unmapped. */
export function findUniqueLegacyContextSession(
  source: LegacyContextSource,
  projectId: string,
  area: LegacyContextArea,
  legacyThreadId?: string,
): LegacyContextSession | null {
  const expected = legacyContextSessionKey(projectId, area);
  if (!source.sessions.has(expected)) return null;
  const snapshot = source.sessions.get(expected);
  return validSnapshot(snapshot, legacyThreadId) ? { sessionKey: expected, snapshot } : null;
}
