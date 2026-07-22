#!/usr/bin/env node
// 悬空 token 门岗 —— 根治「引用了不存在的 CSS 变量 → var() 静默回退」整类 bug。
//
// 背景：2026-06-22 发现 §14.1「清休眠暗色层」删掉了所有 --tc-* token 定义，但 tailwind.config.ts
// 仍把 text-caption/micro/body/rounded-pill 等活跃工具类映射到这些已删变量（无 fallback）。
// CSS 规范下 `font-size: var(--已删, 无兜底)` → 声明失效 → 继承父级 → 全 App 字号层级被抹平、
// 下拉胶囊变直角。check-design-tokens 只抓硬编码 px/hex，结构上抓不到「指向不存在变量」的悬空引用，
// 这一整类对它隐形。本门岗补这个洞。
//
// 机制：
//   1. 收集「已定义」token：所有 src/**/*.css 的 `--x:` 定义 + TS/TSX 里运行时注入的
//      内联 style（`'--x':` / `["--x"]:` / setProperty('--x'）。
//   2. 收集「被引用」token：src/**/*.{ts,tsx,css} 与 tailwind.config.ts 里所有 `var(--x)`，
//      但**带 fallback 的 `var(--x, …)` 放行**（有兜底，不会失效）。
//   3. 引用了但未定义（且不在外部库白名单）= 悬空 → 红牌，列出每个 file:line。
//
// 白名单前缀：--mantine-（Mantine 运行时注入）、--tw-（Tailwind 内部）。
//
// 用法：node ./scripts/check-dangling-tokens.mjs

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 外部/工具链运行时注入的 token，视为已定义。
const WHITELIST_PREFIXES = ["--mantine-", "--tw-"];

function gitFiles(globs) {
  const out = execSync(`git ls-files ${globs}`, { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").map((l) => l.trim()).filter(Boolean);
}

// 扫描范围：src 下的 ts/tsx/css + 仓库根的 tailwind.config.ts。
const SRC_FILES = gitFiles("src")
  .filter((f) => /\.(tsx?|css)$/.test(f))
  // git ls-files 连「工作树已删、未 commit」的文件一起列出——量工作树现状，消失的跳过（不削弱棘轮）。
  .filter((f) => fs.existsSync(path.join(ROOT, f)));
const CONFIG_FILES = ["tailwind.config.ts"].filter((f) => fs.existsSync(path.join(ROOT, f)));
const ALL_FILES = [...SRC_FILES, ...CONFIG_FILES];

// ---- 1. 已定义 token 集合 ----
const defined = new Set();
const DEF_CSS = /(^|[^A-Za-z0-9-])(--[A-Za-z0-9-]+)\s*:/g; // CSS `--x:`
const DEF_INLINE = /['"](--[A-Za-z0-9-]+)['"]\s*:/g; // 内联 style 对象 `'--x':`
const DEF_SETPROP = /setProperty\(\s*['"](--[A-Za-z0-9-]+)['"]/g; // setProperty('--x'
for (const rel of ALL_FILES) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const re of [DEF_CSS, DEF_INLINE, DEF_SETPROP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) defined.add(m[m.length - 1]);
  }
}

function isKnown(name) {
  return defined.has(name) || WHITELIST_PREFIXES.some((p) => name.startsWith(p));
}

// ---- 2+3. 被引用但未定义（无 fallback）----
// var(--x)  → 检查；var(--x, …) → 放行（有兜底）。group2 区分 ')' vs ','。
const REF = /var\(\s*(--[A-Za-z0-9-]+)\s*([,)])/g;
const findings = [];
for (const rel of ALL_FILES) {
  const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const lines = content.split("\n");
  lines.forEach((line, idx) => {
    REF.lastIndex = 0;
    let m;
    while ((m = REF.exec(line))) {
      const name = m[1];
      const hasFallback = m[2] === ",";
      if (hasFallback) continue;
      if (!isKnown(name)) {
        findings.push({ token: name, file: rel, line: idx + 1, text: line.trim() });
      }
    }
  });
}

if (findings.length > 0) {
  // 按 token 聚合
  const byToken = new Map();
  for (const f of findings) {
    if (!byToken.has(f.token)) byToken.set(f.token, []);
    byToken.get(f.token).push(`${f.file}:${f.line}`);
  }
  console.error("\n悬空 token 门岗未通过（引用了未定义的 CSS 变量 → var() 会静默回退）：\n");
  for (const [token, sites] of [...byToken.entries()].sort()) {
    console.error(`✗ ${token}（未定义）— ${sites.length} 处：`);
    for (const s of sites) console.error(`    ${s}`);
  }
  console.error(
    `\n共 ${byToken.size} 个未定义 token / ${findings.length} 处引用。` +
      `\n修法：① 该 token 应存在 → 在 src/theme/nomi-tokens.css 补定义（§0.5 ① 层）；` +
      `\n      ② 拼错/已废弃 → 改成就近的合法 token；③ 确需兜底 → 写 var(--x, 回退值)。\n`,
  );
  process.exit(1);
}

console.log(`✓ 悬空 token 门岗通过：扫 ${ALL_FILES.length} 文件，已定义 ${defined.size} 个 token，无悬空引用。`);
