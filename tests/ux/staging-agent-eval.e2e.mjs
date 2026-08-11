// 站位旅途级评测 · B 层（agent 选择质量）：喂 8 个自然语言镜头场景，抓 agent 产出的
// create_staging_reference spec，打印它选的 characters/poses/layout/facing/camera —— 人眼判断
// agent 是否对多角色/多站位/朝向「选得对」。纯文本额度。gated APIMART_E2E。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/staging-agent-eval.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";


if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP staging-agent-eval: 会花文本额度。APIMART_E2E=1 才跑。");
  process.exit(0);
}
const MODEL_KEY = process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro";

const SCENARIOS = [
  "男主角单膝跪地向女主角求婚，女主角站在他正前方。",
  "三个人围着篝火坐着聊天。",
  "审讯室里，警探站着逼问坐在桌前的嫌疑人。",
  "两个人面对面激烈争吵，互相叉腰瞪着对方。",
  "一队四名士兵并排站立敬礼。",
  "主角站在欢呼的人群中间举起双手庆祝。",
  "俯拍两个人面对面坐着下棋。",
  "一个人在前面走，另一个人在后面悄悄跟踪他。",
];

const { app, win } = await launchNomiApp({ name: "staging-agent-eval" });
try {
  if (process.env.APIMART_API_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), process.env.APIMART_API_KEY);
  }

  const rows = [];
  for (const scenario of SCENARIOS) {
    const spec = await win.evaluate(async ({ mk, text }) => {
      const { sessionId } = await window.nomiDesktop.agents.chatV2Start({
        prompt: `在画布上为这个镜头做站位锁定（用合适的工具）：${text}`,
        sessionKey: "probe-agent-eval",
        skillKey: "workbench.generation.canvas-planner",
        mode: "auto",
        agentModelKey: mk,
        agentVendorKey: "apimart",
      });
      return await new Promise((resolve) => {
        let found = null;
        const off = window.nomiDesktop.agents.onChatV2Event(sessionId, (ev) => {
          if (!ev) return;
          if ((ev.type === "tool-call" || ev.type === "tool-call-pending")) {
            if (ev.toolName === "create_staging_reference") found = ev.args ?? ev.input ?? null;
            if (ev.type === "tool-call-pending" && ev.toolCallId) {
              window.nomiDesktop.agents.confirmTool(sessionId, ev.toolCallId, { ok: false, denied: true, message: "probe" });
            }
          }
          if (ev.type === "done" || ev.type === "error") { off?.(); resolve(found); }
        });
        setTimeout(() => { off?.(); resolve(found); }, 90000);
      });
    }, { mk: MODEL_KEY, text: scenario });

    if (!spec) {
      rows.push(`✗ 未调 staging | ${scenario}`);
    } else {
      const chars = Array.isArray(spec.characters) ? spec.characters : [];
      const poses = chars.map((c) => c?.pose || "standing").join("/");
      const facings = chars.map((c) => c?.facing || "-").join("/");
      const cam = spec.camera ? `${spec.camera.angle || "auto"}/${spec.camera.height || "auto"}/${spec.camera.shot || "auto"}` : "(省略·用默认)";
      rows.push(`✓ ${chars.length}人 [${poses}] facing=[${facings}] layout=${spec.layout || "auto"} cam=${cam}${spec.crowd ? " +crowd" : ""} | ${scenario}`);
    }
    console.log("  " + rows[rows.length - 1]);
  }

  console.log("\n═══ B 层 agent 选择评测 ═══");
  rows.forEach((r) => console.log(r));
  await app.close(); process.exit(0);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
