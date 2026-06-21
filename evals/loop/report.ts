// S4 仪表盘(dev-facing 工件,非产品 UI 故不走 R8)—— 真 driver 跑全场景 → 客观指标表,
// 控制台打印 + 落 evals/loop/report.md(可提交/分享)。让创始人「有数」:哪类用户服务好/差。
// 跑:node_modules/.bin/tsx evals/loop/report.ts
import { writeFileSync } from "node:fs";
import { runAll, avgOf, METRIC_IDS, type Row } from "./metrics";
import { baselineDefaults } from "./learnedDefaults";
import { semiObjectiveEnabled } from "./semiObjective.mjs";

const fmt = (n: number) => Number(n).toFixed(2);
const pad = (s: string | number, n: number) => {
  const str = String(s);
  return str + " ".repeat(Math.max(0, n - [...str].length));
};

function consoleTable(rows: Row[]) {
  console.log("\n=== 自我改进 loop · 客观指标表(真 canvasGraph,离线零额度) ===\n");
  console.log(pad("人格", 24) + METRIC_IDS.map((c) => pad(c, 24)).join(""));
  for (const r of rows) {
    console.log(pad(r.persona, 24) + METRIC_IDS.map((c) => pad(fmt(r.scores[c]), 24)).join(""));
  }
  console.log("\n" + pad("总览均分", 24) + METRIC_IDS.map((c) => pad(fmt(avgOf(rows, c)), 24)).join(""));
}

function markdown(rows: Row[]): string {
  const head = `| 人格 | ${METRIC_IDS.join(" | ")} |`;
  const sep = `|---|${METRIC_IDS.map(() => "---").join("|")}|`;
  const body = rows
    .map((r) => `| ${r.persona} | ${METRIC_IDS.map((c) => fmt(r.scores[c])).join(" | ")} |`)
    .join("\n");
  const avg = `| **总览均分** | ${METRIC_IDS.map((c) => fmt(avgOf(rows, c))).join(" | ")} |`;
  const gaps = rows.filter((r) => r.traj.missing.length);
  const gapLines = gaps.length
    ? gaps.map((g) => `- ${g.persona}:缺 ${g.traj.missing.join(", ")}`).join("\n")
    : "- (无)";
  return [
    "# 自我改进 loop · 客观指标仪表盘",
    "",
    `> 自动生成(evals/loop/report.ts)。真 canvasGraph 领域逻辑,离线零额度。半客观层:${semiObjectiveEnabled() ? "已启用" : "未启用(需 VLM key+额度+校准)"}。`,
    "",
    head,
    sep,
    body,
    avg,
    "",
    "## ⚠️ 能力缺口(诚实标 · D4)",
    gapLines,
    "",
    "> 注:`producedAsset` 等为 stub(真生成留额度门后);主观画质留创始人抽查,不在此表。",
    "",
  ].join("\n");
}

(async () => {
  const rows = await runAll(baselineDefaults());
  consoleTable(rows);
  const md = markdown(rows);
  writeFileSync(new URL("./report.md", import.meta.url), md);
  console.log("\n📄 已落 evals/loop/report.md");
  const gaps = rows.filter((r) => r.traj.missing.length);
  console.log("\n⚠️ 能力缺口:");
  for (const g of gaps) console.log(`  · ${g.persona}:缺 ${g.traj.missing.join(", ")}`);
  console.log(`\n✅ 仪表盘出表:${rows.length} 人格 × ${METRIC_IDS.length} 维,全离线。`);
})();
