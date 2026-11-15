// 同一个事实不许存两份、靠流程保持同步（设计卡 docs/plan/2026-11-15-archetype-wire-defaults-runtime.md「系统改进」）。
//
// 这一类问题：从仓库里的源头（档案声明……）派生出一份数据、提交进仓库，生产代码在运行时读这份副本；源头改了、副本要靠
// 生成脚本 / 机器人 PR 追上，追不上就悄悄落后（2026-11 档案默认值表在主干上落后于档案，Agent 发的参数和画布不一样）。
// 源头本来就 import 得到，就在用的时候现算；这里让「生产代码读一份提交进仓库的生成文件」一写就红。
//
// 判据：electron/ 和 src/ 的生产代码（非测试）里，import 的目标文件名带 `.generated.`，或文件头写着 `@generated`。
// 名单只减不增：名单里的每一项要写清为什么它的源头不在仓库里（不是仓库里另一份事实的副本）。
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PRODUCTION_ROOTS = ["electron", "src"];
// 设计实验室只拿真实数据当样张、不进产品包（同 archetypeSingleEntry.structure.test.ts 的 NOT_SHIPPED）。
const NOT_SHIPPED = `src${path.sep}devlab${path.sep}`;

/**
 * 源头不在仓库里的生成文件（只减不增）。
 * - modelSchemaMetaValidator.generated.cjs：JSON Schema 2020-12 官方元 schema 用固定版本 Ajv 预编译出的校验器；
 *   源头是外部标准 + 锁定的依赖版本，仓库里没有另一份会被人改的事实。
 */
const ALLOWED_GENERATED = [
  "electron/capabilityCore/modelSchemaMetaValidator.generated.cjs",
  // ualActions.ts：从 UAL 动作 GLB（二进制资产）读出的动作元数据；源头不是代码能 import 的声明，运行时解析 GLB 只为拿名字和时长不划算。
  "src/workbench/generationCanvas/nodes/director/model/assetCatalog/ualActions.ts",
  // 档案方式清单：同一类（档案的副本），同一刀下一段改成现算并删掉。
  "electron/catalog/archetypeModes.generated.ts",
  "electron/catalog/archetypeModes.audio.generated.ts",
  "electron/catalog/archetypeModes.image.generated.ts",
  "electron/catalog/archetypeModes.model3d.generated.ts",
  "electron/catalog/archetypeModes.video.generated.ts",
].sort();

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : productionSources(full);
    return /\.(tsx?|mts|cts|mjs|cjs|js)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
  });
}

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", "/index.ts", "/index.tsx"];

function resolveRelative(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const extension of EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate) && !readdirSafe(candidate)) return candidate;
  }
  return null;
}

function readdirSafe(candidate: string): boolean {
  try {
    readdirSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function isGenerated(file: string): boolean {
  if (/\.generated\./.test(path.basename(file))) return true;
  return readFileSync(file, "utf8").slice(0, 400).includes("@generated");
}

/** 生产代码读到的生成文件（仓库相对路径）→ 读它的文件。 */
function generatedReadByProduction(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const root = process.cwd();
  for (const file of PRODUCTION_ROOTS.flatMap((directory) => productionSources(directory)).filter((candidate) => !candidate.startsWith(NOT_SHIPPED))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(IMPORT_RE)) {
      const specifier = match[1];
      const target = resolveRelative(file, specifier);
      const unresolvedGenerated = !target && /\.generated(?:\.|$)/.test(specifier);
      if (!unresolvedGenerated && !(target && isGenerated(target))) continue;
      const key = target ? path.relative(root, target).split(path.sep).join("/") : specifier;
      out.set(key, [...(out.get(key) ?? []), file.split(path.sep).join("/")]);
    }
  }
  return out;
}

describe("生产代码不读提交进仓库的派生数据", () => {
  it("生产代码读到的生成文件只有名单里那几个（名单只减不增）", () => {
    expect([...generatedReadByProduction().keys()].sort()).toEqual(ALLOWED_GENERATED);
  });

  it("名单里的每一项都还在、还被读（用不到了就从名单删掉）", () => {
    const read = generatedReadByProduction();
    for (const file of ALLOWED_GENERATED) expect(read.has(file), file).toBe(true);
  });
});
