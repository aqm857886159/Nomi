import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ProfileKind } from "../catalog/types";
import {
  ProductionRunLockBusyError,
  createProductionRunLock,
  type ProductionRunLock,
} from "../productionRun/productionRunLock";
import {
  CertificationPersistenceError,
  writeCertificationJsonAtomic,
} from "./operationLedger";
import {
  PROMOTION_JOURNAL_STATES,
  PROMOTION_JOURNAL_VERSION,
  type CertificationArchiveRef,
  type PromotionJournalEntry,
  type PromotionJournalState,
} from "./types";

const MAX_FILE_BYTES = 1_048_576;
const MAX_ENTRIES = 1_000;
const TMP_STALE_MS = 5 * 60_000;
const EMPTY_STATE: PromotionJournalState = { version: PROMOTION_JOURNAL_VERSION, entries: [], tombstones: [], archives: [] };
type PromotionTombstone = PromotionJournalState["tombstones"][number];
export type PromotionJournalWrite = (filePath: string, state: PromotionJournalState) => void;

type PromotionJournalDependencies = {
  write?: PromotionJournalWrite;
  writeArchive?: (filePath: string, state: unknown) => void;
  lock?: ProductionRunLock;
  lockTimeoutMs?: number;
  maxEntries?: number;
  maxInlineTombstones?: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function rejectUnknownKeys(raw: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const unknown = Object.keys(raw).find((key) => !allowed.includes(key));
  if (unknown) throw new CertificationPersistenceError("invalid_state", `Invalid ${name} field: ${unknown}`);
}

function safe(value: unknown, name: string, max = 256): string {
  if (typeof value !== "string" || !value || value.length > max || value.split("").some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127) || /:\/\//.test(value)) {
    throw new CertificationPersistenceError("invalid_state", `Invalid ${name}`);
  }
  return value;
}

function digest(value: unknown, name: string): string {
  const normalized = safe(value, name, 64);
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new CertificationPersistenceError("invalid_state", `Invalid ${name}`);
  return normalized;
}

function timestamp(value: unknown, name: string): string {
  const normalized = safe(value, name, 64);
  if (!Number.isFinite(Date.parse(normalized))) throw new CertificationPersistenceError("invalid_state", `Invalid ${name}`);
  return normalized;
}

function validateEntry(raw: unknown): PromotionJournalEntry {
  if (!isRecord(raw) || raw.version !== 2 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || !isRecord(raw.childRunRef)) {
    throw new CertificationPersistenceError("invalid_state", "Invalid promotion journal entry");
  }
  rejectUnknownKeys(raw, ["version", "revision", "journalId", "runId", "lineageRootVendorKey", "leaseToken", "expectedActiveRevision", "proposedRevisionId", "contractDigest", "verifiedModes", "childRunRef", "terminalStage", "state", "userAction", "runFinalizedAt", "createdAt", "updatedAt"], "promotion journal");
  rejectUnknownKeys(raw.childRunRef, ["runId", "revisionDigest"], "promotion child run");
  if (!Array.isArray(raw.verifiedModes) || raw.verifiedModes.length > 256 || !PROMOTION_JOURNAL_STATES.includes(raw.state as never)) {
    throw new CertificationPersistenceError("invalid_state", "Invalid promotion journal state");
  }
  const entry: PromotionJournalEntry = {
    version: 2,
    revision: Number(raw.revision),
    journalId: safe(raw.journalId, "journal id"),
    runId: safe(raw.runId, "run id"),
    lineageRootVendorKey: safe(raw.lineageRootVendorKey, "lineage root"),
    leaseToken: safe(raw.leaseToken, "lease token"),
    proposedRevisionId: safe(raw.proposedRevisionId, "proposed revision"),
    contractDigest: digest(raw.contractDigest, "contract digest"),
    verifiedModes: raw.verifiedModes.map((mode) => {
      if (!isRecord(mode)) throw new CertificationPersistenceError("invalid_state", "Invalid verified mode");
      rejectUnknownKeys(mode, ["modelKey", "taskKind"], "verified mode");
      return { modelKey: safe(mode.modelKey, "model key"), taskKind: safe(mode.taskKind, "task kind") as ProfileKind };
    }),
    childRunRef: {
      runId: safe(raw.childRunRef.runId, "child run id"),
      revisionDigest: digest(raw.childRunRef.revisionDigest, "child revision digest"),
    },
    state: raw.state as PromotionJournalEntry["state"],
    createdAt: timestamp(raw.createdAt, "created at"),
    updatedAt: timestamp(raw.updatedAt, "updated at"),
  };
  if (raw.expectedActiveRevision !== undefined) entry.expectedActiveRevision = safe(raw.expectedActiveRevision, "expected revision");
  if (raw.terminalStage === "completed" || raw.terminalStage === "partial") entry.terminalStage = raw.terminalStage;
  if (raw.userAction === "review_newer_certification") entry.userAction = raw.userAction;
  if (raw.runFinalizedAt !== undefined) entry.runFinalizedAt = timestamp(raw.runFinalizedAt, "run finalized at");
  if (entry.runFinalizedAt && entry.state !== "committed") throw new CertificationPersistenceError("invalid_state", "Only committed promotion can be finalized");
  if (entry.state === "aborted" && entry.runFinalizedAt) throw new CertificationPersistenceError("invalid_state", "Aborted promotion cannot be finalized");
  return entry;
}

