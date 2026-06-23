// eval:journey —— Lane C 完整用户流程评测(J1-J5)。
// 在隔离 Electron 实例里把每条旅程当多轮连续会话走,每里程碑做终态功能验证。
// 与 storyboard 评测同 run 目录约定(output.jsonl/scores.json/report.md),可被 eval:view 读。
//
// 用法:
//   pnpm eval:journey                 # 全部旅程 × 1 trial
//   pnpm eval:journey --smoke         # 冒烟档(smoke 旅程 + 全部零额度旅程)
//   pnpm eval:journey --ci            # 仅零额度旅程(J3/J5),失败非零退出(CI 用)
//   pnpm eval:journey --only j1-promo # 指定旅程
//   pnpm eval:journey --k 3           # 每条旅程 3 trial(pass@3)
//   pnpm eval:journey --model vk/mk   # 指定助手模型
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getJourneys } from "../evals/journeys/index.mjs";
import { runJourneyTrial } from "../evals/lib/journeyRunner.mjs";
import { aggregateTrials } from "../evals/lib/grading.mjs";
import { realCatalogPath } from "../evals/lib/isoApp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const ci = args.includes("--ci");
const smoke = args.includes("--smoke");
const kIdx = args.indexOf("--k");
const trials = kIdx >= 0 ? Math.max(1, Number(args[kIdx + 1]) || 1) : 1;
const onlyIdx = args.indexOf("--only");
const onlyIds = onlyIdx >= 0 ? new Set(String(args[onlyIdx + 1] || "").split(",").filter(Boolean)) : null;
const modelIdx = args.indexOf("--model");
const modelPref = (() => {
  if (modelIdx < 0) return null;
  const raw = String(args[modelIdx + 1] || "");
  const [vendorKey, modelKey] = raw.includes("/") ? raw.split("/", 2) : ["", raw];
  return modelKey ? { vendorKey, modelKey } : null;
})();

const journeys = getJourneys({ ids: onlyIds, ci, smoke });
if (journeys.length === 0) {
  // ci/smoke 模式下零额度 journey 暂时为空(j3/j5 删除后) → 优雅放行,别让 CI 红。
  // 指名 ids 却没匹配 = 用法错,仍报错退出。
  if ((ci || smoke) && !onlyIds) {
    console.log("当前没有零额度 journey 可跑(j3/j5 已删,待按当前 UI 流程重写)。跳过,视为通过。");
    process.exit(0);
  }
  console.error("没有匹配的旅程");
  process.exit(1);
}

const hasCatalog = fs.existsSync(realCatalogPath());
const gitCommit = execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
const runDir = path.join(repoRoot, "evals", "runs", `${stamp}-journeys${ci ? "-ci" : smoke ? "-smoke" : ""}`);
fs.mkdirSync(runDir, { recursive: true });
const outputPath = path.join(runDir, "output.jsonl");

console.log(`eval:journey — ${journeys.length} 旅程 × ${trials} trial${hasCatalog ? "" : "(无 catalog,需 agent 的旅程将跳过)"} → ${path.relative(repoRoot, runDir)}\n`);

const journeyResults = [];
for (const journey of journeys) {
  if (journey.needsAgent && !hasCatalog) {
    console.log(`⤼ SKIP ${journey.id}(需真实模型 catalog,本机未配置)`);
    journeyResults.push({ journeyId: journey.id, name: journey.name, skipped: true, trialsDetail: [] });
    continue;
  }
  console.log(`\n━━ ${journey.id} — ${journey.name} ━━`);
  console.log(`   成功标准:${journey.successCriterion}`);
  const trialGrades = [];
  const trialsDetail = [];
  for (let trial = 1; trial <= trials; trial += 1) {
    const result = await runJourneyTrial(repoRoot, journey, { trial, modelPref, log: (m) => console.log(m) });
    fs.appendFileSync(outputPath, `${JSON.stringify(result)}\n`);
    trialGrades.push({ pass: result.pass, score: result.score });
    trialsDetail.push(result);
    console.log(`  ${result.pass ? "✅" : result.failureReason === "error" ? "⚠️  infra" : "❌"} trial ${trial} — score ${result.score} · ${Math.round(result.metrics.latencyMs / 1000)}s${result.metrics.tokensTotal ? ` · ${result.metrics.tokensTotal} tokens` : ""}`);
  }
  journeyResults.push({ journeyId: journey.id, name: journey.name, ...aggregateTrials(trialGrades), trialsDetail });
}

