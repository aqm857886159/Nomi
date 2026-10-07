// 技能目录的 **Nomi 投影与策略**（CJS 这一半）。
//
// 发现与解析不在这里了（2026-09-18）：那是 pi 的 `loadSourcedSkills`，住在岛上
// `electron/agentLane/laneSkillCatalog.mts`。这个文件留下的每一样都是 pi 不管的：
//   · `SkillRecord`——Nomi 投影类型，CJS 两侧（IPC / MCP / 制作 Run）都要看见它，岛只 `import type`；
//   · 根在哪（`getSkillDiscoveryRoots`）——宿主的事；
//   · 受众（`isSkillVisibleTo` / MCP 两档）、Workbench 可选性、查找 key 归一、内容寻址读取——全是策略。
//
// `readSkillRecords()` 是 **async** 的，经 `laneNativeLoader.cts` 那座桥到岛上（pi 是 ESM-only，主进程只能
// 动态 `import()` 摸到它）。每次调用都重扫盘：目录没有快照，「刚导入的技能」下一次读就在。
// 吃 `records` 的函数一律显式收参数，不再默认偷偷读盘——谁要新鲜数据谁 `await readSkillRecords()`。
import { director3dBoxFaceEnabled } from "../shared/featureFlags/director3dboxFace";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { SkillCuration } from "../shared/skillCuration";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { computeSkillContentHash, isSafeSkillFilePath, readSkillPackageFiles, SKILL_PACKAGE_VERSION } from "./skillPackage";
import type { SkillAudience, SkillManifest } from "./skillManifestSchema";

export type SkillRecord = {
  curation?: SkillCuration;
  name: string;
  /** 包句柄：`<dir>/SKILL.md` 的目录名，或根目录下 `<stem>.md` 技能的文件名去掉 `.md`。IPC / MCP / 查找都认它。 */
  directoryName: string;
  /** 技能文件的绝对路径（`SKILL.md`，或根目录下的 `<stem>.md`）。 */
  filePath: string;
  /** 包根：技能目录；根 `.md` 技能则是它所在的技能根目录。lane 的可信读根就是它。 */
  packageDir: string;
  description: string;
  /** pi 给的方法正文——**已去 frontmatter**。进提示词的只有它。 */
  content: string;
  /** 整份文件原文（含 frontmatter）。MCP `resources/read` 与导出要的是它（R31：外部读者期待完整的 SKILL.md）。 */
  body: string;
  manifest: SkillManifest | null;
  manifestError?: string;
  /** Pi uses the same flag when deciding whether a Skill may enter its prompt. */
  disableModelInvocation?: boolean;
  origin: "builtin" | "user";
  audience: SkillAudience;
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
  /** 这条技能要不要 coding 工具（自带 `scripts/`/`bin/`/`hooks/`，或 frontmatter 写了 `tools: coding`）。 */
  requiresCodingTools: boolean;
};

/**
 * A root is the only input to canonical Skill discovery.  Keeping this small
 * type here (instead of teaching each transport how to walk the filesystem)
 * makes the desktop Agent, Pi and MCP read the same package set and the same
 * precedence order.
 */
export type SkillDiscoveryRoot = {
  path: string;
  origin: SkillRecord["origin"];
};

export type SkillDiscoveryDiagnostic = {
  type: "warning" | "error";
  /** pi 的稳定诊断码（`file_info_failed` / `list_failed` / `read_failed` / `parse_failed` / `invalid_metadata`），或 Nomi 投影层的（`shadowed` / `symlink` / `escaped` / `corrupt` / `legacy_manifest`）。 */
  code?: string;
  message: string;
  path?: string;
};

export type SkillDiscoveryResult = {
  records: SkillRecord[];
  diagnostics: SkillDiscoveryDiagnostic[];
};

