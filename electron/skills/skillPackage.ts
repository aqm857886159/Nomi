// Skill 分享 = 异步文件交换（无后端）。导出一个 skill 为自描述包 → 发给人 → 对方导入到可写
// 用户目录。安全：导入校验 frontmatter、拒路径穿越、不覆盖内置
// （docs/plan/2026-06-19-skill-playbook-system.md §6 + §0.5.d）。
//
// **2026-09-07（阶段 5c）：`scripts/` 不再被跳过。** v1 拒收可执行区的理由原话是
// 「进来就要配安全扫描 + 沙箱」——那两样现在都有了：沙箱是 pi 自带示例接的
// `@anthropic-ai/sandbox-runtime`（`electron/agentLane/laneCodingSandbox.mts`），
// 审批是三档权限策略（`electron/shared/agentCapabilities/codingCommandPolicy.ts`）。
// 前提没了，限制就该同 commit 删掉，而不是留一句「暂不支持」当永久豁免（P1）。
// 技能正文引用脚本路径，模型用 bash 工具去跑，跑之前过那三档——**技能本身不获得任何
// 额外权限**：它带的脚本和用户自己敲的命令走同一条闸。
// 纯函数（打包/校验/冲突命名）与 FS 函数（显式目录，便于单测，不碰 electron app）分离；
// runtimePaths 薄包装见末尾。
import { createHash } from "node:crypto";
import { broadcastSkillLibraryChanged } from "./skillLibraryBroadcast";
import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot } from "../runtimePaths";
import { readSkillCuration } from "../shared/skillCuration";
import { parseSkillFrontmatter, readSkillFrontmatterIdentity } from "./skillFrontmatter";

export const SKILL_PACKAGE_VERSION = "nomi-skill-v1";

/** 自描述、可移植的 skill 包（JSON 序列化即可传输）。 */
export type SkillPackage = {
  version: string;
  /** 导出时间戳（调用方传入：脚本环境不可用 Date.now，由 IPC 层盖戳）。 */
  exportedAt: number;
  /** 目标目录名建议（导入时按冲突规则可能改名）。 */
  dirName: string;
  /** 相对路径（`/` 分隔，可含 references/ 等子目录）→ utf8 内容。必含根部 SKILL.md。 */
  files: Record<string, string>;
};

/** 知识层文本白名单。二进制（图片等）不进包——由调用方统计并如实告知用户跳过了几个。 */
const SKILL_TEXT_EXT = /\.(md|markdown|json|txt|ya?ml|csv)$/i;
/** 子目录深度上限（`references/api/v2/spec.md` = 3 段目录，够用且防深层炸弹）。 */
const SKILL_PATH_MAX_DEPTH = 4;
/**
 * 可执行区。**现在收，但要标出来**——UI 据此告诉用户「这个技能含可执行脚本，运行需确认」。
 *
 * 为什么仍然要认得出它：用户在点「导入」那一刻有权知道自己收下的是不是会跑起来的东西。
 * 把它和普通 markdown 一视同仁不是更简洁，是把一个该说的事实藏起来了（D4）。
 */
const SKILL_EXECUTABLE_DIRS = new Set(["scripts", "bin", "hooks"]);

/** 可执行脚本的扩展名白名单。**不是所有文件都收**：二进制仍然不进包（它没法审阅）。 */
const SKILL_SCRIPT_EXT = /\.(mjs|cjs|js|ts|mts|py|sh|bash|zsh|rb)$/i;

