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

import {
  HUE_DRIFT_THRESHOLD,
  analyzeHueDrift,
  analyzeTransparentOklchMixes,
  collectTokenDefinitions,
} from "./lib/colorMixHue.mjs";
import { scanScopedTokenDefinitions } from "./lib/scopedTokenScan.mjs";

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
    .filter((f) => !f.startsWith("src/devlab/"))
    // git ls-files 连「工作树已删除、尚未 commit」的文件一起列出——门岗量的是工作树现状，
    // 消失的文件没有内容可查，跳过（commit 后 CI checkout 恒存在，不削弱棘轮）。
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
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

// ---- 第 5 类：color-mix(in oklch) 色相漂移（非棘轮，零容忍）----
//
// oklch 是极坐标空间，插值时**色相走最短弧**。把「有色相的色」和「被钉了色相的中性色」混在一起，
// 结果会落在两者之间某个跟谁都不像的色相上。2026-08-02 实锤：--nomi-accent-soft 期望淡蓝，
// 浅色实际算出 h≈347（粉）、暗色 h≈124（橄榄绿），全 App 80+ 个选中态/chip 跟着跑色，
// 而 --nomi-accent 本身一直是对的 —— 所以肉眼查 token 定义查不出来，必须靠算。
// 修法：改 `in srgb`（无色相分量，仓库既有做法：--nomi-focus、滚动条色）。
// 混 transparent 的那一族不归本类判（transparent 无色相、拽不动谁），由下面第 5b 类整体禁止。
const MIX_SCAN_GLOBS = "src electron tailwind.config.ts";
const mixFiles = execSync(`git ls-files ${MIX_SCAN_GLOBS}`, { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .filter((f) => /\.(tsx?|css|mjs)$/.test(f))
  .filter((f) => fs.existsSync(path.join(ROOT, f)))
  .map((f) => ({ path: f, content: fs.readFileSync(path.join(ROOT, f), "utf8") }));

const tokenDefs = collectTokenDefinitions(mixFiles.map((f) => f.content));
const hueFindings = analyzeHueDrift(mixFiles, tokenDefs);

if (hueFindings.length > 0) {
  errors.push(
    `✗ color-mix(in oklch) 色相漂移：${hueFindings.length} 处（两个操作数色相相差 > ${HUE_DRIFT_THRESHOLD}°，` +
      `oklch 会沿最短弧插值出一个跟谁都不像的色相）：\n` +
      hueFindings
        .map(
          (f) =>
            `    ${f.file}:${f.line}\n` +
            f.pairs
              .map(
                (p) =>
                  `      ${f.operandA}(h≈${p.hueA.toFixed(0)}) × ${f.operandB}(h≈${p.hueB.toFixed(0)})` +
                  (p.resultHue != null ? ` → 混出 h≈${p.resultHue.toFixed(0)}` : ` → 相差 ${p.delta.toFixed(0)}°`),
              )
              .join("\n") +
            `\n      修法：改成 color-mix(in srgb, …)（无色相分量，不会弧插值）`,
        )
        .join("\n"),
  );
}

// ---- 第 5b 类：color-mix(in oklch, X, transparent) 整体禁止（非棘轮，零容忍）----
//
// 「混 transparent 安全」曾是本门岗的原话，是假的：低彩度操作数转进 oklch 时色相被判 powerless
// 写成 `none`、落地当 h=0，淡蓝渲染成淡粉（tokenColor() 就这么把全 App 染粉过）。整族禁掉、
// 不按「操作数今天是中性的」放行；触发条件实测、修法与等价性证据见 scripts/lib/colorMixHue.mjs 文件头。
const transparentMixes = analyzeTransparentOklchMixes(mixFiles);

if (transparentMixes.length > 0) {
  errors.push(
    `✗ color-mix(in oklch, …, transparent)：${transparentMixes.length} 处（Chromium 会把低彩度操作数的色相判成 none、` +
      `落地当 h=0 → 淡蓝变淡粉；对中性 token 现在看不出，指向有色相 token 就静默出事）：\n` +
      transparentMixes
        .map((f) => `    ${f.file}:${f.line}  ${f.expression}\n      修法：改成 color-mix(in oklab, …)（无色相分量，中性 token 渲染恒等）`)
        .join("\n"),
  );
}

// ---- 第 6 类：语义 token 定义困在作用域里（非棘轮，零容忍）----
//
// CSS 自定义属性沿 **DOM 树**继承：--nomi-* / --workbench-* 的**定义**一旦写进 `.workbench-shell`
// 之类的类作用域，portal 到 body / 挂在 app 根 / 库页的浮层就解析不到 → var() 静默失效退回继承色
// （任务中心、库页确认卡勾勾两度实锤 rgb(201,201,201)），还会逼出「每个 portal 补挂作用域类」的桥。
// 2026-08-24 已把两族全量收口到 :root（docs/plan/2026-08-24-workbench-token-root-scope.md）。
// 本类拦回潮：只查真源层（src/electron 的 .css + tailwind.config.ts）；TSX 内联 style 是运行时
// 参数化，放行。扫描器在 scripts/lib/scopedTokenScan.mjs，自证见 scripts/scopedTokenScan.test.mjs。
const scopedDefs = scanScopedTokenDefinitions(
  mixFiles.filter((f) => f.path.endsWith(".css") || f.path.endsWith("tailwind.config.ts")),
);

if (scopedDefs.length > 0) {
  errors.push(
    `✗ 语义 token 定义困在作用域：${scopedDefs.length} 处（--nomi-*/--workbench-* 必须定义在 :root 层，` +
      `否则 portal/库页浮层解析不到、静默退灰）：\n` +
      scopedDefs
        .map((f) => `    ${f.file}:${f.line}  ${f.token} 定义在「${f.selector}」\n      修法：把定义挪进 tailwind.config.ts addBase 的 ':root'（暗色进 ':root[data-mantine-color-scheme="dark"]'）`)
        .join("\n"),
  );
}

for (const w of warnings) console.warn(w);

if (errors.length > 0) {
  console.error("\n设计 token 门岗未通过（token-only）：\n" + errors.join("\n") + "\n");
  process.exit(1);
}

console.log(
  `✓ 设计 token 门岗通过：${RULES.length} 类棘轮（只减不增，目标清零）。当前 ${counts.join("/")}（${RULES.map((r) => r.baseline).join("/")}）。` +
    `\n✓ color-mix 色相漂移零容忍：扫 ${mixFiles.length} 文件 / ${tokenDefs.size} 个 token 定义，无 in oklch 跨色相混合。` +
    `\n✓ color-mix(in oklch, …, transparent) 零容忍：无一处（混 transparent 一律 in oklab）。` +
    `\n✓ 语义 token 作用域零容忍：--nomi-*/--workbench-* 定义全部在 :root 层（portal/浮层任意挂载点都解析得到）。`,
);
