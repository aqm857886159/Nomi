import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { isDurable } from "../durability";
import { writeJsonFileAtomic } from "../jsonFile";
import type {
  ProjectAgentCompactCommandReceipt,
  ProjectAgentHostState,
  ProjectBinding,
} from "../shared/projectAgentContracts";
import {
  assertProjectAgentBinding,
  createInitialProjectAgentState,
  projectAgentPartitionKey,
  sameProjectAgentBinding,
  snapshotProjectAgentHostState,
  stableProjectAgentJson,
} from "./projectAgentState";
import {
  createProjectAgentCommandLedger,
  emptyProjectAgentCommandLedgerPointer,
  type ProjectAgentCommandLedgerPointer,
  type ProjectAgentCommandLedgerView,
} from "./projectAgentCommandLedger";

export const PROJECT_AGENT_STORE_SCHEMA_VERSION = 1;

const PROJECT_AGENT_ENVELOPE_KEYS = "binding|checksum|commandLedger|hostRevision|schemaVersion|state";
const PROJECT_AGENT_LEDGER_POINTER_KEYS = "byteOffset|headChecksum|highWater";
const PROJECT_AGENT_PRIVATE_FILE_OPTIONS = Object.freeze({ mode: 0o600 });

type ProjectAgentSnapshotEnvelope = {
  schemaVersion: typeof PROJECT_AGENT_STORE_SCHEMA_VERSION;
  binding: ProjectBinding;
  hostRevision: number;
  commandLedger: ProjectAgentCommandLedgerPointer;
  state: ProjectAgentHostState;
  checksum: string;
};

type ProjectAgentEnvelopeResolution = Readonly<{
  envelope: ProjectAgentSnapshotEnvelope;
  source: "main" | "backup";
  ledger: ProjectAgentCommandLedgerView;
}>;

type DirectoryIdentity = Readonly<{
  dev: number;
  ino: number;
}>;

export type ProjectAgentRepositoryPaths = {
  dir: string;
  snapshot: string;
  backup: string;
  ledger: string;
};

export type ProjectAgentRepositoryDeps = {
  rootDir: string;
};

export class ProjectAgentRepositoryIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectAgentRepositoryIntegrityError";
  }
}

export class ProjectAgentRepositoryCommittedDurabilityError extends Error {
  readonly committed = true as const;
  readonly retryable = false as const;

  constructor(
    readonly committedRevision: number,
    options: { cause: unknown },
  ) {
    super(`Project Agent revision ${committedRevision} is published but its directory barrier failed`);
    this.name = "ProjectAgentRepositoryCommittedDurabilityError";
    Object.defineProperty(this, "cause", { configurable: true, value: options.cause });
  }
}

export class ProjectAgentRepositoryRevisionConflictError extends Error {
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Project Agent host revision conflict: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = "ProjectAgentRepositoryRevisionConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

function snapshotBase(state: ProjectAgentHostState, commandLedger: ProjectAgentCommandLedgerPointer) {
  return {
    schemaVersion: PROJECT_AGENT_STORE_SCHEMA_VERSION,
    binding: state.binding,
    hostRevision: state.hostRevision,
    commandLedger,
    state,
  } as const;
}

function digest(value: unknown): string {
  return crypto.createHash("sha256").update(stableProjectAgentJson(value)).digest("hex");
}

function ensurePrivateExistingPath(filePath: string, kind: "directory" | "file", requiredMode: number): boolean {
  let linked: fs.Stats;
  try {
    linked = fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const validType = kind === "directory" ? linked.isDirectory() : linked.isFile();
  if (linked.isSymbolicLink() || !validType) {
    throw new ProjectAgentRepositoryIntegrityError(`Project Agent private ${kind} is invalid: ${filePath}`);
  }
  if (kind === "file" && linked.nlink !== 1) {
    throw new ProjectAgentRepositoryIntegrityError(`Project Agent private file has multiple links: ${filePath}`);
  }
  if (process.platform === "win32") return true;
  if ((linked.mode & 0o777) === requiredMode) return true;

  const directoryFlag =
    kind === "directory" && typeof fs.constants.O_DIRECTORY === "number" ? fs.constants.O_DIRECTORY : 0;
  const noFollowFlag = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let fd: number;
  try {
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | directoryFlag | noFollowFlag);
  } catch {
    throw new ProjectAgentRepositoryIntegrityError(
      `Project Agent private ${kind} cannot be opened safely: ${filePath}`,
    );
  }
  try {
    const opened = fs.fstatSync(fd);
    const openedType = kind === "directory" ? opened.isDirectory() : opened.isFile();
    if (
      !openedType ||
      opened.dev !== linked.dev ||
      opened.ino !== linked.ino ||
      (kind === "file" && opened.nlink !== 1)
    ) {
      throw new ProjectAgentRepositoryIntegrityError(`Project Agent private ${kind} changed during open: ${filePath}`);
    }
    if ((opened.mode & 0o777) !== requiredMode) fs.fchmodSync(fd, requiredMode);
  } finally {
    fs.closeSync(fd);
  }
  return true;
}

function readPrivateDirectoryIdentity(directoryPath: string, label: string): DirectoryIdentity {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(directoryPath);
  } catch (error) {
    throw new ProjectAgentRepositoryIntegrityError(`Project Agent ${label} directory is unavailable: ${directoryPath}`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ProjectAgentRepositoryIntegrityError(`Project Agent ${label} directory is invalid: ${directoryPath}`);
  }
  return Object.freeze({ dev: stat.dev, ino: stat.ino });
}

function assertPrivateDirectoryIdentity(directoryPath: string, expected: DirectoryIdentity, label: string): void {
  const actual = readPrivateDirectoryIdentity(directoryPath, label);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new ProjectAgentRepositoryIntegrityError(`Project Agent ${label} directory changed during commit`);
  }
}

