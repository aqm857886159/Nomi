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
  writeWorkspaceManifest,
} from "./workspaceManifest";
import { workspaceProjectFile } from "./workspacePaths";
import type { WorkspaceProjectRecordV2 } from "./workspaceTypes";

const tempRoots: string[] = [];
const canCreateDirSymlink = canCreateSymlink("dir");
const canCreateFileSymlink = canCreateSymlink("file");

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
    expect(raw.rootPath).toBeUndefined();
    expect(hasWorkspaceManifest(root)).toBe(true);
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

  it("creates workspace assets and exports directories", () => {
    const root = makeTempDir();

    ensureWorkspaceFolders(root);

    expect(fs.statSync(path.join(root, ".nomi")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "assets", "generated", "2026-05-31")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "assets", "imported", "2026-05-31")).isDirectory()).toBe(true);
    expect(fs.statSync(path.join(root, "exports")).isDirectory()).toBe(true);
  });

  (canCreateDirSymlink ? it : it.skip)("rejects pre-existing managed directory symlinks that point outside the workspace", () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    fs.symlinkSync(outside, path.join(root, ".nomi"), "dir");

    expect(() => ensureWorkspaceFolders(root)).toThrow(/workspace/i);
    expect(() => writeWorkspaceManifest(root, makeRecord())).toThrow(/workspace/i);
  });

  (canCreateFileSymlink ? it : it.skip)("rejects project manifest file symlinks that point outside the workspace", () => {
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
  });

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
});
