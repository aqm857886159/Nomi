// eval:diff —— 按 caseId 对齐两次 run 的 scores.json,输出回归表(新 fail/新 pass/分数漂移)。
// 有回归 → 非零退出(将来接 push 提醒)。
// 用法: pnpm eval:diff <runDirA(旧)> <runDirB(新)>
import fs from "node:fs";
import path from "node:path";

const [dirA, dirB] = process.argv.slice(2).map((p) => p && path.resolve(p));
if (!dirA || !dirB) {
  console.error("用法: pnpm eval:diff <runDirA(旧基线)> <runDirB(新)>");
  process.exit(2);
}
function load(dir) {
  const file = path.join(dir, "scores.json");
  if (!fs.existsSync(file)) {
    console.error(`缺 ${file} ——先 pnpm eval:score ${dir}`);
    process.exit(2);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
const a = load(dirA);
const b = load(dirB);
const aByCase = new Map(a.cases.map((c) => [c.caseId, c]));

const regressions = [];
const fixes = [];
const drifts = [];
const fresh = [];
for (const cb of b.cases) {
  const ca = aByCase.get(cb.caseId);
  if (!ca) {
    fresh.push(cb);
    continue;
  }
  if (ca.passAtK && !cb.passAtK) regressions.push({ caseId: cb.caseId, from: ca.meanScore, to: cb.meanScore });
  else if (!ca.passAtK && cb.passAtK) fixes.push({ caseId: cb.caseId, from: ca.meanScore, to: cb.meanScore });
  else if (Math.abs(cb.meanScore - ca.meanScore) >= 0.1) drifts.push({ caseId: cb.caseId, from: ca.meanScore, to: cb.meanScore });
}

console.log(`eval:diff ${a.runDir}(@${a.gitCommit}) → ${b.runDir}(@${b.gitCommit})`);
console.log(`pass@k: ${a.summary.passAtK}/${a.summary.cases} → ${b.summary.passAtK}/${b.summary.cases}`);
if (regressions.length) {
  console.log(`\n🔴 回归 ${regressions.length} 个:`);
  for (const r of regressions) console.log(`  ${r.caseId}: ${r.from} → ${r.to}`);
}
if (fixes.length) {
  console.log(`\n🟢 修复 ${fixes.length} 个:`);
  for (const r of fixes) console.log(`  ${r.caseId}: ${r.from} → ${r.to}`);
}
if (drifts.length) {
  console.log(`\n🟡 分数漂移 ≥0.1:`);
  for (const r of drifts) console.log(`  ${r.caseId}: ${r.from} → ${r.to}`);
}
if (fresh.length) console.log(`\n➕ 新 case: ${fresh.map((c) => c.caseId).join(", ")}`);
if (!regressions.length && !fixes.length && !drifts.length) console.log("\n无变化。");
process.exit(regressions.length ? 1 : 0);
