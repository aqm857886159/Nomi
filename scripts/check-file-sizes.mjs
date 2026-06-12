#!/usr/bin/env node
// 文件体积门岗 —— 落实 CLAUDE.md 规则 12（约束代码量、防巨型文件）。
//
// 机制（棘轮，只减不增）：
//   1. 任何非测试的 .ts/.tsx，行数不得超过 MAX_LINES（硬上限）。
//   2. 现存已超限的"巨壳"列入 ALLOWLIST 并记录基线行数；它们：
//        - 超过基线 → 红牌（你把已知巨壳改得更大了：拆分或精简，别再喂）。
//        - 低于基线 → 黄牌提示（你瘦身了，请把基线下调以锁定战果）。
//      目标是逐步把 ALLOWLIST 清空。
//   3. 新文件不得超过 MAX_LINES —— 想新增超限文件 = 先拆，或人工评审后入白名单。
//
// CSS 文件由规则 10 单独治理（只可减不可增），不在本门岗范围。
//
// 用法：node ./scripts/check-file-sizes.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 800;
const SCAN_DIRS = ["src", "electron"];

// 现存巨壳的基线行数（棘轮上限）。清空此表 = 巨壳债还清。
// 改小某个数 = 你成功瘦身后锁定的新上限。新增条目应经人工评审。
const ALLOWLIST = {
  "src/workbench/generationCanvas/nodes/scene3d/Scene3DFullscreen.tsx": 3860,
  "electron/runtime.ts": 755,
  "src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx": 935,
  "src/workbench/generationCanvas/components/GenerationCanvas.tsx": 991,
  // generationCanvasStore.ts 曾 871 行（巨壳）；S5-0 按 zustand slice 模式拆出 canvasStoreTypes.ts +
  // canvasNodeActions.ts + canvasGraphActions.ts + canvasRunActions.ts 后壳文件缩到 161 < 800，已出白名单。
  // NodeParameterControls.tsx 曾 1097 行（巨壳）；C2b 抽出 controls/parameterControlModel.ts +
  // archetypeMeta.ts + ModeBar.tsx 后缩到 605 < 800 硬上限，已出白名单（Rule 12：逐步清空白名单）。
};

function listFiles() {
  // 用 git 列出受跟踪文件，天然排除 node_modules / dist / 未跟踪草稿。
  const out = execSync("git ls-files " + SCAN_DIRS.join(" "), { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .filter((f) => !/\.d\.ts$/.test(f));
}

function countLines(absPath) {
  // 与 `wc -l` 一致：统计换行符数量。
  const content = fs.readFileSync(absPath, "utf8");
  return (content.match(/\n/g) || []).length;
}

const errors = [];
const warnings = [];

for (const rel of listFiles()) {
  const lines = countLines(path.join(ROOT, rel));
  const baseline = ALLOWLIST[rel];
  if (baseline !== undefined) {
    if (lines > baseline) {
      errors.push(`✗ ${rel}: ${lines} 行 > 基线 ${baseline}（已知巨壳又长大了 —— 拆分或精简，别再喂）`);
    } else if (lines < baseline) {
      warnings.push(`↓ ${rel}: ${lines} 行 < 基线 ${baseline}（已瘦身，请把 check-file-sizes.mjs 里的基线下调到 ${lines} 以锁定）`);
    }
  } else if (lines > MAX_LINES) {
    errors.push(`✗ ${rel}: ${lines} 行 > 上限 ${MAX_LINES}（新巨型文件 —— 请拆分；确需保留须人工评审后入 ALLOWLIST）`);
  }
}

for (const w of warnings) console.warn(w);

if (errors.length > 0) {
  console.error("\n文件体积门岗未通过（规则 12）：\n" + errors.join("\n") + "\n");
  process.exit(1);
}

console.log(`✓ 文件体积门岗通过：上限 ${MAX_LINES} 行，巨壳白名单 ${Object.keys(ALLOWLIST).length} 个（棘轮只减不增）。`);
