import fs from "node:fs";
import path from "node:path";
import {
  ensureWorkspaceFolders,
  hasWorkspaceManifest,
  readProjectJsonFileWithEmbeddedMediaSlimming,
  readProjectJsonTopLevelFields,
  readWorkspaceManifestSnapshot,
  readWorkspaceManifestSummary,
  withWorkspaceManifestMutationSync,
} from "./workspaceManifest";
import { listRegisteredRootPaths } from "./workspaceRegistry";
import { workspaceNomiDir } from "./workspacePaths";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

const LEGACY_PROJECT_FILE = "project.json";
const REMOVED_FROM_LIBRARY_MARKER = "removed-from-library";

type LegacyProjectRecord = Record<string, unknown>;

function legacyProjectFile(rootPath: string): string {
  return path.join(path.resolve(rootPath), LEGACY_PROJECT_FILE);
}

export function readLegacyProject(rootPath: string): LegacyProjectRecord | null {
  const filePath = legacyProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = readProjectJsonFileWithEmbeddedMediaSlimming(rootPath, filePath);
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as LegacyProjectRecord) : null;
  } catch {
    return null;
  }
}

function removedFromLibraryMarkerPath(rootPath: string): string {
  return path.join(workspaceNomiDir(rootPath), REMOVED_FROM_LIBRARY_MARKER);
}

export function isLegacyProjectSuppressed(rootPath: string): boolean {
  try {
    return fs.existsSync(removedFromLibraryMarkerPath(rootPath));
  } catch {
    return false;
  }
}

export function suppressLegacyProjectRediscovery(rootPath: string): void {
  ensureWorkspaceFolders(rootPath);
  fs.writeFileSync(removedFromLibraryMarkerPath(rootPath), `${Date.now()}\n`, "utf8");
}

function stringOrFallback(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toWorkspaceRecord(rootPath: string, raw: LegacyProjectRecord): WorkspaceProjectRecordV2 {
  const now = Date.now();
  return normalizeWorkspaceProjectRecord({
    id: stringOrFallback(raw.id, `workspace-${now}`),
    name: stringOrFallback(raw.name, path.basename(path.resolve(rootPath)) || "Untitled Project"),
    version: 2,
    createdAt: numberOrFallback(raw.createdAt, now),
    updatedAt: numberOrFallback(raw.updatedAt, now),
    savedAt: numberOrFallback(raw.savedAt, numberOrFallback(raw.updatedAt, now)),
    revision: numberOrFallback(raw.revision, 0),
    lastKnownRootPath: path.resolve(rootPath),
    payload: raw.payload,
  });
}

export function readLegacyProjectSummary(rootPath: string): Omit<WorkspaceProjectRecordV2, "payload"> | null {
  const filePath = legacyProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const fields = readProjectJsonTopLevelFields(filePath, {
      keys: ["id", "name", "createdAt", "updatedAt", "savedAt", "revision"],
      stopBeforeKeys: ["payload"],
    });
    if (!fields) {
      return null;
    }
    const { payload: _payload, ...summary } = toWorkspaceRecord(rootPath, fields);
    return summary;
  } catch {
    return null;
  }
}

