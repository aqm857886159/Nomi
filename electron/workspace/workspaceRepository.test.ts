import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  gcEmptyDraftWorkspaceProjects,
  diagnoseWorkspaceProject,
  listWorkspaceProjects,
  readWorkspaceProject,
  recoverWorkspaceProject,
  removeWorkspaceProjectReference,
  resolveWorkspaceProjectDir,
  saveWorkspaceProject,
  type WorkspaceRepositoryDeps,
} from "./workspaceRepository";
import { workspaceProjectBackupFile, workspaceProjectFile, workspaceProjectQuarantineFile } from "./workspacePaths";
import { recentWorkspacesPath } from "./workspaceRegistry";
import { WorkspaceProjectIdentityUnavailableError } from "./workspaceTypes";
import { ensureWorkspaceProjectIdentity } from "./workspaceProjectIdentity";
import {
  WorkspaceManifestLockBusyError,
  releaseWorkspaceManifestLock,
  tryAcquireWorkspaceManifestLock,
} from "./workspaceManifestLock";

const tempRoots: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-workspace-repository-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function deps(): WorkspaceRepositoryDeps {
  return {
    settingsRoot: makeTempDir("nomi-workspace-repository-settings-"),
    defaultProjectsRoot: makeTempDir("nomi-workspace-repository-default-projects-"),
  };
}