/** 把 Windows 反斜杠归一成 `/`，并去掉冗余的 `./`。 */
function normalizeSkillPath(raw: string): string {
  return String(raw || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

/** 这个路径是不是「可执行区」（v1 不收，但要与「非法路径」区分开，好给人话原因）。 */
export function isExecutableSkillPath(raw: string): boolean {
  const p = normalizeSkillPath(raw);
  const top = p.split("/")[0]?.toLowerCase() ?? "";
  return SKILL_EXECUTABLE_DIRS.has(top);
}

/**
 * 安全的 skill 相对路径：允许子目录（`references/x.md`、`assets/tpl.txt`），
 * 但禁 `..` / 绝对路径 / 盘符 / `\0` / 空段，限深度，限文本扩展名。
 */
export function isSafeSkillFilePath(raw: string): boolean {
  const p = normalizeSkillPath(raw);
  if (!p || p.includes("\0")) return false;
  if (p.startsWith("/") || /^[a-z]:/i.test(p)) return false;
  const segments = p.split("/");
  if (segments.length > SKILL_PATH_MAX_DEPTH) return false;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return false;
    // 段内不许再藏分隔符或空白包裹（zip 里出现过 `a /../b` 这种）
    if (segment.trim() !== segment) return false;
  }
  const leaf = segments[segments.length - 1];
  // 可执行区收脚本扩展名，知识区收文本扩展名。**两边都不收二进制**：
  // 一个审阅不了的文件，用户点「允许运行」时等于在批一件他看不见的事。
  return isExecutableSkillPath(p) ? SKILL_SCRIPT_EXT.test(leaf) : SKILL_TEXT_EXT.test(leaf);
}

/** 打包（纯）：把文件表组装成 SkillPackage。 */
export function buildSkillPackage(
  dirName: string,
  files: Record<string, string>,
  exportedAt: number,
): SkillPackage {
  return { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files };
}

/**
 * Order-independent content hash over a skill's file map (M1 skill-write capability).
 * Names are sorted so the digest is stable regardless of insertion order; each name/body
 * is NUL-delimited to prevent boundary collisions. Consumed by skillStore + skillWriteTransportAdapters.
 */
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

export type ValidatedSkillPackage =
  | { ok: true; pkg: SkillPackage; skillName: string }
  | { ok: false; error: string };

/**
 * 归一导入输入（纯）：吃两种形状，**版本号只此一处**（渲染层不复制它）。
 * ① 完整信封 `{version, exportedAt, dirName, files}` —— 我们自己导出的 `.nomiskill.json`，原样透传；
 * ② 裸文件表 `{dirName, files}` —— 渲染层从 SKILL.md / zip 解析出来的，这里盖版本戳。
 *
 * ② 是 2026-08-27 加的：此前只认 ①，导致「别人的技能一律进不来」，而生态早已收敛到
 * 「文件夹 + SKILL.md + YAML frontmatter」，我们自己的 SKILL.md 本来就是这个格式（R20 对齐标准）。
 */
export function normalizeSkillImportInput(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== undefined) return raw;
  return { ...obj, version: SKILL_PACKAGE_VERSION, exportedAt: 0 };
}

/**
 * 校验一个外来包（纯）：版本兼容 + 形状 + 文件名安全 + 必含 SKILL.md + frontmatter 可解析。
 * 版本不符 → 拒（人话）；frontmatter 写坏 → 拒（不落一个别的宿主读不出来的 skill）；
 * 没有 Nomi 扩展块 → 允许（纯知识层技能，生态里绝大多数长这样）。
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
    if (!isSafeSkillFilePath(name)) return { ok: false, error: `不安全或不支持的文件路径：${name}` };
    if (typeof content !== "string") return { ok: false, error: `文件 ${name} 内容必须是字符串` };
  }
  const fileMap = Object.fromEntries(fileEntries) as Record<string, string>;
  if (!fileMap["SKILL.md"] || !fileMap["SKILL.md"].trim()) {
    return { ok: false, error: "skill 包缺少 SKILL.md 正文" };
  }
  const identity = readSkillFrontmatterIdentity(fileMap["SKILL.md"]);
  if (identity.error) return { ok: false, error: identity.error };
  if (readSkillCuration(parseSkillFrontmatter(fileMap["SKILL.md"]).values)?.preview) {
    return { ok: false, error: "Skill preview media cannot be preserved by this text-only package" };
  }
  const exportedAt = typeof obj.exportedAt === "number" ? obj.exportedAt : 0;
  return {
    ok: true,
    pkg: { version: SKILL_PACKAGE_VERSION, exportedAt, dirName, files: fileMap },
    skillName: identity.name || dirName,
  };
}

/**
 * 这个包带可执行脚本吗。UI 用它在导入卡上加一行「含可执行脚本，运行需确认」。
 *
 * 它是**一句事实，不是一道闸**：闸在 `codingCommandPolicy` 那边，每次真要跑的时候判。
 * 放在这里是因为导入那一刻是用户唯一会认真看一眼这个技能的时刻。
 */
