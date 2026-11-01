import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  backfillWorkspaceOrigins,
  findRecentWorkspace,
  listRecentWorkspaces,
  recentWorkspacesPath,
  bindWorkspaceLocation,
  bindWorkspaceLocations,
  removeWorkspaceReference,
  type WorkspaceLocationBinding,
} from "./workspaceRegistry";
import { workspaceFolderCopy } from "../shared/contracts/projectLocation";

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

function makeTempDir(name = "nomi-workspace-registry-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function binding(id: string, rootPath: string, name = id): WorkspaceLocationBinding {
  return { id, name, rootPath };
}

/** 让 rootPath 成为一个装着 id 的项目文件夹（只写登记判定要读的 .nomi/project.json 的 id）。 */
function holdProject(rootPath: string, id: string): void {
  fs.mkdirSync(path.join(rootPath, ".nomi"), { recursive: true });
  fs.writeFileSync(path.join(rootPath, ".nomi", "project.json"), JSON.stringify({ id, name: id, version: 2 }));
}

describe("recentWorkspacesPath", () => {
  it("stores the registry under the settings root", () => {
    const settingsRoot = makeTempDir();

    expect(recentWorkspacesPath(settingsRoot)).toBe(path.join(settingsRoot, "recent-workspaces.json"));
  });
});

