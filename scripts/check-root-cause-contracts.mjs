#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRootCauseChange } from "./root-cause-contracts.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
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
const changedFiles = new Set(lines(git(["diff", "--name-only", baseRef, "--"])));
for (const file of lines(git(["ls-files", "--others", "--exclude-standard"]))) changedFiles.add(file);
const existingFiles = new Set(lines(git(["ls-files", "--cached", "--others", "--exclude-standard"])));

const fixesDir = path.join(repoRoot, "docs", "fixes");
const contractFiles = fs.existsSync(fixesDir)
  ? fs.readdirSync(fixesDir).filter((file) => file.endsWith(".root-cause.json")).sort()
  : [];
const contracts = contractFiles.map((file) => {
  const absolutePath = path.join(fixesDir, file);
  try {
    return {
      ...JSON.parse(fs.readFileSync(absolutePath, "utf8")),
      __file: path.relative(repoRoot, absolutePath).replaceAll(path.sep, "/"),
    };
  } catch (error) {
    console.error(`✖ 无法解析根因合同 ${path.relative(repoRoot, absolutePath)}：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
});

const result = validateRootCauseChange({ changedFiles: [...changedFiles], contracts, existingFiles });
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