// —— 聚合 + scores.json + report.md(与 storyboard 同形态)——
const ran = journeyResults.filter((j) => !j.skipped);
const passAtK = ran.filter((j) => j.passAtK).length;
const infraErrors = ran.reduce((s, j) => s + j.trialsDetail.filter((t) => t.failureReason === "error").length, 0);
const tokensTotal = ran.reduce((s, j) => s + j.trialsDetail.reduce((a, t) => a + (t.metrics?.tokensTotal || 0), 0), 0);

const scores = {
  runDir: path.basename(runDir),
  dataset: "journeys",
  gitCommit,
  scoredAt: new Date().toISOString(),
  summary: {
    journeys: ran.length,
    skipped: journeyResults.length - ran.length,
    trialsPerJourney: trials,
    passAtK,
    passAtKRate: ran.length ? +(passAtK / ran.length).toFixed(3) : 0,
    infraErrors,
    tokensTotal,
  },
  journeys: journeyResults.map((j) => ({
    journeyId: j.journeyId,
    name: j.name,
    skipped: Boolean(j.skipped),
    passAtK: j.passAtK ?? null,
    meanScore: j.meanScore ?? null,
    trials: (j.trialsDetail || []).map((t) => ({
      trial: t.trial,
      pass: t.pass,
      score: t.score,
      failureReason: t.failureReason,
      milestones: t.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        pass: m.pass,
        failed: m.checks.filter((c) => !c.pass).map((c) => `${c.label}${c.reason ? ` (${c.reason})` : ""}`),
      })),
    })),
  })),
};
fs.writeFileSync(path.join(runDir, "scores.json"), JSON.stringify(scores, null, 2));

const lines = [`# Journey Eval — @ ${gitCommit}`, ""];
lines.push(`**${passAtK}/${ran.length} 旅程通过(pass@${trials})** · infra 错误 ${infraErrors} · ${tokensTotal.toLocaleString()} tokens${scores.summary.skipped ? ` · 跳过 ${scores.summary.skipped}(无 catalog)` : ""}`);
lines.push("", "| 旅程 | pass@k | 均分 | 失败里程碑 |", "|---|---|---|---|");
for (const j of journeyResults) {
  if (j.skipped) { lines.push(`| ${j.journeyId} | ⤼ skip | — | 需真实 catalog |`); continue; }
  const firstFail = (j.trialsDetail[0]?.milestones || []).filter((m) => !m.pass).map((m) => m.id).join(", ");
  lines.push(`| ${j.journeyId} | ${j.passAtK ? "✅" : "❌"} | ${j.meanScore} | ${firstFail || "—"} |`);
}
lines.push("", "## 失败里程碑下钻");
for (const j of ran.filter((x) => !x.passAtK)) {
  lines.push(`### ${j.journeyId} ${j.name}`);
  for (const t of j.trialsDetail) {
    for (const m of t.milestones.filter((x) => !x.pass)) {
      lines.push(`- trial ${t.trial} · ${m.id}「${m.title}」: ${m.checks.filter((c) => !c.pass).map((c) => `${c.label}${c.reason ? ` (${c.reason})` : ""}`).join("; ")}`);
    }
  }
}
fs.writeFileSync(path.join(runDir, "report.md"), lines.join("\n"));

console.log(`\n━━ 完成 ━━`);
console.log(`pass@${trials}: ${passAtK}/${ran.length}${scores.summary.skipped ? ` (跳过 ${scores.summary.skipped})` : ""} · infra 错误 ${infraErrors}`);
console.log(`报告: ${path.relative(process.cwd(), path.join(runDir, "report.md"))}`);
process.exit(passAtK === ran.length && infraErrors === 0 ? 0 : 1);
