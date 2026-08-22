import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PRODUCTION_RUN_INTENT_LOG_SCHEMA_VERSION = 1;

export type ProductionRunIntentStatus = "prepared" | "committed" | "aborted";

export type ProductionRunIntent = {
  schemaVersion: typeof PRODUCTION_RUN_INTENT_LOG_SCHEMA_VERSION;
  intentId: string;
  runId: string;
  kind: string;
  key: string;
  payloadHash: string;
  status: ProductionRunIntentStatus;
  createdAt: string;
  committedAt?: string;
  seq: number;
  prevHash: string;
  fencingEpoch: number;
  keyId: string;
  mac: string;
};

export type ProductionRunIntentPrepareInput = {
  runId: string;
  kind: string;
  key: string;
  payload: unknown;
  fencingEpoch?: number;
  allowRetryAfterAbort?: boolean;
};

export type ProductionRunIntentLogDeps = {
  filePath: string;
  macKey: string | NodeJS.TypedArray;
  keyId?: string;
  previousKeys?: Readonly<Record<string, string | NodeJS.TypedArray>>;
  now?: () => string;
  randomId?: () => string;
};

export class IntentLogIntegrityError extends Error {
  readonly code = "migration_parse_error";

  constructor(message: string) {
    super(`migration_parse_error: ${message}`);
    this.name = "IntentLogIntegrityError";
  }
}

export class IntentLogFencingError extends Error {
  readonly code = "stale_fencing_epoch";

  constructor(message: string) {
    super(`stale fencing epoch: ${message}`);
    this.name = "IntentLogFencingError";
  }
}

type IntentWithoutMac = Omit<ProductionRunIntent, "mac">;

function stableJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Intent payload must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("Intent payload must be JSON serializable");
}

function hashPayload(payload: unknown): string {
  return crypto.createHash("sha256").update(stableJson(payload)).digest("hex");
}

function asKeyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

function macFor(record: IntentWithoutMac, macKey: string | NodeJS.TypedArray): string {
  return crypto.createHmac("sha256", asKeyBuffer(macKey)).update(stableJson(record)).digest("base64url");
}

function recordHash(record: ProductionRunIntent): string {
  return crypto.createHash("sha256").update(stableJson(record)).digest("hex");
}

function appendDurableLine(filePath: string, record: ProductionRunIntent): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(filePath, "a");
  try {
    fs.writeSync(fd, `${JSON.stringify(record)}\n`, undefined, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  // The file contents are durable before returning. Directory fsync is best effort
  // because Windows does not allow opening a directory as a file descriptor.
  try {
    const directoryFd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch {
    // The intent itself remains durable; callers still get the original result.
  }
}

function invalid(message: string): never {
  throw new IntentLogIntegrityError(message);
}

function isStatus(value: unknown): value is ProductionRunIntentStatus {
  return value === "prepared" || value === "committed" || value === "aborted";
}

function parseRecord(value: unknown): ProductionRunIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("intent record must be an object");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== PRODUCTION_RUN_INTENT_LOG_SCHEMA_VERSION) invalid("unsupported intent schema version");
  if (typeof record.intentId !== "string" || !record.intentId || typeof record.runId !== "string" || !record.runId) invalid("invalid intent identity");
  if (typeof record.kind !== "string" || !record.kind || typeof record.key !== "string" || !record.key) invalid("invalid intent key");
  if (typeof record.payloadHash !== "string" || !/^[a-f0-9]{64}$/.test(record.payloadHash)) invalid("invalid intent payload hash");
  if (!isStatus(record.status) || typeof record.createdAt !== "string" || !record.createdAt) invalid("invalid intent status");
  if (record.committedAt !== undefined && (typeof record.committedAt !== "string" || !record.committedAt)) invalid("invalid committedAt");
  if (!Number.isInteger(record.seq) || (record.seq as number) < 1 || typeof record.prevHash !== "string") invalid("invalid intent chain position");
  if (!Number.isInteger(record.fencingEpoch) || (record.fencingEpoch as number) < 0) invalid("invalid fencing epoch");
  if (typeof record.keyId !== "string" || !record.keyId || typeof record.mac !== "string" || !record.mac) invalid("invalid intent authentication");
  return record as ProductionRunIntent;
}

function equalMac(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && crypto.timingSafeEqual(actualBytes, expectedBytes);
}

