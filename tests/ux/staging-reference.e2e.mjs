// 真实用户视角 E2E（触发层）：真 LLM 看到「需要锁站位/动作/机位」的镜头请求时，
// 会不会主动调用 create_staging_reference，且参数合理（≥2 角色 + 跪姿 + 低机位）。
// 这是工具「何时用」描述 + 触发机制的唯一硬证据（单测只证 schema，证不了 LLM 真会用）。
// 纯文本额度（不触发任何图像/视频生成；站位出图是本地离屏、零 API）。
// 额度闸：不显式 APIMART_E2E=1 / APIMART_API_KEY 就 SKIP。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/staging-reference.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import { runAgentProbe } from "./_agentProbe.mjs";


if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP staging-reference.e2e: 会花文本额度。APIMART_E2E=1 node tests/ux/staging-reference.e2e.mjs 才跑。");
  process.exit(0);
}

const MODEL_KEY = process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro";
const ENV_KEY = process.env.APIMART_API_KEY;
const PROMPT =
  "帮我把这个镜头落到画布上：男主角单膝跪地向女主角求婚，女主角站在他正前方，用低机位仰拍的中景。请用合适的工具，把这两个人的站位、动作和机位锁定好，别让生成时人物关系跑偏。";

const { app, win } = await launchNomiApp({ name: "staging-reference" });

try {
  if (ENV_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((v) => v.key === "apimart" || v.vendorKey === "apimart");
    if (!(apimart && (apimart.hasApiKey || apimart.enabledApiKey))) {
      console.log("SKIP staging-reference.e2e: apimart 未配 API key。");
      await app.close(); process.exit(0);
    }
  }

  console.log(`\n▶ chatV2 站位触发（agentModelKey=${MODEL_KEY}）`);
  const outcome = await win.evaluate(runAgentProbe, {
    timeoutMs: 120000,
    request: {
      prompt: PROMPT,
      capability: "canvas-agent",
      history: { kind: "ephemeral" },
      featureKey: "probe-staging",
      skillKey: "workbench-generation",
      mode: "auto",
      agentModelKey: MODEL_KEY,
      agentVendorKey: "apimart",
    },
  });

  const calls = outcome.calls || [];
  console.log(`  工具调用：${calls.map((c) => c.toolName).join(", ") || "(无)"}`);
  if (outcome.result?.usage) console.log(`  usage: ${JSON.stringify(outcome.result.usage)}`);
  if (outcome.error) console.log(`  error: ${outcome.error}`);

  const staging = calls.find((c) => c.toolName === "create_staging_reference");
  let argsOk = false;
  if (staging?.args) {
    const a = staging.args;
    const chars = Array.isArray(a.characters) ? a.characters : [];
    const hasKneel = chars.some((c) => typeof c?.pose === "string" && /knee/.test(c.pose));
    const lowCam = a.camera && typeof a.camera === "object" && a.camera.height === "low";
    argsOk = chars.length >= 2 && (hasKneel || lowCam);
    console.log(`  staging args: characters=${chars.length} kneel=${hasKneel} low=${lowCam}`);
  }

  console.log(`\n═══ 站位触发 E2E：完成=${outcome.ok ? "✓" : "✗"} 调用=${staging ? "✓" : "✗"} 参数合理=${argsOk ? "✓" : "✗"} ═══`);
  if (outcome.ok && staging && argsOk) {
    console.log("  ✓ 真 LLM 对需要锁站位的镜头主动调用了 create_staging_reference 且参数合理。");
    await app.close(); process.exit(0);
  }
  console.log("  ✗ Agent 未正常收尾、未触发或参数不合理 —— 先看上方 error，再检查工具 description 与系统提示。");
  await app.close(); process.exit(1);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