function validateTombstone(raw: unknown): PromotionTombstone {
  if (!isRecord(raw) || raw.version !== 1) throw new CertificationPersistenceError("invalid_state", "Invalid promotion tombstone");
  return {
    version: 1,
    journalId: safe(raw.journalId, "tombstone journal id"),
    runId: safe(raw.runId, "tombstone run id"),
    proposedRevisionId: safe(raw.proposedRevisionId, "tombstone revision id"),
    finalizedAt: timestamp(raw.finalizedAt, "tombstone finalized at"),
  };
}

function validateArchive(raw: unknown): CertificationArchiveRef {
  if (!isRecord(raw) || raw.version !== 1 || !Number.isSafeInteger(raw.count) || Number(raw.count) < 1) throw new CertificationPersistenceError("invalid_state", "Invalid journal archive");
  const fileName = safe(raw.fileName, "journal archive name", 128);
  if (!/^segment-[a-f0-9]{64}\.json$/.test(fileName)) throw new CertificationPersistenceError("invalid_state", "Invalid journal archive name");
  return { version: 1, fileName, sha256: digest(raw.sha256, "journal archive digest"), count: Number(raw.count) };
}

function readState(filePath: string): PromotionJournalState {
  if (!fs.existsSync(filePath)) return clone(EMPTY_STATE);
  if (fs.statSync(filePath).size > MAX_FILE_BYTES) throw new CertificationPersistenceError("oversized", "Promotion journal exceeds size limit");
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {
    throw new CertificationPersistenceError("corrupt", "Promotion journal is corrupt or truncated");
  }
  if (!isRecord(parsed) || parsed.version !== 2) throw new CertificationPersistenceError("unsupported_version", "Unsupported promotion journal version");
  if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.tombstones) || !Array.isArray(parsed.archives)
    || parsed.entries.length > MAX_ENTRIES || parsed.tombstones.length > MAX_ENTRIES || parsed.archives.length > MAX_ENTRIES) {
    throw new CertificationPersistenceError("invalid_state", "Invalid promotion journal entries");
  }
  return {
    version: 2,
    entries: parsed.entries.map(validateEntry),
    tombstones: parsed.tombstones.map(validateTombstone),
    archives: parsed.archives.map(validateArchive),
  };
}

function cleanupStaleTemps(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) return;
  const prefix = `.${path.basename(filePath)}.`;
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    const target = path.join(dir, name);
    try {
      if (Date.now() - fs.statSync(target).mtimeMs >= TMP_STALE_MS) fs.rmSync(target, { force: true });
    } catch { /* active writer */ }
  }
}

export class PromotionJournal {
  private state: PromotionJournalState;
  private readonly write: PromotionJournalWrite;
  private readonly writeArchive: (filePath: string, state: unknown) => void;
  private readonly lock: ProductionRunLock;
  private readonly lockTimeoutMs: number;
  private readonly maxEntries: number;
  private readonly maxInlineTombstones: number;
  private readonly archiveDir: string;
  private archiveIndexHead?: string;
  private archiveIndex?: Map<string, PromotionTombstone>;
  private activeLease?: ReturnType<ProductionRunLock["acquire"]>;

