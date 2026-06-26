// 姿势自纠闭环 —— 复用 loop.ts 的 round() 范式(诊断≠修、重跑差裁决、涨固化/跌回滚)接到 3D 假人姿势域。
// 三模式:
//   self  (默认) 确定性 mock 验证器自测,证「修则固化/坏 patch 则回滚」机制成立——免 app/VLM,秒级可验。
//   detect       真免费探测:shell walk 跑全姿势库,出落地+结构通过报告(零额度,本地渲染)。
//   fix          形状 fix 闭环:免费结构/落地当硬门 + VLM 形状裁判(gated,复用 appBridge 视觉模型)。需关着 Nomi。
// 跑:node evals/loop/poseLoop.mjs            (self,失败退出码非零=可执行验证)
//     MODE=detect node evals/loop/poseLoop.mjs
//     MODE=fix    node evals/loop/poseLoop.mjs   (需 app + 视觉模型)
import { runPoseLane } from "./poseLane.mjs";

const EPS = 0.01;

/** 一回合:对 current 提 patch → 重测 → 客观裁决 → 涨则固化、否则回滚。measure 是注入的验证器(可换)。 */
async function round(label, current, proposer, measure) {
  const baseScore = await measure(current);
  const patched = await proposer(current);
  const newScore = await measure(patched);
  const kept = newScore > baseScore + EPS;
  console.log(`[${label}] ${baseScore.toFixed(3)} → ${newScore.toFixed(3)}  ${kept ? "✅ 涨 → 固化" : "↩️ 跌/平 → 回滚"}`);
  return { next: kept ? patched : current, kept };
}

// ── self:确定性 mock 验证器(免 app/VLM)。机制与真部署相同,只是把验证器换成可秒验的纯函数。──
// 模拟「脚踝/关节增量越接近已校准值得分越高、越偏越低」,等价于真实里的 free结构/落地(+VLM形状)分。
function mockMeasure(ov) {
  let penalty = 0;
  for (const pose of Object.values(ov)) for (const v of Object.values(pose)) penalty += Math.abs(v[0]) + Math.abs(v[1]) + Math.abs(v[2]);
  return Math.max(0, 1 - penalty / 100);
}

async function selfTest() {
  console.log("=== 姿势自纠闭环 · 机制自测(确定性 mock 验证器,免 app/VLM) ===");
  let cur = { sit: { mixamorigLeftFoot: [30, 0, 0] } }; // 起点:偏的覆盖(差)
  // 回合1:修 agent 提议收敛到接近已校准的小增量 → 应改进固化。
  const r1 = await round("回合1 修(收敛已校准)", cur, async () => ({ sit: { mixamorigLeftFoot: [2, 0, 0] } }), async (o) => mockMeasure(o));
  cur = r1.next;
  // 回合2(对照):注入大偏覆盖(坏)→ 应被自动回滚。
  const r2 = await round("回合2 坏patch对照", cur, async () => ({ sit: { mixamorigLeftFoot: [80, 0, 0] } }), async (o) => mockMeasure(o));
  cur = r2.next;
  if (!r1.kept) throw new Error("回合1 未固化改进(闭环失效)");
  if (r2.kept) throw new Error("回合2 坏 patch 未被回滚(裁决失效)");
  console.log("\n✅ 机制成立:好覆盖被固化、坏覆盖被自动回滚——裁决权在重跑指标差,不在 agent 自评。");
  console.log("   真部署:把 mockMeasure 换成 free 结构/落地(+VLM 形状)即同一套闭环。");
}

// ── detect:真免费探测(shell walk,全姿势库)。这是「截图发现问题」的零成本常驻层。──
async function detect() {
  console.log("=== 姿势自纠闭环 · 免费探测(shell walk:全姿势库落地+结构,零额度) ===");
  const { rows, structuralPass, groundedRate, n } = runPoseLane();
  console.log(`\n结构通过 ${(structuralPass * 100).toFixed(0)}% · 落地 ${(groundedRate * 100).toFixed(0)}%  (n=${n})`);
  const bad = rows.filter((r) => !r.ok || !r.grounded);
  if (bad.length) {
    console.log("⚠ 待修:");
    for (const b of bad) console.log(`  · ${b.id}: ${!b.grounded ? "未落地 " : ""}${(b.structFails || []).join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("✅ 全姿势库:落地 + 结构全通过。");
  }
}

// ── fix:形状 fix 闭环(VLM gated)。免费结构/落地当硬门,VLM 判形状/意图当 fitness。需 app + 视觉模型。──
async function fixMode() {
  const { visionAvailable } = await import("./semiObjective.mjs").catch(() => ({ visionAvailable: () => false }));
  const { closeApp } = await import("./appBridge.mjs");
  try {
    if (!visionAvailable()) {
      console.log("MODE=fix 需视觉模型(VLM)做形状裁判。未检测到 enabled 视觉模型 → 跳过形状 fix,回退免费探测。");
      await detect();
      return;
    }
    // measure = free 结构/落地硬门(不过则 0) × VLM 形状分(逐例对 hero 图问「像不像意图」)。
    // 注:这里给出闭环骨架;真跑会逐例 chatVision 烧 VLM 额度,故按需开。诊断≠修、重跑裁决同 round()。
    console.log("=== 姿势自纠闭环 · 形状 fix(免费门 + VLM 形状裁判) ===");
    console.log("(骨架已就位:measure=free结构落地硬门 × VLM形状分;round() 重跑裁决固化/回滚。逐例 chatVision 烧额度,按需扩。)");
    await detect();
  } finally {
    await closeApp();
  }
}

const mode = process.env.MODE || "self";
const run = mode === "detect" ? detect : mode === "fix" ? fixMode : selfTest;
run().catch((e) => {
  console.error("❌ poseLoop 失败:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
