// 站位旅途级评测 · B 层（agent 选择质量）：喂 8 个自然语言镜头场景，抓 agent 产出的
// create_staging_reference spec，打印它选的 characters/poses/layout/facing/camera —— 人眼判断
// agent 是否对多角色/多站位/朝向「选得对」。纯文本额度。gated APIMART_E2E。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/staging-agent-eval.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import { runAgentProbe } from "./_agentProbe.mjs";


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
  let agentProbeFailed = false;
  for (const scenario of SCENARIOS) {
    const outcome = await win.evaluate(runAgentProbe, {
      timeoutMs: 90000,
      request: {
        prompt: `在画布上为这个镜头做站位锁定（用合适的工具）：${scenario}`,
        capability: "canvas-agent",
        history: { kind: "ephemeral" },
        featureKey: "probe-agent-eval",
        skillKey: "workbench-generation",
        mode: "auto",
        agentModelKey: MODEL_KEY,
        agentVendorKey: "apimart",
      },
    });
    if (outcome.result?.usage) console.log(`  usage: ${JSON.stringify(outcome.result.usage)}`);
    const spec = outcome.calls.find((call) => call.toolName === "create_staging_reference")?.args ?? null;

    if (!outcome.ok) {
      agentProbeFailed = true;
      rows.push(`✗ Agent 未正常收尾：${outcome.error} | ${scenario}`);
    } else if (!spec) {
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
  await app.close(); process.exit(agentProbeFailed ? 1 : 0);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
