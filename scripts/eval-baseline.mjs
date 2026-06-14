// eval:baseline —— 把一次 scores.json 提升为入库的 golden 基线(Lane B)。
// 改 agent 前先存基线,改后 eval:diff 自动对它比;分数掉了回归门报红。
// 用法:
//   pnpm eval:baseline [runDir]          # 缺省取 evals/runs 下最新有 scores.json 的
//   pnpm eval:baseline [runDir] --yes    # 跳过覆盖确认
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeScores, baselinePath, BASELINE_DIR, loadBaseline } from "../evals/lib/baseline.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runsRoot = path.join(repoRoot, "evals", "runs");

function latestScoredRun() {
  if (!fs.existsSync(runsRoot)) return null;
  const dirs = fs.readdirSync(runsRoot)
    .filter((n) => fs.existsSync(path.join(runsRoot, n, "scores.json")))
    .sort();
  return dirs.length ? path.join(runsRoot, dirs[dirs.length - 1]) : null;
}

const arg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const runDir = arg ? path.resolve(arg) : latestScoredRun();
if (!runDir || !fs.existsSync(path.join(runDir, "scores.json"))) {
  console.error("找不到 scores.json——先 pnpm eval:run / eval:journey 跑出一次");
  process.exit(1);
}

const scores = JSON.parse(fs.readFileSync(path.join(runDir, "scores.json"), "utf8"));
const baseline = {
  ...normalizeScores(scores),
  capturedAt: new Date().toISOString(),
  sourceRun: path.basename(runDir),
};
if (!baseline.dataset) {
  console.error("scores.json 缺 dataset 字段,无法定位基线文件");
  process.exit(1);
}

const target = baselinePath(baseline.dataset);
const existing = loadBaseline(baseline.dataset);
if (existing && !process.argv.includes("--yes")) {
  console.log(`已有基线 ${path.relative(repoRoot, target)}(@${existing.gitCommit},${existing.items?.length || 0} 项)。`);
  console.log(`将覆盖为 @${baseline.gitCommit}(${baseline.items.length} 项)。加 --yes 确认覆盖。`);
  process.exit(2);
}

fs.mkdirSync(BASELINE_DIR, { recursive: true });
fs.writeFileSync(target, JSON.stringify(baseline, null, 2));
console.log(`✅ 基线已入库:${path.relative(repoRoot, target)}`);
console.log(`   ${baseline.dataset} @ ${baseline.gitCommit} · ${baseline.items.length} 项 · pass@k ${baseline.items.filter((i) => i.passAtK).length}/${baseline.items.length}`);
if (baseline.summary?.qualityByDimension) {
  console.log(`   质量分卡已纳入基线(回归门将监控各维跌幅 ≥0.1)`);
}
console.log(`\n提交它:git add ${path.relative(repoRoot, target)}(基线入库,run 产物仍 gitignore)`);