/** Resolve the process-wide ordered roots once for every transport. */
export function getSkillDiscoveryRoots(): SkillDiscoveryRoot[] {
  // The compiled Pi runtime is also exercised by a plain Node process (for
  // example the zero-quota agent-runtime suite). In that process Electron's
  // CommonJS entry is an executable path string, so `app.getPath()` is not
  // available. Keep the same ordered roots and package contract there while
  // avoiding a hard dependency on a live Electron app; the real desktop path
  // still always comes from runtimePaths.
  let roots: string[];
  try {
    roots = getSkillsRoots();
  } catch {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const appPath = String(process.env.NOMI_APP_PATH || "").trim();
    roots = Array.from(new Set([
      String(process.env.NOMI_SKILLS_DIR || "").trim(),
      path.join(process.cwd(), "skills"),
      path.isAbsolute(appPath) ? path.join(appPath, "skills") : "",
      path.join(__dirname, "../skills"),
      path.isAbsolute(resourcesPath || "") ? path.join(resourcesPath!, "skills") : "",
    ].filter(Boolean).map((root) => path.resolve(root))));
  }
  let userRoot: string | undefined;
  try {
    userRoot = path.resolve(getUserSkillsRoot());
  } catch {
    const configured = [process.env.NOMI_SETTINGS_DIR, process.env.NOMI_ELECTRON_USER_DATA_DIR]
      .map((value) => String(value || "").trim())
      .find((value) => path.isAbsolute(value));
    if (configured) userRoot = path.resolve(configured, "skills");
  }
  return roots.map((root) => ({
    path: root,
    origin: (userRoot && path.resolve(root) === userRoot ? "user" : "builtin") as SkillRecord["origin"],
  })).concat(userRoot && !roots.some((root) => path.resolve(root) === userRoot)
    ? [{ path: userRoot, origin: "user" as const }]
    : []);
}

export function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/**
 * 全部根 → 目录。**每次都重扫盘**（目录没有快照）。实现在岛上（pi 的 `loadSourcedSkills`），这里只是桥。
 * 形状在这里手抄一遍而不是 `typeof import('…laneNativeLoader.cjs')`：那样会把岛的 .mts 拖进 CJS 工程
 * （`feedbackIpc.ts:57` 试过，不行）。漂移守卫在桥那一侧：`laneNativeLoader.cts` 把它声明成返回 `SkillRecord[]`。
 */
export async function readSkillRecords(): Promise<SkillRecord[]> {
  const native = createRequire(__filename)("../agentLane/laneNativeLoader.cjs") as {
    readSkillRecords(): Promise<SkillRecord[]>;
  };
  return native.readSkillRecords();
}

export function findSkillRecord(
  skillKey: string,
  skillName: string,
  records: readonly SkillRecord[],
): SkillRecord | null {
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);
  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;
  const prefix = records.filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;
  return records.find((skill) =>
    normalizeSkillLookupKey(skill.name) === normalizedKey ||
    normalizeSkillLookupKey(skill.directoryName) === normalizedKey ||
    (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName) ||
    (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)) ?? null;
}

export function isSkillVisibleTo(record: SkillRecord, audience: SkillAudience): boolean {
  if (audience === "internal") return true;
  return record.origin === "builtin" && record.audience === "mcp";
}

/**
 * MCP has two deliberately different audiences.  Public/unauthenticated
 * protocol consumers receive only built-in Skills that explicitly opt in to
 * MCP.  A locally authenticated Codex/Claude/Cursor connection has already
 * proved that Nomi installed it, so it may use the same private catalog as
 * the desktop Agent and Workbench.  Keeping this decision here prevents the
 * dispatcher, Pi loader, and renderer from growing three divergent filters.
 */
export type SkillMcpAccess = "public" | "local-authenticated";

export function isSkillVisibleToMcp(record: SkillRecord, access: SkillMcpAccess = "public"): boolean {
  return access === "local-authenticated" || isSkillVisibleTo(record, "mcp");
}

/**
 * Workbench picker visibility is separate from MCP audience visibility. User
 * Skills and existing playbooks remain selectable; a built-in single-stage
 * Skill must opt in explicitly so routing resources do not leak into the UI.
 */
