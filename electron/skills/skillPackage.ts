// Skill sharing is a knowledge-only file exchange. Renderer import code may normalize
// source formats, but this main-process module owns versioning, limits, validation and writes.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { parseSkillManifest, type SkillManifest } from "./skillManifestSchema";

export const SKILL_PACKAGE_VERSION = "nomi-skill-v1";
export const SKILL_PACKAGE_MAX_FILES = 256;
export const SKILL_PACKAGE_MAX_FILE_BYTES = 1024 * 1024;
export const SKILL_PACKAGE_MAX_TOTAL_BYTES = 10 * 1024 * 1024;
export const SKILL_PACKAGE_MAX_DEPTH = 8;
export const SKILL_PACKAGE_MAX_PATH_CHARS = 240;
export const SKILL_PACKAGE_TEXT_EXTENSION = /\.(?:md|markdown|json|txt|ya?ml|csv)$/i;
export const SKILL_PACKAGE_FORBIDDEN_DIRECTORIES = new Set(["scripts", "bin", "hooks", "__macosx"]);
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export type SkillPackage = {
  version: string;
  exportedAt: number;
  dirName: string;
  files: Record<string, string>;
};

export function isSafeSkillRelativePath(relativePath: string): boolean {
  if (!relativePath || relativePath.length > SKILL_PACKAGE_MAX_PATH_CHARS) return false;
  if (relativePath.includes("\\") || relativePath.includes("\0") || path.posix.isAbsolute(relativePath)) return false;
  const parts = relativePath.split("/");
  if (parts.length > SKILL_PACKAGE_MAX_DEPTH) return false;
  if (parts.some((part) => !part || part === "." || part === ".." || part.startsWith("."))) return false;
  if (parts.some((part) => SKILL_PACKAGE_FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))) return false;
  if (relativePath === "SKILL.md" || relativePath === "skill.json") return true;
  return SKILL_PACKAGE_TEXT_EXTENSION.test(parts.at(-1) ?? "");
}

export function suggestSkillImportDirName(skillMarkdown: string, fallbackName: string): string {
  const frontmatter = skillMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const declaredName = frontmatter?.[1].match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1]?.trim();
  return declaredName || fallbackName.replace(/\.(?:zip|nomiskill)$/i, "") || "imported-skill";
}

function contentBytes(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function validateFileTable(files: unknown): { ok: true; files: Record<string, string> } | { ok: false; error: string } {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return { ok: false, error: "skill 包缺少 files" };
  }
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length > SKILL_PACKAGE_MAX_FILES) {
    return { ok: false, error: `skill 包文件数超过 ${SKILL_PACKAGE_MAX_FILES}` };
  }
  let totalBytes = 0;
  const normalized: Record<string, string> = Object.create(null) as Record<string, string>;
  const canonicalPaths = new Set<string>();
  for (const [name, content] of entries) {
    if (!isSafeSkillRelativePath(name)) return { ok: false, error: `Unsupported Skill package path: ${name}` };
    const canonicalPath = name.normalize("NFC").toLowerCase();
    if (canonicalPaths.has(canonicalPath)) {
      return { ok: false, error: `Skill package contains colliding paths: ${name}` };
    }
    canonicalPaths.add(canonicalPath);
    if (typeof content !== "string") return { ok: false, error: `文件 ${name} 内容必须是字符串` };
    if (content.includes("\0")) return { ok: false, error: `文件 ${name} 不是纯文本` };
    const bytes = contentBytes(content);
    if (bytes > SKILL_PACKAGE_MAX_FILE_BYTES) return { ok: false, error: `文件 ${name} 超过大小限制` };
    totalBytes += bytes;
    if (totalBytes > SKILL_PACKAGE_MAX_TOTAL_BYTES) return { ok: false, error: "skill 包超过总大小限制" };
    normalized[name] = content;
  }
  for (const canonicalPath of canonicalPaths) {
    const parts = canonicalPath.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      if (canonicalPaths.has(parts.slice(0, depth).join("/"))) {
        return { ok: false, error: `Skill package contains a file/directory collision: ${canonicalPath}` };
      }
    }
  }
  if (!normalized["SKILL.md"]?.trim()) return { ok: false, error: "skill 包缺少 SKILL.md 正文" };
  return { ok: true, files: normalized };
}

