import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { computeSkillContentHash, readSkillDirFiles, SKILL_PACKAGE_VERSION } from "./skillPackage";
import {
  parseSkillManifest,
  type SkillAudience,
  type SkillManifest,
} from "./skillManifestSchema";

export type SkillRecord = {
  name: string;
  directoryName: string;
  filePath: string;
  description: string;
  body: string;
  manifest: SkillManifest | null;
  manifestError?: string;
  /** Pi uses the same flag when deciding whether a Skill may enter its prompt. */
  disableModelInvocation?: boolean;
  origin: "builtin" | "user";
  audience: SkillAudience;
  packageVersion: typeof SKILL_PACKAGE_VERSION;
  contentHash: string;
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

function frontmatterValue(markdown: string, key: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const value = match?.[1].match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return String(value?.[1] || "").trim();
}

function parseSkillName(markdown: string, directoryName: string): string {
  return frontmatterValue(markdown, "name") || directoryName;
}

function parseSkillDescription(markdown: string): string {
  return frontmatterValue(markdown, "description");
}

function parseDisableModelInvocation(markdown: string): boolean {
  return /^---\s*\n([\s\S]*?)\n---/.exec(markdown)?.[1]
    ?.match(/^disable-model-invocation:\s*(["']?)(true|false)\1\s*$/im)?.[2]
    ?.toLowerCase() === "true";
}

function parseSkillAudience(markdown: string): SkillAudience {
  return frontmatterValue(markdown, "audience") === "mcp" ? "mcp" : "internal";
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

function readSkillManifest(files: Record<string, string>): { manifest: SkillManifest | null; error?: string } {
  const rawManifest = files["skill.json"];
  if (!rawManifest) return { manifest: null };
  let raw: unknown;
  try {
    raw = JSON.parse(rawManifest);
  } catch (error) {
    return { manifest: null, error: `skill.json 不是合法 JSON：${(error as Error).message}` };
  }
  const parsed = parseSkillManifest(raw);
  return parsed.ok ? { manifest: parsed.manifest } : { manifest: null, error: parsed.error };
}

/**
 * Discover only direct Skill packages (`root/<dir>/SKILL.md`).  Pi's generic
 * loader also accepts loose markdown files and recursively discovers nested
 * roots; that is useful for a generic coding agent but is not Nomi's package
 * contract.  All transports call this function so metadata, hash and
 * directory precedence cannot drift.
 */
export function discoverSkillRecordsFromRoots(
  roots: readonly SkillDiscoveryRoot[],
): SkillDiscoveryResult {
  const records: SkillRecord[] = [];
  const diagnostics: SkillDiscoveryDiagnostic[] = [];
  const seenDirs = new Set<string>();
  const normalizedRoots = roots
    .filter((root) => typeof root?.path === "string" && path.isAbsolute(root.path))
    .map((root) => ({
      path: path.resolve(root.path),
      origin: root.origin === "user" ? "user" as const : "builtin" as const,
    }));
  for (const root of normalizedRoots) {
    if (!fs.existsSync(root.path)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root.path, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      diagnostics.push({
        type: "warning",
        message: `Could not read Skill root: ${(error as Error).message}`,
        path: root.path,
      });
      continue;
    }
    for (const entry of entries) {
      const directoryKey = entry.name.normalize("NFC").toLowerCase();
      if (!entry.isDirectory() || seenDirs.has(directoryKey)) continue;
      const skillDir = path.join(root.path, entry.name);
      if (!fs.existsSync(path.join(skillDir, "SKILL.md"))) continue;
      let files: Record<string, string>;
      try {
        files = readSkillDirFiles(skillDir);
      } catch (error) {
        diagnostics.push({
          type: "warning",
          message: `Skill package could not be read, skipped: ${(error as Error).message}`,
          path: skillDir,
        });
        continue;
      }
      const body = files["SKILL.md"].trim();
      if (!body) continue;
      // 损坏包（正文含 NUL 等 C0 控制字符 = 二进制/截断/写坏）不许「占坑遮蔽」：若它优先级更高，
      // 加进 seenDirs 就会把同目录名下一个合法包（如 user 覆盖）挡掉。故这里当损坏处理——记一条 warning
      // 且**不**加 seenDirs，让后续 root 里同名的合法包顶上（nomiSkillResources 的 shadow 优先级测试钉死）。
      // 只拦真正的控制字符（放行 \t\n\r，它们在 markdown 里合法）。字符类里的控制字符是刻意的。
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body)) {
        diagnostics.push({
          type: "warning",
          message: "Skill package SKILL.md contains control characters, skipped as corrupt",
          path: skillDir,
        });
        continue;
      }
      seenDirs.add(directoryKey);
      const { manifest, error } = readSkillManifest(files);
      records.push({
        name: manifest?.name || parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath: path.join(skillDir, "SKILL.md"),
        description: manifest?.description || parseSkillDescription(body),
        body,
        manifest,
        manifestError: error,
        disableModelInvocation: parseDisableModelInvocation(body),
        origin: root.origin,
        // Imported Skills cannot publish themselves through package metadata.
        audience: root.origin === "user" ? "internal" : (manifest?.audience ?? parseSkillAudience(body)),
        packageVersion: SKILL_PACKAGE_VERSION,
        contentHash: computeSkillContentHash(files),
      });
    }
  }
  return { records, diagnostics };
}

export function readSkillRecords(): SkillRecord[] {
  return discoverSkillRecordsFromRoots(getSkillDiscoveryRoots()).records;
}

export function findSkillRecord(
  skillKey: string,
  skillName: string,
  records: SkillRecord[] = readSkillRecords(),
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
  records: SkillRecord[] = readSkillRecords(),
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

export function listSkillSummariesForMcp(
  access: SkillMcpAccess = "public",
  records: SkillRecord[] = readSkillRecords(),
): SkillSummary[] {
  return records.filter((record) => isSkillVisibleToMcp(record, access)).map((record) => ({
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    origin: record.origin,
    packageVersion: record.packageVersion,
    contentHash: record.contentHash,
  }));
}

export type SkillContent = SkillSummary & { body: string };

export function readSkillContent(
  key: string,
  audience: SkillAudience,
  records: SkillRecord[] = readSkillRecords(),
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
  access: SkillMcpAccess = "public",
  records: SkillRecord[] = readSkillRecords(),
  expected?: Readonly<{ packageVersion: string; contentHash: string }>,
): SkillContent | null {
  const record = findExactSkillRecord(key, records);
  if (!record || !isSkillVisibleToMcp(record, access)) return null;
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