export function migrateLegacyProjectFolder(rootPath: string): WorkspaceProjectRecordV2 | null {
  if (isLegacyProjectSuppressed(rootPath)) {
    return null;
  }
  const initialLegacyPath = legacyProjectFile(rootPath);
  if (!fs.existsSync(initialLegacyPath) && !hasWorkspaceManifest(rootPath)) {
    return null;
  }

  ensureWorkspaceFolders(rootPath);
  try {
    return withWorkspaceManifestMutationSync(rootPath, (context) => {
      if (context.current) return context.current;
      const canonicalLegacyPath = legacyProjectFile(context.canonicalRootPath);
      if (!fs.existsSync(canonicalLegacyPath)) return null;
      const raw = context.readProjectJsonWithEmbeddedMediaSlimming(canonicalLegacyPath);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return context.replace(toWorkspaceRecord(rootPath, raw as LegacyProjectRecord));
    });
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export type LegacyDiscoveryOptions = {
  /**
   * 设置根：用它读出 registry 已知的 rootPath 集合，做增量对账。
   * 省略时退化为「registry 全空」= 全盘发现（仅用于没有 registry 语境的直接调用/测试）。
   */
  settingsRoot?: string;
};

/**
 * 发现阶段的清单读取（性能根因边界二）：先走无锁快照读，只有它返回 null 才回落到带写事务
 * 锁的读取器。实测同一批 346 个项目：快照 0.7ms/项目 vs 加锁读 29.5ms/项目（45 倍）。
 *
 * 回落条件由 `readWorkspaceManifestSnapshot` 自己把关（backup 身份冲突、data: URL 需要
 * slimming、partial identity 都会返回 null）——那些安全检查一条都没削弱，只是把「快照够用」
 * 的绝大多数项目从锁路径上摘下来。
 */
function readDiscoveredManifestSummary(projectRoot: string): Omit<WorkspaceProjectRecordV2, "payload"> | null {
  const snapshot = readWorkspaceManifestSnapshot(projectRoot);
  if (snapshot) {
    const { payload: _payload, ...summary } = snapshot;
    return summary;
  }
  return readWorkspaceManifestSummary(projectRoot);
}

/**
 * 发现 = 对 registry 缺失项的增量对账（性能根因边界一）。
 *
 * 不变量：**发现阶段只触碰 registry 里还没有的项目**。已注册目录在任何 manifest 读之前
 * 就被跳过 → 读次数 0、注册次数 0。成本正比于「新增项目数」而不是「磁盘项目数」。
 */
export function discoverLegacyProjects(
  defaultProjectsRoot: string,
  options: LegacyDiscoveryOptions = {},
): WorkspaceProjectRecordV2[] {
  const root = path.resolve(defaultProjectsRoot);
  if (!fs.existsSync(root)) {
    return [];
  }

  // 先拿已知集合（一次 registry 读），再扫目录：任何 manifest 读之前就完成对账。
  const known = options.settingsRoot ? listRegisteredRootPaths(options.settingsRoot) : new Set<string>();

  const projects: WorkspaceProjectRecordV2[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const projectRoot = path.join(root, entry.name);
    if (isRegisteredRoot(known, projectRoot)) continue;
    if (isLegacyProjectSuppressed(projectRoot)) continue;
    if (hasWorkspaceManifest(projectRoot)) {
      const manifest = readDiscoveredManifestSummary(projectRoot);
      if (manifest) {
        projects.push({ ...manifest, lastKnownRootPath: path.resolve(projectRoot) });
      }
      continue;
    }
    const summary = readLegacyProjectSummary(projectRoot);
    if (summary) {
      projects.push(summary);
    }
  }
  return projects;
}

/** 路径归一化比较：registry 存 `path.resolve` 版本，扫盘目录可能经符号链接（macOS /tmp）。 */
function isRegisteredRoot(known: Set<string>, projectRoot: string): boolean {
  if (!known.size) return false;
  if (known.has(path.resolve(projectRoot))) return true;
  try {
    return known.has(fs.realpathSync(projectRoot));
  } catch {
    return false;
  }
}

// 进程内一次性 guard：同一进程内每个 defaultProjectsRoot 只在首次列举真正扫盘，之后返回
// 空数组，避免同一次运行里反复扫盘。需要在新建/打开文件夹等可能改变磁盘项目集合时显式重新
// 发现，调用 resetLegacyDiscoveryGuard()。
//
// 它**不**负责首次列举本身的成本——那由 discoverLegacyProjects 的 registry 增量对账负责
// （只触碰未注册目录 + 无锁快照读）。2026-06-14 的 4acbcd3d 只装了这个 guard 就宣称
// 「列举只走 registry」，结果每次冷启动的首次列举仍然 O(磁盘项目数) 全量重读重注册
// （346 项目 = 9.1s 冻屏）。两层缺一不可，别再把 guard 当成完整答案。
const discoveredRoots = new Set<string>();

/**
 * 一次性发现：每个默认根每进程只真正扫盘一次；后续调用返回空（不重复 O(N) fs 读+重注册）。
 *
 * 注意这个 guard 只管「同一进程内重复列举」。**每次启动的首次列举**的成本由
 * `discoverLegacyProjects` 的 registry 增量对账负责压到 O(新增项目数)——两者是不同层面的
 * 保护，缺了后者时 guard 挡不住「每次冷启动把全库重读重注册一遍」（2026-09-03 性能根因）。
 */
export function discoverLegacyProjectsOnce(
  defaultProjectsRoot: string,
  options: LegacyDiscoveryOptions = {},
): WorkspaceProjectRecordV2[] {
  const root = path.resolve(defaultProjectsRoot);
  if (discoveredRoots.has(root)) {
    return [];
  }
  discoveredRoots.add(root);
  return discoverLegacyProjects(root, options);
}

/** 显式同步入口：清掉一次性 guard，让下一次 discoverLegacyProjectsOnce 重新扫盘（首次启动/显式刷新/新建后）。 */
export function resetLegacyDiscoveryGuard(): void {
  discoveredRoots.clear();
}
