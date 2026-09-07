#!/usr/bin/env node
/**
 * catalog validate —— Nomi skill validate 原型（对齐 agentskills.io 规则）
 * 用法：
 *   node validate-skill.mjs <path/to/skill-dir>        # 校验一个含 SKILL.md 的目录
 *   node validate-skill.mjs --catalog <catalog.json>   # 校验整个 catalog 的结构
 *
 * 对应立项 docs/plan/2026-09-07-skill-catalog-registry.md P0 §2；
 * 规则依据 research/2026-09-07-skill-ecosystem-catalog/research-official-format-and-imports.md。
 * 这是原型实现；拍板包 skills-ref validate 后本脚本可退化为 wrapper。
 */
import fs from "node:fs";
import path from "node:path";

const RESERVED = ["anthropic", "claude", "nomi"];

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return { frontmatter: null, body: text };
  const body = text.slice(m[0].length);
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    fm[k] = v;
  }
  return { frontmatter: fm, body };
}

export function validateSkillDir(dir, { internal = false } = {}) {
  const skillPath = path.join(dir, "SKILL.md");
  if (!fs.existsSync(skillPath)) {
    return { ok: false, name: path.basename(dir), errors: [`缺少 SKILL.md（技能正文必须放在 SKILL.md 里，与 Claude Code / pi 同格式）`] };
  }
  const text = fs.readFileSync(skillPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(text);
  if (!frontmatter) return { ok: false, name: path.basename(dir), errors: ["没有 YAML frontmatter（--- name/description --- 开头）"] };

  const dirName = path.basename(dir);
  const name = frontmatter.name ?? "";
  const desc = frontmatter.description ?? "";
  const errors = [];
  const checks = { nameLenOk: false, descLenOk: false, reservedWordOk: false, dirNameMatches: false };

  // name: 1-64, 小写字母/数字/连字符, 不以 - 开头结尾、无 --
  // internal 模式（Nomi 内建）：允许点号分段 workbench.creation.xxx（内部运行时格式，
  // 不进外部 catalog；此模式仅用于检查内建技能自身一致性）
  const namePattern = internal ? /^[a-z0-9]+([.-][a-z0-9]+)*$/ : /^[a-z0-9]+(-[a-z0-9]+)*$/;
  checks.nameLenOk = typeof name === "string" && name.length >= 1 && name.length <= 64 && namePattern.test(name);
  if (!checks.nameLenOk) errors.push(`name 非法（需 1-64 位${internal ? "小写字母/数字/点/连字符" : "小写字母/数字/连字符，不以 - 开头结尾"}）: "${name}"`);
  checks.dirNameMatches = internal
    ? name === dirName || name.replace(/\./g, "-") === dirName  // Nomi 内建约定：name 点号 ↔ 目录连字符等价
    : name === dirName;
  if (!checks.dirNameMatches) errors.push(`name (${name}) 与所在目录名 (${dirName}) 不一致`);
  checks.reservedWordOk = !RESERVED.some((w) => name.includes(w));
  if (!checks.reservedWordOk) errors.push(`name 含保留字（${RESERVED.join("/")}）: "${name}"`);
  checks.descLenOk = typeof desc === "string" && desc.length >= 1 && desc.length <= 1024;
  if (!checks.descLenOk) errors.push(`description 非法（需 1-1024 字符）: 当前 ${String(desc).length} 字符`);

  const lineCount = body.split(/\r?\n/).filter(Boolean).length;
  const huge = lineCount > 500;

  return {
    ok: errors.length === 0,
    name,
    dir: dirName,
    errors,
    checks,
    meta: { lines: lineCount, hugeBody: huge, chars: text.length },
    note: huge ? "正文超过建议 500 行上限（渐进披露：>5000 tokens），考虑拆到 references/" : undefined,
  };
}

// catalog 结构校验（轻量，不对整 schema 做全量——原型只查关键不变量）
export function validateCatalog(entries) {
  const ids = new Set();
  const problems = [];
  for (const e of entries) {
    if (!e.id) { problems.push(`条目缺 id`); continue; }
    if (ids.has(e.id)) problems.push(`重复 id: ${e.id}`);
    ids.add(e.id);
    if (!e.kind || !["skill", "effect-pack", "lora"].includes(e.kind)) problems.push(`${e.id}: kind 非法 (${e.kind})`);
    if (e.license === "none" && e.curation?.status === "official") problems.push(`${e.id}: 无 license 不能标 official（只能 open-directory）`);
    if (e.curation?.status === "official" && e.security?.verified !== "official") problems.push(`${e.id}: official 但 security.verified 非 official`);
  }
  return { ok: problems.length === 0, problems };
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--catalog") {
    const file = args[1];
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = Array.isArray(data) ? data : data.entries;
    const r = validateCatalog(entries);
    console.log(`catalog: ${entries.length} 条, ${r.ok ? "✓ 通过" : "✗ " + r.problems.length + " 问题"}`);
    for (const p of r.problems) console.log("  -", p);
    process.exit(r.ok ? 0 : 1);
  }
  if (!args[0]) { console.error("用法: validate-skill.mjs <skill-dir> [--internal] | --catalog <catalog.json>"); process.exit(2); }
  const internal = args.includes("--internal");
  const r = validateSkillDir(args[0], { internal });
  console.log(`${r.ok ? "✓" : "✗"} ${r.dir}: ${r.ok ? "合规" : "不合规"}`);
  for (const e of r.errors) console.log("  -", e);
  if (r.note) console.log("  !", r.note);
  process.exit(r.ok ? 0 : 1);
}

// 仅直接执行时跑 CLI（被 collect.mjs import 时跳过）
const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) main();