export function isSkillSelectableInWorkbench(
  record: Pick<SkillRecord, "name" | "origin" | "manifest">,
): boolean {
  if (record.origin === "user") return true;
  // 绑在构建开关上的技能（3D-BOX 工作流，它点名的 stage_shot 只在开关开时是新版）：开关关就不可选。
  if (record.manifest?.requiresFlag === "director3dbox" && !director3dBoxFaceEnabled()) return false;
  return record.manifest?.selectableInWorkbench === true || Boolean(record.manifest?.stages?.length);
}

export type SkillSummary = {
  name: string;
  directoryName: string;
  description: string;
  origin: "builtin" | "user";
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
};

/** Exact identity lookup shared by every read transport.  Deliberately does
 * not use findSkillRecord's internal prefix fallback: a caller must name one
 * concrete Skill, otherwise similarly-prefixed resources could be confused.
 */
export function findExactSkillRecord(key: string, records: readonly SkillRecord[]): SkillRecord | undefined {
  const normalized = normalizeSkillLookupKey(key);
  if (!normalized) return undefined;
  return records.find((candidate) => candidate.name === key || candidate.directoryName === key
    || normalizeSkillLookupKey(candidate.name) === normalized
    || normalizeSkillLookupKey(candidate.directoryName) === normalized);
}

export function listSkillSummaries(
  audience: SkillAudience,
  records: readonly SkillRecord[],
): SkillSummary[] {
  return records.filter((record) => isSkillVisibleTo(record, audience)).map((record) => ({
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  }));
}

/** Re-read through the canonical package reader; a changed package never answers an old identity. */
function currentMcpSkillFiles(record: SkillRecord): Record<string, string> | null {
  try {
    if (!path.isAbsolute(record.packageDir) || fs.lstatSync(record.packageDir).isSymbolicLink()) return null;
    const files = readSkillPackageFiles(record);
    return computeSkillContentHash(files) === record.contentHash ? files : null;
  } catch {
    return null;
  }
}

export function listSkillSummariesForMcp(
  access: SkillMcpAccess,
  records: readonly SkillRecord[],
): Array<SkillSummary & { filePaths: string[] }> {
  return records.filter((record) => isSkillVisibleToMcp(record, access)).flatMap((record) => {
    const files = currentMcpSkillFiles(record);
    return files ? [{
      name: record.name,
      directoryName: record.directoryName,
      description: record.description,
      origin: record.origin,
      packageVersion: record.packageVersion,
      contentHash: record.contentHash,
      filePaths: Object.keys(files).sort(),
    }] : [];
  });
}

export type SkillContent = SkillSummary & { body: string };

export function readSkillContent(
  key: string,
  audience: SkillAudience,
  records: readonly SkillRecord[],
  expected?: Readonly<{ packageVersion: string; contentHash: string }>,
): SkillContent | null {
  const record = findExactSkillRecord(key, records);
  if (!record || !isSkillVisibleTo(record, audience)) return null;
  if (expected && (record.packageVersion !== expected.packageVersion || record.contentHash !== expected.contentHash)) {
    return null;
  }
  return {
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    body: record.body,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  };
}

export function readSkillContentForMcp(
  key: string,
  access: SkillMcpAccess,
  records: readonly SkillRecord[],
  expected?: Readonly<{ packageVersion: string; contentHash: string }>,
  filePath = "SKILL.md",
): SkillContent | null {
  const record = findExactSkillRecord(key, records);
  if (!record || !isSkillVisibleToMcp(record, access)) return null;
  if (expected && (record.packageVersion !== expected.packageVersion || record.contentHash !== expected.contentHash)) {
    return null;
  }
  if (!isSafeSkillFilePath(filePath)) return null;
  const files = currentMcpSkillFiles(record);
  if (!files || !Object.prototype.hasOwnProperty.call(files, filePath)) return null;
  return {
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    body: files[filePath],
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  };
}
