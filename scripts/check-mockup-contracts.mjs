#!/usr/bin/env node
// 形态契约门岗（2026-09-03）——防「忘了写契约」静默退回人眼对账（L0）。
//
// 背景：拍板样张是 HTML、实现是 React，两套代码描述同一个东西，中间靠人脑翻译 →
// 漂移是结构性的。`tests/ux/_contract.mjs` 把形态意图变成二值断言解决了「能不能查」，
// 但如果没人写契约、或写了没人跑，机制就等于不存在。本门岗守这两件事：
//   1. **有样张的功能面必须有契约文件**（`docs/design/mockups/contracts/<样张名>.{intent,auto}.mjs`）
//   2. **契约必须被至少一条走查引用**（写了不跑 = 装饰品）
//
// 两层契约同规范：`*.intent.mjs`（拍板方手写的意图关系）/ `*.auto.mjs`（从样张导出的挂点/几何/token）。
// 任一层存在即算该样张有契约；两层都缺才算欠账。
//
// 棘轮：存量样张多数早于本机制，逐一补契约是独立工程。记基线、只减不增，新增样张必须带契约。
// 重记基线：`node ./scripts/check-mockup-contracts.mjs --baseline`

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOCKUP_DIR = path.join(root, "docs", "design", "mockups");
const CONTRACT_DIR = path.join(MOCKUP_DIR, "contracts");
const WALK_DIR = path.join(root, "tests", "ux");
const baselinePath = path.join(root, "scripts", "mockup-contracts-baseline.json");

if (!fs.existsSync(MOCKUP_DIR)) {
  console.log("✅ 形态契约门岗：无 mockups 目录，跳过。");
  process.exit(0);
}

const mockups = fs
  .readdirSync(MOCKUP_DIR)
  .filter((f) => f.endsWith(".html"))
  .sort();

const contracts = fs.existsSync(CONTRACT_DIR)
  ? fs.readdirSync(CONTRACT_DIR).filter((f) => /\.(intent|auto)\.mjs$/.test(f))
  : [];

// 走查全文（含子目录），用于判断契约有没有被引用。
function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, acc);
    else if (/\.(mjs|js|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const walkText = walkFiles(WALK_DIR)
  .map((f) => fs.readFileSync(f, "utf8"))
  .join("\n");

const missing = []; // 样张没有任何契约文件
const unused = []; // 契约文件没被任何走查引用

for (const html of mockups) {
  const base = html.replace(/\.html$/, "");
  const own = contracts.filter((c) => c.startsWith(`${base}.`));
  if (own.length === 0) missing.push(html);
}
for (const c of contracts) {
  if (!walkText.includes(c) && !walkText.includes(c.replace(/\.mjs$/, ""))) unused.push(c);
}

if (process.argv.includes("--baseline")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(missing.sort(), null, 2)}\n`);
  console.log(`✅ 已记录基线：${missing.length} 张样张暂无形态契约`);
  process.exit(0);
}

const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
const known = new Set(baseline);
const newlyMissing = missing.filter((m) => !known.has(m));
const cleared = baseline.filter((b) => !missing.includes(b));

let red = false;

if (newlyMissing.length) {
  red = true;
  console.error(`✖ ${newlyMissing.length} 张新样张没有形态契约：`);
  for (const m of newlyMissing) console.error(`   docs/design/mockups/${m}`);
  console.error(
    "\n  → 新增样张必须同产契约（拍板那刻的人才知道哪些关系承载意图）：",
  );
  console.error(
    `     docs/design/mockups/contracts/<样张名>.intent.mjs —— 见同目录已有样本`,
  );
}

if (unused.length) {
  red = true;
  console.error(`\n✖ ${unused.length} 份契约没有被任何走查引用（写了不跑 = 装饰品）：`);
  for (const u of unused) console.error(`   docs/design/mockups/contracts/${u}`);
  console.error("\n  → 在对应走查里 import 并调用 assertMockupContract（入口在 tests/ux/_assert.mjs）。");
}

if (red) process.exit(1);

console.log(
  `✅ 形态契约门岗通过：${contracts.length} 份契约全部被走查引用；欠契约样张 ${missing.length} 张（基线 ${baseline.length}）${cleared.length ? `，本次补齐 ${cleared.length} 张` : ""}。`,
);
