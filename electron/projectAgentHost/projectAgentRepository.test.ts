import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __projectAgentCommandLedgerScanCountForTests } from "./projectAgentCommandLedger";
import {
  PROJECT_AGENT_STORE_SCHEMA_VERSION,
  ProjectAgentRepositoryCommittedDurabilityError,
  ProjectAgentRepositoryIntegrityError,
  ProjectAgentRepositoryRevisionConflictError,
  createProjectAgentRepository,
} from "./projectAgentRepository";
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "./projectAgentState";
import type { ProjectAgentHostState, ProjectBinding } from "../shared/projectAgentContracts";
import { getDurabilityMode, setDurabilityMode } from "../durability";

let root = "";
let previousDurability = getDurabilityMode();

beforeEach(() => {
  previousDurability = getDurabilityMode();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-repository-"));
});

afterEach(() => {
  setDurabilityMode(previousDurability);
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const BINDING_A = {
  projectId: "same-visible-project-id",
  immutableProjectUuid: "39eeb81d-f188-4e30-bb0f-d59ebfec67a8",
  projectGeneration: 1,
};

const BINDING_B = {
  projectId: "same-visible-project-id",
  immutableProjectUuid: "d626d09d-6922-49c4-ae3f-31b5c84d9fcb",
  projectGeneration: 1,
};

function state(
  binding: ProjectBinding = BINDING_A,
  hostRevision = 0,
  commandIds: readonly string[] = [],
): ProjectAgentHostState {
  const firstRecentRevision = Math.max(1, hostRevision - 63);
  const recentAppliedCommands = Array.from(
    { length: hostRevision === 0 ? 0 : hostRevision - firstRecentRevision + 1 },
    (_, index) => {
      const appliedRevision = firstRecentRevision + index;
      return {
        commandId: commandIds[appliedRevision - 1] ?? `repository-fixture-command-${appliedRevision}`,
        mutationHash: appliedRevision.toString(16).padStart(64, "0"),
        appliedRevision,
        patch: {
          binding,
          previousRevision: appliedRevision - 1,
          hostRevision: appliedRevision,
          changes: [],
        },
      };
    },
  );
  return snapshotProjectAgentHostState({
    ...createInitialProjectAgentState(binding),
    hostRevision,
    commandLedgerHighWater: hostRevision,
    recentAppliedCommands,
  });
}

describe("ProjectAgentRepository", () => {
  it("writes a versioned checksummed snapshot and loads it after restart", () => {
    const first = createProjectAgentRepository({ rootDir: root });
    first.initialize(state());
    const paths = first.pathsFor(BINDING_A);
    const envelope = JSON.parse(fs.readFileSync(paths.snapshot, "utf8")) as Record<string, unknown>;

    expect(envelope).toMatchObject({
      schemaVersion: PROJECT_AGENT_STORE_SCHEMA_VERSION,
      binding: BINDING_A,
      hostRevision: 0,
    });
    expect(envelope.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toEqual(state());
  });

  it("appends a checksummed compact command record and commits its exact byte pointer", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    const ledgerBytes = fs.readFileSync(paths.ledger);
    const envelope = JSON.parse(fs.readFileSync(paths.snapshot, "utf8")) as Record<string, unknown>;
    const records = ledgerBytes
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      commandId: "repository-fixture-command-1",
      mutationHash: "1".padStart(64, "0"),
      appliedRevision: 1,
      binding: BINDING_A,
    });
    expect(records[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.commandLedger).toEqual({
      highWater: 1,
      byteOffset: ledgerBytes.byteLength,
      headChecksum: records[0]?.checksum,
    });
  });

  it("stores private snapshots, backup, ledger and partition directories", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);

    if (process.platform !== "win32") {
      expect(fs.statSync(path.dirname(paths.dir)).mode & 0o777).toBe(0o700);
      expect(fs.statSync(paths.dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(paths.snapshot).mode & 0o777).toBe(0o600);
      expect(fs.statSync(paths.backup).mode & 0o777).toBe(0o600);
      expect(fs.statSync(paths.ledger).mode & 0o777).toBe(0o600);
    }
  });

  it("fails closed on symlink snapshots and a non-regular ledger", () => {
    if (process.platform === "win32") return;
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    const snapshotTarget = path.join(root, "snapshot-target.json");
    const backupTarget = path.join(root, "backup-target.json");
    fs.copyFileSync(paths.snapshot, snapshotTarget);
    fs.copyFileSync(paths.backup, backupTarget);
    fs.rmSync(paths.snapshot);
    fs.rmSync(paths.backup);
    fs.symlinkSync(snapshotTarget, paths.snapshot);
    fs.symlinkSync(backupTarget, paths.backup);

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );

    fs.rmSync(paths.snapshot);
    fs.copyFileSync(snapshotTarget, paths.snapshot);
    fs.rmSync(paths.ledger);
    fs.mkdirSync(paths.ledger);
    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("fails closed if a snapshot is swapped to a symlink between validation and read", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const snapshotTarget = path.join(root, "race-target.json");
    fs.copyFileSync(paths.snapshot, snapshotTarget);
    fs.writeFileSync(paths.backup, "{corrupt-backup", "utf8");
    const realOpenSync = fs.openSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      if (
        !swapped &&
        String(filePath) === paths.snapshot &&
        flags === (fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
      ) {
        swapped = true;
        fs.rmSync(paths.snapshot);
        fs.symlinkSync(snapshotTarget, paths.snapshot);
      }
      return realOpenSync(filePath, flags, mode);
    });

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("fails closed when the partition parent is replaced during commit", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const external = path.join(root, "external-target");
    const moved = path.join(root, "partition-moved");
    fs.mkdirSync(external);
    const realRemove = fs.rmSync.bind(fs);
    let swapped = false;
    vi.spyOn(fs, "rmSync").mockImplementation((filePath, options) => {
      if (!swapped && String(filePath) === paths.backup) {
        swapped = true;
        fs.renameSync(paths.dir, moved);
        fs.symlinkSync(external, paths.dir);
      }
      return realRemove(filePath, options);
    });

    expect(() => repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toThrow(ProjectAgentRepositoryIntegrityError);
    expect(fs.existsSync(path.join(external, "snapshot-v1.json"))).toBe(false);
    expect(fs.existsSync(path.join(external, "snapshot-v1.backup.json"))).toBe(false);

    fs.rmSync(paths.dir, { force: true });
    fs.renameSync(moved, paths.dir);
  });

  it("fails closed when the partition is replaced after main publish", () => {
    setDurabilityMode("durable");
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const external = path.join(root, "external-after-publish");
    const moved = path.join(root, "partition-moved-after-publish");
    fs.mkdirSync(external);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realRename = fs.renameSync.bind(fs);
    const partitionFds = new Set<number>();
    let mainPublished = false;
    let swapped = false;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === paths.dir && flags === "r") partitionFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const result = realRename(from, to);
      if (String(to) === paths.snapshot) mainPublished = true;
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (mainPublished && !swapped && partitionFds.has(fd)) {
        swapped = true;
        fs.renameSync(paths.dir, moved);
        fs.symlinkSync(external, paths.dir);
      }
      return realFsync(fd);
    });

    expect(() => repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toThrow(ProjectAgentRepositoryIntegrityError);
    expect(fs.existsSync(path.join(external, "snapshot-v1.backup.json"))).toBe(false);
    expect(fs.existsSync(path.join(external, "snapshot-v1.json"))).toBe(false);

    fs.rmSync(paths.dir, { force: true });
    fs.renameSync(moved, paths.dir);
  });

  it("ignores a prepared tail and lets a different command replace the same revision", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === paths.snapshot) {
        const error = new Error("simulated main publish failure after ledger append") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realRename(from, to);
    });

    expect(() => repository.commit(BINDING_A, 0, state(BINDING_A, 1, ["prepared-command"]))).toThrow(
      /main publish failure/,
    );
    expect(repository.load(BINDING_A)).toEqual(state());
    expect(repository.lookupCommittedCommand(state(), "prepared-command")).toBeNull();

    vi.restoreAllMocks();
    const replacement = state(BINDING_A, 1, ["replacement-command"]);
    vi.spyOn(fs, "ftruncateSync").mockImplementation(() => {
      const error = new Error("simulated prepared-tail truncate EIO") as NodeJS.ErrnoException;
      error.code = "EIO";
      throw error;
    });
    expect(() => repository.commit(BINDING_A, 0, replacement)).toThrow(/truncate EIO/);
    expect(repository.load(BINDING_A)).toEqual(state());

    vi.restoreAllMocks();
    expect(repository.commit(BINDING_A, 0, replacement)).toEqual(replacement);
    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toEqual(replacement);
    expect(repository.lookupCommittedCommand(replacement, "prepared-command")).toBeNull();
    expect(repository.lookupCommittedCommand(replacement, "replacement-command")).toMatchObject({
      commandId: "replacement-command",
      appliedRevision: 1,
    });
    const ledgerLines = fs.readFileSync(paths.ledger, "utf8").trimEnd().split("\n");
    expect(ledgerLines).toHaveLength(1);
    expect(ledgerLines[0]).toContain("replacement-command");
  });

  it("uses a backup high-water to retire a prepared tail before a replacement commit", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    const realRemove = fs.rmSync.bind(fs);
    vi.spyOn(fs, "rmSync").mockImplementation((filePath, options) => {
      if (String(filePath) === paths.backup) {
        const error = new Error("simulated backup retire EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realRemove(filePath, options);
    });
    expect(() =>
      repository.commit(BINDING_A, 1, state(BINDING_A, 2, ["repository-fixture-command-1", "prepared-second"])),
    ).toThrow(/backup retire EIO/);

    vi.restoreAllMocks();
    fs.writeFileSync(paths.snapshot, "{corrupt-main", "utf8");
    const recovered = createProjectAgentRepository({ rootDir: root });
    expect(recovered.load(BINDING_A)).toEqual(state(BINDING_A, 1));
    const replacement = state(BINDING_A, 2, ["repository-fixture-command-1", "replacement-second"]);
    expect(recovered.commit(BINDING_A, 1, replacement)).toEqual(replacement);
    expect(recovered.lookupCommittedCommand(replacement, "prepared-second")).toBeNull();
    expect(recovered.lookupCommittedCommand(replacement, "replacement-second")).toMatchObject({
      appliedRevision: 2,
    });
  });

  it("fails closed when a committed ledger prefix is missing or fails its checksum chain", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    const validLedger = fs.readFileSync(paths.ledger, "utf8");
    const record = JSON.parse(validLedger.trimEnd()) as Record<string, unknown>;
    fs.writeFileSync(paths.ledger, `${JSON.stringify({ ...record, checksum: "0".repeat(64) })}\n`, "utf8");
    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );

    fs.rmSync(paths.ledger);
    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("fails closed instead of truncating a non-empty ledger when both snapshots are missing", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    fs.rmSync(paths.snapshot);
    fs.rmSync(paths.backup);

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
    expect(fs.statSync(paths.ledger).size).toBeGreaterThan(0);
  });

  it("does not roll an acknowledged main back to a stale backup when its ledger is invalid", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const staleBackup = fs.readFileSync(paths.backup);
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    fs.writeFileSync(paths.backup, staleBackup, { mode: 0o600 });
    const record = JSON.parse(fs.readFileSync(paths.ledger, "utf8").trimEnd()) as Record<string, unknown>;
    fs.writeFileSync(paths.ledger, `${JSON.stringify({ ...record, checksum: "0".repeat(64) })}\n`, "utf8");

    const restarted = createProjectAgentRepository({ rootDir: root });
    expect(() => restarted.load(BINDING_A)).toThrow(ProjectAgentRepositoryIntegrityError);
    expect(() => restarted.commit(BINDING_A, 1, state(BINDING_A, 2))).toThrow(ProjectAgentRepositoryIntegrityError);
  });

  it("initializes only the canonical empty state instead of bypassing the reducer", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    const seededWithoutCommand = snapshotProjectAgentHostState({
      ...createInitialProjectAgentState(BINDING_A),
      activeThreadId: "thread-bypassed",
      threads: [
        {
          threadId: "thread-bypassed",
          title: "must enter through reducer",
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    });

    expect(() => repository.initialize(seededWithoutCommand)).toThrow(ProjectAgentRepositoryIntegrityError);
    expect(repository.load(BINDING_A)).toBeNull();
  });

  it("partitions by immutable UUID and generation rather than the visible project id", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    const generationTwo = { ...BINDING_A, projectGeneration: 2 };

    repository.initialize(state(BINDING_A));
    repository.initialize(state(BINDING_B));
    repository.initialize(state(generationTwo));

    expect(
      new Set([
        repository.pathsFor(BINDING_A).snapshot,
        repository.pathsFor(BINDING_B).snapshot,
        repository.pathsFor(generationTwo).snapshot,
      ]).size,
    ).toBe(3);
    expect(repository.load(BINDING_A)?.binding).toEqual(BINDING_A);
    expect(repository.load(BINDING_B)?.binding).toEqual(BINDING_B);
    expect(repository.load(generationTwo)?.binding).toEqual(generationTwo);
  });

  it("re-initializes the same empty partition idempotently", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    const first = repository.initialize(state());
    const second = repository.initialize(state());

    expect(second).toEqual(first);
    expect(repository.load(BINDING_A)).toEqual(first);
  });

  it("fsyncs the existing store root when creating a sibling partition", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state(BINDING_A));
    const siblingPaths = repository.pathsFor(BINDING_B);
    const storeRoot = path.dirname(siblingPaths.dir);
    const realOpen = fs.openSync.bind(fs);
    let storeRootOpenCount = 0;
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      if (String(filePath) === storeRoot && flags === "r") storeRootOpenCount += 1;
      return realOpen(filePath, flags, mode);
    });

    repository.initialize(state(BINDING_B));

    expect(storeRootOpenCount).toBeGreaterThan(0);
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A));
    expect(repository.load(BINDING_B)).toEqual(state(BINDING_B));
  });

  it("re-reads durable revision before every commit and rejects stale CAS", () => {
    const writerOne = createProjectAgentRepository({ rootDir: root });
    const writerTwo = createProjectAgentRepository({ rootDir: root });
    writerOne.initialize(state());

    writerOne.commit(BINDING_A, 0, state(BINDING_A, 1));

    expect(() => writerTwo.commit(BINDING_A, 0, state(BINDING_A, 1))).toThrow(
      ProjectAgentRepositoryRevisionConflictError,
    );
    expect(writerTwo.load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("fsyncs partition directory metadata at acknowledged commit points", () => {
    setDurabilityMode("durable");
    const repository = createProjectAgentRepository({ rootDir: root });
    const paths = repository.pathsFor(BINDING_A);
    const realOpen = fs.openSync.bind(fs);
    let directoryOpenCount = 0;
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      if (String(filePath) === paths.dir && flags === "r") directoryOpenCount += 1;
      return realOpen(filePath, flags, mode);
    });

    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));

    expect(directoryOpenCount).toBeGreaterThanOrEqual(2);
  });

  it("fails initialization when a new partition parent-directory barrier fails", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    const paths = repository.pathsFor(BINDING_A);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const rootDirectoryFds = new Set<number>();
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === root && flags === "r") rootDirectoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (rootDirectoryFds.has(fd)) {
        const error = new Error("simulated parent directory fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      rootDirectoryFds.delete(fd);
      return realClose(fd);
    });

    expect(() => repository.initialize(state())).toThrow(/parent directory fsync EIO/);
    expect(fs.existsSync(paths.snapshot)).toBe(false);
  });

  it("retries the parent barrier when initialization left an unacknowledged directory", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    const paths = repository.pathsFor(BINDING_A);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const rootDirectoryFds = new Set<number>();
    let rootBarrierCount = 0;
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === root && flags === "r") rootDirectoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (rootDirectoryFds.has(fd)) {
        rootBarrierCount += 1;
        if (rootBarrierCount === 1) {
          const error = new Error("simulated first parent fsync EIO") as NodeJS.ErrnoException;
          error.code = "EIO";
          throw error;
        }
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      rootDirectoryFds.delete(fd);
      return realClose(fd);
    });

    expect(() => repository.initialize(state())).toThrow(/first parent fsync EIO/);
    expect(repository.initialize(state())).toEqual(state());
    expect(rootBarrierCount).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(paths.snapshot)).toBe(true);
  });

  it("rejects a commit when the POSIX directory durability barrier fails", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const directoryFds = new Set<number>();
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === paths.dir && flags === "r") directoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (directoryFds.has(fd)) {
        const error = new Error("simulated directory fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      directoryFds.delete(fd);
      return realClose(fd);
    });

    expect(() => repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toThrow(/directory fsync EIO/);
    expect(repository.load(BINDING_A)).toEqual(state());
  });

  it("marks a post-publish directory failure as committed and non-retryable", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const realRename = fs.renameSync.bind(fs);
    const directoryFds = new Set<number>();
    let mainPublished = false;
    const scansBefore = __projectAgentCommandLedgerScanCountForTests();
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === paths.dir && flags === "r") directoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      const result = realRename(from, to);
      if (String(to) === paths.snapshot) mainPublished = true;
      return result;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (directoryFds.has(fd) && mainPublished) {
        const error = new Error("simulated post-publish fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      directoryFds.delete(fd);
      return realClose(fd);
    });

    let error: unknown;
    try {
      repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ProjectAgentRepositoryCommittedDurabilityError);
    expect(error).toMatchObject({
      committed: true,
      retryable: false,
      committedRevision: 1,
    });
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A, 1));
    expect(repository.lookupCommittedCommand(state(BINDING_A, 1), "repository-fixture-command-1")).toMatchObject({
      appliedRevision: 1,
    });
    // 提交后仍走内存索引答题，一次账本全量重扫都没有。上一版这里过滤 `fs.readFileSync` 的
    // 路径参数，而重扫走 readRegular() → fs.readFileSync(fd)，第一个参数是 fd 数字不是路径，
    // 过滤器**永远匹配不到**——那条断言恒真。计数器不经过 fs 间接层，`projectAgentHost.test.ts`
    // 里的阳性对照用例钉住「它真的会涨」。
    expect(__projectAgentCommandLedgerScanCountForTests() - scansBefore).toBe(0);
    expect(fs.existsSync(paths.backup)).toBe(false);
  });

  it("keeps the previous snapshot byte-for-byte when the final atomic rename fails", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const before = fs.readFileSync(paths.snapshot);
    const realRename = fs.renameSync.bind(fs);
    let snapshotRenames = 0;

    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === paths.snapshot) {
        snapshotRenames += 1;
        if (snapshotRenames === 1) {
          const error = new Error("simulated final rename failure") as NodeJS.ErrnoException;
          error.code = "EIO";
          throw error;
        }
      }
      return realRename(from, to);
    });

    expect(() => repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toThrow(/simulated final rename failure/);
    expect(fs.readFileSync(paths.snapshot)).toEqual(before);
    expect(repository.load(BINDING_A)).toEqual(state());
    expect(fs.readdirSync(paths.dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    vi.restoreAllMocks();
    fs.writeFileSync(paths.snapshot, "{corrupt-after-failed-publish", "utf8");
    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("keeps a committed main authoritative when post-commit backup mirroring fails", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const realRename = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === paths.backup) {
        const error = new Error("simulated backup mirror failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realRename(from, to);
    });

    expect(repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toEqual(state(BINDING_A, 1));
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A, 1));
    expect(fs.existsSync(paths.backup)).toBe(false);

    vi.restoreAllMocks();
    fs.writeFileSync(paths.snapshot, "{corrupt-after-committed-main", "utf8");
    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("does not report a committed main as retryable when mirror cleanup also fails", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const realRename = fs.renameSync.bind(fs);
    const realRemove = fs.rmSync.bind(fs);
    let mirrorFailed = false;

    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === paths.backup) {
        mirrorFailed = true;
        const error = new Error("simulated backup mirror failure") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realRename(from, to);
    });
    vi.spyOn(fs, "rmSync").mockImplementation((filePath, options) => {
      if (String(filePath) === paths.backup && mirrorFailed) {
        const error = new Error("simulated mirror cleanup failure") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      return realRemove(filePath, options);
    });

    expect(repository.commit(BINDING_A, 0, state(BINDING_A, 1))).toEqual(state(BINDING_A, 1));
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("recovers the latest acknowledged revision when the main snapshot later corrupts", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);

    fs.writeFileSync(paths.snapshot, "{corrupt", "utf8");

    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("self-heals a backup recovery before risking the only valid copy on the next commit", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    fs.writeFileSync(paths.snapshot, "{corrupt-main", "utf8");
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A, 1));
    const realRename = fs.renameSync.bind(fs);
    let snapshotRenames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to) === paths.snapshot) {
        snapshotRenames += 1;
        if (snapshotRenames === 2) {
          const error = new Error("simulated publish EIO after recovery") as NodeJS.ErrnoException;
          error.code = "EIO";
          throw error;
        }
      }
      return realRename(from, to);
    });

    expect(() => repository.commit(BINDING_A, 1, state(BINDING_A, 2))).toThrow(/publish EIO after recovery/);

    vi.restoreAllMocks();
    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("does not label a failed backup self-heal barrier as the next command being committed", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    fs.writeFileSync(paths.snapshot, "{corrupt-main", "utf8");
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const directoryFds = new Set<number>();
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      if (String(filePath) === paths.dir && flags === "r") directoryFds.add(fd);
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (directoryFds.has(fd)) {
        const error = new Error("simulated recovery barrier EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      directoryFds.delete(fd);
      return realClose(fd);
    });

    let error: unknown;
    try {
      repository.commit(BINDING_A, 1, state(BINDING_A, 2));
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: "EIO" });
    expect(error).not.toMatchObject({ committed: true });
    expect(repository.load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("uses a valid main snapshot when the backup is corrupt", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);

    fs.writeFileSync(paths.backup, "{corrupt", "utf8");

    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toEqual(state(BINDING_A, 1));
  });

  it("fails closed when both main and backup are corrupt or fail checksum", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING_A, 0, state(BINDING_A, 1));
    const paths = repository.pathsFor(BINDING_A);
    const envelope = JSON.parse(fs.readFileSync(paths.snapshot, "utf8")) as Record<string, unknown>;

    fs.writeFileSync(paths.snapshot, JSON.stringify({ ...envelope, checksum: "wrong" }), "utf8");
    fs.writeFileSync(paths.backup, "{corrupt", "utf8");

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("rejects unknown envelope and duplicate-binding fields instead of accepting unsigned data", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING_A);
    const envelope = JSON.parse(fs.readFileSync(paths.snapshot, "utf8")) as Record<string, unknown>;

    fs.writeFileSync(
      paths.snapshot,
      JSON.stringify({
        ...envelope,
        binding: { ...BINDING_A, area: "canvas" },
        unsignedFutureField: true,
      }),
      "utf8",
    );
    fs.writeFileSync(paths.backup, "{corrupt", "utf8");

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING_A)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });
});
