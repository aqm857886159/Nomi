#!/usr/bin/env node
// 文件体积门岗：规则与棘轮基线存放在 scripts/file-sizes-baseline.json，代码只负责执行。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitPaths } from "./lib/gitPaths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = path.join(ROOT, "scripts", "file-sizes-baseline.json");
const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
const MAX_LINES = baseline.maxLines;
const SCAN_DIRS = baseline.scanDirs;
const ALLOWLIST = baseline.allowlist;

function listFiles() {
  return gitPaths(["ls-files", ...SCAN_DIRS], { cwd: ROOT })
    .filter((f) => /\.(?:tsx?|[mc]ts)$/.test(f))
    .filter((f) => !/\.test\.(?:tsx?|[mc]ts)$/.test(f))
    .filter((f) => !/\.d\.(?:ts|[mc]ts)$/.test(f))
    .filter((f) => !/^src\/i18n\/(locales\/.*|resources)\.ts$/.test(f))
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
}

function countLines(absPath) {
  return (fs.readFileSync(absPath, "utf8").match(/\n/g) || []).length;
}

const files = listFiles();
const errors = [];
const warnings = [];
for (const rel of files) {
  const lines = countLines(path.join(ROOT, rel));
  const baselineLines = ALLOWLIST[rel];
  if (baselineLines !== undefined) {
    if (lines > baselineLines) errors.push(`✗ ${rel}: ${lines} 行 > 基线 ${baselineLines}（已知巨壳又长大了 —— 拆分或精简，别再喂）`);
    else if (lines < baselineLines) warnings.push(`↓ ${rel}: ${lines} 行 < 基线 ${baselineLines}（已瘦身，请把 JSON 基线下调到 ${lines} 以锁定）`);
  } else if (lines > MAX_LINES) {
    errors.push(`✗ ${rel}: ${lines} 行 > 上限 ${MAX_LINES}（新巨型文件 —— 请拆分；确需保留须人工评审后入白名单）`);
  }
}
for (const warning of warnings) console.warn(warning);
console.log(`scanned=${files.length}`);
if (files.length === 0) errors.push("✗ 文件体积门岗没有扫描到任何源码文件（scanned=0；若确实适用空仓库，必须在 runner 里显式声明豁免）");
if (errors.length > 0) {
  console.error("\n文件体积门岗未通过（规则 12）：\n" + errors.join("\n") + "\n");
  process.exit(1);
}
console.log(`✓ 文件体积门岗通过：上限 ${MAX_LINES} 行，巨壳白名单 ${Object.keys(ALLOWLIST).length} 个（棘轮只减不增）。`);
