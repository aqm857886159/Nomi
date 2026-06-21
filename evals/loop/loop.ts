// 自我改进闭环引擎 —— 查 → 修 → 重跑 → eval-diff 客观裁决 → 涨固化/跌回滚。
// 架构铁律(全在此体现):查 agent ≠ 修 agent 独立;patch 由客观指标差裁决,修不自评;
// 裁决=重跑后均分差(非任何 agent 的嘴)。离线、零额度。
// 查/修默认规则版;配 NOMI_LOOP_LLM_* 则自动升级 LLM 版(缺 key 回退,见 llmAgents.ts)。
// 跑:node_modules/.bin/tsx evals/loop/loop.ts(失败退出码非零 = 可执行验证)
import { runAll, avgOf, type Row } from "./metrics";
import { baselineDefaults, cloneDefaults, type LearnedDefaults } from "./learnedDefaults";
import { diagnose } from "./diagnose";
import { fix } from "./fix";
import { diagnoseLLM, fixLLM, loopLlmMode } from "./llmAgents";
import { closeApp } from "./appBridge.mjs";

const TARGET = "semantic-edge-correctness";
const EPS = 0.01;

type Proposer = (rows: Row[], cur: LearnedDefaults) => Promise<LearnedDefaults>;

/** 一回合:对 current 提一个 patch → 重跑 → 客观裁决 → 涨则固化、否则回滚。 */
async function round(label: string, current: LearnedDefaults, proposer: Proposer): Promise<{ next: LearnedDefaults; kept: boolean }> {
  const baseRows = await runAll(current);
  const baseAvg = avgOf(baseRows, TARGET);
  const patched = await proposer(baseRows, current);
  const newRows = await runAll(patched);
  const newAvg = avgOf(newRows, TARGET);
  const kept = newAvg > baseAvg + EPS;
  console.log(
    `[${label}] ${TARGET}: ${baseAvg.toFixed(3)} → ${newAvg.toFixed(3)}  ${kept ? "✅ 涨 → 固化" : "↩️ 跌/平 → 回滚"}`,
  );
  return { next: kept ? patched : current, kept };
}

export async function runImprovementLoop(): Promise<void> {
  console.log("=== 自我改进闭环(查≠修 · 客观裁决 · 离线零额度) ===");
  console.log(`查/修模式:${loopLlmMode()}\n`);
  let learned = baselineDefaults();

  // 回合 1:查 → 修(LLM 版优先,缺 key 回退规则版)→ 应改进语义边正确性
  const r1 = await round("回合1 查/修", learned, async (rows, cur) => {
    const diag = (await diagnoseLLM(rows)) ?? diagnose(rows);
    console.log("  查 agent:", diag.pattern);
    console.log("  修 agent:提议 patch(不自评,交闭环裁决)");
    return (await fixLLM(diag, cur)) ?? fix(diag, cur);
  });
  learned = r1.next;

  // 回合 2(对照实验):故意注入坏 patch → 应被自动回滚
  const r2 = await round("回合2 坏patch对照", learned, async (_rows, cur) => {
    const bad = cloneDefaults(cur);
    for (const k of Object.keys(bad.refEdgeMode)) bad.refEdgeMode[k] = "reference";
    console.log("  注入坏 patch:语义模式退回泛用 reference(= 重新引入 bug)");
    return bad;
  });
  learned = r2.next;

  const finalRows = await runAll(learned);
  const finalAvg = avgOf(finalRows, TARGET);
  console.log("\n固化的 learned.refEdgeMode =", JSON.stringify(learned.refEdgeMode));
  console.log("最终", TARGET, "均分 =", finalAvg.toFixed(3));

  // 断言闭环真不变量(规则版/LLM 版通用):回合1 必改进固化、回合2 坏 patch 必回滚。
  // 不强求满分(LLM 不一定到 1.0;改进+回滚才是机制成立的证据)。失败非零退出(可执行验证)。
  if (!r1.kept) throw new Error("回合1 未固化改进(闭环失效)");
  if (r2.kept) throw new Error("回合2 坏 patch 未被回滚(裁决失效)");
  void finalAvg;
  console.log(
    "\n✅ 闭环成立:回合1 真改进被固化、回合2 坏 patch 被自动回滚——裁决权在客观指标差,不在 agent 自评。",
  );
}

runImprovementLoop()
  .catch((e) => {
    console.error("❌ 闭环验证失败:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closeApp());
