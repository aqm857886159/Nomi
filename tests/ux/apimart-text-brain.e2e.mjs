// 真实端到端（接入即验证 · Issue #9 验收门 S2）：验证 apimart 的默认文本大脑
// `deepseek-v4-pro` 在真实服务端上 **chat + tool_use 双通**——这是创作助手 / 拆镜头能跑的前提，
// 也是「默认播一个文本模型」是否真有用的唯一硬证据（单测只能证种子写进 catalog，证不了 vendor 接受）。
//
// 走真实 app 栈（safeStorage 身份一致，复用 app 已配 apimart key 自解密）：
//   chatV2Start(agentModelKey="deepseek-v4-pro") → 发一段拆镜头 prompt → 监听 chatV2 事件。
//   判定：① 收到 content-delta/result = chat 解析成功（模型在 apimart 真实存在）；
//        ② 收到 tool-call / tool-call-pending = function calling 可用（agent 主控必需）。
//   两者皆中 → PASS。只 chat 不 tool_use → 退回 gpt-5 系（回填 plan + apimartTexts.ts）。
//
// **会花真实额度（仅文本，极少）**。额度闸：不显式 APIMART_E2E=1 / APIMART_API_KEY 就 SKIP。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/apimart-text-brain.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";


if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP apimart-text-brain.e2e: 会花额度。APIMART_E2E=1 node tests/ux/apimart-text-brain.e2e.mjs 才跑（用 app 已配 apimart key）。");
  process.exit(0);
}

const MODEL_KEY = process.env.APIMART_TEXT_MODEL || "deepseek-v4-pro";
const ENV_KEY = process.env.APIMART_API_KEY;
const STORY = "一个程序员深夜加班，灵感突现，敲下最后一行代码，窗外天亮了。";

const { app, win } = await launchNomiApp({
  name: "apimart-text-brain",
  args: ["--disable-gpu", "--disable-software-rasterizer"],
});

try {

  // key：env 覆盖否则用已存的（自解密）。未配 → SKIP。
  if (ENV_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((v) => v.key === "apimart" || v.vendorKey === "apimart");
    if (!(apimart && (apimart.hasApiKey || apimart.enabledApiKey))) {
      console.log("SKIP apimart-text-brain.e2e: apimart 未配 API key（app「模型接入」里配，或设 APIMART_API_KEY）。");
      await app.close(); process.exit(0);
    }
  }

  // 确认种子大脑在 catalog（S1 应已 reconcile 进去）。
  const hasBrain = await win.evaluate(async (mk) => {
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；先 await 才能使用数组方法。
    const models = (await window.nomiDesktop.modelCatalog.listModels?.()) || [];
    return (models || []).some((m) => (m.vendorKey === "apimart") && m.modelKey === mk);
  }, MODEL_KEY).catch(() => null);
  console.log(`apimart 文本大脑 ${MODEL_KEY} 在 catalog：${hasBrain === null ? "(listModels 未暴露,跳过自检)" : hasBrain}`);

  // 驱动一整轮 agent：强制 agentModelKey=deepseek-v4-pro，发拆镜头 prompt，监听 chatV2 事件。
  // 顺序同真实渲染层：先 start 拿 sessionId，再 onChatV2Event(sessionId, cb)（vendor 网络延迟覆盖订阅窗口）。
  console.log(`\n▶ chatV2 拆镜头（agentModelKey=${MODEL_KEY}）`);
  const outcome = await win.evaluate(async ({ mk, story }) => {
    const { sessionId } = await window.nomiDesktop.agents.chatV2Start({
      prompt: `把下面这段故事拆成 3 个分镜镜头，必须调用 propose_storyboard_plan 工具产出方案，不要只用文字回答。\n\n故事：${story}`,
      sessionKey: "probe-text-brain",
      skillKey: "workbench.generation.canvas-planner",
      mode: "auto",
      agentModelKey: mk,
      agentVendorKey: "apimart",
    });
    return await new Promise((resolve) => {
      const seen = { content: false, toolCall: false, error: "", done: false };
      const off = window.nomiDesktop.agents.onChatV2Event(sessionId, (ev) => {
        if (!ev) return;
        if (ev.type === "content-delta" && (ev.delta || "").length) seen.content = true;
        if (ev.type === "tool-call" || ev.type === "tool-call-pending") {
          seen.toolCall = true;
          // 规划阶段不真写画布：收到待确认就拒绝，尽快收尾省额度。
          if (ev.type === "tool-call-pending" && ev.toolCallId) {
            window.nomiDesktop.agents.confirmTool(sessionId, ev.toolCallId, { ok: false, denied: true, message: "probe: reject to end" });
          }
        }
        if (ev.type === "result" && ev.result?.text) seen.content = true;
        if (ev.type === "error") seen.error = ev.message || "unknown";
        if (ev.type === "done") { seen.done = true; off?.(); resolve(seen); }
      });
      setTimeout(() => { off?.(); resolve(seen); }, 90000);
    });
  }, { mk: MODEL_KEY, story: STORY });

  console.log(`  content(chat 解析): ${outcome.content}`);
  console.log(`  toolCall(tool_use): ${outcome.toolCall}`);
  if (outcome.error) console.log(`  error: ${outcome.error}`);

  const chatOk = outcome.content || outcome.toolCall;
  const toolOk = outcome.toolCall;
  console.log(`\n═══ apimart 文本大脑 E2E：chat=${chatOk ? "✓" : "✗"} tool_use=${toolOk ? "✓" : "✗"} ═══`);
  if (chatOk && toolOk) {
    console.log(`  ✓ ${MODEL_KEY} 在 apimart 上 chat + tool_use 双通，可当默认大脑。`);
    await app.close(); process.exit(0);
  }
  if (chatOk && !toolOk) {
    console.log(`  ✗ ${MODEL_KEY} chat 通但 tool_use 未触发 → 该模型不适合做 agent 主控，退回 gpt-5 系并回填 apimartTexts.ts。`);
  } else {
    console.log(`  ✗ ${MODEL_KEY} 连 chat 都没解析（id 不存在 / vendor 拒绝 / key 失效）。err=${outcome.error || "(无)"}`);
  }
  await app.close(); process.exit(1);
} catch (err) {
  console.log(`✗ ${err?.message || err}`);
  await app.close().catch(() => undefined);
  process.exit(1);
}
