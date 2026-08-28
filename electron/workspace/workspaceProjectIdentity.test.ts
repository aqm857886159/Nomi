import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForProduction } from "../productionRun/productionRunTestHelpers";
import { canCreateSymlink } from "../testSupport/canCreateSymlink";
import { recoverWorkspaceManifest } from "./workspaceManifest";
import { releaseWorkspaceManifestLock, tryAcquireWorkspaceManifestLock } from "./workspaceManifestLock";
import { workspaceProjectBackupFile, workspaceProjectFile } from "./workspacePaths";
import {
  WorkspaceProjectIdentityUnavailableError,
  deriveCanonicalWorkspaceRootIdentity,
  ensureWorkspaceProjectIdentity,
  type WorkspaceProjectIdentity,
} from "./workspaceProjectIdentity";

const tempRoots: string[] = [];
const canCreateDirSymlink = canCreateSymlink("dir");

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(prefix = "nomi-workspace-identity-"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

function legacyManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "project-1",
    name: "Legacy Film",
    version: 2,
    createdAt: 100,
    updatedAt: 200,
    savedAt: 300,
    revision: 4,
    lastKnownRootPath: "/client/claimed/path",
    payload: {
      script: "keep me",
      image: "data:image/png;base64,aGVsbG8=",
    },
    futureField: { keep: [1, 2, 3] },
    ...overrides,
  };
}

function writeRawManifest(root: string, value: Record<string, unknown>): string {
  const manifestPath = workspaceProjectFile(root);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(manifestPath, serialized);
  return serialized;
}

function writeRawBackup(root: string, value: Record<string, unknown>): string {
  const backupPath = workspaceProjectBackupFile(root);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  fs.writeFileSync(backupPath, serialized);
  return serialized;
}

function runIdentityChild(root: string, uuid: string, readyPath: string): Promise<WorkspaceProjectIdentity> {
  const tsx = path.resolve("node_modules/.bin/tsx");
  const script = [
    'import fs from "node:fs";',
    'import { ensureWorkspaceProjectIdentity } from "./electron/workspace/workspaceProjectIdentity.ts";',
    "void (async () => {",
    "  fs.writeFileSync(process.env.TEST_READY_PATH, 'ready');",
    "  const identity = await ensureWorkspaceProjectIdentity(process.env.TEST_WORKSPACE_ROOT, {",
    "    randomUuid: () => process.env.TEST_WORKSPACE_UUID,",
    "    lockOptions: { retryDelayMs: 2, waitTimeoutMs: 5000 },",
    "  });",
    "  process.stdout.write(JSON.stringify(identity));",
    "})().catch((error) => { console.error(error); process.exitCode = 1; });",
  ].join("\n");
  return new Promise((resolve, reject) => {
    execFile(
      tsx,
      ["-e", script],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TEST_WORKSPACE_ROOT: root,
          TEST_WORKSPACE_UUID: uuid,
          TEST_READY_PATH: readyPath,
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`identity child failed: ${stderr || error.message}`));
          return;
        }
        resolve(JSON.parse(stdout) as WorkspaceProjectIdentity);
      },
    );
  });
}

async function waitForFiles(filePaths: string[]): Promise<void> {
  await waitForProduction(() => filePaths.every((filePath) => fs.existsSync(filePath)));
}