describe("workspace registry", () => {
  it("stores recent workspaces sorted by lastOpenedAt descending", () => {
    const settingsRoot = makeTempDir();
    const firstRoot = makeTempDir();
    const secondRoot = makeTempDir();

    vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
    bindWorkspaceLocation(settingsRoot, binding("project-1", firstRoot, "First"));
    vi.setSystemTime(new Date("2026-05-31T12:05:00Z"));
    const entries = bindWorkspaceLocation(settingsRoot, binding("project-2", secondRoot, "Second"));

    expect(entries.map((entry) => entry.id)).toEqual(["project-2", "project-1"]);
    expect(entries[0]).toMatchObject({
      id: "project-2",
      name: "Second",
      rootPath: path.resolve(secondRoot),
      missing: false,
      lastOpenedAt: Date.parse("2026-05-31T12:05:00Z"),
    });
  });

  it("dedupes by project id and rebinds to the folder the caller names when the old one does not hold the id", () => {
    const settingsRoot = makeTempDir();
    const oldRoot = makeTempDir();
    const newRoot = makeTempDir();

    bindWorkspaceLocation(settingsRoot, binding("project-1", oldRoot, "Old Name"));
    vi.setSystemTime(new Date("2026-05-31T12:10:00Z"));
    const entries = bindWorkspaceLocation(settingsRoot, binding("project-1", newRoot, "New Name"));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "project-1",
      name: "New Name",
      rootPath: path.resolve(newRoot),
      lastOpenedAt: Date.parse("2026-05-31T12:10:00Z"),
      missing: false,
    });
  });

  it("persists a project's creation origin across later saves", () => {
    const settingsRoot = makeTempDir();
    const nativeRoot = makeTempDir();
    const projectRoot = path.join(nativeRoot, "project-1");
    fs.mkdirSync(projectRoot);

    bindWorkspaceLocation(settingsRoot, { ...binding("project-1", projectRoot), origin: { source: "native", nativeRootPath: nativeRoot } });
    bindWorkspaceLocation(settingsRoot, binding("project-1", projectRoot, "Saved Again"));

    expect(findRecentWorkspace(settingsRoot, "project-1")).toMatchObject({
      source: "native",
      nativeRootPath: path.resolve(nativeRoot),
    });
  });

  it("backfills legacy entries once from the old default root", () => {
    const settingsRoot = makeTempDir();
    const oldDefaultRoot = makeTempDir();
    const nativeProjectRoot = path.join(oldDefaultRoot, "native-project");
    const externalProjectRoot = makeTempDir();
    fs.mkdirSync(nativeProjectRoot);
    bindWorkspaceLocation(settingsRoot, binding("native", nativeProjectRoot));
    bindWorkspaceLocation(settingsRoot, binding("external", externalProjectRoot));

    backfillWorkspaceOrigins(settingsRoot, oldDefaultRoot);

    expect(findRecentWorkspace(settingsRoot, "native")).toMatchObject({
      source: "native",
      nativeRootPath: path.resolve(oldDefaultRoot),
    });
    expect(findRecentWorkspace(settingsRoot, "external")).toMatchObject({ source: "folder" });
  });

  it("marks missing root paths without deleting entries", () => {
    const settingsRoot = makeTempDir();
    const workspaceRoot = makeTempDir();
    bindWorkspaceLocation(settingsRoot, binding("project-1", workspaceRoot, "Missing Soon"));
    fs.rmSync(workspaceRoot, { recursive: true, force: true });

    const entries = listRecentWorkspaces(settingsRoot);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "project-1", missing: true });
  });

  it("finds a recent workspace without checking unrelated root paths", () => {
    const settingsRoot = makeTempDir();
    const targetRoot = makeTempDir();
    const slowRoot = path.join(settingsRoot, "offline-drive", "slow-workspace");
    const registryPath = recentWorkspacesPath(settingsRoot);
    fs.writeFileSync(
      registryPath,
      JSON.stringify([
        {
          id: "slow-project",
          name: "Slow Project",
          rootPath: slowRoot,
          lastOpenedAt: 2,
        },
        {
          id: "target-project",
          name: "Target Project",
          rootPath: targetRoot,
          lastOpenedAt: 1,
        },
      ]),
    );
    const existsSpy = vi.spyOn(fs, "existsSync");

    const entry = findRecentWorkspace(settingsRoot, "target-project");

    expect(entry).toMatchObject({
      id: "target-project",
      rootPath: path.resolve(targetRoot),
      missing: false,
    });
    expect(existsSpy).toHaveBeenCalledWith(registryPath);
    expect(existsSpy).toHaveBeenCalledWith(path.resolve(targetRoot));
    expect(existsSpy).not.toHaveBeenCalledWith(path.resolve(slowRoot));
    existsSpy.mockRestore();
  });

  it("removes a workspace reference without deleting the folder", () => {
    const settingsRoot = makeTempDir();
    const workspaceRoot = makeTempDir();
    fs.writeFileSync(path.join(workspaceRoot, "script.md"), "hello");
    bindWorkspaceLocation(settingsRoot, binding("project-1", workspaceRoot, "Keep Folder"));

    const entries = removeWorkspaceReference(settingsRoot, "project-1");

    expect(entries).toEqual([]);
    expect(fs.existsSync(path.join(workspaceRoot, "script.md"))).toBe(true);
  });

  it("rejects bindings without an explicit rootPath (the registry never copies a manifest's lastKnownRootPath)", () => {
    const settingsRoot = makeTempDir();

    expect(() => bindWorkspaceLocation(settingsRoot, binding("project-1", ""))).toThrow(/rootPath/i);
    expect(() => bindWorkspaceLocations(settingsRoot, [binding("project-1", "  ")])).toThrow(/rootPath/i);
    expect(listRecentWorkspaces(settingsRoot)).toEqual([]);
  });

  it("refuses to rebind an id whose registered folder still holds it (a copy), in single and batch form", () => {
    const settingsRoot = makeTempDir();
    const original = makeTempDir();
    const copy = makeTempDir();
    holdProject(original, "project-1");
    holdProject(copy, "project-1");
    bindWorkspaceLocation(settingsRoot, binding("project-1", original, "原片"));
    const before = fs.readFileSync(recentWorkspacesPath(settingsRoot), "utf8");

    let thrown: unknown;
    try {
      bindWorkspaceLocation(settingsRoot, binding("project-1", copy, "原片"));
    } catch (error) {
      thrown = error;
    }
    expect(workspaceFolderCopy(thrown)).toEqual({ projectName: "原片", originalRootPath: path.resolve(original) });
    const batch = bindWorkspaceLocations(settingsRoot, [binding("project-1", copy, "原片")]);
    expect(batch.conflicts).toEqual([expect.objectContaining({ boundRootPath: path.resolve(original) })]);
    expect(fs.readFileSync(recentWorkspacesPath(settingsRoot), "utf8")).toBe(before);
  });

  it("rebinds once the registered folder is gone or no longer holds the id (rename / move, then reopen)", () => {
    const settingsRoot = makeTempDir();
    const original = makeTempDir();
    const renamed = `${original}-renamed`;
    holdProject(original, "project-1");
    bindWorkspaceLocation(settingsRoot, binding("project-1", original));
    fs.renameSync(original, renamed);
    tempRoots.push(renamed);

    bindWorkspaceLocation(settingsRoot, binding("project-1", renamed));
    expect(findRecentWorkspace(settingsRoot, "project-1")).toMatchObject({ rootPath: path.resolve(renamed), missing: false });
  });
});

describe("registry lock release under a transient Windows sharing violation", () => {
  it("retries removing the lock directory instead of leaving it for the next call to spin on", () => {
    const settingsRoot = makeTempDir();
    const lockDir = `${recentWorkspacesPath(settingsRoot)}.lock`;
    const realRmdir = fs.rmdirSync.bind(fs);
    let failures = 2;
    const rmdirSpy = vi.spyOn(fs, "rmdirSync").mockImplementation(((target: fs.PathLike, options?: fs.RmDirOptions) => {
      if (path.resolve(String(target)) === path.resolve(lockDir) && failures > 0) {
        failures -= 1;
        throw Object.assign(new Error(`EPERM: operation not permitted, rmdir '${lockDir}'`), { code: "EPERM" });
      }
      return realRmdir(target, options);
    }) as typeof fs.rmdirSync);

    bindWorkspaceLocation(settingsRoot, binding("project-1", makeTempDir()));

    expect(failures).toBe(0);
    expect(fs.existsSync(lockDir)).toBe(false);
    rmdirSpy.mockRestore();
  });
});
