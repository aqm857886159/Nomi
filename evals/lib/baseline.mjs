// Lane B benchmark 基线(单一真相源)。把一次 scores.json 归一成「项目无关」的基线快照,
// storyboard(cases/caseId)与 journeys(journeys/journeyId)两种形态都能进同一套基线/回归门。
// 仅基线入库(evals/baselines/),runs 仍 gitignore——基线是可对比的标尺,run 是临时产物。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const BASELINE_DIR = path.join(repoRoot, "evals", "baselines");

export function baselinePath(dataset) {
  return path.join(BASELINE_DIR, `${dataset}.json`);
}

/** scores.json → 归一:{ dataset, gitCommit, items:[{id,passAtK,meanScore}], summary }。 */
export function normalizeScores(scores) {
  let items = [];
  if (Array.isArray(scores.cases)) {
    items = scores.cases.map((c) => ({ id: c.caseId, passAtK: Boolean(c.passAtK), meanScore: c.meanScore ?? 0 }));
  } else if (Array.isArray(scores.journeys)) {
    items = scores.journeys
      .filter((j) => !j.skipped)
      .map((j) => ({ id: j.journeyId, passAtK: Boolean(j.passAtK), meanScore: j.meanScore ?? 0 }));
  }
  return { dataset: scores.dataset, gitCommit: scores.gitCommit, items, summary: scores.summary || {} };
}

export function loadBaseline(dataset) {
  const file = baselinePath(dataset);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/**
 * 比新 scores 对基线,出回归/修复/漂移。回归判据(任一即红):
 *   ① pass@k 翻转(基线 pass → 新 fail);② meanScore 跌 ≥0.1;③ 任一质量维度跌 ≥0.1。
 */
export function diffAgainstBaseline(baseline, scores) {
  const newNorm = normalizeScores(scores);
  const baseById = new Map((baseline.items || []).map((i) => [i.id, i]));
  const regressions = [];
  const fixes = [];
  const drifts = [];
  const fresh = [];
  for (const cur of newNorm.items) {
    const base = baseById.get(cur.id);
    if (!base) { fresh.push(cur.id); continue; }
    if (base.passAtK && !cur.passAtK) regressions.push({ id: cur.id, kind: "pass→fail", from: base.meanScore, to: cur.meanScore });
    else if (!base.passAtK && cur.passAtK) fixes.push({ id: cur.id, from: base.meanScore, to: cur.meanScore });
    else if (cur.meanScore - base.meanScore <= -0.1) regressions.push({ id: cur.id, kind: "均分跌", from: base.meanScore, to: cur.meanScore });
    else if (Math.abs(cur.meanScore - base.meanScore) >= 0.1) drifts.push({ id: cur.id, from: base.meanScore, to: cur.meanScore });
  }
  // 质量维度回归(Lane A 校准后才有意义;基线/新都带 qualityByDimension 才比)。
  const qualityRegressions = [];
  const baseQ = baseline.summary?.qualityByDimension;
  const newQ = newNorm.summary?.qualityByDimension;
  if (baseQ && newQ) {
    for (const dim of Object.keys(baseQ)) {
      if (typeof newQ[dim] === "number" && newQ[dim] - baseQ[dim] <= -0.1) {
        qualityRegressions.push({ dim, from: baseQ[dim], to: newQ[dim] });
      }
    }
  }
  return { regressions, fixes, drifts, fresh, qualityRegressions };
}
