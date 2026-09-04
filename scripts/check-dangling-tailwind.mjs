#!/usr/bin/env node
// 悬空 Tailwind 类门岗 —— 根治「token 键在 config 中不存在 → Tailwind 不生成该条 CSS → 静默失效」。
//
// 背景：2026-09-03 分镜表 v5 C 段实现写了 `text-nomi-ink-70`，而 ink 阶梯只有 05/10/20/30/40/60/80——
// 没有 70。Tailwind 对未知键**不报错也不生成**，那行字直接掉回继承色，肉眼不一定看得出。
// 既有 check-design-tokens 抓硬编码 px/hex，check-dangling-tokens 抓 `var(--未定义)`；
// 「类名引用了不存在的 token 键」这一类对两者都隐形，本门岗补这个洞。
//
// 两个方向（缺任一半都会制造同类静默失效，必须一起堵）：
//   正向 · 用了不存在的键：扫 src 静态类名 → 键必须在 theme.extend 里。
//   反向 · 定义了却没出口：扫 config 里的 --nomi-*/--workbench-* 颜色变量 → 必须被 theme 映射，
//          或显式登记进 unmapped 基线（确认它只给 CSS 直接 var() 消费）。
//          `--workbench-success-ink` 就是栽在这一半：明暗两套值都在，只差 theme 里一行映射，
//          于是全 App 10 处「已完成」绿字/绿勾静默掉回继承色。
//
// 只认**静态字面类名**（含 cn()/className 字符串里的），模板拼接的动态类名本就不该写（JIT 也扫不到）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 从 theme.extend 的某个块里取出所有键名（含带引号的复合键）。 */
export function keysOfBlock(cfg, blockName) {
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

const UTILS = ["text", "bg", "border", "ring", "fill", "stroke", "divide", "outline", "decoration", "shadow", "from", "via", "to", "accent", "caret", "placeholder"];
const MANAGED = /^(nomi|workbench)-/;

/** 受管前缀 → (工具类前缀, 该族已定义键集合)。只管我们自造的 nomi-/workbench- 族，不碰 Tailwind 原生调色板。 */
export function familiesOf(cfg) {
  return [
    { utils: UTILS, keys: keysOfBlock(cfg, "colors"), label: "颜色" },
    { utils: ["text"], keys: keysOfBlock(cfg, "fontSize"), label: "字号" },
    { utils: ["rounded"], keys: keysOfBlock(cfg, "borderRadius"), label: "圆角" },
    { utils: ["shadow"], keys: keysOfBlock(cfg, "boxShadow"), label: "阴影" },
    { utils: ["font"], keys: keysOfBlock(cfg, "fontFamily"), label: "字族" },
  ];
}

/**
 * 正向：在给定源文件里找出引用了未定义 token 键的静态类名。
 * @param {string} cfg tailwind.config.ts 全文
 * @param {Array<{file:string,text:string}>} sources
 */
export function findDanglingClasses(cfg, sources) {
  const families = familiesOf(cfg);
  const offenders = [];
  for (const { file, text } of sources) {
    text.split("\n").forEach((line, idx) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // 注释里的通配符示例不算用法
      const re = new RegExp(`(?<![\\w-])(${[...UTILS, "rounded", "font"].join("|")})-((?:nomi|workbench)-[\\w-]+)(?![\\w$-])`, "g");
      let m;
      while ((m = re.exec(line))) {
        const [, util, key] = m;
        if (!MANAGED.test(key)) continue;
        const fams = families.filter((f) => f.utils.includes(util));
        // 任一受管族认识这个键即放行（text- 同时可能是颜色或字号）
        if (!fams.some((f) => f.keys.has(key))) offenders.push({ file, line: idx + 1, cls: `${util}-${key}` });
      }
    });
  }
  return offenders;
}

const COLOR_VALUE = /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color-mix\()/;

/**
 * 反向：config 里定义了、值是颜色、却没被 theme.extend 映射的受管变量（--nomi- 与 --workbench- 两族）。
 * 只管颜色值——长度、时长、字体栈本就该由 CSS 直接 var() 消费，不该进 theme。
 */