  constructor(private readonly filePath: string, dependencies: PromotionJournalDependencies = {}) {
    cleanupStaleTemps(filePath);
    this.state = readState(filePath);
    this.write = dependencies.write || writeCertificationJsonAtomic;
    this.writeArchive = dependencies.writeArchive || writeCertificationJsonAtomic;
    this.lockTimeoutMs = dependencies.lockTimeoutMs ?? 3_000;
    this.maxEntries = dependencies.maxEntries ?? 800;
    this.maxInlineTombstones = dependencies.maxInlineTombstones ?? 400;
    this.archiveDir = path.join(path.dirname(filePath), `${path.basename(filePath)}.archive`);
    this.lock = dependencies.lock || createProductionRunLock({
      filePath: `${filePath}.lock`,
      epochPath: `${filePath}.lock.epoch`,
      ownerId: `promotion-journal-${process.pid}-${crypto.randomUUID()}`,
      leaseMs: 30_000,
    });
  }

  get(journalId: string): PromotionJournalEntry | undefined {
    const found = this.refresh().entries.find((entry) => entry.journalId === journalId);
    return found ? clone(found) : undefined;
  }

  wasFinalized(journalId: string): boolean {
    const state = this.refresh();
    if (state.entries.some((entry) => entry.journalId === journalId && Boolean(entry.runFinalizedAt))) return true;
    if (state.tombstones.some((entry) => entry.journalId === journalId)) return true;
    return Boolean(this.findArchiveTombstone(journalId, state.archives));
  }

  pendingEntries(): PromotionJournalEntry[] {
    return this.refresh().entries.filter((entry) => entry.state !== "aborted" && !entry.runFinalizedAt).map(clone);
  }

  prepare(input: Omit<PromotionJournalEntry, "version" | "revision" | "state" | "createdAt" | "updatedAt"> & { now: string }): PromotionJournalEntry {
    return this.mutate((state) => {
      const existing = state.entries.find((entry) => entry.journalId === input.journalId);
      if (existing) {
        if (existing.contractDigest !== input.contractDigest || existing.proposedRevisionId !== input.proposedRevisionId) throw new Error("Promotion journal id is already bound to a different revision");
        return { state, result: existing };
      }
      if (state.tombstones.some((entry) => entry.journalId === input.journalId)
        || this.findArchiveTombstone(input.journalId, state.archives)) throw new Error("Promotion journal is already finalized");
      const { now, ...durableInput } = input;
      const entry = validateEntry({ ...durableInput, version: 2, revision: 1, state: "prepared", createdAt: now, updatedAt: now });
      return { state: { ...state, entries: [...state.entries, entry] }, result: entry };
    });
  }

  markCatalogCommitted(journalId: string, input: {
    expectedRevision: number;
    committedModes: Array<{ modelKey: string; taskKind: ProfileKind }>;
    now: string;
  }): PromotionJournalEntry {
    let entry = this.get(journalId);
    if (!entry) throw new Error(`Promotion journal entry not found: ${journalId}`);
    if (entry.revision !== input.expectedRevision) throw new Error("Promotion journal revision conflict");
    if (entry.state === "prepared") {
      entry = this.update(journalId, entry.revision, (current) => ({ ...current, state: "catalog_committing", updatedAt: input.now }));
    }
    return this.update(journalId, entry.revision, (current) => ({
      ...current,
      state: "catalog_committed",
      verifiedModes: input.committedModes,
      updatedAt: input.now,
    }));
  }

  replay(input: {
    commitCatalog: (entry: PromotionJournalEntry) =>
      | { status: "committed"; committedModes: Array<{ modelKey: string; taskKind: ProfileKind }> }
      | { status: "no-lease" };
    finalizeRun: (entry: PromotionJournalEntry) => void;
    now: () => string;
  }): void {
    this.withLock(() => {
      this.state = readState(this.filePath);
      for (const journalId of this.state.entries.map((entry) => entry.journalId)) {
        let entry = this.state.entries.find((item) => item.journalId === journalId)!;
        if (entry.state === "aborted" || (entry.state === "committed" && entry.runFinalizedAt)) continue;
        if (entry.state === "prepared") {
          entry = this.updateUnlocked(entry.journalId, entry.revision, (current) => ({ ...current, state: "catalog_committing", updatedAt: input.now() }));
        }
        if (entry.state === "catalog_committing") {
          const promoted = input.commitCatalog(entry);
          if (promoted.status === "no-lease") {
            this.updateUnlocked(entry.journalId, entry.revision, (current) => ({
              ...current,
              state: "aborted",
              userAction: "review_newer_certification",
              updatedAt: input.now(),
            }));
            continue;
          }
          entry = this.updateUnlocked(entry.journalId, entry.revision, (current) => ({
            ...current,
            state: "catalog_committed",
            verifiedModes: promoted.committedModes,
            updatedAt: input.now(),
          }));
        }
        if (entry.state === "catalog_committed") {
          entry = this.updateUnlocked(entry.journalId, entry.revision, (current) => ({ ...current, state: "committed", updatedAt: input.now() }));
        }
        if (entry.state === "committed" && !entry.runFinalizedAt) {
          input.finalizeRun(entry);
          this.updateUnlocked(entry.journalId, entry.revision, (current) => ({
            ...current,
            runFinalizedAt: input.now(),
            updatedAt: input.now(),
          }));
        }
      }
    });
  }