export function createProductionRunIntentLog(deps: ProductionRunIntentLogDeps) {
  const now = deps.now ?? (() => new Date().toISOString());
  const randomId = deps.randomId ?? (() => crypto.randomUUID());
  const keyId = deps.keyId ?? "app-key-v1";
  const keys: Readonly<Record<string, string | NodeJS.TypedArray>> = {
    ...deps.previousKeys,
    [keyId]: deps.macKey,
  };

  function readRecords(): ProductionRunIntent[] {
    if (!fs.existsSync(deps.filePath)) return [];
    const records: ProductionRunIntent[] = [];
    let previousHash = "";
    const content = fs.readFileSync(deps.filePath, "utf8");
    for (const [lineIndex, line] of content.split("\n").entries()) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        invalid(`invalid JSON at line ${lineIndex + 1}`);
      }
      const record = parseRecord(parsed);
      if (record.seq !== records.length + 1) invalid(`unexpected sequence at line ${lineIndex + 1}`);
      if (record.prevHash !== previousHash) invalid(`broken intent chain at line ${lineIndex + 1}`);
      const macKey = keys[record.keyId];
      if (!macKey || !equalMac(record.mac, macFor({ ...record, mac: undefined } as IntentWithoutMac, macKey))) {
        invalid(`invalid intent MAC at line ${lineIndex + 1}`);
      }
      previousHash = recordHash(record);
      records.push(record);
    }
    return records;
  }

  function latestByIntent(records: ProductionRunIntent[]): Map<string, ProductionRunIntent> {
    const latest = new Map<string, ProductionRunIntent>();
    for (const record of records) latest.set(record.intentId, record);
    return latest;
  }

  function latestByKey(records: ProductionRunIntent[]): Map<string, ProductionRunIntent> {
    const latest = new Map<string, ProductionRunIntent>();
    for (const record of latestByIntent(records).values()) latest.set(record.key, record);
    return latest;
  }

  function append(input: Omit<ProductionRunIntent, "seq" | "prevHash" | "mac">): ProductionRunIntent {
    const records = readRecords();
    const previous = records.at(-1);
    const withoutMac: IntentWithoutMac = {
      ...input,
      seq: (previous?.seq ?? 0) + 1,
      prevHash: previous ? recordHash(previous) : "",
    };
    const record: ProductionRunIntent = { ...withoutMac, mac: macFor(withoutMac, deps.macKey) };
    appendDurableLine(deps.filePath, record);
    return record;
  }

  function prepare(input: ProductionRunIntentPrepareInput): ProductionRunIntent {
    const runId = input.runId.trim();
    const kind = input.kind.trim();
    const key = input.key.trim();
    if (!runId || !kind || !key) throw new Error("Intent runId, kind and key are required");
    const payloadHash = hashPayload(input.payload);
    const existing = latestByKey(readRecords()).get(key);
    if (existing) {
      if (existing.runId !== runId || existing.kind !== kind || existing.payloadHash !== payloadHash
        || (input.fencingEpoch ?? 0) !== existing.fencingEpoch) {
        throw new Error(`intent key conflict: ${key}`);
      }
      if (existing.status === "aborted" && !input.allowRetryAfterAbort) throw new Error(`intent key already aborted: ${key}`);
      if (existing.status === "aborted" && input.allowRetryAfterAbort) {
        // An explicit definitely-not-submitted disposition opens a new attempt
        // with the same provider key; callers must opt into this branch.
      } else {
        return existing;
      }
    }
    return append({
      schemaVersion: PRODUCTION_RUN_INTENT_LOG_SCHEMA_VERSION,
      intentId: randomId(),
      runId,
      kind,
      key,
      payloadHash,
      status: "prepared",
      createdAt: now(),
      fencingEpoch: input.fencingEpoch ?? 0,
      keyId,
    });
  }

  function transition(intentId: string, status: Exclude<ProductionRunIntentStatus, "prepared">, options: { fencingEpoch?: number } = {}): ProductionRunIntent {
    const current = latestByIntent(readRecords()).get(intentId);
    if (!current) throw new Error(`Intent not found: ${intentId}`);
    if (options.fencingEpoch !== undefined && options.fencingEpoch !== current.fencingEpoch) {
      throw new IntentLogFencingError(`${options.fencingEpoch} does not own ${current.fencingEpoch}`);
    }
    if (current.status === status) return current;
    if (current.status !== "prepared") throw new Error(`Intent cannot transition from ${current.status} to ${status}`);
    const { mac: _mac, seq: _seq, prevHash: _prevHash, ...identity } = current;
    return append({
      ...identity,
      status,
      ...(status === "committed" ? { committedAt: now() } : {}),
      ...(status === "aborted" ? { committedAt: undefined } : {}),
    });
  }

  function list(): ProductionRunIntent[] {
    return Array.from(latestByIntent(readRecords()).values()).sort((left, right) => left.seq - right.seq);
  }

  function pending(): ProductionRunIntent[] {
    return list().filter((intent) => intent.status === "prepared");
  }

  return {
    prepare,
    commit: (intentId: string, options?: { fencingEpoch?: number }) => transition(intentId, "committed", options),
    abort: (intentId: string, options?: { fencingEpoch?: number }) => transition(intentId, "aborted", options),
    list,
    pending,
    read: (intentId: string) => latestByIntent(readRecords()).get(intentId),
  };
}

export type ProductionRunIntentLog = ReturnType<typeof createProductionRunIntentLog>;