export function findUnmappedColorVars(cfg) {
  const defined = new Map();
  for (const m of cfg.matchAll(/'(--(?:nomi|workbench)-[\w-]+)'\s*:\s*'([^']*)'/g)) {
    if (!defined.has(m[1])) defined.set(m[1], m[2]); // 首次=浅色块定义，暗色覆盖同名跳过
  }
  const isColor = (value, depth = 0) => {
    if (depth > 4 || !value) return false;
    const v = value.trim();
    if (COLOR_VALUE.test(v)) return true;
    const ref = v.match(/^var\(\s*(--[\w-]+)\s*\)$/); // --workbench-ink: var(--nomi-ink) 这类别名要追进去
    return ref && defined.has(ref[1]) ? isColor(defined.get(ref[1]), depth + 1) : false;
  };
  const themeIdx = cfg.indexOf("theme: {");
  const themeBlock = themeIdx < 0 ? "" : cfg.slice(themeIdx);
  const mapped = new Set();
  for (const m of themeBlock.matchAll(/(?:tokenColor\(\s*|var\(\s*)'?(--(?:nomi|workbench)-[\w-]+)'?/g)) mapped.add(m[1]);
  const unmapped = [...defined.keys()].filter((v) => isColor(defined.get(v)) && !mapped.has(v)).sort();
  return { defined, mapped, unmapped };
}

export function walkSources(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(p, acc);
    else if (/\.(ts|tsx|css)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function main() {
  const cfg = fs.readFileSync(path.join(root, "tailwind.config.ts"), "utf8");
  const sources = walkSources(path.join(root, "src")).map((p) => ({
    file: path.relative(root, p),
    text: fs.readFileSync(p, "utf8"),
  }));
  const offenders = findDanglingClasses(cfg, sources);
  const { defined, mapped, unmapped } = findUnmappedColorVars(cfg);

  // 两道棘轮共用 --baseline：都只减不增，新增一处即红。
  const baselinePath = path.join(root, "scripts", "dangling-tailwind-baseline.json");
  const unmappedBaselinePath = path.join(root, "scripts", "unmapped-token-baseline.json");
  const current = [...new Set(offenders.map((o) => `${o.file}::${o.cls}`))].sort();
  if (process.argv.includes("--baseline")) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    fs.writeFileSync(unmappedBaselinePath, `${JSON.stringify(unmapped, null, 2)}\n`);
    console.log(`✅ 已记录基线：${current.length} 处悬空类、${unmapped.length} 个未映射颜色变量`);
    return 0;
  }

  let failed = false;
  const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : [];
  const known = new Set(baseline);
  const added = current.filter((k) => !known.has(k));
  const fixed = baseline.filter((k) => !current.includes(k));
  if (added.length) {
    failed = true;
    console.error(`✖ 新增悬空 Tailwind 类 ${added.length} 处——类名里的 token 键在 tailwind.config.ts 中不存在。`);
    console.error("  Tailwind 对未知键不报错也不生成 CSS，该声明会静默失效（掉回继承值，肉眼常看不出）。");
    for (const k of added) {
      const [f, c] = k.split("::");
      const hit = offenders.find((o) => o.file === f && o.cls === c);
      console.error(`   ${f}:${hit ? hit.line : "?"}  ${c}`);
    }
    console.error("\n  → 改用已定义的档位（ink 阶梯只有 05/10/20/30/40/60/80），或去 tailwind.config.ts 定义它：");
    console.error("     addBase 里加 CSS 变量（**live 真源在此**，src/theme/nomi-tokens.css 只是样张用的镜像、App 不加载），");
    console.error("     并且**同时**在 theme.extend.colors 里加 tokenColor('--…') 映射——只加前者就是下面反向检查那一类。");
  } else {
    console.log(`✅ 悬空 Tailwind 类棘轮通过：欠账 ${current.length} 处（基线 ${baseline.length}）${fixed.length ? `，本次清掉 ${fixed.length} 处` : ""}。`);
  }

  const unmappedBaseline = fs.existsSync(unmappedBaselinePath) ? JSON.parse(fs.readFileSync(unmappedBaselinePath, "utf8")) : [];
  const knownUnmapped = new Set(unmappedBaseline);
  const newUnmapped = unmapped.filter((v) => !knownUnmapped.has(v));
  const nowMapped = unmappedBaseline.filter((v) => !unmapped.includes(v));
  if (newUnmapped.length) {
    failed = true;
    console.error(`\n✖ 新增「定义了颜色变量但没映射进 theme」${newUnmapped.length} 个——写成 Tailwind 类名会静默失效。`);
    for (const v of newUnmapped) {
      // 同族已映射的兄弟最能说明问题：--workbench-success 映射了、--workbench-success-ink 没有 = 半个家族。
      const sibling = [...mapped].find((m) => v.startsWith(`${m}-`));
      console.error(`   ${v} = ${defined.get(v)}${sibling ? `   ←「${sibling}」已映射，这是同族漏项` : ""}`);
    }
    console.error("\n  → 要么在 theme.extend.colors 里加 tokenColor('--…') 映射（想当 Tailwind 类用就必须加），");
    console.error("     要么确认它只给 CSS 直接 var() 消费、跑 `node scripts/check-dangling-tailwind.mjs --baseline` 收进基线。");
  } else {
    console.log(`✅ 未映射颜色变量棘轮通过：${unmapped.length} 个（基线 ${unmappedBaseline.length}）${nowMapped.length ? `，本次补映射 ${nowMapped.length} 个` : ""}。`);
  }

  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
