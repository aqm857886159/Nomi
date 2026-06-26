// Skill 分享 = 异步文件交换（无后端）。导出一个 skill 为自描述包 → 发给人 → 对方导入到可写
// 用户目录。安全：skill 只声明（SKILL.md + skill.json 文本），不跑外部代码；导入校验 manifest、
// 拒路径穿越、不覆盖内置（docs/plan/2026-06-19-skill-playbook-system.md §6 + §0.5.d）。
// 纯函数（打包/校验/冲突命名）与 FS 函数（显式目录，便于单测，不碰 electron app）分离；
// runtimePaths 薄包装见末尾。
import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { parseSkillManifest, type SkillManifest } from "./skillManifestSchema";

export const SKILL_PACKAGE_VERSION = "nomi-skill-v1";

/** 自描述、可移植的 skill 包（JSON 序列化即可传输；skill 是纯文本，无需 zip）。 */
export type SkillPackage = {
  version: string;
  /** 导出时间戳（调用方传入：脚本环境不可用 Date.now，由 IPC 层盖戳）。 */
  exportedAt: number;
  /** 目标目录名建议（导入时按冲突规则可能改名）。 */
  dirName: string;
  /** basename → utf8 内容。必含 SKILL.md；可含 skill.json + 其它 .md/.txt 资源。 */
  files: Record<string, string>;
};

/** 仅允许安全的纯文件名（无目录分隔/无 ..）+ 白名单扩展（防路径穿越、防写可执行）。 */
export function isSafeSkillFileName(name: string): boolean {
  if (!name || name !== path.basename(name)) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  return /\.(md|json|txt)$/i.test(name);
}

/** 打包（纯）：把文件表组装成 SkillPackage。 */
export function buildSkillPackage(
  dirName: string,
  files: Record<string, string>,
  exportedAt: number,
): SkillPackage {
  return { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files };
}

export type ValidatedSkillPackage =
  | { ok: true; pkg: SkillPackage; manifest: SkillManifest | null }
  | { ok: false; error: string };

/**
 * 校验一个外来包（纯）：版本兼容 + 形状 + 文件名安全 + 必含 SKILL.md + manifest 合法。
 * 三态对齐 Dify：版本不符 → 拒（人话）；skill.json 存在但非法 → 拒（不落坏 skill）；
 * skill.json 缺失 → 允许（legacy markdown-only，manifest=null）。
 */
export function validateSkillPackage(raw: unknown): ValidatedSkillPackage {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "不是合法的 skill 包（应为 JSON 对象）" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== SKILL_PACKAGE_VERSION) {
    return { ok: false, error: `skill 包版本不兼容：期望 ${SKILL_PACKAGE_VERSION}，实际 ${String(obj.version)}` };
  }
  const dirName = typeof obj.dirName === "string" ? obj.dirName.trim() : "";
  if (!dirName) return { ok: false, error: "skill 包缺少 dirName" };
  const files = obj.files;
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return { ok: false, error: "skill 包缺少 files" };
  }
  const fileEntries = Object.entries(files as Record<string, unknown>);
  for (const [name, content] of fileEntries) {
    if (!isSafeSkillFileName(name)) return { ok: false, error: `不安全的文件名：${name}` };
    if (typeof content !== "string") return { ok: false, error: `文件 ${name} 内容必须是字符串` };
  }
  const fileMap = Object.fromEntries(fileEntries) as Record<string, string>;
  if (!fileMap["SKILL.md"] || !fileMap["SKILL.md"].trim()) {
    return { ok: false, error: "skill 包缺少 SKILL.md 正文" };
  }
  let manifest: SkillManifest | null = null;
  if (fileMap["skill.json"]) {
    let json: unknown;
    try {
      json = JSON.parse(fileMap["skill.json"]);
    } catch (err) {
      return { ok: false, error: `skill.json 不是合法 JSON：${(err as Error).message}` };
    }
    const parsed = parseSkillManifest(json);
    if (!parsed.ok) return { ok: false, error: `skill.json 校验失败：${parsed.error}` };
    manifest = parsed.manifest;
  }
  const exportedAt = typeof obj.exportedAt === "number" ? obj.exportedAt : 0;
  return { ok: true, pkg: { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files: fileMap }, manifest };
}

/** 目标目录名清洗 + 冲突避让（纯）：非法字符→-，已存在→加 -2/-3…（不覆盖现有/内置）。 */
export function resolveImportDirName(desired: string, existingDirs: ReadonlySet<string>): string {
  const base =
    desired
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "imported-skill";
  if (!existingDirs.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existingDirs.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

// --- FS 层（显式目录参数；不碰 electron app，便于单测） ---

/** 读一个 skill 目录的顶层可分享文件（SKILL.md / skill.json / *.md / *.txt）。 */
export function readSkillDirFiles(absDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!isSafeSkillFileName(entry.name)) continue;
    out[entry.name] = fs.readFileSync(path.join(absDir, entry.name), "utf8");
  }
  return out;
}

/** 把一个已校验的包写进用户 skills 根，按冲突避让取目录名。返回最终落地目录名 + 绝对路径。 */
export function writeSkillImport(userRoot: string, pkg: SkillPackage): { dirName: string; dir: string } {
  fs.mkdirSync(userRoot, { recursive: true });
  const existing = new Set(
    fs.existsSync(userRoot)
      ? fs.readdirSync(userRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
      : [],
  );
  const dirName = resolveImportDirName(pkg.dirName, existing);
  const dir = path.join(userRoot, dirName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(pkg.files)) {
    if (!isSafeSkillFileName(name)) continue; // 双保险
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return { dirName, dir };
}

// --- runtimePaths 薄包装（生产用；FS 副作用，真机/IPC 走这里，不进单测） ---

export type ImportSkillResult =
  | { ok: true; dirName: string; skillName: string; manifest: SkillManifest | null }
  | { ok: false; error: string };

/** 按目录名在所有 skills 根里找到该 skill 并打包导出（exportedAt 由调用方盖戳）。 */
export function exportSkillPackageByName(directoryName: string, exportedAt: number): SkillPackage | null {
  for (const root of getSkillsRoots()) {
    const dir = path.join(root, directoryName);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      return buildSkillPackage(directoryName, readSkillDirFiles(dir), exportedAt);
    }
  }
  return null;
}

export type DeleteSkillResult = { ok: true; dirName: string } | { ok: false; error: string };

/**
 * 删除一个**用户目录下**的 skill（不可逆）。安全：解析后必须严格落在 userRoot 内（防 `..` 穿越），
 * 且只删 userData/skills——内置随附 skill 在只读安装目录，这里碰不到，天然禁删（与导入对称）。
 */
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

/** 导入一个外来包到可写用户 skills 目录（校验 → 落地）。 */
export function importSkillPackageToUserDir(raw: unknown): ImportSkillResult {
  const validated = validateSkillPackage(raw);
  if (!validated.ok) return validated;
  const { dirName } = writeSkillImport(getUserSkillsRoot(), validated.pkg);
  return {
    ok: true,
    dirName,
    skillName: validated.manifest?.name || dirName,
    manifest: validated.manifest,
  };
}
