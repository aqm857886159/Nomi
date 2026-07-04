import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWorkspaceProject,
  gcEmptyDraftWorkspaceProjects,
  listWorkspaceProjects,
  readWorkspaceProject,
  removeWorkspaceProjectReference,
  resolveWorkspaceProjectDir,
  saveWorkspaceProject,
  type WorkspaceRepositoryDeps,
} from "./workspaceRepository";
import { workspaceProjectFile } from "./workspacePaths";
import { recentWorkspacesPath } from "./workspaceRegistry";

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
      expect.objectContaining({ id: created.id, name: "Missing Folder", missing: true, rootPath: path.resolve(selectedRoot) }),
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
    expect(projects.find((project) => project.id === broken.id)).toMatchObject({
      id: broken.id,
      missing: true,
    });
    expect(readWorkspaceProject(healthy.id, repoDeps)).toMatchObject({ id: healthy.id });
    expect(readWorkspaceProject(broken.id, repoDeps)).toBeNull();
    warnSpy.mockRestore();
  });

  it("returns null for stale registry entries whose manifest id does not match", () => {
    const staleRoot = makeTempDir();
    const actualRoot = makeTempDir();
    const repoDeps = deps();
    const stale = createWorkspaceProject(
      { rootPath: staleRoot, record: { name: "Stale", payload: {} } },
      repoDeps,
    );
    const actual = createWorkspaceProject(
      { rootPath: actualRoot, record: { name: "Actual", payload: {} } },
      repoDeps,
    );
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

    const result = gcEmptyDraftWorkspaceProjects(repoDeps);
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

    const result = gcEmptyDraftWorkspaceProjects(repoDeps);
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

    const result = gcEmptyDraftWorkspaceProjects(repoDeps);
    expect(result.recycled).not.toContain(draft.id);
    expect(readWorkspaceProject(draft.id, repoDeps)).not.toBeNull();
  });

  it("never touches non-draft native projects", () => {
    const repoDeps = deps();
    const normal = createWorkspaceProject(
      { rootPath: nativeRoot(repoDeps, "normal"), record: { name: "普通" } },
      repoDeps,
    );
    const result = gcEmptyDraftWorkspaceProjects(repoDeps);
    expect(result.recycled).not.toContain(normal.id);
    expect(readWorkspaceProject(normal.id, repoDeps)).not.toBeNull();
  });

  it("never deletes an external folder draft — only the registry binding could change, files stay", () => {
    const repoDeps = deps();
    const externalRoot = makeTempDir("nomi-external-folder-"); // 不在默认根下 = folder
    const draft = createWorkspaceProject(
      { rootPath: externalRoot, record: { name: "外部", draft: true } },
      repoDeps,
    );
    const result = gcEmptyDraftWorkspaceProjects(repoDeps);
    expect(result.recycled).not.toContain(draft.id);
    expect(fs.existsSync(workspaceProjectFile(externalRoot))).toBe(true);
  });
});
