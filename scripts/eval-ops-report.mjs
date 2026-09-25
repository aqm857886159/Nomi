// 评测体系 S0.5:零额度运营报告(docs/plan/2026-06-11-eval-system-master-plan.md §4)。
// 从 EventLog(真实使用轨迹)直接统计——评测循环里最早产生行动价值的消费物:
//   ① agent 轮次 / 错误率 / token 用量;② vendor 调用成功率 / P50·P90 时延(requested↔completed 按 runId 配对);
//   ③ 按模型分解。成本字段等 harness S7(cost 写回)后自动出现。
// 用法:
//   node scripts/eval-ops-report.mjs [--days 7] [--json] [额外项目根目录...]
// 默认扫 ~/Documents/Nomi Projects + recent-workspaces.json 里登记的外部目录。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { realNomiProfile } from "../tests/ux/_realProfile.mjs";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const daysIdx = args.indexOf("--days");
const days = daysIdx >= 0 ? Number(args[daysIdx + 1]) || 7 : 7;
const extraRoots = args.filter((a, i) => !a.startsWith("--") && (daysIdx < 0 || i !== daysIdx + 1));
const since = Date.now() - days * 24 * 60 * 60 * 1000;

/** 候选目录 → 项目目录集合:候选自己带 .nomi/events 即项目;否则当项目根,子目录里找。 */
function discoverProjectDirs() {
  const candidates = new Set();
  const defaultRoot = path.join(os.homedir(), "Documents", "Nomi Projects");
  if (fs.existsSync(defaultRoot)) candidates.add(defaultRoot);
  const registry = path.join(realNomiProfile().userDataDir, "recent-workspaces.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(registry, "utf8"));
    const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of items) {
      const dir = typeof item === "string" ? item : item?.rootPath || item?.path || "";
      if (dir && fs.existsSync(dir)) candidates.add(dir);
    }
  } catch {
    /* 注册表缺失/格式变化:静默,默认根仍可用 */
  }
  for (const dir of extraRoots) if (fs.existsSync(dir)) candidates.add(path.resolve(dir));

  const projects = new Set();
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, ".nomi", "events"))) {
      projects.add(dir);
      continue;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = path.join(dir, entry.name);
      if (fs.existsSync(path.join(child, ".nomi", "events"))) projects.add(child);
    }
  }
  return [...projects];
}

function* eventLogFiles(projectDir) {
  const eventsDir = path.join(projectDir, ".nomi", "events");
  let files = [];
  try {
    files = fs.readdirSync(eventsDir);
  } catch {
    return;
  }
  for (const file of files.sort()) {
    if (/^log-\d+\.jsonl$/.test(file)) yield path.join(eventsDir, file);
  }
}

function readEvents(file) {
  const events = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* 撕裂尾行容忍 */
    }
  }
  return events;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function tokensFromUsage(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const total = Number(usage.totalTokens ?? usage.total_tokens);
  if (Number.isFinite(total) && total > 0) return total;
  const sum =
    (Number(usage.promptTokens ?? usage.prompt_tokens ?? usage.inputTokens ?? usage.input_tokens) || 0) +
    (Number(usage.completionTokens ?? usage.completion_tokens ?? usage.outputTokens ?? usage.output_tokens) || 0);
  return sum;
}

const stats = {
  windowDays: days,
  projectsWithEvents: 0,
  events: 0,
  agent: { turns: 0, errors: 0, toolProposed: 0, toolFailed: 0, rejected: 0, tokens: 0 },
  vendor: { requested: 0, succeeded: 0, failed: 0, latenciesMs: [], byModel: new Map() },
  review: { ok: 0, suspect: 0 },
};

const projectDirs = discoverProjectDirs();
const pendingVendor = new Map(); // runId → requested 事件(跨段配对)

