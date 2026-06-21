// 跑全部场景 → 客观指标(共享给 runner 和闭环)。driver 用真 canvasGraph,scorers 纯客观。
import { SCENARIO_ITEMS, NOMI_CAPABILITIES } from "./personas.mjs";
import { OBJECTIVE_SCORERS } from "./scorers.mjs";
import { driveScenario, type Trajectory } from "./driver";
import type { LearnedDefaults } from "./learnedDefaults";

export type Row = {
  persona: string;
  scenario: string;
  scores: Record<string, number>;
  traj: Trajectory;
};

export const METRIC_IDS: string[] = OBJECTIVE_SCORERS.map((s) => s.id);

export async function runAll(learned: LearnedDefaults): Promise<Row[]> {
  const rows: Row[] = [];
  for (const item of SCENARIO_ITEMS) {
    const traj = driveScenario(item, learned, NOMI_CAPABILITIES);
    const scores: Record<string, number> = {};
    for (const s of OBJECTIVE_SCORERS) {
      const res = await s.run({ output: traj });
      scores[s.id] = res.score;
    }
    rows.push({ persona: item.personaLabel, scenario: item.id, scores, traj });
  }
  return rows;
}

export const avgOf = (rows: Row[], metric: string): number =>
  rows.reduce((a, r) => a + (r.scores[metric] ?? 0), 0) / rows.length;