  private update(journalId: string, expectedRevision: number, update: (entry: PromotionJournalEntry) => PromotionJournalEntry): PromotionJournalEntry {
    return this.mutate((state) => {
      const index = state.entries.findIndex((entry) => entry.journalId === journalId);
      if (index < 0) throw new Error(`Promotion journal entry not found: ${journalId}`);
      const current = state.entries[index];
      if (current.revision !== expectedRevision) throw new Error("Promotion journal revision conflict");
      const next = validateEntry({ ...update(clone(current)), version: 2, revision: current.revision + 1 });
      const entries = [...state.entries];
      entries[index] = next;
      return { state: { ...state, entries }, result: next };
    });
  }

  private updateUnlocked(journalId: string, expectedRevision: number, update: (entry: PromotionJournalEntry) => PromotionJournalEntry): PromotionJournalEntry {
    const index = this.state.entries.findIndex((entry) => entry.journalId === journalId);
    if (index < 0) throw new Error(`Promotion journal entry not found: ${journalId}`);
    const current = this.state.entries[index];
    if (current.revision !== expectedRevision) throw new Error("Promotion journal revision conflict");
    const next = validateEntry({ ...update(clone(current)), version: 2, revision: current.revision + 1 });
    const entries = [...this.state.entries];
    entries[index] = next;
    this.persist(this.compact({ ...this.state, entries }));
    return clone(next);
  }

  private mutate<T>(fn: (state: PromotionJournalState) => { state: PromotionJournalState; result: T }): T {
    return this.withLock(() => {
      const mutation = fn(readState(this.filePath));
      this.persist(this.compact(mutation.state));
      return clone(mutation.result);
    });
  }

  private compact(state: PromotionJournalState): PromotionJournalState {
    let next = clone(state);
    const shouldCompact = next.entries.length > this.maxEntries
      || Buffer.byteLength(JSON.stringify(next)) > Math.floor(MAX_FILE_BYTES * 0.8)
      || (next.entries.some((entry) => Boolean(entry.runFinalizedAt)) && (next.tombstones.length > 0 || next.archives.length > 0));
    if (shouldCompact) {
      const finalized = next.entries.filter((entry) => Boolean(entry.runFinalizedAt));
      next = {
        ...next,
        entries: next.entries.filter((entry) => !entry.runFinalizedAt),
        tombstones: [...next.tombstones, ...finalized.map((entry): PromotionTombstone => ({
          version: 1,
          journalId: entry.journalId,
          runId: entry.runId,
          proposedRevisionId: entry.proposedRevisionId,
          finalizedAt: entry.runFinalizedAt!,
        }))],
      };
    }
    if (next.tombstones.length > this.maxInlineTombstones) {
      const archived = next.tombstones.slice(0, next.tombstones.length - this.maxInlineTombstones);
      const ref = this.appendArchive(archived, next.archives);
      next = {
        ...next,
        tombstones: this.maxInlineTombstones ? next.tombstones.slice(-this.maxInlineTombstones) : [],
        archives: [ref],
      };
    }
    return next;
  }

  private appendArchive(tombstones: PromotionTombstone[], priorRefs: CertificationArchiveRef[]): CertificationArchiveRef {
    if (priorRefs.length <= 1) {
      this.ensureArchiveIndex(priorRefs);
      const ref = this.writeArchiveSegment(tombstones, priorRefs[0]);
      for (const tombstone of tombstones) this.archiveIndex!.set(tombstone.journalId, tombstone);
      this.archiveIndexHead = ref.fileName;
      return ref;
    }
    let previous: CertificationArchiveRef | undefined;
    const all = [...this.readArchiveTombstones(priorRefs), ...tombstones];
    for (let index = 0; index < all.length; index += 250) previous = this.writeArchiveSegment(all.slice(index, index + 250), previous);
    return previous!;
  }

