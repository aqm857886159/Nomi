#!/usr/bin/env node
// 设计 token 门岗 —— 落实 CLAUDE.md「token-only」与设计系统 §2/§6（禁绕过 token 写任意值）。
//
// 背景：2026-06-15 全套设计审查发现 token 纪律大面积侵蚀（228 任意 px 字号 / 84 任意圆角 /
// off-token 颜色），且 bodySm 错类静默回退 16px 那类 bug 正源于此。本门岗根治整类：
//
// 机制（棘轮，只减不增，仿 check-file-sizes）：
//   - 每类违规（任意 px 字号 / 任意 px 圆角 / 硬编码 hex 颜色 / Tailwind 默认色板）统计全仓出现次数。
//   - 超过 BASELINE → 红牌（你新增了绕过 token 的写法：改用 token）。
//   - 低于 BASELINE → 黄牌（你清理了，请把基线下调以锁定战果）。目标逐步清零。
//
// 不算违规（放行）：`text-[var(--…)]` / `bg-[var(--…)]` 等用 token 变量的写法（那是 token，只是 bracket 语法）。
//
// 用法：node ./scripts/check-design-tokens.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 各类违规的正则 + 当前基线（棘轮上限）。把基线逐步降到 0 = token 债还清。
const RULES = [
  {
    key: "任意 px 字号（用 text-caption/micro/body-sm/body/title/h2/h1/display）",
    re: /\btext-\[[0-9.]+px\]/g,
    baseline: 0, // 已清零(28px 品牌标题 → text-display token)
  },
  {
    key: "任意 px 圆角（用 rounded-nomi-sm/nomi/nomi-lg）",
    re: /\brounded-\[[0-9.]+px\]/g,
    baseline: 0, // 已清零(全 snap 到 6/10/14 标尺)
  },
  {
    key: "硬编码 hex 颜色（用语义 token）",
    re: /\b(?:text|bg|border|fill|stroke|from|to|ring|outline|divide)-\[#[0-9a-fA-F]{3,8}\b/g,
    baseline: 0, // 已清零
  },
  {
    key: "Tailwind 默认色板（用语义 token）",
    re: /\b(?:text|bg|border|ring|divide|from|to)-(?:red|blue|green|yellow|gray|slate|zinc|amber|sky|indigo|emerald|rose|orange|teal|violet|cyan|lime|fuchsia|pink|purple)-[0-9]{2,3}\b/g,
    baseline: 0, // 已清零（原 3 处 Scene3DFullscreen XYZ 轴色已不再以默认色板形式出现，锁定战果）
  },
];

function listFiles() {
  const out = execSync("git ls-files src", { cwd: ROOT, encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    // 3D 预设动作校准台：仅 dev 工具（独立 Three.js 渲染页，非产品 UI），不纳入设计 token 门禁。
    .filter((f) => !f.startsWith("src/devlab/"));
}

const files = listFiles();
const counts = RULES.map(() => 0);

for (const rel of files) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  RULES.forEach((rule, i) => {
    const m = content.match(rule.re);
    if (m) counts[i] += m.length;
  });
}

const errors = [];
const warnings = [];
RULES.forEach((rule, i) => {
  const n = counts[i];
  if (n > rule.baseline) {
    errors.push(`✗ ${rule.key}：${n} 处 > 基线 ${rule.baseline}（新增了绕过 token 的写法 —— 改用 token）`);
  } else if (n < rule.baseline) {
    warnings.push(`↓ ${rule.key}：${n} 处 < 基线 ${rule.baseline}（已清理，请把 check-design-tokens.mjs 基线下调到 ${n} 锁定）`);
  }
});

for (const w of warnings) console.warn(w);

if (errors.length > 0) {
  console.error("\n设计 token 门岗未通过（token-only）：\n" + errors.join("\n") + "\n");
  process.exit(1);
}

console.log(`✓ 设计 token 门岗通过：${RULES.length} 类棘轮（只减不增，目标清零）。当前 ${counts.join("/")}（${RULES.map((r) => r.baseline).join("/")}）。`);
