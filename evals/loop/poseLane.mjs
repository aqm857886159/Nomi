// 姿势-站位 lane —— 把 3D 假人姿势域接进自改进闭环的「驱动 + 客观打分」。
// 验证器分层(最省钱):免费的「落地 + 结构断言」(跑 walk harness 出 _summary.json)是常驻预滤 + 回归探测;
// 形状「像不像意图」留 VLM(gated,见 poseLoop.mjs fix 模式 + semiObjective)。本文件只管免费层。
// driver = 跑 tests/ux/staging-pose-shots.walk.mjs(本地 vite+chromium 离屏渲染,零额度),解析逐例结构 + 落地。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SUMMARY = path.join(repoRoot, "tests/ux/_stagingshot/_summary.json");

/** 跑 walk(可选姿势覆盖层 JSON 路径),返回逐例 {id, ok(结构通过), grounded(落地), structFails, diag}。零额度。 */
export function runStagingWalk(overridesPath) {
  const env = { ...process.env };
  if (overridesPath) env.OVERRIDES = overridesPath;
  const r = spawnSync("node", ["tests/ux/staging-pose-shots.walk.mjs"], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!fs.existsSync(SUMMARY)) {
    throw new Error("walk 未产出 _summary.json:" + String(r.stderr || r.stdout || "").slice(0, 400));
  }
  return JSON.parse(fs.readFileSync(SUMMARY, "utf8"));
}

/** 纯客观打分(免费层):结构通过率 + 落地率。 */
export function scoreRows(rows) {
  const n = rows.length || 1;
  const structuralPass = rows.filter((r) => r.ok).length / n;
  const groundedRate = rows.filter((r) => r.grounded).length / n;
  return { structuralPass, groundedRate, n: rows.length };
}

/** 跑一遍姿势库免费探测,返回 { rows, structuralPass, groundedRate, n }。 */
export function runPoseLane(overridesPath) {
  const rows = runStagingWalk(overridesPath);
  return { rows, ...scoreRows(rows) };
}
