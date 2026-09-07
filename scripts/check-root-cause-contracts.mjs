#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inheritLegacyContractHashes, validateRootCauseChange, validateRootCauseHistory } from "./root-cause-contracts.mjs";
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
const changedFiles = new Set(gitPaths(["diff", "--name-only", baseRef, "--"], { cwd: repoRoot }));
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
for (const contract of contracts) {
  if (contract.change_kind !== "structural") continue;
  const preservedExports = contract.structural_evidence?.preserved_exports;
  if (!Array.isArray(preservedExports)) continue;
  for (const preserved of preservedExports) {
    const relative = String(preserved?.path || "").replaceAll(path.sep, "/").replace(/^\.\//, "");
    const absolute = path.resolve(repoRoot, relative);
    if (absolute === repoRoot || !absolute.startsWith(`${repoRoot}${path.sep}`)) continue;
    try {
      if (fs.statSync(absolute).isFile()) fileContents.set(relative, fs.readFileSync(absolute, "utf8"));
    } catch {
      // The validator reports the missing path/content as a failed structural claim.
    }
  }
}

const result = validateRootCauseChange({
  changedFiles: [...changedFiles],
  contracts,
  existingFiles,
  legacyHashes,
  fileContents,
});
if (!result.ok) {
  console.error(`✖ 根因合同门禁失败（触发 ${result.triggeredFiles.length} 个高风险生产文件）`);
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
if (result.triggeredFiles.length === 0) {
  console.log("✅ 根因合同门禁：本次无高风险生产路径变化");
} else {
  console.log(`✅ 根因合同门禁：${result.triggeredFiles.length} 个高风险生产文件均有合同和变化中的回归测试`);
}
