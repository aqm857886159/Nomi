import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDurabilityMode, setDurabilityMode } from "../durability";
import type { ProjectAgentHostState } from "../shared/projectAgentContracts";
import { ProjectAgentRepositoryIntegrityError, createProjectAgentRepository } from "./projectAgentRepository";
import { createInitialProjectAgentState, snapshotProjectAgentHostState } from "./projectAgentState";

const BINDING = {
  projectId: "same-visible-project-id",
  immutableProjectUuid: "39eeb81d-f188-4e30-bb0f-d59ebfec67a8",
  projectGeneration: 1,
} as const;

let root = "";
let previousDurability = getDurabilityMode();

beforeEach(() => {
  previousDurability = getDurabilityMode();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-project-agent-repository-privacy-"));
});

afterEach(() => {
  setDurabilityMode(previousDurability);
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function state(hostRevision = 0): ProjectAgentHostState {
  const recentAppliedCommands = Array.from({ length: hostRevision }, (_, index) => {
    const appliedRevision = index + 1;
    return {
      commandId: `privacy-command-${appliedRevision}`,
      mutationHash: appliedRevision.toString(16).padStart(64, "0"),
      appliedRevision,
      patch: {
        binding: BINDING,
        previousRevision: appliedRevision - 1,
        hostRevision: appliedRevision,
        changes: [],
      },
    };
  });
  return snapshotProjectAgentHostState({
    ...createInitialProjectAgentState(BINDING),
    hostRevision,
    commandLedgerHighWater: hostRevision,
    recentAppliedCommands,
  });
}

describe("ProjectAgentRepository private storage", () => {
  it("repairs widened POSIX permissions before accepting an existing partition", () => {
    if (process.platform === "win32") return;
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING, 0, state(1));
    const paths = repository.pathsFor(BINDING);
    const storeRoot = path.dirname(paths.dir);
    fs.chmodSync(storeRoot, 0o755);
    fs.chmodSync(paths.dir, 0o755);
    fs.chmodSync(paths.snapshot, 0o644);
    fs.chmodSync(paths.backup, 0o644);
    fs.chmodSync(paths.ledger, 0o644);

    expect(createProjectAgentRepository({ rootDir: root }).load(BINDING)).toEqual(state(1));
    expect(fs.statSync(storeRoot).mode & 0o777).toBe(0o700);
    expect(fs.statSync(paths.dir).mode & 0o777).toBe(0o700);
    expect(fs.statSync(paths.snapshot).mode & 0o777).toBe(0o600);
    expect(fs.statSync(paths.backup).mode & 0o777).toBe(0o600);
    expect(fs.statSync(paths.ledger).mode & 0o777).toBe(0o600);
  });

  it("fails closed on symlinked store and partition directories", () => {
    if (process.platform === "win32") return;
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    repository.commit(BINDING, 0, state(1));
    const paths = repository.pathsFor(BINDING);
    const storeRoot = path.dirname(paths.dir);
    const movedStoreRoot = path.join(root, "project-agent-host-real");
    fs.renameSync(storeRoot, movedStoreRoot);
    fs.symlinkSync(movedStoreRoot, storeRoot);

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );

    fs.rmSync(storeRoot);
    fs.renameSync(movedStoreRoot, storeRoot);
    const movedPartition = path.join(storeRoot, "partition-real");
    fs.renameSync(paths.dir, movedPartition);
    fs.symlinkSync(movedPartition, paths.dir);

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("fails closed on dangling snapshot symlinks instead of treating them as an uninitialized store", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING);
    fs.rmSync(paths.snapshot);
    fs.rmSync(paths.backup);
    fs.symlinkSync(path.join(root, "missing-main.json"), paths.snapshot);
    fs.symlinkSync(path.join(root, "missing-backup.json"), paths.backup);

    expect(() => createProjectAgentRepository({ rootDir: root }).load(BINDING)).toThrow(
      ProjectAgentRepositoryIntegrityError,
    );
  });

  it("does not accumulate private temp snapshots when repeated backup fsyncs fail", () => {
    const repository = createProjectAgentRepository({ rootDir: root });
    repository.initialize(state());
    const paths = repository.pathsFor(BINDING);
    const realOpen = fs.openSync.bind(fs);
    const realFsync = fs.fsyncSync.bind(fs);
    const realClose = fs.closeSync.bind(fs);
    const backupTempFds = new Set<number>();
    setDurabilityMode("durable");
    vi.spyOn(fs, "openSync").mockImplementation((filePath, flags, mode) => {
      const fd = realOpen(filePath, flags, mode);
      const name = path.basename(String(filePath));
      if (name.startsWith(".snapshot-v1.backup.json.") && name.endsWith(".tmp")) {
        backupTempFds.add(fd);
      }
      return fd;
    });
    vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (backupTempFds.has(fd)) {
        const error = new Error("simulated backup temp fsync EIO") as NodeJS.ErrnoException;
        error.code = "EIO";
        throw error;
      }
      return realFsync(fd);
    });
    vi.spyOn(fs, "closeSync").mockImplementation((fd) => {
      backupTempFds.delete(fd);
      return realClose(fd);
    });

    expect(repository.commit(BINDING, 0, state(1))).toEqual(state(1));
    expect(repository.commit(BINDING, 1, state(2))).toEqual(state(2));
    expect(repository.load(BINDING)).toEqual(state(2));
    expect(fs.readdirSync(paths.dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
