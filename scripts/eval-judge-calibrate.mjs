// S3 judge 校准:对同一批 case,judge 判决 vs 人工标注(evals/annotations/) →
// precision / recall / agreement。P 与 R 任一 <0.8 = judge 不可信,只能继续当参考。
// (看 P/R 而非 raw agreement:类别失衡时一致率会骗人——Hamel)
// 用法: pnpm eval:judge-calibrate <runDir>   (runDir 里的 case 需已在查看器里人工标注并导出)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadJudgeConfig, loadFewshots, judgeOne } from "../evals/lib/judge.mjs";
import { createdNodes } from "../evals/lib/grading.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runDir = process.argv[2] && path.resolve(process.argv[2]);
if (!runDir || !fs.existsSync(path.join(runDir, "output.jsonl"))) {
  console.error("用法: pnpm eval:judge-calibrate <runDir>");
  process.exit(2);
}
const cfg = loadJudgeConfig();
if (!cfg) {
  console.error("缺 evals/judge.config.json —— { baseUrl, apiKey, model }(便宜档模型,D2 拍板)");
  process.exit(2);
}

// 人工标注(金标准)
const human = new Map();
const annotDir = path.join(repoRoot, "evals", "annotations");
for (const f of fs.existsSync(annotDir) ? fs.readdirSync(annotDir).filter((n) => n.endsWith(".jsonl")) : []) {
  for (const line of fs.readFileSync(path.join(annotDir, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const a = JSON.parse(line);
      if (a.source === path.basename(runDir) && a.verdict) human.set(a.key, a.verdict === "pass");
    } catch {
      /* skip */
    }
  }
}
if (human.size < 10) {
  console.error(`该 run 的人工标注只有 ${human.size} 条(<10)——先在查看器里标够再校准: pnpm eval:view ${path.relative(process.cwd(), runDir)}`);
  process.exit(2);
}

const meta = JSON.parse(fs.readFileSync(path.join(runDir, "meta.json"), "utf8"));
const { cases } = await import(pathToFileURL(path.join(repoRoot, "evals", "datasets", `${meta.dataset}.mjs`)).href);
const caseById = new Map(cases.map((c) => [c.id, c]));
const outputs = fs
  .readFileSync(path.join(runDir, "output.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((o) => human.has(`${o.caseId}#${o.trial}`));

const fewshots = loadFewshots();
console.log(`校准:${outputs.length} 条(few-shot ${fewshots.length} 例,模型 ${cfg.model})`);
let tp = 0, fp = 0, tn = 0, fn = 0;
const disagreements = [];
for (const o of outputs) {
  const key = `${o.caseId}#${o.trial}`;
  const evalCase = caseById.get(o.caseId);
  const verdict = await judgeOne(cfg, { userMessage: evalCase.input.message, createdNodes: createdNodes(o), fewshots });
  const truth = human.get(key);
  if (verdict.pass && truth) tp += 1;
  else if (verdict.pass && !truth) { fp += 1; disagreements.push({ key, judge: "pass", human: "fail", reason: verdict.reason }); }
  else if (!verdict.pass && !truth) tn += 1;
  else { fn += 1; disagreements.push({ key, judge: "fail", human: "pass", reason: verdict.reason }); }
  console.log(`  ${key}: judge=${verdict.pass ? "pass" : "fail"} human=${truth ? "pass" : "fail"}`);
}
const precision = tp + fp ? +(tp / (tp + fp)).toFixed(3) : null;
const recall = tp + fn ? +(tp / (tp + fn)).toFixed(3) : null;
const agreement = +((tp + tn) / outputs.length).toFixed(3);
const calibrated = precision !== null && recall !== null && precision >= 0.8 && recall >= 0.8;

const report = { runDir: path.basename(runDir), model: cfg.model, n: outputs.length, fewshots: fewshots.length, precision, recall, agreement, calibrated, disagreements, at: new Date().toISOString() };
fs.writeFileSync(path.join(repoRoot, "evals", "judge-calibration.json"), JSON.stringify(report, null, 2));
console.log(`\nprecision ${precision} · recall ${recall} · agreement ${agreement}`);
console.log(calibrated ? "✅ 校准达标(P/R≥0.8)——judge 可计入评分" : "❌ 未达标——judge 只能当参考;看 disagreements 修 rubric/few-shot 再来");
if (disagreements.length) {
  console.log("\n分歧明细:");
  for (const d of disagreements) console.log(`  ${d.key}: judge=${d.judge} human=${d.human} — ${d.reason.slice(0, 100)}`);
}