describe("workspace project identity", () => {
  it("fills a fully legacy manifest once without changing business or unknown fields", async () => {
    const root = makeTempDir();
    const before = legacyManifest();
    writeRawManifest(root, before);

    const first = await ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    });
    const second = await ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
    });
    const after = JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      projectId: "project-1",
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
      canonicalRootPath: fs.realpathSync(root),
    });
    expect(first.canonicalRootDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(after).toEqual({
      ...before,
      immutableProjectUuid: first.immutableProjectUuid,
      projectGeneration: 1,
    });
    expect(fs.readdirSync(path.dirname(workspaceProjectFile(root)))).not.toContain("project-identity.lock");
  });

  it("fails closed when exactly one identity field is present", async () => {
    for (const partial of [
      { immutableProjectUuid: "11111111-1111-4111-8111-111111111111" },
      { projectGeneration: 1 },
    ]) {
      const root = makeTempDir();
      const before = writeRawManifest(root, legacyManifest(partial));

      await expect(ensureWorkspaceProjectIdentity(root)).rejects.toMatchObject({
        code: "project_identity_unavailable",
      });
      expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(before);
    }
  });

  it("adopts a complete backup identity when the main legacy manifest has none", async () => {
    const root = makeTempDir();
    writeRawManifest(root, legacyManifest());
    const backupBefore = writeRawBackup(
      root,
      legacyManifest({
        immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
        projectGeneration: 3,
      }),
    );
    const randomUuid = vi.fn(() => "22222222-2222-4222-8222-222222222222");

    const identity = await ensureWorkspaceProjectIdentity(root, { randomUuid });

    expect(identity).toMatchObject({
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 3,
    });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(fs.readFileSync(workspaceProjectBackupFile(root), "utf8")).toBe(backupBefore);
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"))).toMatchObject({
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
    });
  });

  it("publishes one new identity to backup before main and survives recovery", async () => {
    const root = makeTempDir();
    writeRawManifest(root, legacyManifest());
    writeRawBackup(root, legacyManifest({ payload: { backup: true } }));

    const identity = await ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    });
    const backup = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(root), "utf8"));

    expect(backup).toMatchObject({
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      payload: { backup: true },
    });
    fs.writeFileSync(workspaceProjectFile(root), "{bad json");
    const recovered = recoverWorkspaceManifest(root, "project-1", 123);
    expect(recovered).toMatchObject({
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
    });
  });

  it("backfills an identityless backup without rewriting an already-complete main manifest", async () => {
    const root = makeTempDir();
    const mainBefore = writeRawManifest(
      root,
      legacyManifest({
        immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
        projectGeneration: 7,
      }),
    );
    writeRawBackup(root, legacyManifest({ payload: { backup: true } }));

    const identity = await ensureWorkspaceProjectIdentity(root);
    const backup = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(root), "utf8"));

    expect(identity).toMatchObject({
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 7,
    });
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(mainBefore);
    expect(backup).toMatchObject({
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      payload: { backup: true },
    });
  });

  it("reuses a backup-staged identity after main publication fails", async () => {
    const root = makeTempDir();
    const mainBefore = writeRawManifest(root, legacyManifest());
    writeRawBackup(root, legacyManifest({ payload: { backup: true } }));
    const canonicalManifestPath = path.join(fs.realpathSync(root), ".nomi", "project.json");
    const realRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.resolve(String(target)) === canonicalManifestPath) {
        const error = new Error("ENOSPC: simulated main identity publish failure") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return realRename(source, target);
    });

    await expect(
      ensureWorkspaceProjectIdentity(root, {
        randomUuid: () => "11111111-1111-4111-8111-111111111111",
      }),
    ).rejects.toMatchObject({ code: "project_identity_unavailable" });
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(mainBefore);
    const staged = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(root), "utf8"));
    expect(staged).toMatchObject({
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    });
    renameSpy.mockRestore();

    const retried = await ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "22222222-2222-4222-8222-222222222222",
    });
    expect(retried).toMatchObject({
      immutableProjectUuid: staged.immutableProjectUuid,
      projectGeneration: staged.projectGeneration,
    });
  });

  it("keeps both files byte-identical when backup identity publication fails", async () => {
    const root = makeTempDir();
    const mainBefore = writeRawManifest(root, legacyManifest());
    const backupBefore = writeRawBackup(root, legacyManifest({ payload: { backup: true } }));
    const canonicalBackupPath = path.join(fs.realpathSync(root), ".nomi", "project.backup.json");
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.resolve(String(target)) === canonicalBackupPath) {
        const error = new Error("ENOSPC: simulated backup identity publish failure") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return realRename(source, target);
    });

    await expect(ensureWorkspaceProjectIdentity(root)).rejects.toMatchObject({
      code: "project_identity_unavailable",
    });
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(mainBefore);
    expect(fs.readFileSync(workspaceProjectBackupFile(root), "utf8")).toBe(backupBefore);
  });

  it("fails closed on partial or conflicting backup identity without changing either file", async () => {
    for (const pair of [
      {
        main: legacyManifest(),
        backup: legacyManifest({
          immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
        }),
      },
      {
        main: legacyManifest({
          immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
          projectGeneration: 1,
        }),
        backup: legacyManifest({
          immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
          projectGeneration: 1,
        }),
      },
    ]) {
      const root = makeTempDir();
      const mainBefore = writeRawManifest(root, pair.main);
      const backupBefore = writeRawBackup(root, pair.backup);

      await expect(ensureWorkspaceProjectIdentity(root)).rejects.toMatchObject({
        code: "project_identity_unavailable",
      });
      expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(mainBefore);
      expect(fs.readFileSync(workspaceProjectBackupFile(root), "utf8")).toBe(backupBefore);
    }
  });

  it("preserves an existing complete identity byte-for-byte", async () => {
    const root = makeTempDir();
    const before = writeRawManifest(
      root,
      legacyManifest({
        immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
        projectGeneration: 7,
      }),
    );
    const randomUuid = vi.fn(() => "22222222-2222-4222-8222-222222222222");

    const identity = await ensureWorkspaceProjectIdentity(root, { randomUuid });

    expect(identity).toMatchObject({
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 7,
    });
    expect(randomUuid).not.toHaveBeenCalled();
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(before);
  });

  (canCreateDirSymlink ? it : it.skip)(
    "derives the same root identity through a symlink and ignores manifest lastKnownRootPath",
    async () => {
      const root = makeTempDir();
      const aliasParent = makeTempDir("nomi-workspace-identity-alias-");
      const alias = path.join(aliasParent, "workspace-alias");
      fs.symlinkSync(root, alias, "dir");
      writeRawManifest(
        root,
        legacyManifest({
          immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
          projectGeneration: 3,
          lastKnownRootPath: "/forged/request/path",
        }),
      );

      const direct = await ensureWorkspaceProjectIdentity(root);
      const throughAlias = await ensureWorkspaceProjectIdentity(alias);

      expect(throughAlias).toEqual(direct);
      expect(direct.canonicalRootPath).toBe(fs.realpathSync(root));
      expect(direct.canonicalRootPath).not.toBe("/forged/request/path");
      expect(deriveCanonicalWorkspaceRootIdentity(alias)).toEqual(deriveCanonicalWorkspaceRootIdentity(root));
    },
  );

  it("waits on the shared manifest transaction and re-reads the winning identity", async () => {
    const root = makeTempDir();
    writeRawManifest(root, legacyManifest());
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "other-process",
      randomId: () => "other-process-nonce",
    });

    const ensuring = ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
      lockOptions: { retryDelayMs: 1, waitTimeoutMs: 1_000 },
    });
    releaseWorkspaceManifestLock(held);

    await expect(ensuring).resolves.toMatchObject({
      immutableProjectUuid: "11111111-1111-4111-8111-111111111111",
      projectGeneration: 1,
    });
  });

  it("converges two real processes on one identity and keeps it stable after restart", async () => {
    const root = makeTempDir();
    const before = legacyManifest();
    writeRawManifest(root, before);
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "test-barrier",
      randomId: () => "test-barrier-nonce",
    });
    const readyA = path.join(root, "identity-child-a.ready");
    const readyB = path.join(root, "identity-child-b.ready");
    const childA = runIdentityChild(root, "11111111-1111-4111-8111-111111111111", readyA);
    const childB = runIdentityChild(root, "22222222-2222-4222-8222-222222222222", readyB);

    await waitForFiles([readyA, readyB]);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    releaseWorkspaceManifestLock(held);
    const [identityA, identityB] = await Promise.all([childA, childB]);
    const restarted = await ensureWorkspaceProjectIdentity(root, {
      randomUuid: () => "33333333-3333-4333-8333-333333333333",
    });
    const after = JSON.parse(fs.readFileSync(workspaceProjectFile(root), "utf8"));

    expect(identityA).toEqual(identityB);
    expect(restarted).toEqual(identityA);
    expect(["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"]).toContain(
      identityA.immutableProjectUuid,
    );
    expect(after).toEqual({
      ...before,
      immutableProjectUuid: identityA.immutableProjectUuid,
      projectGeneration: 1,
    });
  }, 15_000);

  it("turns bounded lock contention into project_identity_unavailable without writing", async () => {
    const root = makeTempDir();
    const before = writeRawManifest(root, legacyManifest());
    const held = tryAcquireWorkspaceManifestLock(root, {
      ownerId: "long-running-writer",
      randomId: () => "long-running-writer-nonce",
    });

    await expect(
      ensureWorkspaceProjectIdentity(root, {
        lockOptions: { retryDelayMs: 1, waitTimeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: "project_identity_unavailable" });
    expect(fs.readFileSync(workspaceProjectFile(root), "utf8")).toBe(before);

    releaseWorkspaceManifestLock(held);
  });

  it("reports project_identity_unavailable and preserves the original manifest when atomic replace fails", async () => {
    const root = makeTempDir();
    const before = writeRawManifest(root, legacyManifest());
    const manifestPath = workspaceProjectFile(root);
    const canonicalManifestPath = path.join(fs.realpathSync(root), ".nomi", "project.json");
    const realRename = fs.renameSync.bind(fs);
    vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (path.resolve(String(target)) === canonicalManifestPath) {
        const error = new Error("ENOSPC: simulated atomic replace failure") as NodeJS.ErrnoException;
        error.code = "ENOSPC";
        throw error;
      }
      return realRename(source, target);
    });

    await expect(ensureWorkspaceProjectIdentity(root)).rejects.toBeInstanceOf(WorkspaceProjectIdentityUnavailableError);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(before);
    expect(fs.readdirSync(path.dirname(manifestPath)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});
