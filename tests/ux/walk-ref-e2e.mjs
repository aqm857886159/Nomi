// 第二发验证：假人「走位平移」灰模片当 video_ref → Seedance 会不会补出迈腿走路。
// 单 session、活体改 store（不重开项目，绕开重开态脆性）：
//   agent 建视频靶子 + create_camera_move(得合法 scene3d 节点) → 暴露 store(localStorage 闸+reload)
//   → 页面内把轨迹绑定从相机改绑「假人」+ 轨迹改成朝相机走位 + 重挂 cameraMoveAutoCapture
//   → 常驻 Host 重渲走位灰模片 → 自动喂 target video_ref → 真生成 → 下载抽帧人眼判断。
// 跑：pnpm run build && NOMI_E2E=1 NOMI_E2E_ALLOW_MULTI_INSTANCE=1 APIMART_E2E=1 NOMI_SPEND_OK=1 node tests/ux/walk-ref-e2e.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  prepareIsolation, launchIsolatedApp, createBlankProject, openGenerationAiPanel,
  setAssistantModelPref, sendAgentMessage, countFinishedTurns, newFinishedTurn,
  waitForPersistedCanvas, readEventsLog, readProjectPayload, TOOL_WHITELIST,
} from "../../evals/lib/isoApp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.DIAG_OUT || "/private/tmp/claude-501/-Users-aoqimin-Desktop-Nomi/a40aa704-6391-4244-8ad0-0fe798cdc10d/scratchpad";
const MODEL_PREF = { vendorKey: "apimart", modelKey: "deepseek-v3.1-250821" };
const isoDir = path.join(os.tmpdir(), "nomi-walk-ref-e2e");

function readNodes(projectDir) { return readProjectPayload(projectDir)?.payload?.generationCanvas?.nodes || []; }
function pendingProposal(events) {
  const resolved = new Set(); const proposed = [];
  for (const e of events) {
    const id = e.payload?.toolCallId; if (!id) continue;
    if (e.type === "agent.tool.proposed") proposed.push({ toolCallId: id, toolName: String(e.payload?.toolName || "") });
    if (e.type === "agent.tool.completed" || e.type === "agent.proposal.approved" || e.type === "agent.proposal.rejected") resolved.add(id);
  }
  return proposed.filter((p) => !resolved.has(p.toolCallId)).at(-1) || null;
}
async function approveLoop(win, projectDir, { timeoutMs, baselineTurnCount, approveSet, log = () => {} }) {
  const deadline = Date.now() + timeoutMs;
  const result = { finished: false, status: "timeout", approvedTools: [] };
  while (Date.now() < deadline) {
    const events = readEventsLog(projectDir);
    const last = newFinishedTurn(events, baselineTurnCount);
    if (last) { result.finished = last.type === "agent.turn.finished"; result.status = last.type === "agent.turn.finished" ? String(last.payload?.status || "ok") : "error"; return result; }
    const confirm = win.locator("button", { hasText: /^(确认|全部拒绝)/ });
    if (await confirm.count().catch(() => 0)) {
      const pending = pendingProposal(events); const tool = pending?.toolName || "";
      if (pending && !(TOOL_WHITELIST.has(tool) || approveSet.has(tool))) {
        await win.locator("button", { hasText: /拒绝/ }).first().click({ timeout: 3000 }).catch(() => {});
      } else {
        await win.locator("button", { hasText: /^确认/ }).first().click({ timeout: 3000 }).catch(() => {});
        result.approvedTools.push(tool); log(`  ✓ 批准: ${tool}`);
      }
      await win.waitForTimeout(800); continue;
    }
    await win.waitForTimeout(1000);
  }
  return result;
}
async function pollNodes(win, projectDir, predicate, { timeoutMs, intervalMs = 2000 }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodes = readNodes(projectDir);
    if (predicate(nodes)) return { ok: true, nodes };
    await win.waitForTimeout(intervalMs);
  }
  return { ok: false, nodes: readNodes(projectDir) };
}
const sceneVideoUrl = (nodes) => nodes.map((n) => n?.meta?.cameraMoveVideo?.url).find((u) => typeof u === "string" && u.trim()) || null;

