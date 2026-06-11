// eval:run —— L1 评测「花额度段」(两段式之一,抄 OpenHands run_infer):
// 每个 case×trial 全新隔离 Electron 实例跑真实 agent → 终态取证(落盘 project.json)
// + 轨迹(.nomi/events)拷进 run 目录 → append output.jsonl(断点续跑)。
// 跑完自动调 eval:score(免费段,可独立反复重跑)。
//
// 用法:
//   pnpm eval:run storyboard --smoke          # 冒烟档:smoke case × 1 trial(分钟级)
//   pnpm eval:run storyboard --k 3            # 全量档:全部 case × 3 trial(pass@3)
//   pnpm eval:run storyboard --cases sb-001   # 指定 case
//   pnpm eval:run storyboard --resume evals/runs/<dir>   # 续跑
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  prepareIsolation,
  launchIsolatedApp,
  createBlankProject,
  openGenerationAiPanel,
  readAssistantModelLabel,
  sendAgentMessage,
  approveUntilTurnEnds,
  waitForPersistedCanvas,
  readEventsLog,
} from "../evals/lib/isoApp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const datasetName = args.find((a) => !a.startsWith("--"));
if (!datasetName) {
  console.error("用法: pnpm eval:run <dataset> [--smoke] [--k N] [--cases id1,id2] [--resume <runDir>]");
  process.exit(1);
}
const smoke = args.includes("--smoke");
const kIdx = args.indexOf("--k");
const trials = kIdx >= 0 ? Math.max(1, Number(args[kIdx + 1]) || 1) : smoke ? 1 : 1;
const casesIdx = args.indexOf("--cases");
const onlyCases = casesIdx >= 0 ? new Set(String(args[casesIdx + 1] || "").split(",").filter(Boolean)) : null;
const resumeIdx = args.indexOf("--resume");
const resumeDir = resumeIdx >= 0 ? path.resolve(args[resumeIdx + 1]) : null;

const HARD_CAP = 60; // 评审后端#7:单次 run 的 case×trial 硬上限,防失控烧额度

const { cases } = await import(path.join(repoRoot, "evals", "datasets", `${datasetName}.mjs`));
let selected = cases;
if (smoke) selected = selected.filter((c) => c.smoke);
if (onlyCases) selected = selected.filter((c) => onlyCases.has(c.id));
if (selected.length === 0) {
  console.error("没有匹配的 case");
  process.exit(1);
}
if (selected.length * trials > HARD_CAP) {
  console.error(`case×trial=${selected.length * trials} 超过硬上限 ${HARD_CAP}——拆小批次跑`);
  process.exit(1);
}

const gitCommit = execSync("git rev-parse --short HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
const runDir = resumeDir || path.join(repoRoot, "evals", "runs", `${stamp}-${datasetName}${smoke ? "-smoke" : ""}`);
fs.mkdirSync(path.join(runDir, "artifacts"), { recursive: true });
const outputPath = path.join(runDir, "output.jsonl");
fs.writeFileSync(
  path.join(runDir, "meta.json"),
  JSON.stringify({ dataset: datasetName, gitCommit, smoke, trials, startedAt: new Date().toISOString(), cases: selected.map((c) => c.id) }, null, 2),
);

// 断点续跑:已完成 (caseId, trial) 跳过
const done = new Set();
if (fs.existsSync(outputPath)) {
  for (const line of fs.readFileSync(outputPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      done.add(`${o.caseId}#${o.trial}`);
    } catch {
      /* 撕裂尾行 */
    }
  }
}

console.log(`eval:run ${datasetName} — ${selected.length} case × ${trials} trial(已完成 ${done.size})→ ${path.relative(repoRoot, runDir)}`);

function trimNode(n) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    prompt: n.prompt,
    categoryId: n.categoryId,
    shotIndex: n.shotIndex ?? null,
    meta: n.meta ?? null,
    status: n.status,
    referencesCount: Array.isArray(n.references) ? n.references.length : 0,
  };
}

for (const evalCase of selected) {
  for (let trial = 1; trial <= trials; trial += 1) {
    const key = `${evalCase.id}#${trial}`;
    if (done.has(key)) continue;
    const isoDir = path.join(os.tmpdir(), "nomi-eval", path.basename(runDir), `${evalCase.id}-t${trial}`);
    const artifactsRel = path.join("artifacts", `${evalCase.id}-t${trial}`);
    const output = {
      caseId: evalCase.id,
      trial,
      ts: new Date().toISOString(),
      gitCommit,
      assistantModel: "",
      baselineNodeIds: [],
      terminalState: null,
      turn: null,
      metrics: {},
      eventsRef: artifactsRel,
      error: null,
      failureReason: null,
    };
    let app = null;
    const t0 = Date.now();
    try {
      console.log(`▶ ${key} ${evalCase.description}`);
      const iso = prepareIsolation(isoDir);
      const launched = await launchIsolatedApp(repoRoot, iso);
      app = launched.app;
      const win = launched.win;
      const projectDir = await createBlankProject(win, iso.projectsDir);
      const baselineRecord = await waitForPersistedCanvas(win, projectDir, { settleMs: 500, timeoutMs: 8000 });
      output.baselineNodeIds = (baselineRecord?.payload?.generationCanvas?.nodes || []).map((n) => n.id);
      await openGenerationAiPanel(win);
      output.assistantModel = await readAssistantModelLabel(win);
      await sendAgentMessage(win, evalCase.input.message);
      output.turn = await approveUntilTurnEnds(win, projectDir, { log: (m) => console.log(m) });
      const record = await waitForPersistedCanvas(win, projectDir);
      const canvas = record?.payload?.generationCanvas || { nodes: [], edges: [] };
      output.terminalState = {
        nodes: (canvas.nodes || []).map(trimNode),
        edges: (canvas.edges || []).map((e) => ({ source: e.source, target: e.target })),
      };
      const events = readEventsLog(projectDir);
      const finished = [...events].reverse().find((e) => e.type === "agent.turn.finished");
      output.metrics = {
        latencyMs: Date.now() - t0,
        tokens: finished?.payload?.usage ?? null,
        eventCount: events.length,
      };
      // 轨迹按引用归档(historyRef 引用制):整个 .nomi 拷进 run 目录
      fs.cpSync(path.join(projectDir, ".nomi"), path.join(runDir, artifactsRel), { recursive: true });
    } catch (error) {
      output.error = error instanceof Error ? error.message : String(error);
      output.failureReason = "error";
      output.metrics = { latencyMs: Date.now() - t0 };
      console.error(`  ✗ infra error: ${output.error}`);
    } finally {
      if (app) await app.close().catch(() => {});
      fs.rmSync(isoDir, { recursive: true, force: true });
    }
    fs.appendFileSync(outputPath, `${JSON.stringify(output)}\n`);
    const tok = output.metrics?.tokens?.totalTokens;
    console.log(`  ${output.failureReason === "error" ? "✗" : "·"} ${Math.round((output.metrics?.latencyMs || 0) / 1000)}s${tok ? ` · ${tok} tokens` : ""}`);
  }
}

console.log("\nrun 段完成,进入免费评分段…\n");
const score = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "eval-score.mjs"), runDir], { stdio: "inherit" });
process.exit(score.status ?? 0);