for (const projectDir of projectDirs) {
  let sawEvents = false;
  for (const file of eventLogFiles(projectDir)) {
    const events = readEvents(file).filter((e) => Date.parse(e.ts) >= since);
    if (events.length === 0) continue;
    sawEvents = true;
    stats.events += events.length;
    for (const e of events) {
      const p = e.payload || {};
      switch (e.type) {
        case "agent.turn.started":
          stats.agent.turns += 1;
          break;
        case "agent.turn.error":
          stats.agent.errors += 1;
          break;
        case "agent.turn.finished":
          stats.agent.tokens += tokensFromUsage(p.usage);
          break;
        case "agent.tool.proposed":
          stats.agent.toolProposed += 1;
          break;
        case "agent.tool.completed":
          if (p.ok === false) stats.agent.toolFailed += 1;
          break;
        case "agent.proposal.rejected":
          stats.agent.rejected += 1;
          break;
        case "vendor.call.requested": {
          stats.vendor.requested += 1;
          const modelKey = p.recipe?.modelKey || "(unknown)";
          if (p.runId) pendingVendor.set(p.runId, { ts: Date.parse(e.ts), modelKey });
          const m = stats.vendor.byModel.get(modelKey) || { requested: 0, succeeded: 0, failed: 0 };
          m.requested += 1;
          stats.vendor.byModel.set(modelKey, m);
          break;
        }
        case "vendor.call.completed": {
          const req = p.runId ? pendingVendor.get(p.runId) : undefined;
          const modelKey = req?.modelKey || "(unknown)";
          const m = stats.vendor.byModel.get(modelKey) || { requested: 0, succeeded: 0, failed: 0 };
          if (p.status === "succeeded") {
            stats.vendor.succeeded += 1;
            m.succeeded += 1;
          } else {
            stats.vendor.failed += 1;
            m.failed += 1;
          }
          stats.vendor.byModel.set(modelKey, m);
          if (req) {
            stats.vendor.latenciesMs.push(Date.parse(e.ts) - req.ts);
            pendingVendor.delete(p.runId);
          }
          break;
        }
        case "review.technical.completed":
          if (p.verdict === "suspect") stats.review.suspect += 1;
          else stats.review.ok += 1;
          break;
        default:
          break;
      }
    }
  }
  if (sawEvents) stats.projectsWithEvents += 1;
}

const latencies = stats.vendor.latenciesMs.sort((a, b) => a - b);
const completed = stats.vendor.succeeded + stats.vendor.failed;
const summary = {
  windowDays: days,
  projectsScanned: projectDirs.length,
  projectsWithEvents: stats.projectsWithEvents,
  totalEvents: stats.events,
  agent: {
    turns: stats.agent.turns,
    errorRate: stats.agent.turns > 0 ? +(stats.agent.errors / stats.agent.turns).toFixed(3) : null,
    toolProposed: stats.agent.toolProposed,
    toolFailed: stats.agent.toolFailed,
    userRejected: stats.agent.rejected,
    totalTokens: stats.agent.tokens,
  },
  vendor: {
    requested: stats.vendor.requested,
    completed,
    failureRate: completed > 0 ? +(stats.vendor.failed / completed).toFixed(3) : null,
    p50LatencyMs: percentile(latencies, 50),
    p90LatencyMs: percentile(latencies, 90),
    inFlightOrLost: stats.vendor.requested - completed,
    byModel: Object.fromEntries(stats.vendor.byModel),
  },
  review: {
    checked: stats.review.ok + stats.review.suspect,
    suspect: stats.review.suspect,
    suspectRate: stats.review.ok + stats.review.suspect > 0 ? +(stats.review.suspect / (stats.review.ok + stats.review.suspect)).toFixed(3) : null,
  },
  cost: null, // harness S7 cost 写回后从 vendor.call.completed.cost 聚合
};

if (asJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  const fmt = (v, suffix = "") => (v === null || v === undefined ? "—(暂无数据)" : `${v}${suffix}`);
  console.log(`Nomi 运营报告(近 ${days} 天)— ${summary.projectsScanned} 个项目带事件目录,${summary.projectsWithEvents} 个窗口内有轨迹,共 ${summary.totalEvents} 条事件`);
  console.log(`\n[AI 对话]  轮次 ${summary.agent.turns} · 错误率 ${fmt(summary.agent.errorRate)} · 工具调用 ${summary.agent.toolProposed}(失败 ${summary.agent.toolFailed} / 用户拒绝 ${summary.agent.userRejected}) · token ${summary.agent.totalTokens}`);
  console.log(`[生成调用] 发起 ${summary.vendor.requested} · 完成 ${summary.vendor.completed} · 失败率 ${fmt(summary.vendor.failureRate)} · P50 ${fmt(summary.vendor.p50LatencyMs, "ms")} · P90 ${fmt(summary.vendor.p90LatencyMs, "ms")} · 在途/丢失 ${summary.vendor.inFlightOrLost}`);
  const models = Object.entries(summary.vendor.byModel);
  if (models.length > 0) {
    console.log(`[按模型]`);
    for (const [key, m] of models) console.log(`  ${key}: 发起 ${m.requested} · 成功 ${m.succeeded} · 失败 ${m.failed}`);
  }
  console.log(`[技术自检] 检查 ${summary.review.checked} · 可疑 ${summary.review.suspect} · 可疑率 ${fmt(summary.review.suspectRate)}`);
  console.log(`[成本]    —(harness S7 cost 写回后出现)`);
  if (summary.totalEvents === 0) console.log(`\n提示:还没有任何轨迹。真实使用一次 app(或跑一轮 eval)后再来。`);
}
