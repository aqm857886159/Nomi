#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOOR_MAP_SINCE, classifyFindings, inheritLegacyContractHashes, validateRootCauseChange, validateRootCauseHistory } from "./root-cause-contracts.mjs";
import { doorsForTargets } from "./door-map.mjs";
import { gitPaths } from "./lib/gitPaths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitRaw(args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function lines(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

function baseline() {
  const explicit = process.env.ROOT_CAUSE_BASE_REF?.trim() || process.env.VOCAB_BASE_REF?.trim();
  if (explicit && !/^0+$/.test(explicit)) {
    try {
      git(["rev-parse", "--verify", `${explicit}^{commit}`]);
      return explicit;
    } catch {
      throw new Error(`ROOT_CAUSE_BASE_REF is unavailable: ${explicit}`);
    }
  }
  try {
    return git(["merge-base", "HEAD", "origin/main"]);
  } catch {
    try {
      git(["rev-parse", "--verify", "HEAD^"]);
      return "HEAD^";
    } catch {
      return "HEAD";
    }
  }
}

let baseRef;
try {
  baseRef = baseline();
} catch (error) {
  console.error(`✖ 根因合同门禁无法确定可信基线：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const changedFiles = new Set(gitPaths(["diff", "--no-renames", "--name-only", baseRef, "--"], { cwd: repoRoot }));
for (const file of gitPaths(["ls-files", "--others", "--exclude-standard"], { cwd: repoRoot })) changedFiles.add(file);
const existingFiles = new Set(gitPaths(["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: repoRoot }));

const fixesDir = path.join(repoRoot, "docs", "fixes");
const contractFiles = fs.existsSync(fixesDir)
  ? fs.readdirSync(fixesDir).filter((file) => file.endsWith(".root-cause.json")).sort()
  : [];
const contracts = contractFiles.map((file) => {
  const absolutePath = path.join(fixesDir, file);
  try {
    const raw = fs.readFileSync(absolutePath, "utf8");
    return {
      ...JSON.parse(raw),
      __file: path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/"),
      __contentHash: createHash("sha256").update(raw).digest("hex"),
    };
  } catch (error) {
    console.error(`✖ 无法解析根因合同 ${path.relative(repoRoot, absolutePath)}：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
});

