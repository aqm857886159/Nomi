// 运镜旅途级评测 · B 层（agent 选择质量）：喂自然语言运镜场景，抓 agent 产出的
// create_camera_move spec，自动判它选的 move/speed 对不对 + 人眼复核；含负样本（静止机位不该调）。
// 纯文本额度。gated APIMART_E2E。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/camera-move-agent-eval.e2e.mjs
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP camera-move-agent-eval: 会花文本额度。APIMART_E2E=1 才跑。");
  process.exit(0);
}
const MODEL_KEY = process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro";

// 每条：自然语言意图 + 期望的 move（null = 期望「不调用」的负样本）。
const SCENARIOS = [
  { text: "镜头慢慢推近女主角的脸。", expect: ["push_in"] },
  { text: "镜头绕着主角转一圈。", expect: ["orbit_left", "orbit_right"] },
  { text: "镜头从低往高升起来，展现整个战场。", expect: ["crane_up"] },
  { text: "镜头跟着奔跑的角色向左横移。", expect: ["track_left"] },
  { text: "镜头缓缓拉远，露出空荡荡的房间。", expect: ["pull_out"] },
  { text: "镜头快速怼近主角惊恐的眼睛。", expect: ["push_in"] },
  { text: "镜头从侧面弧线扫过对峙的两人。", expect: ["arc_left", "arc_right"] },
  { text: "固定机位，角色站着说话，镜头不动。", expect: [] }, // 负样本：不该调运镜
];

function captureCameraMove(win, mk, text) {
  return win.evaluate(async ({ mk, text }) => {
    const { sessionId } = await window.nomiDesktop.agents.chatV2Start({
      prompt: `为这个镜头处理运镜（用合适的工具，如果需要的话）：${text}`,
      sessionKey: "probe-camera-move-eval",
      skillKey: "workbench.generation.canvas-planner",
      mode: "auto",
      agentModelKey: mk,
      agentVendorKey: "apimart",
    });
    return await new Promise((resolve) => {
      let found = null;
      const off = window.nomiDesktop.agents.onChatV2Event(sessionId, (ev) => {
        if (!ev) return;
        if (ev.type === "tool-call" || ev.type === "tool-call-pending") {
          if (ev.toolName === "create_camera_move") found = ev.args ?? ev.input ?? null;
          if (ev.type === "tool-call-pending" && ev.toolCallId) {
            window.nomiDesktop.agents.confirmTool(sessionId, ev.toolCallId, { ok: false, denied: true, message: "probe" });
          }
        }
        if (ev.type === "done" || ev.type === "error") { off?.(); resolve(found); }
      });
      setTimeout(() => { off?.(); resolve(found); }, 90000);
    });
  }, { mk, text });
}

const app = await electron.launch({ executablePath: require("electron"), args: ["."], cwd: repoRoot, env: { ...process.env } });
try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);
  if (process.env.APIMART_API_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), process.env.APIMART_API_KEY);
  }

  const rows = [];
  let pass = 0;
  for (const sc of SCENARIOS) {
    const spec = await captureCameraMove(win, MODEL_KEY, sc.text);
    const move = spec?.move ?? null;
    const wantStatic = sc.expect.length === 0;
    let ok;
    if (wantStatic) ok = spec === null; // 负样本：不该调
    else ok = move != null && sc.expect.includes(move);
    if (ok) pass += 1;
    const got = spec === null ? "(未调用)" : `move=${move} speed=${spec.speed || "auto"} shot=${spec.shot || "auto"}`;
    rows.push(`${ok ? "✓" : "✗"} 期望[${sc.expect.join("/") || "不调用"}] 实得 ${got} | ${sc.text}`);
    console.log("  " + rows[rows.length - 1]);
  }

  console.log("\n═══ 运镜 agent 选择评测（B 层）═══");
  rows.forEach((r) => console.log(r));
  console.log(`\n通过 ${pass}/${SCENARIOS.length}`);
  await app.close();
  process.exit(pass === SCENARIOS.length ? 0 : 1);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
