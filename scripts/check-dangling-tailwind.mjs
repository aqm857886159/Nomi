#!/usr/bin/env node
// 悬空 Tailwind 类门岗 —— 根治「类名里的 token 键在 config 中不存在 → Tailwind 不生成该条 CSS → 静默失效」。
//
// 背景：2026-09-03 分镜表 v5 C 段实现写了 `text-nomi-ink-70`，而 ink 阶梯只有 05/10/20/30/40/60/80——
// 没有 70。Tailwind 对未知键**不报错也不生成**，那行字直接掉回继承色，肉眼不一定看得出。
// 既有 check-design-tokens 抓硬编码 px/hex，check-dangling-tokens 抓 `var(--未定义)`；
// 「类名引用了不存在的 token 键」这一类对两者都隐形，本门岗补这个洞。
//
// 机制：从 tailwind.config.ts 的 theme.extend 解析各族已定义键（colors/fontSize/borderRadius/
// boxShadow/fontFamily），再扫 src 里对应前缀的类名用法，用了未定义键即红牌。
// 只认**静态字面类名**（含 cn()/className 字符串里的），模板拼接的动态类名本就不该写（JIT 也扫不到）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = fs.readFileSync(path.join(root, "tailwind.config.ts"), "utf8");

/** 从 theme.extend 的某个块里取出所有键名（含带引号的复合键）。 */
function keysOfBlock(blockName) {
  const start = cfg.indexOf(`${blockName}: {`);
  if (start < 0) return new Map();
  let depth = 0, i = cfg.indexOf("{", start), end = -1;
  for (; i < cfg.length; i++) {
    if (cfg[i] === "{") depth++;
    else if (cfg[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = cfg.slice(start, end);
  // 顶层组（如 nomi: { ... }）与叶子键都收，组内键拼成 `组-键`
  const out = new Map();
  const groupRe = /(?:^|\n)\s{8}(?:'([\w-]+)'|"([\w-]+)"|([\w-]+)):\s*\{/g;
  let g;
  const groupRanges = [];
  while ((g = groupRe.exec(body))) {
    const name = g[1] || g[2] || g[3];
    let d = 0, j = body.indexOf("{", g.index), e = -1;
    for (; j < body.length; j++) {
      if (body[j] === "{") d++;
      else if (body[j] === "}") { d--; if (d === 0) { e = j; break; } }
    }
    groupRanges.push([g.index, e]);
    const inner = body.slice(g.index, e);
    const leafRe = /(?:'([\w-]+)'|"([\w-]+)"|(\b[\w-]+)):\s*(?!\{)/g;
    let l;
    while ((l = leafRe.exec(inner))) {
      const k = l[1] || l[2] || l[3];
      if (k === name) continue;
      out.set(k === "DEFAULT" ? name : `${name}-${k}`, true);
      if (k === "DEFAULT") out.set(name, true);
    }
    out.set(name, true); // 组名本身（如 bg-nomi 不常用，但 text-nomi 可能）
  }
  // 组外叶子键（如 borderRadius / fontSize 直接列）
  const leafRe = /(?:^|\n)\s{8}(?:'([\w-]+)'|"([\w-]+)"|([\w-]+)):\s*(?!\{)/g;
  let m;
  while ((m = leafRe.exec(body))) {
    const inGroup = groupRanges.some(([s, e]) => m.index > s && m.index < e);
    if (inGroup) continue;
    out.set(m[1] || m[2] || m[3], true);
  }
  return out;
}

const colorKeys = keysOfBlock("colors");
const fontKeys = keysOfBlock("fontSize");
const radiusKeys = keysOfBlock("borderRadius");
const shadowKeys = keysOfBlock("boxShadow");
const familyKeys = keysOfBlock("fontFamily");

/** 受管前缀 → (工具类前缀, 该族已定义键集合)。只管我们自造的 nomi-/workbench- 族，不碰 Tailwind 原生调色板。 */
const FAMILIES = [
  { utils: ["text", "bg", "border", "ring", "fill", "stroke", "divide", "outline", "decoration", "shadow", "from", "via", "to", "accent", "caret", "placeholder"], keys: colorKeys, label: "颜色" },
  { utils: ["text"], keys: fontKeys, label: "字号" },
  { utils: ["rounded"], keys: radiusKeys, label: "圆角" },
  { utils: ["shadow"], keys: shadowKeys, label: "阴影" },
  { utils: ["font"], keys: familyKeys, label: "字族" },
];
const MANAGED = /^(nomi|workbench)-/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const offenders = [];
for (const file of walk(path.join(root, "src"))) {
  const text = fs.readFileSync(file, "utf8");
  text.split("\n").forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // 注释里的通配符示例不算用法
    // 抓形如 text-nomi-ink-70 / rounded-nomi-xl / shadow-workbench-foo 的静态类名
    const re = /(?<![\w-])(text|bg|border|ring|fill|stroke|divide|outline|decoration|shadow|from|via|to|accent|caret|placeholder|rounded|font)-((?:nomi|workbench)-[\w-]+)/g;
    let m;
    while ((m = re.exec(line))) {
      const [, util, key] = m;
      if (!MANAGED.test(key)) continue;
      const fams = FAMILIES.filter((f) => f.utils.includes(util));
      // 任一受管族认识这个键即放行（text- 同时可能是颜色或字号）
      const known = fams.some((f) => f.keys.has(key));
      if (!known) offenders.push({ file: path.relative(root, file), line: idx + 1, cls: `${util}-${key}` });
    }
  });
}

// 棘轮：现存 82 处是历史欠账（`--baseline` 重记），只减不增；新增一处即红。
const baselinePath = path.join(root, "scripts", "dangling-tailwind-baseline.json");
const current = [...new Set(offenders.map((o) => `${o.file}::${o.cls}`))].sort();
if (process.argv.includes("--baseline")) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`✅ 已记录基线：${current.length} 处悬空类`);
  process.exit(0);
}
const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
const known = new Set(baseline);
const added = current.filter((k) => !known.has(k));
const fixed = baseline.filter((k) => !current.includes(k));
if (added.length) {
  console.error(`✖ 新增悬空 Tailwind 类 ${added.length} 处——类名里的 token 键在 tailwind.config.ts 中不存在。`);
  console.error("  Tailwind 对未知键不报错也不生成 CSS，该声明会静默失效（掉回继承值，肉眼常看不出）。");
  for (const k of added) {
    const [f, c] = k.split("::");
    const hit = offenders.find((o) => o.file === f && o.cls === c);
    console.error(`   ${f}:${hit ? hit.line : "?"}  ${c}`);
  }
  console.error("\n  → 改用已定义的档位（ink 阶梯只有 05/10/20/30/40/60/80），或先在 nomi-tokens.css + tailwind.config.ts 里定义它。");
  process.exit(1);
}
console.log(`✅ 悬空 Tailwind 类棘轮通过：欠账 ${current.length} 处（基线 ${baseline.length}）${fixed.length ? `，本次清掉 ${fixed.length} 处` : ""}。`);