export function buildSkillPackage(
  dirName: string,
  files: Record<string, string>,
  exportedAt: number,
): SkillPackage {
  return { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files };
}

/** Stamp a renderer-normalized file table. Explicit incompatible envelopes remain rejectable. */
export function stampSkillPackage(raw: unknown, exportedAt: number): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const source = raw as Record<string, unknown>;
  if (source.version !== undefined && source.version !== SKILL_PACKAGE_VERSION) return raw;
  return {
    ...source,
    version: SKILL_PACKAGE_VERSION,
    exportedAt: typeof source.exportedAt === "number" ? source.exportedAt : exportedAt,
  };
}

export type ValidatedSkillPackage =
  | { ok: true; pkg: SkillPackage; manifest: SkillManifest | null }
  | { ok: false; error: string };

export function validateSkillPackage(raw: unknown): ValidatedSkillPackage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "不是合法的 skill 包（应为 JSON 对象）" };
  }
  const obj = raw as Record<string, unknown>;
  const allowedKeys = new Set(["version", "exportedAt", "dirName", "files"]);
  const unexpected = Object.keys(obj).find((key) => !allowedKeys.has(key));
  if (unexpected) return { ok: false, error: `skill 包含不支持的字段：${unexpected}` };
  if (obj.version !== SKILL_PACKAGE_VERSION) {
    return { ok: false, error: `skill 包版本不兼容：期望 ${SKILL_PACKAGE_VERSION}，实际 ${String(obj.version)}` };
  }
  const dirName = typeof obj.dirName === "string" ? obj.dirName.trim() : "";
  if (!dirName || dirName.length > 160) return { ok: false, error: "skill 包缺少合法 dirName" };
  const validatedFiles = validateFileTable(obj.files);
  if (!validatedFiles.ok) return validatedFiles;

  let manifest: SkillManifest | null = null;
  if (validatedFiles.files["skill.json"]) {
    let json: unknown;
    try {
      json = JSON.parse(validatedFiles.files["skill.json"]);
    } catch (error) {
      return { ok: false, error: `skill.json 不是合法 JSON：${(error as Error).message}` };
    }
    const parsed = parseSkillManifest(json);
    if (!parsed.ok) return { ok: false, error: `skill.json 校验失败：${parsed.error}` };
    manifest = parsed.manifest;
  }
  const exportedAt = typeof obj.exportedAt === "number" && Number.isFinite(obj.exportedAt) && obj.exportedAt >= 0
    ? obj.exportedAt
    : 0;
  return {
    ok: true,
    pkg: { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files: validatedFiles.files },
    manifest,
  };
}

