// 评测节奏门岗(评测方案 §4,提醒不阻断,永远 exit 0):
//   ① 真实轨迹攒够 ~50 条 agent 轮次 → 提醒做一轮 error analysis(事件驱动,不按日历硬转)
//   ② agent 链路文件(prompt/工具/模型 profile)在上次 eval run 之后有改动 → 提醒跑 smoke 档
// 接进 check:audit 同一节奏(R14)。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gitPaths } from "./lib/gitPaths.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TURN_THRESHOLD = 50;
/** 改了这些路径 = 动了被评测的 agent 行为面。 */
const AGENT_PATHS = ["electron/ai/", "src/workbench/generationCanvas/agent/", "src/workbench/ai/"];

// ① 轨迹计数:上次 error analysis(docs/audit 里带 error-analysis 的文档的 mtime)之后的新轮次
function lastAnalysisTime() {
  const auditDir = path.join(repoRoot, "docs", "audit");
  if (!fs.existsSync(auditDir)) return 0;
  let latest = 0;
  for (const f of fs.readdirSync(auditDir)) {
    if (/error-analysis/.test(f)) latest = Math.max(latest, fs.statSync(path.join(auditDir, f)).mtimeMs);
  }
  return latest;
}

function countTurnsSince(sinceMs) {
  let turns = 0;
  const candidates = [path.join(os.homedir(), "Documents", "Nomi Projects")];
  try {
    const registry = JSON.parse(
      fs.readFileSync(path.join(os.homedir(), "Library", "Application Support", "Nomi", "recent-workspaces.json"), "utf8"),
    );
    for (const item of Array.isArray(registry) ? registry : []) if (item?.rootPath) candidates.push(item.rootPath);
  } catch {
    /* ignore */
  }
  const projectDirs = new Set();
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, ".nomi", "events"))) projectDirs.add(dir);
    else {
      try {
        for (const e of fs.readdirSync(dir)) if (fs.existsSync(path.join(dir, e, ".nomi", "events"))) projectDirs.add(path.join(dir, e));
      } catch {
        /* ignore */
      }
    }
  }
  for (const projectDir of projectDirs) {
    const eventsDir = path.join(projectDir, ".nomi", "events");
    for (const f of fs.readdirSync(eventsDir)) {
      if (!/^log-\d+\.jsonl$/.test(f)) continue;
      for (const line of fs.readFileSync(path.join(eventsDir, f), "utf8").split("\n")) {
        if (!line.includes('"agent.turn.started"')) continue;
        try {
          const e = JSON.parse(line);
          if (Date.parse(e.ts) > sinceMs) turns += 1;
        } catch {
          /* torn */
        }
      }
    }
  }
  return turns;
}

// ② agent 链路改动 vs 上次 eval run 的 commit
function lastEvalRunCommit() {
  const runsRoot = path.join(repoRoot, "evals", "runs");
  if (!fs.existsSync(runsRoot)) return null;
  const metas = fs
    .readdirSync(runsRoot)
    .map((d) => path.join(runsRoot, d, "meta.json"))
    .filter((f) => fs.existsSync(f))
    .sort();
  if (!metas.length) return null;
  try {
    return JSON.parse(fs.readFileSync(metas[metas.length - 1], "utf8")).gitCommit || null;
  } catch {
    return null;
  }
}

function agentFilesChangedSince(commit) {
  try {
    const out = gitPaths(["diff", "--name-only", `${commit}..HEAD`], { cwd: repoRoot }).join("\n");
    return out.split("\n").filter((f) => AGENT_PATHS.some((p) => f.startsWith(p)));
  } catch {
    return [];
  }
}

const turns = countTurnsSince(lastAnalysisTime());
if (turns >= TURN_THRESHOLD) {
  console.log(`📋 真实轨迹已攒 ${turns} 条轮次(≥${TURN_THRESHOLD})——该做一轮 error analysis 了:`);
  console.log(`   pnpm eval:view --project <项目目录> 翻轨迹标注 → 失败分类落 docs/audit/<date>-error-analysis.md`);
} else if (turns > 0) {
  console.log(`轨迹积累中:${turns}/${TURN_THRESHOLD} 条轮次(攒够再做 error analysis,不按日历硬转)。`);
}

const baseCommit = lastEvalRunCommit();
if (baseCommit) {
  const changed = agentFilesChangedSince(baseCommit);
  if (changed.length > 0) {
    console.log(`🧪 agent 链路自上次 eval(@${baseCommit})后改了 ${changed.length} 个文件——push 前建议跑冒烟档:`);
    console.log(`   pnpm eval:run storyboard --smoke   (≈3 分钟,改完对一下「变好还是变坏」)`);
    for (const f of changed.slice(0, 5)) console.log(`   · ${f}`);
  }
} else {
  console.log(`还没有任何 eval run 基线——先跑一次: pnpm eval:run storyboard --smoke`);
}
process.exit(0);
