// 「主人模块」名单（D-test-world-owner-only 批 1）：产品里拥有存盘格式 / 桌面接口 / 目录读口的模块。
// 写盘锁、换导出锁和冻结插件都读这一份，不各写一份。
// 只放路径，不 import 任何产品代码——vitest 配置期要加载它（冻结插件在配置里），不能把产品依赖拖进去。
// 名单仍是手写的：卡要各主人模块自己导出标记，那一步动产品代码，留给批 3（见 docs/plan/2026-11-22-test-world-owner-only.md ★1b）。
// 一致性：ownerModules.test.mjs 核每条路径真存在、核 settings 目录里的写口都被收进来。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const EXPLICIT_OWNER_MODULES = [
  "electron/catalog/catalogStore.ts",
  "electron/catalog/seedBuiltins.ts",
  "electron/catalog/declaredProviderRegistration.ts",
  "electron/projects/repository.ts",
  "electron/workspace/workspaceRepository.ts",
  "electron/workspace/workspaceManifest.ts",
  "electron/jsonFile.ts",
  "electron/configFileStore.ts",
  "src/desktop/bridge.ts",
  "src/config/modelCatalogCache.ts",
  "src/config/useModelOptions.ts",
] as const;

/** electron/settings 下的写口：设置文件各自的 `*Settings.ts`，加 localePreference / 同装继承。 */
function settingsWriters(): string[] {
  const dir = path.join(REPO_ROOT, "electron/settings");
  return fs
    .readdirSync(dir)
    .filter((n) => /(Settings|Preference|InstallSeed)\.ts$/.test(n) && !/\.test\./.test(n))
    .map((n) => `electron/settings/${n}`);
}

export const OWNER_MODULES: readonly string[] = Object.freeze([...EXPLICIT_OWNER_MODULES, ...settingsWriters()]);
const OWNER_ABS = new Set(OWNER_MODULES.map((m) => path.join(REPO_ROOT, m)));

/** 工作树根下的相对路径（/ 分隔）；根外的返回 null。 */
export function repoRelative(file: string): string | null {
  const abs = file.startsWith("file://") ? fileURLToPath(file) : file;
  const rel = path.relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

const EXTS = ["", ".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

/** 把 import 说明符（相对或绝对）按文件系统解析成真实文件；解析不到（裸包名、别名）返回 null。 */
export function resolveSpecifier(specifier: string, importer: string | null): string | null {
  let base: string;
  if (specifier.startsWith(".")) {
    if (!importer) return null;
    base = path.resolve(path.dirname(importer.startsWith("file://") ? fileURLToPath(importer) : importer), specifier);
  } else if (path.isAbsolute(specifier)) {
    base = specifier;
  } else {
    return null;
  }
  for (const ext of EXTS) {
    const candidate = base + ext;
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 试下一个后缀 */
    }
  }
  return null;
}

const REEXPORT = /export\s+(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;
const TYPE_ONLY_REEXPORT = /^export\s+type\s/;

/** 源码里有 `export … from` 转手主人模块的（只转类型的不算）：消费方经它拿到的就是主人的东西。 */
export function reexportsOwner(file: string, code: string): boolean {
  if (!code.includes("export") || !code.includes("from")) return false;
  for (const m of code.matchAll(REEXPORT)) {
    if (TYPE_ONLY_REEXPORT.test(m[0])) continue;
    const target = resolveSpecifier(m[1], file);
    if (target && OWNER_ABS.has(target)) return true;
  }
  return false;
}

const judged = new Map<string, boolean>();

/** 这个文件是不是主人模块：在名单里，或源码转手导出名单里的主人。结果按路径缓存。 */
export function isOwnerModule(file: string, code?: string): boolean {
  if (OWNER_ABS.has(file)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
  const cached = judged.get(file);
  if (cached !== undefined) return cached;
  let source = code;
  if (source === undefined) {
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      return false;
    }
  }
  const verdict = reexportsOwner(file, source);
  judged.set(file, verdict);
  return verdict;
}

/** 测试侧的文件（名字像测试，或在任一 tests/ 目录下）；tests/world 是主人发的入口，不算测试侧。 */
export function isTestSideFile(rel: string): boolean {
  const isTestName = /\.(test|spec|node-test)\.[cm]?[jt]sx?$/.test(rel);
  if (rel.startsWith("tests/world/") && !isTestName) return false;
  return isTestName || /(^|\/)tests\//.test(rel) || /TestUtils\.ts$|\.testkit\.ts$/.test(rel);
}