  private writeArchiveSegment(tombstones: PromotionTombstone[], previous?: CertificationArchiveRef): CertificationArchiveRef {
    const payload = { version: 2, tombstones, ...(previous ? { previous } : {}) };
    const sha256 = hash(JSON.stringify(payload));
    const fileName = `segment-${sha256}.json`;
    fs.mkdirSync(this.archiveDir, { recursive: true, mode: 0o700 });
    const target = path.join(this.archiveDir, fileName);
    if (!fs.existsSync(target)) this.writeArchive(target, payload);
    return { version: 1, fileName, sha256, count: tombstones.length };
  }

  private readArchiveTombstones(refs: readonly CertificationArchiveRef[]): PromotionTombstone[] {
    this.ensureArchiveIndex(refs);
    return [...this.archiveIndex!.values()];
  }

  private findArchiveTombstone(journalId: string, refs: readonly CertificationArchiveRef[]): PromotionTombstone | undefined {
    this.ensureArchiveIndex(refs);
    return this.archiveIndex!.get(journalId);
  }

  private ensureArchiveIndex(refs: readonly CertificationArchiveRef[]): void {
    const head = refs.length === 1 ? refs[0].fileName : refs.map((ref) => ref.fileName).join(":");
    if (this.archiveIndexHead === head && this.archiveIndex) return;
    const index = new Map<string, PromotionTombstone>();
    if (!refs.length) {
      this.archiveIndexHead = head;
      this.archiveIndex = index;
      return;
    }
    const pending = [...refs];
    const visited = new Set<string>();
    while (pending.length) {
      const ref = pending.pop()!;
      if (visited.has(ref.fileName)) throw new CertificationPersistenceError("invalid_state", "Promotion archive chain contains a cycle");
      if (visited.size >= 100_000) throw new CertificationPersistenceError("oversized", "Promotion archive chain is too deep");
      visited.add(ref.fileName);
      const target = path.join(this.archiveDir, ref.fileName);
      if (fs.statSync(target).size > MAX_FILE_BYTES) throw new CertificationPersistenceError("oversized", "Promotion archive exceeds size limit");
      let parsed: unknown;
      try { parsed = JSON.parse(fs.readFileSync(target, "utf8")); } catch { throw new CertificationPersistenceError("corrupt", "Promotion archive is corrupt"); }
      if (!isRecord(parsed) || ![1, 2].includes(Number(parsed.version)) || !Array.isArray(parsed.tombstones)) throw new CertificationPersistenceError("unsupported_version", "Unsupported promotion archive version");
      if (hash(JSON.stringify(parsed)) !== ref.sha256 || parsed.tombstones.length !== ref.count) throw new CertificationPersistenceError("corrupt", "Promotion archive digest mismatch");
      for (const value of parsed.tombstones) {
        const tombstone = validateTombstone(value);
        index.set(tombstone.journalId, tombstone);
      }
      if (parsed.version === 2 && parsed.previous !== undefined) pending.push(validateArchive(parsed.previous));
    }
    this.archiveIndexHead = head;
    this.archiveIndex = index;
  }

  private withLock<T>(fn: () => T): T {
    const deadline = Date.now() + this.lockTimeoutMs;
    const spin = new Int32Array(new SharedArrayBuffer(4));
    let lease: ReturnType<ProductionRunLock["acquire"]> | undefined;
    while (!lease) {
      try { lease = this.lock.acquire(); } catch (error) {
        if (!(error instanceof ProductionRunLockBusyError)) throw error;
        if (Date.now() >= deadline) throw new CertificationPersistenceError("lock_timeout", "Promotion journal lock timed out");
        Atomics.wait(spin, 0, 0, 10);
      }
    }
    this.activeLease = lease;
    try { return fn(); } finally {
      this.activeLease = undefined;
      try { this.lock.release(lease); } catch { /* preserve original result */ }
    }
  }

  private persist(next: PromotionJournalState): void {
    if (this.activeLease) this.lock.assertOwned(this.activeLease);
    this.write(this.filePath, next);
    this.state = clone(next);
  }

  private refresh(): PromotionJournalState {
    this.state = readState(this.filePath);
    return this.state;
  }
}
