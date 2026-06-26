// 姿势自纠闭环 —— 复用 loop.ts 的 round() 范式(诊断≠修、重跑差裁决、涨固化/跌回滚)接到 3D 假人姿势域。
// 三模式:
//   self  (默认) 确定性 mock 验证器自测,证「修则固化/坏 patch 则回滚」机制成立——免 app/VLM,秒级可验。
//   detect       真免费探测:shell walk 跑全姿势库,出落地+结构通过报告(零额度,本地渲染)。
//   fix          形状 fix 闭环:免费结构/落地当硬门 + VLM 形状裁判(gated,复用 appBridge 视觉模型)。需关着 Nomi。
// 跑:node evals/loop/poseLoop.mjs            (self,失败退出码非零=可执行验证)
//     MODE=detect node evals/loop/poseLoop.mjs
//     MODE=fix    node evals/loop/poseLoop.mjs   (需 app + 视觉模型)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runPoseLane, runStagingWalk, SHOT_DIR } from "./poseLane.mjs";

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
// 真跑:渲一个用例(可带姿势覆盖)→ 读 hero 图(生产无地面帧)→ 复用 app 视觉模型问「像不像意图+解剖正常」
// → 分。诊断≠修、裁决靠重跑分差(round())。本自测:从「破坏的坐姿」修回校准坐姿应固化、再注坏应回滚。
async function fixMode() {
  const { visionAvailable, vlmJudge } = await import("./semiObjective.mjs");
  const { closeApp, modelLabels } = await import("./appBridge.mjs");
  const CASE = "05-sit";
  const INTENT = "一个人坐着的姿势:大腿大致水平、小腿大致垂直、上身直立,四肢解剖正常(膝盖不反折)";
  const BAD = { sit: { mixamorigLeftLeg: [-95, 0, 0], mixamorigRightLeg: [-95, 0, 0] } }; // 膝反折=破坏坐姿
  const ovPath = path.join(os.tmpdir(), "nomi-pose-fix-ov.json");

  // measure:写覆盖→渲该用例→读 hero PNG→VLM 判意图/解剖→分。免费结构没过则直接 0(硬门)。
  const measure = async (ov) => {
    if (ov && Object.keys(ov).length) fs.writeFileSync(ovPath, JSON.stringify(ov));
    const rows = runStagingWalk(ov && Object.keys(ov).length ? ovPath : undefined, "05");
    const row = rows.find((r) => r.id === CASE);
    if (!row || !row.ok) return 0; // free 硬门:结构没过(断渲/悬空)直接 0,不浪费 VLM
    const png = path.join(SHOT_DIR, `${CASE}__hero.png`);
    const dataUrl = `data:image/png;base64,${fs.readFileSync(png).toString("base64")}`;
    const v = await vlmJudge(dataUrl, `画面里的人是否是「${INTENT}」?`);
    const score = v.pass ? Math.max(0.5, v.confidence ?? 0.5) : (1 - (v.confidence ?? 0)) * 0.5;
    console.log(`    VLM: pass=${v.pass} conf=${v.confidence ?? "?"} → score ${score.toFixed(3)}`);
    return score;
  };

  try {
    if (!visionAvailable()) {
      console.log("MODE=fix 需视觉模型(VLM)做形状裁判。未检测到 enabled 视觉模型 → 回退免费探测。");
      await detect();
      return;
    }
    console.log("=== 姿势自纠闭环 · 形状 fix(免费结构硬门 + VLM 形状裁判) ===");
    console.log(`视觉模型:${modelLabels().vision}\n目标用例:${CASE} · 意图:${INTENT}\n`);
    let cur = BAD; // 起点:破坏的坐姿(膝反折)
    // 回合1:修 agent 提议回退覆盖(=校准坐姿)→ VLM 分应升 → 固化。
    const r1 = await round("回合1 修(破坏坐姿→校准)", cur, async () => ({}), measure);
    cur = r1.next;
    // 回合2(对照):注入破坏覆盖 → VLM 分应降 → 回滚。
    const r2 = await round("回合2 坏patch对照(注膝反折)", cur, async () => BAD, measure);
    cur = r2.next;
    if (!r1.kept) throw new Error("回合1 未固化(VLM 没认出校准坐姿更好)——检查视觉模型/意图措辞");
    if (r2.kept) throw new Error("回合2 坏 patch 未回滚(VLM 没认出破坏更差)");
    console.log("\n✅ VLM 形状 fix 闭环成立:校准坐姿被固化、膝反折破坏被回滚——裁决在 VLM 重判分差(诊断≠修)。");
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