export function skillPackageCarriesExecutables(pkg: SkillPackage): boolean {
  return Object.keys(pkg.files).some((name) => isExecutableSkillPath(name));
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

/**
 * 读一个 skill 目录的可分享文本文件，**含子目录**（references/ assets/ …）。
 * 递归是为了让导出↔导入闭环：只读顶层的话，带 references 的技能导出一圈就被削平了。
 */
export function readSkillDirFiles(absDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (rel.split("/").length >= SKILL_PATH_MAX_DEPTH) continue;
        walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.isFile() || !isSafeSkillFilePath(rel)) continue;
      out[rel] = fs.readFileSync(path.join(dir, entry.name), "utf8");
    }
  };
  walk(absDir, "");
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
    if (!isSafeSkillFilePath(name)) continue; // 双保险
    const target = path.join(dir, ...name.split("/"));
    // 三保险：解析后必须仍落在本 skill 目录内（防任何绕过 isSafeSkillFilePath 的构造）
    if (!path.resolve(target).startsWith(path.resolve(dir) + path.sep)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return { dirName, dir };
}

// --- runtimePaths 薄包装（生产用；FS 副作用，真机/IPC 走这里，不进单测） ---

export type ImportSkillResult =
  | { ok: true; dirName: string; skillName: string }
  | { ok: false; error: string };

/** 按目录名在所有 skills 根里找到该 skill 并打包导出（exportedAt 由调用方盖戳）。 */
export function exportSkillPackageByName(directoryName: string, exportedAt: number): SkillPackage | null {
  for (const root of getSkillsRoots()) {
    const dir = path.join(root, directoryName);
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      const pkg = buildSkillPackage(directoryName, readSkillDirFiles(dir), exportedAt);
      return validateSkillPackage(pkg).ok ? pkg : null;
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
  broadcastSkillLibraryChanged();
  return { ok: true, dirName: name };
}

/**
 * 导入一个外来包到可写用户 skills 目录（归一 → 校验 → 落地）。
 *
 * 吃两种形状（**版本号只此一处**，渲染层不复制它）：
 * ① 完整信封 `{version, exportedAt, dirName, files}` —— 我们自己导出的 `.nomiskill.json`；
 * ② 裸文件表 `{dirName, files}` —— 渲染层从 SKILL.md / zip / 文件夹解析出来的，由这里盖版本戳。
 *
 * ② 是 2026-08-27 加的：此前只认 ①，导致「别人的技能一律进不来」——而生态早已收敛到
 * 「文件夹 + SKILL.md + YAML frontmatter」，我们自己的 SKILL.md 本来就是这个格式（R20）。
 */
export function importSkillPackageToUserDir(raw: unknown): ImportSkillResult {
  const validated = validateSkillPackage(normalizeSkillImportInput(raw));
  if (!validated.ok) return validated;
  const { dirName } = writeSkillImport(getUserSkillsRoot(), validated.pkg);
  // 盘变了就说一声。挂在写盘这一层，是因为入口不止一个（渲染层导入、拖拽、Agent 的
  // `author_skill`），而漏掉的那一个不会报错——它只是让用户在技能菜单里找不到刚加的东西。
  broadcastSkillLibraryChanged();
  return { ok: true, dirName, skillName: validated.skillName || dirName };
}