describe("workspace repository", () => {
  it("keeps projects under a previous default root native after the default location changes", () => {
    const settingsRoot = makeTempDir("nomi-workspace-repository-settings-");
    const oldDefaultRoot = makeTempDir("nomi-workspace-old-default-");
    const newDefaultRoot = makeTempDir("nomi-workspace-new-default-");
    const oldProjectRoot = path.join(oldDefaultRoot, "old-project");
    const originalDeps: WorkspaceRepositoryDeps = {
      settingsRoot,
      defaultProjectsRoot: oldDefaultRoot,
    };
    const changedDeps: WorkspaceRepositoryDeps = {
      settingsRoot,
      defaultProjectsRoot: newDefaultRoot,
    };
    const created = createWorkspaceProject(
      {
        rootPath: oldProjectRoot,
        record: { name: "Old native project" },
        origin: { source: "native", nativeRootPath: oldDefaultRoot },
      },
      originalDeps,
    );

    expect(listWorkspaceProjects(changedDeps)[0]).toMatchObject({ id: created.id, source: "native" });
    expect(deleteWorkspaceProject(created.id, changedDeps)).toEqual({ id: created.id, deleted: true });
    expect(fs.existsSync(oldProjectRoot)).toBe(false);
  });

  it("never reclassifies an external project when its ancestor becomes the new default root", () => {
    const settingsRoot = makeTempDir("nomi-workspace-repository-settings-");
    const oldDefaultRoot = makeTempDir("nomi-workspace-old-default-");
    const newDefaultRoot = makeTempDir("nomi-workspace-new-default-");
    const externalRoot = path.join(newDefaultRoot, "existing-external-project");
    const marker = path.join(externalRoot, "keep-me.txt");
    const originalDeps: WorkspaceRepositoryDeps = { settingsRoot, defaultProjectsRoot: oldDefaultRoot };
    const changedDeps: WorkspaceRepositoryDeps = { settingsRoot, defaultProjectsRoot: newDefaultRoot };
    const created = createWorkspaceProject(
      {
        rootPath: externalRoot,
        record: { name: "External project" },
        origin: { source: "folder" },
      },
      originalDeps,
    );
    fs.writeFileSync(marker, "must survive", "utf8");

    expect(listWorkspaceProjects(changedDeps)[0]).toMatchObject({ id: created.id, source: "folder" });
    expect(deleteWorkspaceProject(created.id, changedDeps)).toEqual({ id: created.id, deleted: false });
    expect(fs.readFileSync(marker, "utf8")).toBe("must survive");
  });

  it("creates a project in the selected root path", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();

    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Selected Folder Project", payload: { scenes: [] } } },
      repoDeps,
    );

    expect(created).toMatchObject({
      name: "Selected Folder Project",
      version: 2,
      payload: { scenes: [] },
      lastKnownRootPath: path.resolve(selectedRoot),
    });
    expect(fs.existsSync(workspaceProjectFile(selectedRoot))).toBe(true);
    expect(fs.existsSync(path.join(repoDeps.defaultProjectsRoot, created.id))).toBe(false);
    expect(listWorkspaceProjects(repoDeps)[0]).toMatchObject({
      id: created.id,
      rootPath: path.resolve(selectedRoot),
      missing: false,
    });
  });

  it("reads a project by id through the recent registry", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Read Me", payload: { script: "hello" } } },
      repoDeps,
    );

    const read = readWorkspaceProject(created.id, repoDeps);

    expect(read).toEqual(created);
  });

  it("saves payload into .nomi/project.json", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Save Me", payload: { draft: 1 } } },
      repoDeps,
    );
    vi.setSystemTime(new Date("2026-05-31T12:30:00Z"));

    const saved = saveWorkspaceProject(created.id, { name: "Saved Name", payload: { draft: 2 } }, repoDeps);
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(selectedRoot), "utf8"));

    expect(saved).toMatchObject({
      id: created.id,
      name: "Saved Name",
      createdAt: created.createdAt,
      updatedAt: Date.parse("2026-05-31T12:30:00Z"),
      savedAt: Date.parse("2026-05-31T12:30:00Z"),
      revision: created.revision + 1,
      payload: { draft: 2 },
    });
    expect(raw.payload).toEqual({ draft: 2 });
    const backup = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(selectedRoot), "utf8"));
    expect(backup.payload).toEqual({ draft: 1 });
    expect(raw).toMatchObject({
      immutableProjectUuid: created.immutableProjectUuid,
      projectGeneration: created.projectGeneration,
    });
    expect(backup).toMatchObject({
      immutableProjectUuid: created.immutableProjectUuid,
      projectGeneration: created.projectGeneration,
    });
  });

  it("keeps save read-backup-write inside the shared sync transaction", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Busy Save", payload: { draft: 1 } } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const backupPath = workspaceProjectBackupFile(selectedRoot);
    const manifestBefore = fs.readFileSync(manifestPath, "utf8");
    const backupBefore = fs.readFileSync(backupPath, "utf8");
    const held = tryAcquireWorkspaceManifestLock(selectedRoot, {
      ownerId: "other-writer",
      randomId: () => "other-writer-nonce",
    });

    expect(() => saveWorkspaceProject(created.id, { name: "Must not save", payload: { draft: 2 } }, repoDeps)).toThrow(
      WorkspaceManifestLockBusyError,
    );
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(manifestBefore);
    expect(fs.readFileSync(backupPath, "utf8")).toBe(backupBefore);

    releaseWorkspaceManifestLock(held);
  });

  it("backs up the raw manifest so future fields survive a repository save", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Raw Backup", payload: { step: 0 } } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...current, futureField: { keep: [1, 2, 3] } }, null, 2)}\n`);

    saveWorkspaceProject(created.id, { name: "Saved", payload: { step: 1 } }, repoDeps);

    expect(JSON.parse(fs.readFileSync(workspaceProjectBackupFile(selectedRoot), "utf8"))).toMatchObject({
      immutableProjectUuid: created.immutableProjectUuid,
      projectGeneration: created.projectGeneration,
      futureField: { keep: [1, 2, 3] },
      payload: { step: 0 },
    });
  });

  it("backfills identity after an identityless legacy save without losing the saved payload", async () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Save Then Identity", payload: { step: 0 } } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const { immutableProjectUuid: _uuid, projectGeneration: _generation, ...legacy } = current;
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`);

    const saved = saveWorkspaceProject(created.id, { name: "Saved", payload: { step: 1 } }, repoDeps);
    const identity = await ensureWorkspaceProjectIdentity(selectedRoot, {
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    });
    const persisted = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(saved).toMatchObject({ revision: 1, payload: { step: 1 } });
    expect(persisted).toMatchObject({
      revision: 1,
      payload: { step: 1 },
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: 1,
    });
  });

  it("preserves a backfilled identity through the next repository save", async () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Identity Then Save", payload: { step: 0 } } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const { immutableProjectUuid: _uuid, projectGeneration: _generation, ...legacy } = current;
    fs.writeFileSync(manifestPath, `${JSON.stringify(legacy, null, 2)}\n`);

    const identity = await ensureWorkspaceProjectIdentity(selectedRoot, {
      randomUuid: () => "11111111-1111-4111-8111-111111111111",
    });
    const saved = saveWorkspaceProject(created.id, { name: "Saved", payload: { step: 1 } }, repoDeps);
    const backup = JSON.parse(fs.readFileSync(workspaceProjectBackupFile(selectedRoot), "utf8"));

    expect(saved).toMatchObject({
      revision: 1,
      payload: { step: 1 },
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: 1,
    });
    expect(backup).toMatchObject({
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: 1,
    });
  });

  it("diagnoses and recovers a corrupt manifest from the last valid backup", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Recover Me", payload: { draft: 1 } } },
      repoDeps,
    );
    saveWorkspaceProject(created.id, { name: "Recover Me", payload: { draft: 2 } }, repoDeps);
    fs.writeFileSync(workspaceProjectFile(selectedRoot), "{bad json");

    expect(diagnoseWorkspaceProject(created.id, repoDeps)).toMatchObject({
      status: "corrupt-manifest",
      recoverable: true,
      backupAvailable: true,
    });
    const recovered = recoverWorkspaceProject(created.id, repoDeps);
    expect(recovered.payload).toEqual({ draft: 1 });
    expect(readWorkspaceProject(created.id, repoDeps)?.payload).toEqual({ draft: 1 });
    expect(fs.existsSync(workspaceProjectQuarantineFile(selectedRoot, Date.now()))).toBe(true);
  });

  it("preserves a structurally complete current identity when recovering an old identityless backup", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Identity Recovery", payload: { draft: 1 } } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const backupPath = workspaceProjectBackupFile(selectedRoot);
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const { immutableProjectUuid: _uuid, projectGeneration: _generation, ...identityless } = current;
    fs.writeFileSync(
      backupPath,
      `${JSON.stringify({ ...identityless, futureBackupField: { keep: true } }, null, 2)}\n`,
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify({ ...current, name: "" }, null, 2)}\n`);

    const recovered = recoverWorkspaceProject(created.id, repoDeps);
    const recoveredRaw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    expect(recovered).toMatchObject({
      immutableProjectUuid: created.immutableProjectUuid,
      projectGeneration: created.projectGeneration,
    });
    expect(recoveredRaw).toMatchObject({
      immutableProjectUuid: created.immutableProjectUuid,
      projectGeneration: created.projectGeneration,
      futureBackupField: { keep: true },
    });
  });

  it("fails recovery closed when backup identity conflicts with the current manifest", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Identity Conflict", payload: {} } },
      repoDeps,
    );
    const manifestPath = workspaceProjectFile(selectedRoot);
    const backupPath = workspaceProjectBackupFile(selectedRoot);
    const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    fs.writeFileSync(
      backupPath,
      `${JSON.stringify(
        {
          ...current,
          immutableProjectUuid: "22222222-2222-4222-8222-222222222222",
        },
        null,
        2,
      )}\n`,
    );
    const corrupt = `${JSON.stringify({ ...current, name: "" }, null, 2)}\n`;
    fs.writeFileSync(manifestPath, corrupt);

    expect(() => recoverWorkspaceProject(created.id, repoDeps)).toThrow(WorkspaceProjectIdentityUnavailableError);
    expect(fs.readFileSync(manifestPath, "utf8")).toBe(corrupt);
  });

  it("removes a project reference without deleting rootPath", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Remove Reference", payload: {} } },
      repoDeps,
    );

    const result = removeWorkspaceProjectReference(created.id, repoDeps);

    expect(result).toEqual({ id: created.id, deleted: false });
    expect(readWorkspaceProject(created.id, repoDeps)).toBeNull();
    expect(fs.existsSync(workspaceProjectFile(selectedRoot))).toBe(true);
  });

  it("returns missing=true when the folder no longer exists", () => {
    const selectedRoot = makeTempDir();
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: selectedRoot, record: { name: "Missing Folder", payload: {} } },
      repoDeps,
    );
    fs.rmSync(selectedRoot, { recursive: true, force: true });

    expect(listWorkspaceProjects(repoDeps)).toEqual([
      expect.objectContaining({
        id: created.id,
        name: "Missing Folder",
        missing: true,
        rootPath: path.resolve(selectedRoot),
      }),
    ]);
    expect(readWorkspaceProject(created.id, repoDeps)).toBeNull();
    expect(resolveWorkspaceProjectDir(created.id, repoDeps)).toBeNull();
  });

  it("keeps readable projects available when one workspace manifest is broken", () => {
    const brokenRoot = makeTempDir();
    const healthyRoot = makeTempDir();
    const repoDeps = deps();
    const broken = createWorkspaceProject(
      { rootPath: brokenRoot, record: { name: "Broken Manifest", payload: {} } },
      repoDeps,
    );
    const healthy = createWorkspaceProject(
      { rootPath: healthyRoot, record: { name: "Healthy", payload: { script: "ok" } } },
      repoDeps,
    );
    fs.writeFileSync(workspaceProjectFile(brokenRoot), "{bad json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const projects = listWorkspaceProjects(repoDeps);

    expect(projects.find((project) => project.id === healthy.id)).toMatchObject({
      id: healthy.id,
      missing: false,
    });
    // 文件夹仍在时不能把「清单损坏」伪装成 missing；上层会把 native missing 当真删并摘掉 registry，
    // 从而连恢复入口都消失。保留卡片，打开时再走 diagnose/recover。
    expect(projects.find((project) => project.id === broken.id)).toMatchObject({ id: broken.id, missing: false });
    expect(readWorkspaceProject(healthy.id, repoDeps)).toMatchObject({ id: healthy.id });
    expect(readWorkspaceProject(broken.id, repoDeps)).toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null for stale registry entries whose manifest id does not match", () => {
    const staleRoot = makeTempDir();
    const actualRoot = makeTempDir();
    const repoDeps = deps();
    const stale = createWorkspaceProject({ rootPath: staleRoot, record: { name: "Stale", payload: {} } }, repoDeps);
    const actual = createWorkspaceProject({ rootPath: actualRoot, record: { name: "Actual", payload: {} } }, repoDeps);
    const registry = JSON.parse(fs.readFileSync(recentWorkspacesPath(repoDeps.settingsRoot), "utf8"));
    fs.writeFileSync(
      recentWorkspacesPath(repoDeps.settingsRoot),
      JSON.stringify(
        registry.map((entry: { id: string; rootPath: string }) =>
          entry.id === stale.id ? { ...entry, rootPath: path.resolve(actualRoot) } : entry,
        ),
        null,
        2,
      ),
    );

    expect(readWorkspaceProject(stale.id, repoDeps)).toBeNull();
    expect(resolveWorkspaceProjectDir(stale.id, repoDeps)).toBeNull();
    expect(resolveWorkspaceProjectDir(actual.id, repoDeps)).toBe(path.resolve(actualRoot));
  });
});

