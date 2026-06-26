import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findRecentWorkspace,
  listRecentWorkspaces,
  recentWorkspacesPath,
  rememberWorkspace,
  removeWorkspaceReference,
} from "./workspaceRegistry";
import type { WorkspaceProjectRecordV2 } from "./workspaceTypes";

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

function record(id: string, rootPath: string, name = id): WorkspaceProjectRecordV2 {
  return {
    id,
    name,
    version: 2,
    createdAt: 100,
    updatedAt: 200,
    savedAt: 300,
    revision: 0,
    lastKnownRootPath: rootPath,
  };
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
    rememberWorkspace(settingsRoot, record("project-1", firstRoot, "First"));
    vi.setSystemTime(new Date("2026-05-31T12:05:00Z"));
    const entries = rememberWorkspace(settingsRoot, record("project-2", secondRoot, "Second"));

    expect(entries.map((entry) => entry.id)).toEqual(["project-2", "project-1"]);
    expect(entries[0]).toMatchObject({
      id: "project-2",
      name: "Second",
      rootPath: path.resolve(secondRoot),
      missing: false,
      lastOpenedAt: Date.parse("2026-05-31T12:05:00Z"),
    });
  });

  it("dedupes by project id and updates the remembered root path", () => {
    const settingsRoot = makeTempDir();
    const oldRoot = makeTempDir();
    const newRoot = makeTempDir();

    rememberWorkspace(settingsRoot, record("project-1", oldRoot, "Old Name"));
    vi.setSystemTime(new Date("2026-05-31T12:10:00Z"));
    const entries = rememberWorkspace(settingsRoot, record("project-1", newRoot, "New Name"));

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "project-1",
      name: "New Name",
      rootPath: path.resolve(newRoot),
      lastOpenedAt: Date.parse("2026-05-31T12:10:00Z"),
      missing: false,
    });
  });

  it("marks missing root paths without deleting entries", () => {
    const settingsRoot = makeTempDir();
    const workspaceRoot = makeTempDir();
    rememberWorkspace(settingsRoot, record("project-1", workspaceRoot, "Missing Soon"));
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
    rememberWorkspace(settingsRoot, record("project-1", workspaceRoot, "Keep Folder"));

    const entries = removeWorkspaceReference(settingsRoot, "project-1");

    expect(entries).toEqual([]);
    expect(fs.existsSync(path.join(workspaceRoot, "script.md"))).toBe(true);
  });

  it("rejects records without a current root path for the local registry", () => {
    const settingsRoot = makeTempDir();
    const noRoot = { ...record("project-1", makeTempDir()), lastKnownRootPath: undefined };

    expect(() => rememberWorkspace(settingsRoot, noRoot)).toThrow(/rootPath/i);
  });
});
