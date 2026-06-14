// eval:diff —— 回归门(Lane B)。两种用法:
//   pnpm eval:diff <新runDir>            # 对入库 golden 基线比(常用,缺基线提示先 eval:baseline)
//   pnpm eval:diff <旧runDir> <新runDir> # 直接比两次 run(临时对照)
// 回归判据(任一即非零退出):pass@k 翻转 / 均分跌 ≥0.1 / 任一质量维度跌 ≥0.1。
import fs from "node:fs";
import path from "node:path";
import { loadBaseline, diffAgainstBaseline, normalizeScores } from "../evals/lib/baseline.mjs";

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((p) => path.resolve(p));
if (positional.length === 0) {
  console.error("用法: pnpm eval:diff <新runDir> [旧runDir]");
  process.exit(2);
}

function loadScores(dir) {
  const file = path.join(dir, "scores.json");
  if (!fs.existsSync(file)) {
    console.error(`缺 ${file} ——先 pnpm eval:score ${dir}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function printDiff(label, d, newSummary) {
  console.log(label);
  if (d.regressions.length) {
    console.log(`\n🔴 回归 ${d.regressions.length} 个:`);
    for (const r of d.regressions) console.log(`  ${r.id}: ${r.from} → ${r.to}${r.kind ? ` (${r.kind})` : ""}`);
  }
  if (d.qualityRegressions.length) {
    console.log(`\n🔴 质量维度回归:`);
    for (const r of d.qualityRegressions) console.log(`  ${r.dim}: ${r.from} → ${r.to}`);
  }
  if (d.fixes.length) {
    console.log(`\n🟢 修复 ${d.fixes.length} 个:`);
    for (const r of d.fixes) console.log(`  ${r.id}: ${r.from} → ${r.to}`);
  }
  if (d.drifts.length) {
    console.log(`\n🟡 分数漂移 ≥0.1:`);
    for (const r of d.drifts) console.log(`  ${r.id}: ${r.from} → ${r.to}`);
  }
  if (d.fresh.length) console.log(`\n➕ 新增项: ${d.fresh.join(", ")}`);
  const regressed = d.regressions.length + d.qualityRegressions.length;
  if (!regressed && !d.fixes.length && !d.drifts.length) console.log("\n无变化。");
  return regressed;
}

let regressed = 0;
if (positional.length === 1) {
  // 单参数:对入库基线比
  const newScores = loadScores(positional[0]);
  const baseline = loadBaseline(newScores.dataset);
  if (!baseline) {
    console.error(`无 ${newScores.dataset} 基线——先 pnpm eval:baseline ${path.relative(process.cwd(), positional[0])} 入库一份`);
    process.exit(2);
  }
  const d = diffAgainstBaseline(baseline, newScores);
  const newNorm = normalizeScores(newScores);
  regressed = printDiff(
    `eval:diff 基线(@${baseline.gitCommit},${baseline.capturedAt?.slice(0, 10) || ""}) → ${newScores.runDir}(@${newScores.gitCommit})\npass@k 基线 ${baseline.items.filter((i) => i.passAtK).length}/${baseline.items.length} → 新 ${newNorm.items.filter((i) => i.passAtK).length}/${newNorm.items.length}`,
    d,
  );
} else {
  // 双参数:直接比两次 run(把旧 run 当临时基线)
  const a = loadScores(positional[0]);
  const b = loadScores(positional[1]);
  const baselineLike = { ...normalizeScores(a), capturedAt: "" };
  const d = diffAgainstBaseline(baselineLike, b);
  regressed = printDiff(`eval:diff ${a.runDir}(@${a.gitCommit}) → ${b.runDir}(@${b.gitCommit})`, d);
}

process.exit(regressed ? 1 : 0);
