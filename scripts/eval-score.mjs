// eval:score —— 免费评分段(两段式之二):读 output.jsonl + artifacts 轨迹 →
// 跑确定性断言 → scores.json + report.md。可反复重跑零额度(改断言不用重跑 agent)。
// 用法: pnpm eval:score [runDir]   (缺省取 evals/runs 下最新)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeCase, aggregateTrials, createdNodes } from "../evals/lib/grading.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runsRoot = path.join(repoRoot, "evals", "runs");

function latestRunDir() {
  if (!fs.existsSync(runsRoot)) return null;
  const dirs = fs
    .readdirSync(runsRoot)
    .filter((name) => fs.existsSync(path.join(runsRoot, name, "output.jsonl")))
    .sort();
  return dirs.length ? path.join(runsRoot, dirs[dirs.length - 1]) : null;
}

const runDir = process.argv[2] ? path.resolve(process.argv[2]) : latestRunDir();
if (!runDir || !fs.existsSync(path.join(runDir, "output.jsonl"))) {
  console.error("找不到 run 目录(或缺 output.jsonl)。先 pnpm eval:run <dataset>");
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8"));
const { cases } = await import(path.join(repoRoot, "evals", "datasets", `${meta.dataset}.mjs`));
const caseById = new Map(cases.map((c) => [c.id, c]));

function readEventsFromArtifacts(output) {
  const dir = path.join(runDir, output.eventsRef || "", "events");
  if (!fs.existsSync(dir)) return [];
  const events = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^log-\d+\.jsonl$/.test(f)).sort()) {
    for (const line of fs.readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {
        /* torn tail */
      }
    }
  }
  return events;
}

const outputs = fs
  .readFileSync(path.join(runDir, "output.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l));

const byCase = new Map();
for (const output of outputs) {
  const evalCase = caseById.get(output.caseId);
  if (!evalCase) continue;
  output.events = readEventsFromArtifacts(output);
  const grade = gradeCase(evalCase, output);
  if (!byCase.has(output.caseId)) byCase.set(output.caseId, []);
  byCase.get(output.caseId).push({ output, grade });
}

const caseResults = [];
for (const [caseId, trialsArr] of byCase) {
  const evalCase = caseById.get(caseId);
  const agg = aggregateTrials(trialsArr.map((t) => t.grade));
  caseResults.push({ caseId, description: evalCase.description, ...agg, trialsDetail: trialsArr });
}
caseResults.sort((a, b) => a.meanScore - b.meanScore || a.caseId.localeCompare(b.caseId));

const totalCases = caseResults.length;
const passAtK = caseResults.filter((c) => c.passAtK).length;
const passAllK = caseResults.filter((c) => c.passAllK).length;
const infraErrors = outputs.filter((o) => o.failureReason === "error").length;
const tokensTotal = outputs.reduce((s, o) => s + (o.metrics?.tokens?.totalTokens || 0), 0);
const latencyMean = outputs.length ? Math.round(outputs.reduce((s, o) => s + (o.metrics?.latencyMs || 0), 0) / outputs.length / 1000) : 0;

const scores = {
  runDir: path.basename(runDir),
  dataset: meta.dataset,
  gitCommit: meta.gitCommit,
  scoredAt: new Date().toISOString(),
  summary: {
    cases: totalCases,
    trialsPerCase: meta.trials,
    passAtK,
    passAllK,
    passAtKRate: totalCases ? +(passAtK / totalCases).toFixed(3) : 0,
    infraErrors,
    tokensTotal,
    latencyMeanSec: latencyMean,
  },
  cases: caseResults.map((c) => ({
    caseId: c.caseId,
    description: c.description,
    passAtK: c.passAtK,
    passAllK: c.passAllK,
    passRate: c.passRate,
    meanScore: c.meanScore,
    trials: c.trialsDetail.map((t) => ({
      trial: t.output.trial,
      pass: t.grade.pass,
      score: t.grade.score,
      reason: t.grade.reason,
      failureReason: t.grade.failureReason,
      tokens: t.output.metrics?.tokens?.totalTokens ?? null,
      artifacts: t.output.eventsRef,
    })),
  })),
};
fs.writeFileSync(path.join(runDir, "scores.json"), JSON.stringify(scores, null, 2));

// —— report.md:首屏 ≤5 行 verdict,最差 case 带下钻路径(评审设计师#5/用户#6) ——
const worst = caseResults.filter((c) => !c.passAtK).slice(0, 3);
const lines = [];
lines.push(`# Eval Report — ${meta.dataset} @ ${meta.gitCommit}`);
lines.push("");
lines.push(`**${passAtK}/${totalCases} case 通过(pass@${meta.trials})** · pass^k ${passAllK}/${totalCases} · infra 错误 ${infraErrors} · 共 ${tokensTotal.toLocaleString()} tokens · 平均 ${latencyMean}s/trial`);
if (worst.length) {
  lines.push("");
  lines.push(`最差 case:${worst.map((c) => `${c.caseId}(${c.meanScore})`).join(" / ")}`);
}
lines.push("");
lines.push("| case | 描述 | pass@k | 均分 | 失败原因(首个 trial) |");
lines.push("|---|---|---|---|---|");
for (const c of caseResults) {
  const firstFail = c.trialsDetail.find((t) => !t.grade.pass);
  lines.push(`| ${c.caseId} | ${c.description} | ${c.passAtK ? "✅" : "❌"} | ${c.meanScore} | ${firstFail ? firstFail.grade.reason.slice(0, 90) : ""} |`);
}
lines.push("");
lines.push("## 失败 case 下钻");
for (const c of caseResults.filter((x) => !x.passAtK)) {
  lines.push(`### ${c.caseId} ${c.description}`);
  for (const t of c.trialsDetail) {
    const created = createdNodes(t.output);
    lines.push(`- trial ${t.output.trial}: score ${t.grade.score} — ${t.grade.reason}`);
    lines.push(`  - 创建节点 ${created.length} 个:${created.map((n) => `${n.title || n.id}`).join(" / ") || "(无)"}`);
    lines.push(`  - 轨迹: \`${path.join(path.basename(runDir), t.output.eventsRef || "")}\``);
  }
}
fs.writeFileSync(path.join(runDir, "report.md"), lines.join("\n"));

// 终端 verdict(评审设计师#5:命令结束直接出结论)
console.log(`\n━━ ${meta.dataset} @ ${meta.gitCommit} ━━`);
console.log(`pass@${meta.trials}: ${passAtK}/${totalCases}${passAllK !== passAtK ? ` (pass^k ${passAllK}/${totalCases})` : ""} · infra 错误 ${infraErrors} · ${tokensTotal.toLocaleString()} tokens`);
for (const c of caseResults) console.log(`  ${c.passAtK ? "✅" : "❌"} ${c.caseId} ${c.description} (${c.meanScore})`);
console.log(`\n报告: ${path.relative(process.cwd(), path.join(runDir, "report.md"))}`);
process.exit(passAtK === totalCases && infraErrors === 0 ? 0 : 1);
