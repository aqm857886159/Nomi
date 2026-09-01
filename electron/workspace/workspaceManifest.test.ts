import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canCreateSymlink } from "../testSupport/canCreateSymlink";
import {
  ensureWorkspaceFolders,
  hasWorkspaceManifest,
  initializeWorkspace,
  readWorkspaceManifest,
  readWorkspaceManifestSnapshot,
  withWorkspaceManifestMutationSync,
  writeWorkspaceManifest,
} from "./workspaceManifest";
import {
  WorkspaceManifestLockBusyError,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "./workspaceManifestLock";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import { WorkspaceProjectIdentityUnavailableError, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

const _compileTimeRejectsAsyncMutationCallback = (): void => {
  // @ts-expect-error synchronous manifest mutations reject Promise-like callback results
  withWorkspaceManifestMutationSync("/compile-time-only", async () => "not-sync");
};

const tempRoots: string[] = [];
const canCreateDirSymlink = canCreateSymlink("dir");
const canCreateFileSymlink = canCreateSymlink("file");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-workspace-manifest-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function makeRecord(overrides: Partial<WorkspaceProjectRecordV2> = {}): WorkspaceProjectRecordV2 {
  return {
    id: "project-1",
    name: "My Film",
    version: 2,
    createdAt: 100,
    updatedAt: 200,
    savedAt: 300,
    revision: 4,
    ...overrides,
  };
}

describe("workspace manifest", () => {
  it("initializes .nomi/project.json in an empty folder without rootPath", () => {
    const root = makeTempDir();

    const record = initializeWorkspace(root, { name: "My Film", payload: { boardId: "board-1" } });
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"));

    expect(record).toMatchObject({
      name: "My Film",
      version: 2,
      createdAt: Date.parse("2026-05-31T12:00:00Z"),
      updatedAt: Date.parse("2026-05-31T12:00:00Z"),
      savedAt: Date.parse("2026-05-31T12:00:00Z"),
      revision: 0,
      payload: { boardId: "board-1" },
      lastKnownRootPath: path.resolve(root),
    });
    expect(record.id).toMatch(/^workspace-/);
    expect(record.immutableProjectUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.projectGeneration).toBe(1);
    expect(JSON.parse(fs.readFileSync(workspaceProjectBackupFile(root), "utf8"))).toMatchObject({
      immutableProjectUuid: record.immutableProjectUuid,
      projectGeneration: 1,
    });
    expect(readWorkspaceManifest(root)).toMatchObject({
      immutableProjectUuid: record.immutableProjectUuid,
      projectGeneration: 1,
    });
    expect(raw.rootPath).toBeUndefined();
    expect(hasWorkspaceManifest(root)).toBe(true);
  });

  it("reads a valid manifest snapshot without contending for the write lock", () => {
    const root = makeTempDir();
    const record = initializeWorkspace(root, { name: "Concurrent reads" });
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "simulated-writer",
      randomId: () => "simulated-writer-nonce",
    });

    expect(readWorkspaceManifestSnapshot(root)).toMatchObject({
      id: record.id,
      name: "Concurrent reads",
      revision: 0,
    });

    releaseWorkspaceManifestLock(held);
  });

  it("reuses an existing workspace manifest and does not overwrite its id", () => {
    const root = makeTempDir();
    ensureWorkspaceFolders(root);
    writeWorkspaceManifest(root, makeRecord({ id: "existing-id", name: "Existing" }));

    const record = initializeWorkspace(root, { name: "New Name" });

    expect(record.id).toBe("existing-id");
    expect(record.name).toBe("Existing");
    expect(readWorkspaceManifest(root)?.id).toBe("existing-id");
  });

  it("does not publish a new manifest when the initial backup cannot be written", () => {
    const root = makeTempDir();
    const canonicalBackupPath = path.join(fs.realpathSync(root), ".nomi", "project.backup.json");
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.resolve(String(target)) === canonicalBackupPath) {
        const error = new Error("ENOSPC: simulated backup publish failure") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return realRename(source, target);
    });

    expect(() => initializeWorkspace(root, { name: "Must not partially publish" })).toThrow(
      /simulated backup publish failure/,
    );
    expect(fs.existsSync(workspaceProjectFile(root))).toBe(false);
    expect(fs.existsSync(workspaceProjectBackupFile(root))).toBe(false);
  });

  it("reuses the staged backup identity when manifest publication is retried", () => {
    const root = makeTempDir();
    const canonicalManifestPath = path.join(fs.realpathSync(root), ".nomi", "project.json");
    const realRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.resolve(String(target)) === canonicalManifestPath) {
        const error = new Error("ENOSPC: simulated manifest publish failure") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return realRename(source, target);
    });

    expect(() => initializeWorkspace(root, { name: "Retry Me", payload: { keep: true } })).toThrow(
      /simulated manifest publish failure/,
    );
    expect(fs.existsSync(workspaceProjectFile(root))).toBe(false);
    const staged = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(root), "utf8"));
    renameSpy.mockRestore();

    const retried = initializeWorkspace(root, { name: "Retry Me", payload: { keep: true } });

    expect(retried).toMatchObject({
      id: staged.id,
      immutableProjectUuid: staged.immutableProjectUuid,
      projectGeneration: staged.projectGeneration,
      payload: { keep: true },
    });
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"))).toEqual(staged);
  });

  it("creates workspace assets and exports directories", () => {
    const root = makeTempDir();

    ensureWorkspaceFolders(root);

    expect(fs.statSync(path.join(root, ".nomi")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "assets", "generated", "2026-05-31")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "assets", "imported", "2026-05-31")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "exports")).isDirectory()).toBe(true);
  });

  (canCreateDirSymlink ? it : it.skip)(
    "rejects pre-existing managed directory symlinks that point outside the workspace",
    () => {
      const root = makeTempDir();
      const outside = makeTempDir();
      fs.symlinkSync(outside, path.join(root, ".nomi"), "dir");

      expect(() => ensureWorkspaceFolders(root)).toThrow(/workspace/i);
      expect(() => writeWorkspaceManifest(root, makeRecord())).toThrow(/workspace/i);
    },
  );

  (canCreateFileSymlink ? it : it.skip)(
    "rejects project manifest file symlinks that point outside the workspace",
    () => {
      const root = makeTempDir();
      const outside = makeTempDir();
      fs.mkdirSync(path.join(root, ".nomi"));
      const outsideManifest = path.join(outside, "project.json");
      fs.writeFileSync(outsideManifest, JSON.stringify(makeRecord({ id: "outside-id" })));
      fs.symlinkSync(outsideManifest, path.join(root, ".nomi", "project.json"));

      expect(() => hasWorkspaceManifest(root)).toThrow(/workspace/i);
      expect(() => readWorkspaceManifest(root)).toThrow(/workspace/i);
      expect(() => writeWorkspaceManifest(root, makeRecord({ id: "inside-id" }))).toThrow(/workspace/i);
      expect(JSON.parse(fs.readFileSync(outsideManifest, "utf8")).id).toBe("outside-id");
    },
  );

  it("reads null for folders without a manifest", () => {
    const root = makeTempDir();

    expect(hasWorkspaceManifest(root)).toBe(false);
    expect(readWorkspaceManifest(root)).toBeNull();
  });

  it("normalizes records when writing and reading", () => {
    const root = makeTempDir();

    const written = writeWorkspaceManifest(root, {
      id: "project-1",
      name: "My Film",
      version: 2,
      createdAt: 100,
      updatedAt: 200,
      savedAt: 200,
      revision: 0,
    });

    expect(written).toEqual(makeRecord({ savedAt: 200, revision: 0 }));
    expect(readWorkspaceManifest(root)).toEqual(makeRecord({ savedAt: 200, revision: 0 }));
  });

  it("preserves complete identity and unknown fields when a stale writer omits them", () => {
    const root = makeTempDir();
    const initialized = initializeWorkspace(root, { name: "Original", payload: { value: 1 } });
    const manifestPath = workspaceProjectFile(root);
    const existingRaw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...existingRaw, futureField: { keep: true } }, null, 2)}\n`);

    writeWorkspaceManifest(
      root,
      makeRecord({
        id: initialized.id,
        name: "Updated by stale writer",
        payload: { value: 2 },
      }),
    );

    expect(JSON.parse(fs.readFileSync(manifestPath, "utf8"))).toMatchObject({
      immutableProjectUuid: initialized.immutableProjectUuid,
      projectGeneration: initialized.projectGeneration,
      futureField: { keep: true },
      name: "Updated by stale writer",
      payload: { value: 2 },
    });
  });

  it("fails closed when a normal writer changes or partially removes persisted identity", () => {
    const root = makeTempDir();
    const initialized = initializeWorkspace(root, { name: "Protected" });
    const manifestPath = workspaceProjectFile(root);

    for (const candidate of [
      {
        ...initialized,
        immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
      },
      {
        ...initialized,
        immutableProjectUuid: undefined,
      },
    ]) {
      const before = fs.readFileSync(manifestPath, "utf8");
      expect(() => writeWorkspaceManifest(root, candidate as WorkspaceProjectRecordV2)).toThrow(
        WorkspaceProjectIdentityUnavailableError,
      );
      expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    }
  });

  it("checks partial identity before embedded-media slimming can mutate the manifest", () => {
    const root = makeTempDir();
    ensureWorkspaceFolders(root);
    const manifestPath = workspaceProjectFile(root);
    const partial = {
      ...makeRecord({ payload: { image: "data:image/png;base64,aGVsbG8=" } }),
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(partial, null, 2)}\n`);
    const before = fs.readFileSync(manifestPath, "utf8");

    expect(() => readWorkspaceManifest(root)).toThrow(WorkspaceProjectIdentityUnavailableError);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, "assets", "generated", "2026-05-31"))).toBe(true);
    expect(fs.readdirSync(path.join(root, "assets", "generated", "2026-05-31"))).toEqual([]);
  });

  it("checks backup identity before embedded-media slimming can mutate the manifest", () => {
    const root = makeTempDir();
    ensureWorkspaceFolders(root);
    const manifestPath = workspaceProjectFile(root);
    const backupPath = workspaceProjectBackupFile(root);
    const main = {
      ...makeRecord({ payload: { image: "data:image/png;base64,aGVsbG8=" } }),
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    };
    const backup = {
      ...makeRecord({ payload: { backup: true } }),
      immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
      projectGeneration: 1,
    };
    const mainBefore = `${JSON.stringify(main, null, 2)}\n`;
    const backupBefore = `${JSON.stringify(backup, null, 2)}\n`;
    fs.writeFileSync(manifestPath, mainBefore);
    fs.writeFileSync(backupPath, backupBefore);

    expect(() => readWorkspaceManifest(root)).toThrow(WorkspaceProjectIdentityUnavailableError);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(mainBefore);
    expect(fs.readFileSync(backupPath, "utf8")).toBe(backupBefore);
    expect(fs.readdirSync(path.join(root, "assets", "generated", "2026-05-31"))).toEqual([]);
  });

  it("rejects a runtime Promise-like mutation callback before publishing JSON or localized assets", () => {
    const root = makeTempDir();
    const manifestPath = workspaceProjectFile(root);
    const backupPath = workspaceProjectBackupFile(root);
    const generatedAssetDir = path.join(root, "assets", "generated", "2026-05-31");
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    const complete = {
      ...makeRecord({ payload: { image: "data:image/png;base64,aGVsbG8=" } }),
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    };
    const mainBefore = `${JSON.stringify(complete, null, 2)}\n`;
    const backupBefore = `${JSON.stringify({ ...complete, payload: { backup: true } }, null, 2)}\n`;
    fs.writeFileSync(manifestPath, mainBefore);
    fs.writeFileSync(backupPath, backupBefore);
    const callFromUntypedJavaScript = withWorkspaceManifestMutationSync as unknown as (
      actualRootPath: string,
      callback: (context: unknown) => unknown,
    ) => unknown;

    expect(() => callFromUntypedJavaScript(root, async () => "not-sync")).toThrow(/Promise-like/i);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(mainBefore);
    expect(fs.readFileSync(backupPath, "utf8")).toBe(backupBefore);
    expect(fs.existsSync(generatedAssetDir)).toBe(false);
  });

  it("makes sync writers fail closed instead of blocking while another owner holds the manifest", () => {
    const root = makeTempDir();
    const initialized = initializeWorkspace(root, { name: "Before" });
    const manifestPath = workspaceProjectFile(root);
    const before = fs.readFileSync(manifestPath, "utf8");
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "other-writer",
      randomId: () => "other-writer-nonce",
    });

    expect(() => writeWorkspaceManifest(root, { ...initialized, name: "Must not write" })).toThrow(
      WorkspaceManifestLockBusyError,
    );
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);

    releaseWorkspaceManifestLock(held);
  });

  it("exposes frozen snapshots instead of mutable aliases to the transaction baseline", () => {
    const root = makeTempDir();
    initializeWorkspace(root, { name: "Immutable", payload: { nested: { keep: true } } });

    withWorkspaceManifestMutationSync(root, (context) => {
      expect(Object.isFrozen(context.current)).toBe(true);
      expect(Object.isFrozen(context.currentRaw)).toBe(true);
      expect(Object.isFrozen((context.current?.payload as { nested: unknown }).nested)).toBe(true);
      expect(
        Reflect.set(context.current as object, "immutableProjectUuid", "22222222-2222-4222-8222-222222222222"),
      ).toBe(false);
      expect(Reflect.set(context.currentRaw as object, "futureField", "tampered")).toBe(false);
    });
  });

  it("rejects a backup identity change against the immutable manifest baseline", () => {
    const root = makeTempDir();
    initializeWorkspace(root, { name: "Protected backup" });
    const backupPath = workspaceProjectBackupFile(root);
    const before = fs.readFileSync(backupPath, "utf8");

    expect(() =>
      withWorkspaceManifestMutationSync(root, (context) => {
        context.replaceBackup({
          ...context.currentRaw,
          immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
        });
      }),
    ).toThrow(WorkspaceProjectIdentityUnavailableError);
    expect(fs.readFileSync(backupPath, "utf8")).toBe(before);
  });
});
