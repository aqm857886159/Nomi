import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertProjectExportRelativePath,
  createExportTempDir,
  createSafeOutputPaths,
  ensureExportDirs,
} from "./exportPaths";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-paths-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("ensureExportDirs", () => {
  it("creates and returns the project exports and .nomi/jobs directories", () => {
    const projectDir = makeTempDir();

    const dirs = ensureExportDirs(projectDir);

    expect(dirs).toEqual({
      exportsDir: path.join(projectDir, "exports"),
      cacheDir: path.join(projectDir, ".nomi", "jobs"),
    });
    expect(fs.statSync(dirs.exportsDir).isDirectory()).toBe(true);
    expect(fs.statSync(dirs.cacheDir).isDirectory()).toBe(true);
  });
});

describe("createExportTempDir", () => {
  it("creates temp directories under .nomi/jobs/jobId", () => {
    const projectDir = makeTempDir();

    const tempDir = createExportTempDir(projectDir, "job-123");

    expect(tempDir).toBe(path.join(projectDir, ".nomi", "jobs", "job-123"));
    expect(fs.statSync(tempDir).isDirectory()).toBe(true);
  });
});

describe("createSafeOutputPaths", () => {
  it("creates sanitized unique final and partial mp4 paths inside exports", () => {
    const projectDir = makeTempDir();

    const paths = createSafeOutputPaths({ projectDir, outputName: " My Export!.mp4 ", extension: "mp4" });

    expect(paths.relativeFinalPath).toMatch(/^exports\/My-Export-\d{12}\.mp4$/);
    expect(paths.finalPath).toBe(path.join(projectDir, paths.relativeFinalPath));
    expect(paths.partialPath).toBe(paths.finalPath.replace(/\.mp4$/, ".partial.mp4"));
    expect(path.dirname(paths.finalPath)).toBe(path.join(projectDir, "exports"));
  });

  it("uses webm extension for webm final and partial paths", () => {
    const projectDir = makeTempDir();

    const paths = createSafeOutputPaths({ projectDir, outputName: "clip/webm", extension: "webm" });

    expect(paths.relativeFinalPath).toMatch(/^exports\/clip-webm-\d{12}\.webm$/);
    expect(paths.partialPath).toBe(paths.finalPath.replace(/\.webm$/, ".partial.webm"));
  });

  it("does not allow an existing final output path collision", () => {
    const projectDir = makeTempDir();
    const first = createSafeOutputPaths({ projectDir, outputName: "same", extension: "mp4" });
    fs.writeFileSync(first.finalPath, "existing");

    const second = createSafeOutputPaths({ projectDir, outputName: "same", extension: "mp4" });

    expect(second.finalPath).not.toBe(first.finalPath);
    expect(second.relativeFinalPath).toMatch(/^exports\/same-\d{12}-2\.mp4$/);
  });
});

describe("assertProjectExportRelativePath", () => {
  it("accepts and normalizes exports-relative paths", () => {
    expect(assertProjectExportRelativePath("exports\\nested\\video.mp4")).toBe("exports/nested/video.mp4");
  });

  it("rejects traversal, absolute paths, and non-export paths", () => {
    expect(() => assertProjectExportRelativePath("exports/../secret.mp4")).toThrow(/exports/);
    expect(() => assertProjectExportRelativePath("/tmp/secret.mp4")).toThrow(/exports/);
    expect(() => assertProjectExportRelativePath("assets/video.mp4")).toThrow(/exports/);
  });
});
