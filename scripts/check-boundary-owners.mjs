#!/usr/bin/env node
// R1（docs/audit/2026-09-18-electron-unowned-state-structural-review.md §5）：
// 958 个声明过的 owner，过去只有合同校验器在立约那一刻看过一眼，之后没有任何门岗核过。
// 本门岗每次跑都逐条核「这个主人今天是不是还在那儿」。
//
// 本门岗**没有 --update / --write-baseline**：台账只能手改。
// 自动写基线 = 把红一键洗成绿，正是这次评审要消灭的「以为有人在管、其实没有」。
//
// 用法：node scripts/check-boundary-owners.mjs [--repo-root <目录>]
//   --repo-root 让测试拿同一组夹具把两道门（本门与 check:concept-owners）都跑一遍，核它们对同一份台账认同一个锚；
//   也用来只读地检查另一棵工作树。除它以外的参数一律拒绝（退出 2）：位置参数若被忽略，结果是悄悄检查脚本所在的这棵树，还报绿。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditBoundaries, evaluate, readContracts, readLedger } from "./boundary-owners.mjs";

const args = process.argv.slice(2);
const rootFlag = args.indexOf("--repo-root");
const rootArg = rootFlag >= 0 ? args[rootFlag + 1] : null;
if (rootFlag >= 0 && (!rootArg || rootArg.startsWith("--"))) {
  console.error("✖ --repo-root 后面要跟一个目录");
  process.exit(2);
}
const stray = args.filter((_, index) => rootFlag < 0 || (index !== rootFlag && index !== rootFlag + 1));
if (stray.length > 0) {
  console.error(`✖ 不认识的参数：${stray.join(" ")}（这道门只认 --repo-root <目录>，也没有 --update）`);
  process.exit(2);
}
const repoRoot = rootArg ? path.resolve(rootArg) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let ledger;
try {
  ledger = readLedger(repoRoot);
} catch (error) {
  console.error(`✖ 边界主人门禁无法开始：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
ledger.__repoRoot = repoRoot;

const entries = readContracts(repoRoot);
const results = auditBoundaries(repoRoot, entries);
const { ok, errors, stats } = evaluate({ results, ledger });

const census = `声明 ${stats.total} 条：在位 ${stats.ok} ｜ 改锚 ${stats.reanchored} ｜ 退役 ${stats.retired} ｜ 待查 ${stats.unverified} ｜ symbol 机器读不了 ${stats.unreadable}`;

if (!ok) {
  console.error(`✖ 边界主人门禁失败（${errors.length} 条）`);
  for (const message of errors) console.error(`  - ${message}`);
  console.error(`\n  ${census}`);
  console.error("\n  处置顺序（别图省事直接塞台账）：");
  console.error("   1. 主人只是搬家/改名 → 记进 reanchored，门岗会接着核新锚（这是真修）");
  console.error("   2. 主人确实没了、那条不变量不再适用 → 记进 retirements 并写清理由");
  console.error("   3. 一时处理不了 → 才进 unverified，且这份只许变少");
  process.exit(1);
}

console.log(`✅ 边界主人门禁：${census}`);
