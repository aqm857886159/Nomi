import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverLegacyProjects,
  discoverLegacyProjectsOnce,
  migrateLegacyProjectFolder,
  resetLegacyDiscoveryGuard,
  suppressLegacyProjectRediscovery,
} from "./legacyProjectMigration";
import { workspaceProjectFile } from "./workspacePaths";

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

function makeTempDir(name = "nomi-legacy-migration-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

function writeLegacyProject(projectRoot: string, overrides: Record<string, unknown> = {}): void {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "project.json"),
    JSON.stringify(
      {
        id: "legacy-id",
        name: "Legacy Project",
        version: 1,
        createdAt: 100,
        updatedAt: 200,
        savedAt: 300,
        revision: 2,
        payload: { old: true },
        ...overrides,
      },
      null,
      2,
    ),
  );
}

describe("migrateLegacyProjectFolder", () => {
  it("migrates legacy project.json into .nomi/project.json", () => {
    const projectRoot = makeTempDir();
    writeLegacyProject(projectRoot);

    const migrated = migrateLegacyProjectFolder(projectRoot);
    const raw = JSON.parse(fs.readFileSync(workspaceProjectFile(projectRoot), "utf8"));

    expect(migrated).toMatchObject({
      id: "legacy-id",
      name: "Legacy Project",
      version: 2,
      createdAt: 100,
      updatedAt: 200,
      savedAt: 300,
      revision: 2,
      payload: { old: true },
      lastKnownRootPath: path.resolve(projectRoot),
    });
    expect(raw.rootPath).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, "project.json"))).toBe(true);
  });

  it("does not duplicate already migrated projects", () => {
    const projectRoot = makeTempDir();
    writeLegacyProject(projectRoot, { id: "legacy-id" });
    const first = migrateLegacyProjectFolder(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "project.json"), JSON.stringify({ id: "changed", name: "Changed", version: 1 }));

    const second = migrateLegacyProjectFolder(projectRoot);

    expect(second).toEqual(first);
    expect(JSON.parse(fs.readFileSync(workspaceProjectFile(projectRoot), "utf8")).id).toBe("legacy-id");
  });

  it("keeps existing assets and exports directories", () => {
    const projectRoot = makeTempDir();
    writeLegacyProject(projectRoot);
    fs.mkdirSync(path.join(projectRoot, "assets", "custom"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "assets", "custom", "ref.png"), "png");
    fs.mkdirSync(path.join(projectRoot, "exports"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "exports", "old.mp4"), "mp4");

    migrateLegacyProjectFolder(projectRoot);

    expect(fs.existsSync(path.join(projectRoot, "assets", "custom", "ref.png"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "exports", "old.mp4"))).toBe(true);
  });
});

describe("discoverLegacyProjects", () => {
  it("reads direct child legacy project summaries without migrating payloads", () => {
    const defaultRoot = makeTempDir();
    writeLegacyProject(path.join(defaultRoot, "Old Project"), { id: "old-project" });
    fs.mkdirSync(path.join(defaultRoot, "Not Project"));

    const projects = discoverLegacyProjects(defaultRoot);

    expect(projects.map((project) => project.id)).toEqual(["old-project"]);
    expect(projects[0]).toEqual(expect.not.objectContaining({ payload: expect.anything() }));
    expect(fs.existsSync(workspaceProjectFile(path.join(defaultRoot, "Old Project")))).toBe(false);
  });

  it("does not scan huge legacy payloads while reading summaries", () => {
    const defaultRoot = makeTempDir();
    const legacyRoot = path.join(defaultRoot, "Huge Project");
    const dataUrl = `data:image/png;base64,${"a".repeat(96 * 1024)}`;
    writeLegacyProject(legacyRoot, {
      id: "huge-project",
      name: "Huge Project",
      payload: { image: dataUrl },
    });

    const projects = discoverLegacyProjects(defaultRoot);

    expect(projects).toEqual([expect.objectContaining({ id: "huge-project", name: "Huge Project" })]);
    expect(fs.existsSync(workspaceProjectFile(legacyRoot))).toBe(false);
    expect(fs.existsSync(path.join(legacyRoot, "assets", "generated"))).toBe(false);
  });

  it("skips malformed legacy project files instead of failing the whole discovery", () => {
    const defaultRoot = makeTempDir();
    writeLegacyProject(path.join(defaultRoot, "Good Project"), { id: "good-project" });
    fs.mkdirSync(path.join(defaultRoot, "Broken Project"), { recursive: true });
    fs.writeFileSync(path.join(defaultRoot, "Broken Project", "project.json"), "{bad json");

    const projects = discoverLegacyProjects(defaultRoot);

    expect(projects.map((project) => project.id)).toEqual(["good-project"]);
  });
});

describe("discoverLegacyProjectsOnce（列举热路径解耦：一次性发现 guard）", () => {
  beforeEach(() => {
    resetLegacyDiscoveryGuard();
  });

  it("第一次发现真正扫盘并返回结果，后续同根调用不再扫盘（O(N) fs 读只跑一次）", () => {
    const defaultRoot = makeTempDir();
    writeLegacyProject(path.join(defaultRoot, "Old Project"), { id: "old-project" });
    const readdirSpy = vi.spyOn(fs, "readdirSync");

    const first = discoverLegacyProjectsOnce(defaultRoot);
    const firstReaddirCalls = readdirSpy.mock.calls.length;
    const second = discoverLegacyProjectsOnce(defaultRoot);
    const secondReaddirCalls = readdirSpy.mock.calls.length;

    expect(first.map((project) => project.id)).toEqual(["old-project"]);
    expect(firstReaddirCalls).toBeGreaterThan(0);
    // 第二次调用不应再触发根目录扫描（解耦后列举不再每次 O(N) fs 读）。
    expect(second).toEqual([]);
    expect(secondReaddirCalls).toBe(firstReaddirCalls);
    readdirSpy.mockRestore();
  });

  it("已 suppress（removed-from-library）的项目不会被一次性发现复活", () => {
    const defaultRoot = makeTempDir();
    const projectRoot = path.join(defaultRoot, "Suppressed Project");
    writeLegacyProject(projectRoot, { id: "suppressed-id" });
    // 用户把它从库里移除：写抑制标记，且把它迁成 workspace（顶层 json 仍在）。
    suppressLegacyProjectRediscovery(projectRoot);

    const discovered = discoverLegacyProjectsOnce(defaultRoot);

    expect(discovered.map((project) => project.id)).not.toContain("suppressed-id");
  });

  it("resetLegacyDiscoveryGuard 后允许显式重新发现（首次启动/显式同步）", () => {
    const defaultRoot = makeTempDir();
    writeLegacyProject(path.join(defaultRoot, "Resync Project"), { id: "resync-id" });

    expect(discoverLegacyProjectsOnce(defaultRoot).map((p) => p.id)).toEqual(["resync-id"]);
    // 不重置：同根再调返回空（已发现过）。
    expect(discoverLegacyProjectsOnce(defaultRoot)).toEqual([]);
    // 显式重置后：再次真正发现。
    resetLegacyDiscoveryGuard();
    expect(discoverLegacyProjectsOnce(defaultRoot).map((p) => p.id)).toEqual(["resync-id"]);
  });
});