const legacyBaselineRelativePath = "scripts/root-cause-contract-v1-baseline.json";
const legacyBaselinePath = path.join(repoRoot, legacyBaselineRelativePath);
let legacyHashes;
try {
  let baselineRaw;
  try {
    baselineRaw = gitRaw(["show", `${baseRef}:${legacyBaselineRelativePath}`]);
  } catch {
    // Bootstrap only: before schema v2 reaches main, the trusted base has no baseline file yet.
    baselineRaw = fs.readFileSync(legacyBaselinePath, "utf8");
  }
  legacyHashes = new Map(Object.entries(JSON.parse(baselineRaw)));

  const baseContractFiles = gitPaths(["ls-tree", "-r", "--name-only", baseRef, "--", "docs/fixes"], { cwd: repoRoot })
    .filter((file) => file.endsWith(".root-cause.json"));
  const baseContracts = baseContractFiles.map((file) => {
    const raw = gitRaw(["show", `${baseRef}:${file}`]);
    return {
      ...JSON.parse(raw),
      __file: file,
      __contentHash: createHash("sha256").update(raw).digest("hex"),
    };
  });
  legacyHashes = inheritLegacyContractHashes(legacyHashes, baseContracts);
} catch (error) {
  console.error(`✖ 无法读取根因合同 v1 只读基线或可信 base 历史：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const history = validateRootCauseHistory({ contracts, legacyHashes });
if (!history.ok) {
  console.error("✖ 根因合同历史门禁失败");
  for (const error of history.errors) console.error(`  - ${error}`);
  process.exit(1);
}

const fileContents = new Map();
function loadFileContent(candidate) {
  const relative = String(candidate || "").replaceAll(path.sep, "/").replace(/^\.\//, "");
  if (!relative || fileContents.has(relative)) return;
  const absolute = path.resolve(repoRoot, relative);
  if (absolute === repoRoot || !absolute.startsWith(`${repoRoot}${path.sep}`)) return;
  try {
    if (fs.statSync(absolute).isFile()) fileContents.set(relative, fs.readFileSync(absolute, "utf8"));
  } catch {
    // The validator reports the missing path/content as a failed claim.
  }
}
// `@generated` 纯数据免门那条判据（root-cause-contracts.mjs 的 isGeneratedDataFile）要读文件正文，
// 而它要判的**正是没有门的那些文件**——只按 door.path 装内容，它永远读不到、永远返回 false，
// 于是规则对它自己要豁免的那一类不可达（2026-09-18 合并 Higgsfield + 六条 C 时实测：
// archetypeWireDefaults.{image,video}.generated.ts 仍被判「改了门表之外的文件」）。
// 本次改动的文件一律装上正文，判据才落到真实文件上。
for (const file of changedFiles) loadFileContent(file);

for (const contract of contracts) {
  // 门表（R21，2026-09-11）：每条 door 的 path:line 都要拿真实文件核对一遍。
  for (const door of Array.isArray(contract.doors) ? contract.doors : []) loadFileContent(door?.path);
  if (contract.change_kind !== "structural") continue;
  const preservedExports = contract.structural_evidence?.preserved_exports;
  if (!Array.isArray(preservedExports)) continue;
  for (const preserved of preservedExports) loadFileContent(preserved?.path);
}

// 门表补全（R21.3，2026-10-02 并入）：本次改动的纠正型合同没写 doors 时，检查自己调 door-map 数一遍，
// 当场补进内存里的合同（于是后面的门表校验判的是真门表，不是「没写」）；加 --fix-doors 才写回合同文件。
// 数的是合同 scope_paths 内、本次改动的 src/ electron/ 生产文件导出的符号；door_reduction 仍由作者填。
const fixDoors = process.argv.includes("--fix-doors");
const doorFillNotes = [];
for (const contract of contracts) {
  if (!changedFiles.has(contract.__file)) continue;
  if (contract.schema_version !== 3 || (contract.change_kind ?? "corrective") !== "corrective") continue;
  const datePrefix = /^(\d{4}-\d{2}-\d{2})-/.exec(path.basename(contract.__file))?.[1];
  if (!datePrefix || datePrefix < DOOR_MAP_SINCE) continue;
  if (Array.isArray(contract.doors) && contract.doors.length > 0) continue;
  const scopes = (Array.isArray(contract.scope_paths) ? contract.scope_paths : []).map((scope) => String(scope).replace(/\/+$/, ""));
  const targets = [...changedFiles].filter((file) =>
    /^(?:src|electron)\//.test(file)
    && /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file)
    && !/\.(?:test|spec)\.|\.node-test\./.test(file)
    && existingFiles.has(file)
    && scopes.some((scope) => file === scope || file.startsWith(`${scope}/`)));
  if (targets.length === 0) continue;
  const doors = doorsForTargets(targets);
  if (doors.length === 0) continue;
  contract.doors = doors;
  doorFillNotes.push(`${contract.__file}: 门表缺失，door-map 数出 ${doors.length} 扇（${targets.length} 个改动文件）${fixDoors ? "，已写回" : "，加 --fix-doors 写回"}`);
  if (fixDoors) {
    const absolute = path.join(repoRoot, contract.__file);
    const raw = JSON.parse(fs.readFileSync(absolute, "utf8"));
    raw.doors = doors;
    fs.writeFileSync(absolute, `${JSON.stringify(raw, null, 2)}
`);
  }
}
for (const note of doorFillNotes) console.error(`⚠ ${note}`);

const result = validateRootCauseChange({
  changedFiles: [...changedFiles],
  contracts,
  existingFiles,
  legacyHashes,
  fileContents,
});
// 只对 schema 不合法阻断，其余发现降为警告（见 root-cause-contracts.mjs 的 classifyFindings）。
const { blocking, warnings } = classifyFindings(result.errors);
console.log(`scanned=${contracts.length}`);
for (const warning of warnings) console.error(`⚠ ${warning}`);
if (blocking.length > 0) {
  console.error(`✖ 根因合同门禁失败（schema 不合法 ${blocking.length} 处；触发 ${result.triggeredFiles.length} 个高风险生产文件）`);
  for (const error of blocking) console.error(`  - ${error}`);
  process.exit(1);
}
if (warnings.length > 0) {
  console.error(`⚠ 根因合同：${warnings.length} 条警告不阻断；强制要合同的情况：修的是逃逸 bug 时由 merge-preflight 查（有 detected_by 的合同）；「第二次修同类问题」暂未检查。`);
}
if (result.triggeredFiles.length === 0) {
  console.log("✅ 根因合同门禁：本次无高风险生产路径变化");
} else if (warnings.length > 0) {
  console.log(`✅ 根因合同门禁：schema 合法（${warnings.length} 条警告，见上）`);
} else {
  console.log(`✅ 根因合同门禁：${result.triggeredFiles.length} 个高风险生产文件均有合同和变化中的回归测试`);
}
