import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canCreateSymlink } from "../testSupport/canCreateSymlink";
import { listWorkspaceFiles, resolveWorkspaceFilePath } from "./workspaceFileIndex";

const tempRoots: string[] = [];
const canCreateDirSymlink = canCreateSymlink("dir");

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-workspace-file-index-test-"));
  tempRoots.push(dir);
  return dir;
}

function write(root: string, relativePath: string, content = "x"): void {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

describe("workspace file index", () => {
  it("classifies text image video and returns forward slash relative paths", () => {
    const root = makeTempDir();
    write(root, "notes/readme.md", "hello");
    write(root, "assets/generated/2026-05-31/image.png", "png");
    write(root, "exports/movie.mp4", "mp4");

    const tree = listWorkspaceFiles({ rootPath: root }).items;
    const notes = tree.find((node) => node.relativePath === "notes");
    const assets = tree.find((node) => node.relativePath === "assets");
    const exportsNode = tree.find((node) => node.relativePath === "exports");

    expect(notes?.kind).toBe("directory");
    expect(notes?.children?.[0]).toMatchObject({ name: "readme.md", relativePath: "notes/readme.md", kind: "text", contentType: "text/markdown" });
    expect(assets?.children?.[0].children?.[0].children?.[0]).toMatchObject({ name: "image.png", relativePath: "assets/generated/2026-05-31/image.png", kind: "image", contentType: "image/png" });
    expect(exportsNode?.children?.[0]).toMatchObject({ name: "movie.mp4", relativePath: "exports/movie.mp4", kind: "video", contentType: "video/mp4" });
  });

  it("skips .git node_modules .nomi/cache and hidden folders by default", () => {
    const root = makeTempDir();
    write(root, ".git/config");
    write(root, "node_modules/pkg/index.js");
    write(root, ".nomi/cache/blob.bin");
    write(root, ".hidden/file.txt");
    write(root, "visible.txt");

    const tree = listWorkspaceFiles({ rootPath: root }).items;

    expect(tree.map((node) => node.relativePath)).toEqual(["visible.txt"]);
  });

  (canCreateDirSymlink ? it : it.skip)("does not follow symlinks outside workspace by default", () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    write(outside, "secret.txt", "secret");
    fs.symlinkSync(outside, path.join(root, "linked"));

    expect(listWorkspaceFiles({ rootPath: root }).items).toEqual([]);
  });

  it("limits large directory scans and reports truncated", () => {
    const root = makeTempDir();
    write(root, "a.txt");
    write(root, "b.txt");
    write(root, "c.txt");

    const result = listWorkspaceFiles({ rootPath: root, maxFiles: 2 });

    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(2);
  });

  const canTestUnreadable = process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() !== 0;
  (canTestUnreadable ? it : it.skip)("skips unreadable subdirectories instead of failing the whole listing", () => {
    const root = makeTempDir();
    write(root, "visible.txt");
    write(root, "locked/secret.txt", "secret");
    const lockedDir = path.join(root, "locked");
    fs.chmodSync(lockedDir, 0o000);
    try {
      const tree = listWorkspaceFiles({ rootPath: root }).items;
      const locked = tree.find((node) => node.relativePath === "locked");
      expect(tree.find((node) => node.relativePath === "visible.txt")).toBeTruthy();
      // The protected directory itself still appears, but its unreadable contents are skipped.
      expect(locked?.children).toEqual([]);
    } finally {
      fs.chmodSync(lockedDir, 0o755);
    }
  });

  (canCreateDirSymlink ? it : it.skip)("rejects reveal paths that are absolute malformed traversal or symlink escapes", () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    write(root, "safe/file.txt");
    write(outside, "secret.txt", "secret");
    fs.symlinkSync(outside, path.join(root, "linked"));

    expect(resolveWorkspaceFilePath(root, "safe/file.txt")).toBe(path.join(root, "safe", "file.txt"));
    expect(() => resolveWorkspaceFilePath(root, "../secret.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "/tmp/secret.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "C:/secret.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "//server/share.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "safe/./file.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "safe//file.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "safe/\0file.txt")).toThrow(/relativePath/);
    expect(() => resolveWorkspaceFilePath(root, "linked/secret.txt")).toThrow(/escapes/);
  });
});