describe("draft lifecycle + empty-draft GC", () => {
  // native 项目 = rootPath 落在默认根之下（Nomi 自管目录）。
  function nativeRoot(deps: WorkspaceRepositoryDeps, name: string): string {
    return path.join(deps.defaultProjectsRoot, name);
  }
  function writeAsset(rootPath: string): void {
    const dir = path.join(rootPath, "assets", "generated", "2026-05-31");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "shot.png"), "binary");
  }

  it("persists draft:true onto a freshly created blank project, and clears it on first save (promote)", () => {
    const repoDeps = deps();
    const created = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "blank-a"), record: { name: "空白", draft: true, payload: { scenes: [] } } },
      repoDeps,
    );
    expect(created.draft).toBe(true);
    expect(created.revision).toBe(0);
    expect(readWorkspaceProject(created.id, repoDeps)?.draft).toBe(true);

    const saved = saveWorkspaceProject(created.id, { name: "空白", payload: { scenes: [{ id: "s1" }] } }, repoDeps);
    expect(saved.revision).toBe(1);
    expect(saved.draft).toBeUndefined();
    expect(readWorkspaceProject(created.id, repoDeps)?.draft).toBeUndefined();
  });

  it("recycles a native, never-edited, asset-free draft", () => {
    const repoDeps = deps();
    const draft = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "blank-gc"), record: { name: "空白", draft: true } },
      repoDeps,
    );
    const dir = resolveWorkspaceProjectDir(draft.id, repoDeps);
    expect(dir).toBeTruthy();

    const result = gcEmptyDraftWorkspaceProjects(repoDeps, listWorkspaceProjects(repoDeps));
    expect(result.recycled).toContain(draft.id);
    expect(fs.existsSync(dir as string)).toBe(false);
    expect(listWorkspaceProjects(repoDeps).some((p) => p.id === draft.id)).toBe(false);
  });

  it("keeps drafts that have user assets on disk (defense in depth)", () => {
    const repoDeps = deps();
    const draft = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "blank-with-asset"), record: { name: "空白", draft: true } },
      repoDeps,
    );
    writeAsset(resolveWorkspaceProjectDir(draft.id, repoDeps) as string);

    const result = gcEmptyDraftWorkspaceProjects(repoDeps, listWorkspaceProjects(repoDeps));
    expect(result.recycled).not.toContain(draft.id);
    expect(readWorkspaceProject(draft.id, repoDeps)).not.toBeNull();
  });

  it("keeps edited drafts (revision > 0)", () => {
    const repoDeps = deps();
    const draft = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "blank-edited"), record: { name: "空白", draft: true } },
      repoDeps,
    );
    saveWorkspaceProject(draft.id, { name: "已编辑", payload: { scenes: [{ id: "s1" }] } }, repoDeps);

    const result = gcEmptyDraftWorkspaceProjects(repoDeps, listWorkspaceProjects(repoDeps));
    expect(result.recycled).not.toContain(draft.id);
    expect(readWorkspaceProject(draft.id, repoDeps)).not.toBeNull();
  });

  it("never touches non-draft native projects", () => {
    const repoDeps = deps();
    const normal = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "normal"), record: { name: "普通" } },
      repoDeps,
    );
    const result = gcEmptyDraftWorkspaceProjects(repoDeps, listWorkspaceProjects(repoDeps));
    expect(result.recycled).not.toContain(normal.id);
    expect(readWorkspaceProject(normal.id, repoDeps)).not.toBeNull();
  });

  it("never deletes an external folder draft — only the registry binding could change, files stay", () => {
    const repoDeps = deps();
    const externalRoot = makeTempDir("nomi-external-folder-"); // 不在默认根下 = folder
    const draft = createWorkspaceProject({ rootPath: externalRoot, record: { name: "外部", draft: true } }, repoDeps);
    const result = gcEmptyDraftWorkspaceProjects(repoDeps, listWorkspaceProjects(repoDeps));
    expect(result.recycled).not.toContain(draft.id);
    expect(fs.existsSync(workspaceProjectFile(externalRoot))).toBe(true);
  });
});