let app = null;
try {
  console.log("═══ 第二发：假人走位平移片 → Seedance 会不会迈腿（单 session 活体改 store）═══");
  const iso = prepareIsolation(isoDir, { requireCatalog: true });
  ({ app } = await launchIsolatedApp(repoRoot, iso));
  const win = (await app.windows())[0] || (await app.firstWindow());
  // 启动后立刻置 E2E 闸 → 画布挂载时 CameraMoveCaptureHost 的 effect 会把 store 挂到 window（无需 reload）
  await win.evaluate(() => localStorage.setItem("__nomiE2E", "1"));
  const projectDir = await createBlankProject(win, iso.projectsDir);
  await openGenerationAiPanel(win);
  await setAssistantModelPref(win, MODEL_PREF);

  // 种子：建视频靶子
  let base = countFinishedTurns(readEventsLog(projectDir));
  await sendAgentMessage(win, "在画布上创建一个视频镜头节点：一个人朝镜头走来的全身镜头（kind=video）。只建节点，先不要生成。");
  await approveLoop(win, projectDir, { timeoutMs: 180000, baselineTurnCount: base, approveSet: new Set(), log: console.log });
  await waitForPersistedCanvas(win, projectDir);
  const target = readNodes(projectDir).find((n) => n.kind === "video");
  if (!target) throw new Error("没建出视频靶子");
  console.log("✓ 视频靶子:", target.id);

  // create_camera_move → 得一个合法 scene3d 节点（先渲相机片，随后我改写成走位）
  base = countFinishedTurns(readEventsLog(projectDir));
  await sendAgentMessage(win, "给这个镜头加一个缓慢推近的运镜。");
  await approveLoop(win, projectDir, { timeoutMs: 180000, baselineTurnCount: base, approveSet: new Set(["create_camera_move"]), log: console.log });
  const r1 = await pollNodes(win, projectDir, (n) => sceneVideoUrl(n) || (n.find((x) => x.id === target.id)?.meta?.referenceVideoUrls || []).length > 0, { timeoutMs: 60000 });
  if (!r1.ok) throw new Error("相机运镜片没渲出（前置失败）");
  console.log("✓ 得到合法 scene3d 节点 + 相机片");

  // store 应已被 CameraMoveCaptureHost 的 effect 挂到 window（画布已挂载）。带重试确认。
  let hasStore = false;
  for (let i = 0; i < 10; i++) {
    hasStore = await win.evaluate(() => !!window.__nomiCanvasStore);
    if (hasStore) break;
    await win.waitForTimeout(1000);
  }
  if (!hasStore) throw new Error("store 未暴露（hook 没生效/没 build）");

  // 活体改写：相机绑定 → 假人走位（朝相机走来）；重挂捕获
  const info = await win.evaluate(() => {
    const store = window.__nomiCanvasStore; const s = store.getState();
    const scene = s.nodes.find((n) => n.kind === "scene3d");
    const target = s.nodes.find((n) => n.kind === "video");
    const st = JSON.parse(JSON.stringify(scene.meta.scene3dState));
    const mann = st.objects.find((o) => o.type === "mannequin");
    const feetY = mann.position[1];
    const traj = st.trajectories[0];
    const p0 = traj.points[0], p1 = traj.points[1] || { id: p0.id + "-b" };
    traj.points = [{ id: p0.id, position: [0, feetY, -2.6] }, { id: p1.id, position: [0, feetY, 1.2] }];
    const b = st.trajectoryBindings[0];
    b.objects = [{ objectId: mann.id, offsetRatio: 0 }]; b.startTime = 0; b.endTime = 4; b.direction = "forward";
    st.sceneTimeline = { totalDuration: 4 };
    mann.position = [0, feetY, -2.6];
    store.getState().updateNode(target.id, { meta: { ...(target.meta || {}), cameraMoveAttached: false, referenceVideoUrls: [] } });
    const meta = { ...(scene.meta || {}) }; meta.scene3dState = st; delete meta.cameraMoveVideo;
    meta.cameraMoveAutoCapture = { targetNodeId: target.id, fps: 24, frameCount: 96, move: "push_in" };
    store.getState().updateNode(scene.id, { meta });
    return { sceneId: scene.id, targetId: target.id, mannId: mann.id, bindObj: b.objects[0].objectId };
  });
  console.log("✓ 已改写成走位平移并重挂捕获:", JSON.stringify(info), "match=", info.bindObj === info.mannId);

  // 等走位灰模片渲出 + 喂入 target
  const r2 = await pollNodes(win, projectDir, (n) => {
    const t = n.find((x) => x.id === info.targetId);
    return sceneVideoUrl(n) && (t?.meta?.referenceVideoUrls || []).length > 0;
  }, { timeoutMs: 90000 });
  if (!r2.ok) throw new Error("走位灰模片没渲出/没喂入（超时）");
  const walkClip = sceneVideoUrl(r2.nodes);
  console.log("✓ 走位灰模片已渲并喂入 video_ref:", walkClip);

  // 真生成
  base = countFinishedTurns(readEventsLog(projectDir));
  await sendAgentMessage(win, "现在请生成这个视频镜头节点（用它已注入的走位参考视频）。直接运行生成。");
  await approveLoop(win, projectDir, { timeoutMs: 180000, baselineTurnCount: base, approveSet: new Set(["run_generation_batch"]), log: console.log });
  const genPollMs = Number(process.env.NOMI_GEN_POLL_MS) || 720000;
  console.log(`◆ 轮询真生成终态（~${Math.round(genPollMs / 60000)}min）……`);
  const r3 = await pollNodes(win, projectDir, (n) => {
    const t = n.find((x) => x.id === info.targetId);
    return Boolean(t?.result?.providerUrl || t?.result?.url) || t?.status === "error";
  }, { timeoutMs: genPollMs, intervalMs: 3000 });
  const t = r3.nodes.find((x) => x.id === info.targetId);
  const outUrl = t?.result?.providerUrl || t?.result?.url || "";
  if (!r3.ok || !outUrl) { console.log("✗ 生成未出片", t?.error || "(超时)"); throw new Error("生成未出片"); }
  console.log("\n✓✓ 走位真生成出片：", outUrl);
  fs.writeFileSync(path.join(OUT, "walk-out-url.txt"), outUrl);
  // 落盘走位灰模片本地路径
  const inFile = walkClip.startsWith("nomi-local://") ? walkClip.split("/").pop() : walkClip;
  console.log("走位灰模片文件名:", inFile);
  await app.close();
  console.log("WALK E2E DONE");
} catch (err) {
  console.log("✗ FATAL:", err?.message || err);
  if (app) await app.close().catch(() => {});
  process.exit(1);
}