export function computeSkillContentHash(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    hash.update(name, "utf8");
    hash.update("\0");
    hash.update(files[name], "utf8");
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function resolveImportDirName(desired: string, existingDirs: ReadonlySet<string>): string {
  const base = desired.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "imported-skill";
  const occupied = new Set([...existingDirs].map((name) => name.normalize("NFC").toLowerCase()));
  if (!occupied.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!occupied.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function readSkillDirFiles(absDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const rootStat = fs.lstatSync(absDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Skill package root must be a real directory");
  }
  let fileCount = 0;
  let totalBytes = 0;
  const visit = (dir: string, segments: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextSegments = [...segments, entry.name];
      const relativePath = nextSegments.join("/");
      const absolutePath = path.join(dir, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`Skill package symbolic link is not allowed: ${relativePath}`);
      if (stat.isDirectory()) {
        if (relativePath.length > SKILL_PACKAGE_MAX_PATH_CHARS || nextSegments.length > SKILL_PACKAGE_MAX_DEPTH
          || nextSegments.some((part) => part.startsWith(".")
            || SKILL_PACKAGE_FORBIDDEN_DIRECTORIES.has(part.toLowerCase()))) {
          throw new Error(`Unsupported Skill package path: ${relativePath}`);
        }
        visit(absolutePath, nextSegments);
        continue;
      }
      if (!stat.isFile() || !isSafeSkillRelativePath(relativePath)) {
        throw new Error(`Unsupported Skill package path: ${relativePath}`);
      }
      fileCount += 1;
      if (fileCount > SKILL_PACKAGE_MAX_FILES) {
        throw new Error(`skill 包文件数超过 ${SKILL_PACKAGE_MAX_FILES}`);
      }
      if (stat.size > SKILL_PACKAGE_MAX_FILE_BYTES) throw new Error(`文件 ${relativePath} 超过大小限制`);
      totalBytes += stat.size;
      if (totalBytes > SKILL_PACKAGE_MAX_TOTAL_BYTES) throw new Error("skill 包超过总大小限制");
      const bytes = fs.readFileSync(absolutePath);
      let content: string;
      try {
        content = utf8Decoder.decode(bytes);
      } catch {
        throw new Error(`Skill package file is not valid UTF-8 text: ${relativePath}`);
      }
      files[relativePath] = content;
    }
  };
  visit(absDir, []);
  const validated = validateFileTable(files);
  if (!validated.ok) throw new Error(validated.error);
  return validated.files;
}

export function writeSkillImport(userRoot: string, pkg: SkillPackage): { dirName: string; dir: string } {
  const validated = validateSkillPackage(pkg);
  if (!validated.ok) throw new Error(validated.error);
  fs.mkdirSync(userRoot, { recursive: true });
  const existing = new Set(fs.readdirSync(userRoot, { withFileTypes: true }).map((entry) => entry.name));
  const dirName = resolveImportDirName(validated.pkg.dirName, existing);
  const dir = path.join(userRoot, dirName);
  const staging = fs.mkdtempSync(path.join(userRoot, ".nomi-skill-import-"));
  try {
    for (const [name, content] of Object.entries(validated.pkg.files)) {
      const destination = path.join(staging, ...name.split("/"));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, "utf8");
    }
    fs.renameSync(staging, dir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return { dirName, dir };
}

export type ImportSkillResult =
  | { ok: true; dirName: string; skillName: string; manifest: SkillManifest | null }
  | { ok: false; error: string };

export function exportSkillPackageByName(directoryName: string, exportedAt: number): SkillPackage | null {
  const name = String(directoryName || "").trim();
  if (!name || name !== path.basename(name) || name === "." || name === "..") return null;
  for (const root of getSkillsRoots()) {
    const dir = path.join(root, name);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      return buildSkillPackage(name, readSkillDirFiles(dir), exportedAt);
    }
  }
  return null;
}

export type DeleteSkillResult = { ok: true; dirName: string } | { ok: false; error: string };

export function deleteUserSkill(directoryName: string): DeleteSkillResult {
  const name = String(directoryName || "").trim();
  if (!name || name !== path.basename(name) || name === "." || name === "..") {
    return { ok: false, error: "非法的技能目录名" };
  }
  const userRoot = path.resolve(getUserSkillsRoot());
  const target = path.resolve(userRoot, name);
  if (target !== path.join(userRoot, name) || !target.startsWith(userRoot + path.sep)) {
    return { ok: false, error: "只能删除用户目录下的技能" };
  }
  if (!fs.existsSync(path.join(target, "SKILL.md"))) {
    return { ok: false, error: "该技能不在用户目录（内置技能只读，不能删除）" };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { ok: true, dirName: name };
}

export function importSkillPackageToUserDir(raw: unknown): ImportSkillResult {
  const validated = validateSkillPackage(stampSkillPackage(raw, Date.now()));
  if (!validated.ok) return validated;
  const { dirName } = writeSkillImport(getUserSkillsRoot(), validated.pkg);
  return {
    ok: true,
    dirName,
    skillName: validated.manifest?.name || dirName,
    manifest: validated.manifest,
  };
}
