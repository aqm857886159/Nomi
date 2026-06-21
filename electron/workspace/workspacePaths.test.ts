import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canCreateSymlink } from "../testSupport/canCreateSymlink";
import {
  assertInsideWorkspace,
  resolveWorkspaceRelativePath,
  workspaceAssetsGeneratedDir,
  workspaceAssetsImportedDir,
  workspaceExportsDir,
  workspaceNomiDir,
  workspaceProjectFile,
} from "./workspacePaths";

const tempRoots: string[] = [];
const canCreateFileSymlink = canCreateSymlink("file");
const canCreateDirSymlink = canCreateSymlink("dir");

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-workspace-paths-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("resolveWorkspaceRelativePath", () => {
  it("resolves safe relative paths inside the workspace", () => {
    const root = makeTempDir();

    expect(resolveWorkspaceRelativePath(root, "assets\\generated\\image.png")).toBe(
      path.join(root, "assets", "generated", "image.png"),
    );
  });

  it("rejects traversal, absolute, Windows drive, UNC, and null-byte paths", () => {
    const root = makeTempDir();

    expect(() => resolveWorkspaceRelativePath(root, "../outside.png")).toThrow(/workspace/i);
    expect(() => resolveWorkspaceRelativePath(root, "/tmp/outside.png")).toThrow(/workspace/i);
    expect(() => resolveWorkspaceRelativePath(root, "C:/Users/me/outside.png")).toThrow(/workspace/i);
    expect(() => resolveWorkspaceRelativePath(root, "//server/share/outside.png")).toThrow(/workspace/i);
    expect(() => resolveWorkspaceRelativePath(root, "assets/\0evil.png")).toThrow(/workspace/i);
  });

  (canCreateFileSymlink ? it : it.skip)("rejects symlinks that escape the workspace", () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    const outsideFile = path.join(outside, "secret.txt");
    fs.writeFileSync(outsideFile, "secret");
    fs.symlinkSync(outsideFile, path.join(root, "linked-secret.txt"));

    expect(() => resolveWorkspaceRelativePath(root, "linked-secret.txt")).toThrow(/workspace/i);
  });

  (canCreateDirSymlink ? it : it.skip)("rejects symlinked parent directories even when the final child does not exist yet", () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    fs.symlinkSync(outside, path.join(root, "linked-outside-dir"), "dir");

    expect(() => resolveWorkspaceRelativePath(root, "linked-outside-dir/new-image.png")).toThrow(/workspace/i);
  });
});

describe("assertInsideWorkspace", () => {
  it("accepts paths under the workspace root", () => {
    const root = makeTempDir();
    const file = path.join(root, "assets", "generated", "image.png");

    expect(assertInsideWorkspace(root, file)).toBe(path.resolve(file));
  });

  it("rejects sibling paths that only share a prefix", () => {
    const root = makeTempDir();
    const sibling = `${root}-sibling/file.png`;

    expect(() => assertInsideWorkspace(root, sibling)).toThrow(/workspace/i);
  });
});

describe("workspace directory helpers", () => {
  it("returns canonical workspace metadata and output directories", () => {
    const root = makeTempDir();

    expect(workspaceNomiDir(root)).toBe(path.join(root, ".nomi"));
    expect(workspaceProjectFile(root)).toBe(path.join(root, ".nomi", "project.json"));
    expect(workspaceAssetsGeneratedDir(root, new Date("2026-05-31T12:00:00Z"))).toBe(
      path.join(root, "assets", "generated", "2026-05-31"),
    );
    expect(workspaceAssetsImportedDir(root, new Date("2026-05-31T12:00:00Z"))).toBe(
      path.join(root, "assets", "imported", "2026-05-31"),
    );
    expect(workspaceExportsDir(root)).toBe(path.join(root, "exports"));
  });
});