function envelopeFor(
  state: ProjectAgentHostState,
  commandLedger: ProjectAgentCommandLedgerPointer,
): ProjectAgentSnapshotEnvelope {
  const base = snapshotBase(snapshotProjectAgentHostState(state), commandLedger);
  return { ...base, checksum: digest(base) };
}

function readValidEnvelope(filePath: string, binding: ProjectBinding): ProjectAgentSnapshotEnvelope | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) return null;
    const noFollowFlag = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(filePath, fs.constants.O_RDONLY | noFollowFlag);
    let rawText: string;
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.nlink !== 1) {
        return null;
      }
      rawText = fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
    const raw = JSON.parse(rawText) as ProjectAgentSnapshotEnvelope;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    if (Object.keys(raw).sort().join("|") !== PROJECT_AGENT_ENVELOPE_KEYS) return null;
    if (raw.schemaVersion !== PROJECT_AGENT_STORE_SCHEMA_VERSION) return null;
    assertProjectAgentBinding(raw.binding);
    const state = snapshotProjectAgentHostState(raw.state);
    if (
      !raw.commandLedger ||
      typeof raw.commandLedger !== "object" ||
      Array.isArray(raw.commandLedger) ||
      Object.keys(raw.commandLedger).sort().join("|") !== PROJECT_AGENT_LEDGER_POINTER_KEYS ||
      !Number.isSafeInteger(raw.commandLedger.highWater) ||
      raw.commandLedger.highWater < 0 ||
      !Number.isSafeInteger(raw.commandLedger.byteOffset) ||
      raw.commandLedger.byteOffset < 0 ||
      typeof raw.commandLedger.headChecksum !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.commandLedger.headChecksum)
    ) {
      return null;
    }
    if (!raw.binding || !sameProjectAgentBinding(raw.binding, binding)) return null;
    if (!sameProjectAgentBinding(state.binding, binding)) return null;
    if (raw.hostRevision !== state.hostRevision) return null;
    if (
      state.commandLedgerHighWater !== state.hostRevision ||
      raw.commandLedger.highWater !== state.commandLedgerHighWater
    ) {
      return null;
    }
    if (
      raw.commandLedger.highWater === 0 &&
      (raw.commandLedger.byteOffset !== 0 ||
        raw.commandLedger.headChecksum !== emptyProjectAgentCommandLedgerPointer().headChecksum)
    ) {
      return null;
    }
    const commandLedger = Object.freeze({ ...raw.commandLedger });
    const base = snapshotBase(state, commandLedger);
    if (typeof raw.checksum !== "string" || raw.checksum !== digest(base)) return null;
    return { ...base, checksum: raw.checksum };
  } catch {
    return null;
  }
}

