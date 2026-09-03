// 类级回归（P2 性能根因 · 2026-09-03）：「发现」是对 registry 缺失项的一次性对账语义，
// 不是「每次启动把磁盘上全部项目重读一遍并全部重注册一遍」。
//
// 钉的是行为不变量（不是墙钟耗时，见 R18）：
//   ① registry 已知的项目 → 发现阶段的 manifest 读次数 = 0、registry 写次数 = 0；
//   ② registry 未知但磁盘上有的项目 → 仍被发现并注册（发现能力不许为了快被削掉）；
//   ③ 真 legacy（只有顶层 project.json、无 .nomi 清单）→ 仍能被发现。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverLegacyProjects,
  discoverLegacyProjectsOnce,
  resetLegacyDiscoveryGuard,
} from "./legacyProjectMigration";
import * as workspaceManifest from "./workspaceManifest";
import { rememberWorkspace, recentWorkspacesPath } from "./workspaceRegistry";
import { workspaceProjectFile } from "./workspacePaths";
import { normalizeWorkspaceProjectRecord } from "./workspaceTypes";

const tempRoots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  resetLegacyDiscoveryGuard();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(name = "nomi-legacy-reconcile-test-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(dir);
  return dir;
}

/** 写一个已迁移的 workspace 项目（有 .nomi/project.json 清单）。 */
function writeWorkspaceProject(projectRoot: string, id: string): void {
  fs.mkdirSync(path.join(projectRoot, ".nomi"), { recursive: true });
  fs.writeFileSync(
    workspaceProjectFile(projectRoot),
    JSON.stringify(
      normalizeWorkspaceProjectRecord({
        id,
        name: id,
        version: 2,
        createdAt: 100,
        updatedAt: 200,
        savedAt: 200,
        revision: 1,
        lastKnownRootPath: path.resolve(projectRoot),
        payload: { nodes: [] },
      }),
      null,
      2,
    ),
  );
}

/** 写一个真 legacy 项目（只有顶层 project.json，没有 .nomi 清单）。 */
function writeLegacyProject(projectRoot: string, id: string): void {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "project.json"),
    JSON.stringify({ id, name: id, version: 1, createdAt: 100, updatedAt: 200, payload: { old: true } }, null, 2),
  );
}

/** 把项目注册进 registry（模拟「上次启动已经认识它了」）。 */
function seedRegistry(settingsRoot: string, projectRoot: string, id: string): void {
  rememberWorkspace(
    settingsRoot,
    normalizeWorkspaceProjectRecord({
      id,
      name: id,
      version: 2,
      createdAt: 100,
      updatedAt: 200,
      savedAt: 200,
      revision: 1,
      lastKnownRootPath: path.resolve(projectRoot),
    }),
    { source: "native", nativeRootPath: path.resolve(path.dirname(projectRoot)) },
  );
}

describe("legacy 发现 = 对 registry 缺失项的增量对账（类级不变量）", () => {
  it("registry 已知的项目：发现阶段 0 次加锁 manifest 读、0 次 registry 写", () => {
    const settingsRoot = makeTempDir();
    const defaultRoot = makeTempDir();
    const ids = ["known-a", "known-b", "known-c"];
    for (const id of ids) {
      const projectRoot = path.join(defaultRoot, id);
      writeWorkspaceProject(projectRoot, id);
      seedRegistry(settingsRoot, projectRoot, id);
    }

    // 从这一刻起计数：发现阶段不该再碰加锁读，也不该再写 registry。
    const lockedRead = vi.spyOn(workspaceManifest, "readWorkspaceManifestSummary");
    const lockedFull = vi.spyOn(workspaceManifest, "readWorkspaceManifest");
    const registryPath = recentWorkspacesPath(settingsRoot);
    const registryBefore = fs.readFileSync(registryPath, "utf8");
    const registryMtimeBefore = fs.statSync(registryPath).mtimeMs;

    const discovered = discoverLegacyProjects(defaultRoot, { settingsRoot });

    // 全部已注册 → 无需再发现任何东西。
    expect(discovered).toEqual([]);
    // 加锁读是 29.5ms/项目 的那条路径：已注册项目一次都不该走。
    expect(lockedRead).not.toHaveBeenCalled();
    expect(lockedFull).not.toHaveBeenCalled();
    // registry 内容/落盘都不该被动过（原实现会 O(n²) 全量重写 N 次）。
    expect(fs.readFileSync(registryPath, "utf8")).toBe(registryBefore);
    expect(fs.statSync(registryPath).mtimeMs).toBe(registryMtimeBefore);
  });

  it("registry 未知但磁盘上有的 workspace 项目：仍被发现（发现能力没被削掉）", () => {
    const settingsRoot = makeTempDir();
    const defaultRoot = makeTempDir();
    const knownRoot = path.join(defaultRoot, "known");
    writeWorkspaceProject(knownRoot, "known");
    seedRegistry(settingsRoot, knownRoot, "known");
    // 这个从没进过 registry：必须被发现。
    writeWorkspaceProject(path.join(defaultRoot, "brand-new"), "brand-new");

    const discovered = discoverLegacyProjects(defaultRoot, { settingsRoot });

    expect(discovered.map((project) => project.id)).toEqual(["brand-new"]);
  });

  it("真 legacy（只有顶层 project.json）：未注册时仍能被发现并迁移", () => {
    const settingsRoot = makeTempDir();
    const defaultRoot = makeTempDir();
    writeLegacyProject(path.join(defaultRoot, "old-one"), "old-one");

    const discovered = discoverLegacyProjects(defaultRoot, { settingsRoot });

    expect(discovered.map((project) => project.id)).toEqual(["old-one"]);
  });

  it("已注册项目走无锁快照读，不走写事务读（读取器选择的不变量）", () => {
    const settingsRoot = makeTempDir();
    const defaultRoot = makeTempDir();
    // 未注册 → 会被读，但必须优先走无锁快照。
    writeWorkspaceProject(path.join(defaultRoot, "unregistered"), "unregistered");

    const snapshot = vi.spyOn(workspaceManifest, "readWorkspaceManifestSnapshot");
    const lockedRead = vi.spyOn(workspaceManifest, "readWorkspaceManifestSummary");

    const discovered = discoverLegacyProjects(defaultRoot, { settingsRoot });

    expect(discovered.map((project) => project.id)).toEqual(["unregistered"]);
    expect(snapshot).toHaveBeenCalled();
    // 快照成功时不该回落到加锁读。
    expect(lockedRead).not.toHaveBeenCalled();
  });

  it("discoverLegacyProjectsOnce 同样按 registry 增量对账（列举入口不绕过边界）", () => {
    const settingsRoot = makeTempDir();
    const defaultRoot = makeTempDir();
    const projectRoot = path.join(defaultRoot, "known");
    writeWorkspaceProject(projectRoot, "known");
    seedRegistry(settingsRoot, projectRoot, "known");

    const lockedRead = vi.spyOn(workspaceManifest, "readWorkspaceManifestSummary");
    const discovered = discoverLegacyProjectsOnce(defaultRoot, { settingsRoot });

    expect(discovered).toEqual([]);
    expect(lockedRead).not.toHaveBeenCalled();
  });
});
