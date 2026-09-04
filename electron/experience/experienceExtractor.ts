import { redactDeep } from "../events/redact";
import { learningEnvelopeSchema, trajectorySchema, type ExperienceCandidateDraft, type ExperienceTrajectory } from "./experienceTypes";

const MAX_TEXT = 2000;
const MAX_NESTED_STRING = 8192;
const MAX_NESTED_KEYS = 64;
const MAX_NESTED_ITEMS = 64;
const MAX_NESTED_DEPTH = 6;
const compact = (value: unknown, max = MAX_TEXT): string => {
  const text = typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
  return text.trim().replace(/\s+/g, " ").slice(0, max);
};

/** Bound untrusted nested values before recursive redaction can inspect them. */
function boundBeforeRedaction(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.slice(0, MAX_NESTED_STRING);
  if (depth >= MAX_NESTED_DEPTH) return compact(value, MAX_NESTED_STRING);
  if (Array.isArray(value)) return value.slice(0, MAX_NESTED_ITEMS).map((item) => boundBeforeRedaction(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_NESTED_KEYS)
        .map(([key, item]) => [key.slice(0, 160), boundBeforeRedaction(item, depth + 1)]),
    );
  }
  return value;
}

function boundedInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid experience trajectory");
  const value = input as Record<string, unknown>;
  return {
    trajectoryId: value.trajectoryId,
    projectId: value.projectId,
    sessionId: value.sessionId,
    threadId: value.threadId,
    area: value.area,
    prompt: typeof value.prompt === "string" ? value.prompt.slice(0, MAX_TEXT) : value.prompt,
    response: typeof value.response === "string" ? value.response.slice(0, MAX_TEXT) : value.response,
    events: Array.isArray(value.events)
      ? value.events.slice(0, 256).map((event) => boundBeforeRedaction(event))
      : value.events,
    completedAt: value.completedAt,
    ...(value.learningEnvelope !== undefined ? { learningEnvelope: boundBeforeRedaction(value.learningEnvelope) } : {}),
  };
}

/** Normalize before any extractor gets to see user content. This is local-only and bounded. */
export function normalizeTrajectory(input: unknown): ExperienceTrajectory {
  const raw = redactDeep(boundedInput(input));
  const record = raw as Record<string, unknown>;
  const events = Array.isArray(record.events) ? record.events.map((event) => {
    const value = event && typeof event === "object" ? event as Record<string, unknown> : {};
    return {
      type: compact(value.type, 120) || "unknown",
      ...(Number.isInteger(value.seq) && Number(value.seq) > 0 ? { seq: Number(value.seq) } : {}),
      ...(value.payload && typeof value.payload === "object" ? { payload: value.payload as Record<string, unknown> } : {}),
    };
  }) : [];
  return trajectorySchema.parse({
    trajectoryId: compact(record.trajectoryId, 160),
    projectId: compact(record.projectId, 160),
    sessionId: compact(record.sessionId, 160),
    ...(record.threadId ? { threadId: compact(record.threadId, 160) } : {}),
    ...(record.area === "creation" || record.area === "generation" ? { area: record.area } : {}),
    prompt: compact(record.prompt),
    response: compact(record.response),
    events,
    completedAt: compact(record.completedAt, 64),
    ...(record.learningEnvelope !== undefined ? { learningEnvelope: record.learningEnvelope } : {}),
  });
}

function extractJsonObject(text: string, marker: string): string | null {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf("{", markerIndex + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

/** Parse only the explicit machine-readable learning block; ordinary prose is never treated as training data. */
export function parseLearningEnvelope(response: string): unknown | null {
  const raw = extractJsonObject(response, "nomi-learning");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return learningEnvelopeSchema.safeParse(parsed).success ? parsed : null;
  } catch { return null; }
}

export type ExperienceExtractor = (trajectory: ExperienceTrajectory) => unknown | Promise<unknown>;

const defaultExtractor: ExperienceExtractor = (trajectory) => trajectory.learningEnvelope ?? parseLearningEnvelope(trajectory.response);
let extractor: ExperienceExtractor = defaultExtractor;

export function setExperienceExtractorForTests(next: ExperienceExtractor | null): void {
  extractor = next ?? defaultExtractor;
}

/**
 * Convert an extractor result into drafts. Invalid or absent output is a deliberate no-op:
 * Nomi never infers a reusable rule from an unverified conversational answer.
 */
export async function extractExperienceCandidates(input: unknown): Promise<ExperienceCandidateDraft[]> {
  const trajectory = normalizeTrajectory(input);
  const result = await extractor(trajectory);
  if (result == null) return [];
  const parsed = learningEnvelopeSchema.safeParse(redactDeep(boundBeforeRedaction(result)));
  if (!parsed.success) return [];
  const sourceSeqs = new Set(trajectory.events.flatMap((event) => event.seq === undefined ? [] : [event.seq]));
  if (parsed.data.evidence.eventSeqs.some((seq) => !sourceSeqs.has(seq))) return [];
  return [{
    kind: parsed.data.kind,
    title: parsed.data.title,
    content: parsed.data.content,
    scope: parsed.data.scope,
    evidence: parsed.data.evidence,
    confidence: parsed.data.confidence,
    consent: parsed.data.consent,
  }];
}