function assertState(binding: ProjectBinding, expectedRevision: number, state: ProjectAgentHostState): void {
  if (!state || !sameProjectAgentBinding(state.binding, binding)) {
    throw new ProjectAgentRepositoryIntegrityError("Project Agent state binding mismatch");
  }
  if (state.hostRevision !== expectedRevision + 1) {
    throw new ProjectAgentRepositoryRevisionConflictError(expectedRevision + 1, state.hostRevision);
  }
  if (state.commandLedgerHighWater !== state.hostRevision) {
    throw new ProjectAgentRepositoryIntegrityError("Project Agent command ledger high-water mismatch");
  }
}

function fsyncDirectory(directoryPath: string): void {
  if (!isDurable()) return;
  let fd: number;
  try {
    fd = fs.openSync(directoryPath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" && ["EPERM", "EACCES", "EINVAL", "ENOTSUP", "EISDIR"].includes(String(code))) {
      return;
    }
    throw error;
  }
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncPublishedMain(
  paths: ProjectAgentRepositoryPaths,
  binding: ProjectBinding,
  committedRevision: number,
): void {
  try {
    fsyncDirectory(paths.dir);
  } catch (cause) {
    const published = readValidEnvelope(paths.snapshot, binding);
    if (published?.hostRevision === committedRevision) {
      throw new ProjectAgentRepositoryCommittedDurabilityError(committedRevision, { cause });
    }
    throw cause;
  }
}

function mirrorCommittedEnvelope(paths: ProjectAgentRepositoryPaths, envelope: ProjectAgentSnapshotEnvelope): void {
  try {
    writeJsonFileAtomic(paths.backup, envelope, PROJECT_AGENT_PRIVATE_FILE_OPTIONS);
    fsyncDirectory(paths.dir);
  } catch {
    // Main is already the sole commit point. A failed or undeletable mirror is
    // either invalid or the same committed revision, so neither can expose an
    // unacknowledged mutation. Cleanup and its metadata barrier are best effort.
    try {
      fs.rmSync(paths.backup, { force: true });
      fsyncDirectory(paths.dir);
    } catch {
      // Preserve the successful main commit instead of surfacing a retryable
      // error after its bytes were published and barriered.
    }
  }
}

/**
 * Phase 2A offline repository for exactly one main-process ProjectAgentHost.
 * Per-partition FIFO lives in that Host. Phase 2B must reject a second owner at
 * startup before this repository is connected to production IPC.
 */
export function createProjectAgentRepository(deps: ProjectAgentRepositoryDeps) {
  if (!path.isAbsolute(deps.rootDir)) {
    throw new Error("Project Agent repository rootDir must be absolute");
  }
  const commandLedger = createProjectAgentCommandLedger({
    fsyncDirectory,
    integrityError: (message) => new ProjectAgentRepositoryIntegrityError(message),
  });

  function createDirectoryDurably(directoryPath: string): void {
    const parent = path.dirname(directoryPath);
    if (ensurePrivateExistingPath(directoryPath, "directory", 0o700)) {
      // An earlier mkdir may have succeeded while its parent barrier failed.
      // Reasserting the low-frequency parent barrier makes retry converge.
      fsyncDirectory(parent);
      return;
    }
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      throw new ProjectAgentRepositoryIntegrityError(
        `Project Agent repository parent directory is unavailable: ${parent}`,
      );
    }
    fs.mkdirSync(directoryPath, { mode: 0o700 });
    fsyncDirectory(parent);
  }

  function ensurePartitionDirectory(paths: ProjectAgentRepositoryPaths): void {
    const storeRoot = path.dirname(paths.dir);
    createDirectoryDurably(storeRoot);
    createDirectoryDurably(paths.dir);
  }

  function pathsFor(binding: ProjectBinding): ProjectAgentRepositoryPaths {
    const dir = path.join(deps.rootDir, "project-agent-host", projectAgentPartitionKey(binding));
    return {
      dir,
      snapshot: path.join(dir, "snapshot-v1.json"),
      backup: path.join(dir, "snapshot-v1.backup.json"),
      ledger: path.join(dir, "commands-v1.jsonl"),
    };
  }

  function hardenExistingPartition(paths: ProjectAgentRepositoryPaths): void {
    const storeRoot = path.dirname(paths.dir);
    if (!ensurePrivateExistingPath(storeRoot, "directory", 0o700)) return;
    if (!ensurePrivateExistingPath(paths.dir, "directory", 0o700)) return;
    ensurePrivateExistingPath(paths.snapshot, "file", 0o600);
    ensurePrivateExistingPath(paths.backup, "file", 0o600);
    ensurePrivateExistingPath(paths.ledger, "file", 0o600);
  }

  function resolveEnvelope(binding: ProjectBinding): ProjectAgentEnvelopeResolution | null {
    const paths = pathsFor(binding);
    hardenExistingPartition(paths);
    const main = readValidEnvelope(paths.snapshot, binding);
    if (main) {
      return {
        envelope: main,
        source: "main",
        ledger: commandLedger.validate(paths.ledger, binding, main.commandLedger),
      };
    }
    const backup = readValidEnvelope(paths.backup, binding);
    if (backup) {
      try {
        return {
          envelope: backup,
          source: "backup",
          ledger: commandLedger.validate(paths.ledger, binding, backup.commandLedger),
        };
      } catch {
        // Fall through to a single fail-closed integrity error.
      }
    }
    if (!fs.existsSync(paths.snapshot) && !fs.existsSync(paths.backup)) {
      try {
        const ledgerStat = fs.lstatSync(paths.ledger);
        if (ledgerStat.isSymbolicLink() || !ledgerStat.isFile()) {
          throw new ProjectAgentRepositoryIntegrityError("Project Agent command ledger is not a regular file");
        }
        if (ledgerStat.size > 0) {
          throw new ProjectAgentRepositoryIntegrityError("Project Agent command ledger exists without a snapshot");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      return null;
    }
    throw new ProjectAgentRepositoryIntegrityError("Project Agent host snapshot and backup are both invalid");
  }

  function load(binding: ProjectBinding): ProjectAgentHostState | null {
    return resolveEnvelope(binding)?.envelope.state ?? null;
  }

  function lookupCommittedCommand(
    state: ProjectAgentHostState,
    commandId: string,
  ): ProjectAgentCompactCommandReceipt | null {
    const canonical = snapshotProjectAgentHostState(state);
    const resolution = resolveEnvelope(canonical.binding);
    if (!resolution) {
      throw new ProjectAgentRepositoryIntegrityError("Project Agent host partition is not initialized");
    }
    if (resolution.envelope.hostRevision !== canonical.hostRevision) {
      throw new ProjectAgentRepositoryRevisionConflictError(canonical.hostRevision, resolution.envelope.hostRevision);
    }
    if (
      resolution.ledger.pointer.highWater !== canonical.commandLedgerHighWater ||
      stableProjectAgentJson(resolution.envelope.state) !== stableProjectAgentJson(canonical)
    ) {
      throw new ProjectAgentRepositoryIntegrityError("Project Agent command lookup snapshot mismatch");
    }
    return commandLedger.lookup(pathsFor(canonical.binding).ledger, resolution.ledger, commandId);
  }

  function initialize(state: ProjectAgentHostState): ProjectAgentHostState {
    const canonical = snapshotProjectAgentHostState(state);
    const emptyInitial = createInitialProjectAgentState(canonical.binding);
    if (stableProjectAgentJson(canonical) !== stableProjectAgentJson(emptyInitial)) {
      throw new ProjectAgentRepositoryIntegrityError(
        "Project Agent repository initialization must use the canonical empty state",
      );
    }
    const paths = pathsFor(canonical.binding);
    ensurePartitionDirectory(paths);
    const existing = resolveEnvelope(canonical.binding);
    const initialLedger = emptyProjectAgentCommandLedgerPointer();
    if (existing) {
      if (
        existing.envelope.hostRevision === 0 &&
        stableProjectAgentJson(existing.envelope.state) === stableProjectAgentJson(canonical)
      ) {
        commandLedger.reconcilePreparedTail(paths.ledger, canonical.binding, existing.ledger);
        const initialEnvelope = envelopeFor(canonical, initialLedger);
        writeJsonFileAtomic(paths.snapshot, initialEnvelope, PROJECT_AGENT_PRIVATE_FILE_OPTIONS);
        fsyncPublishedMain(paths, canonical.binding, 0);
        mirrorCommittedEnvelope(paths, initialEnvelope);
        return load(canonical.binding)!;
      }
      throw new ProjectAgentRepositoryIntegrityError("Project Agent host partition is already initialized");
    }
    if (canonical.hostRevision !== 0) {
      throw new ProjectAgentRepositoryRevisionConflictError(0, canonical.hostRevision);
    }
    const emptyView = commandLedger.validate(paths.ledger, canonical.binding, initialLedger);
    commandLedger.reconcilePreparedTail(paths.ledger, canonical.binding, emptyView);
    const initialEnvelope = envelopeFor(canonical, initialLedger);
    writeJsonFileAtomic(paths.snapshot, initialEnvelope, PROJECT_AGENT_PRIVATE_FILE_OPTIONS);
    fsyncPublishedMain(paths, canonical.binding, 0);
    mirrorCommittedEnvelope(paths, initialEnvelope);
    return load(canonical.binding)!;
  }

  function commit(
    binding: ProjectBinding,
    expectedRevision: number,
    state: ProjectAgentHostState,
  ): ProjectAgentHostState {
    const resolution = resolveEnvelope(binding);
    if (!resolution) {
      throw new ProjectAgentRepositoryIntegrityError("Project Agent host partition is not initialized");
    }
    const current = resolution.envelope;
    if (current.hostRevision !== expectedRevision) {
      throw new ProjectAgentRepositoryRevisionConflictError(expectedRevision, current.hostRevision);
    }
    const canonical = snapshotProjectAgentHostState(state);
    assertState(binding, expectedRevision, canonical);
    const paths = pathsFor(binding);
    const storeRootIdentity = readPrivateDirectoryIdentity(path.dirname(paths.dir), "store root");
    const partitionIdentity = readPrivateDirectoryIdentity(paths.dir, "partition");
    const assertCommitDirectories = (): void => {
      assertPrivateDirectoryIdentity(path.dirname(paths.dir), storeRootIdentity, "store root");
      assertPrivateDirectoryIdentity(paths.dir, partitionIdentity, "partition");
    };
    assertCommitDirectories();
    if (resolution.source === "backup") {
      assertCommitDirectories();
      writeJsonFileAtomic(paths.snapshot, current, PROJECT_AGENT_PRIVATE_FILE_OPTIONS);
      assertCommitDirectories();
      // This repairs revision N so it is safe to attempt N+1; it does not
      // commit the caller's N+1 mutation. Barrier failure remains pre-commit.
      fsyncDirectory(paths.dir);
    }
    assertCommitDirectories();
    commandLedger.reconcilePreparedTail(paths.ledger, binding, resolution.ledger);
    assertCommitDirectories();
    const receipt = canonical.recentAppliedCommands.at(-1);
    if (!receipt || receipt.appliedRevision !== canonical.hostRevision) {
      throw new ProjectAgentRepositoryIntegrityError("Project Agent state has no current command receipt");
    }
    const prepared = commandLedger.prepareAppend({
      ledgerPath: paths.ledger,
      directoryPath: paths.dir,
      binding,
      view: resolution.ledger,
      receipt,
    });
    assertCommitDirectories();
    const nextEnvelope = envelopeFor(canonical, prepared.pointer);
    // Main is the only commit point. Retire the old mirror first; a failed main
    // publish therefore leaves old main as truth and no future/unacknowledged
    // backup to resurrect. This is two full writes in steady state (not three).
    fs.rmSync(paths.backup, { force: true });
    // The directory may have been replaced while retiring the mirror. Never
    // let the following atomic writer resolve paths through an attacker-owned
    // replacement.
    assertCommitDirectories();
    fsyncDirectory(paths.dir);
    assertCommitDirectories();
    writeJsonFileAtomic(paths.snapshot, nextEnvelope, PROJECT_AGENT_PRIVATE_FILE_OPTIONS);
    assertCommitDirectories();
    try {
      fsyncPublishedMain(paths, binding, canonical.hostRevision);
    } catch (error) {
      if (error instanceof ProjectAgentRepositoryCommittedDurabilityError) {
        commandLedger.markCommitted(prepared);
      }
      throw error;
    }
    // A directory can be exchanged while the fsync is operating on its pinned
    // fd. Re-check the pathname identity before publishing any mirror or
    // reading the acknowledged state through it.
    assertCommitDirectories();
    commandLedger.markCommitted(prepared);
    mirrorCommittedEnvelope(paths, nextEnvelope);
    assertCommitDirectories();
    return load(binding)!;
  }

  return { pathsFor, load, lookupCommittedCommand, initialize, commit };
}

export type ProjectAgentRepository = ReturnType<typeof createProjectAgentRepository>;
