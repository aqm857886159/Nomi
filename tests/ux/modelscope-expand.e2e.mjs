// verify-first（接入即验证，魔搭扩容）：用 app 已配的魔搭 key 真打一遍候选模型，确认魔搭真服务、
// 真出货，再据此写生产 catalog（不手配漂）。**会花魔搭免费额度（视频额度少，省着测）**。
//   ① LLM(免费文本大脑)：chatV2 chat + tool_use 双通 —— deepseek-ai/DeepSeek-V3 等
//   ② 视频(Wan)：POST /v1/videos/generations 异步 + 轮询 /v1/tasks/{id}(X-ModelScope-Task-Type:video_generation)
//      → output_video_url 出片
// 用法：MODELSCOPE_E2E=1 pnpm run build && node tests/ux/modelscope-expand.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import { runAgentProbe } from "./_agentProbe.mjs";

if (!process.env.MODELSCOPE_E2E) {
  console.log("SKIP modelscope-expand: 会花魔搭额度。MODELSCOPE_E2E=1 node tests/ux/modelscope-expand.e2e.mjs 才跑（用 app 已配魔搭 key）。");
  process.exit(0);
}

const LLM_CANDIDATES = (process.env.MS_LLM || "deepseek-ai/DeepSeek-R1,Qwen/Qwen3-32B,Qwen/Qwen3-235B-A22B,Qwen/Qwen2.5-72B-Instruct,ZhipuAI/GLM-4.5").split(",").map((s) => s.trim()).filter(Boolean);
const VIDEO_CANDIDATES = (process.env.MS_VIDEO || "Wan-AI/Wan2.2-T2V-A14B").split(",").map((s) => s.trim()).filter(Boolean);
// 视频 size 试探（图片当初要像素 WxH；视频可能同理）。
const VIDEO_SIZE = process.env.MS_VIDEO_SIZE || "1280x720";

// 魔搭视频传输 op（异步，X-ModelScope 头；与图片同 vendor 不同 task-type + 结果字段）。
const VIDEO_CREATE = {
  method: "POST", path: "/v1/videos/generations",
  headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json", "X-ModelScope-Async-Mode": "true" },
  body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", size: "{{request.params.size}}" },
  response_mapping: { task_id: "task_id" }, provider_meta_mapping: { task_id: "task_id" },
};
const VIDEO_QUERY = {
  method: "GET", path: "/v1/tasks/{{providerMeta.task_id}}",
  headers: { Authorization: "Bearer {{user_api_key}}", "X-ModelScope-Task-Type": "video_generation" },
  response_mapping: { status: "task_status", video_url: "output_video_url", error_message: "errors.message" },
};
const STATUS_MAPPING = { queued: ["pending", "queued"], running: ["running", "processing"], succeeded: ["succeed", "succeeded", "success"], failed: ["failed", "fail", "error", "canceled", "cancelled", "timeout", "revoked"] };

const { app, win } = await launchNomiApp({ name: "modelscope-expand", args: ["--disable-gpu"], settleMs: 1200 });
const results = [];
let agentProbeFailed = false;
const ok = (n, v, d) => { results.push({ n, v }); console.log(`  ${v ? "✓" : "✗"} ${n}${d ? " — " + d : ""}`); };

try {

  // 前置：魔搭已配 key？
  const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
  const ms = (vendors || []).find((v) => v.key === "modelscope");
  if (!ms?.hasApiKey) { console.log("SKIP: 魔搭未配 key（app 模型接入里配）。"); await app.close(); process.exit(0); }

  // ① LLM：逐个 upsert 成 text 模型 → chatV2 验 chat + tool_use。
  console.log("\n▶ ① 魔搭 LLM（免费文本大脑）chat + tool_use");
  for (const mk of LLM_CANDIDATES) {
    await win.evaluate((id) => window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: "modelscope", modelKey: id, labelZh: id, kind: "text", enabled: true }), mk);
    const outcome = await win.evaluate(runAgentProbe, {
      timeoutMs: 70000,
      request: {
        prompt: "把这句话拆成 2 个分镜，必须调用 propose_storyboard_plan 工具，不要只用文字。故事：一只猫在屋顶看月亮。",
        capability: "storyboard", history: { kind: "ephemeral" }, featureKey: "ms-probe",
        skillKey: "workbench-generation", mode: "auto",
        agentModelKey: mk, agentVendorKey: "modelscope",
      },
    });
    if (!outcome.ok) agentProbeFailed = true;
    if (outcome.result?.usage) console.log(`   usage: ${JSON.stringify(outcome.result.usage)}`);
    const tool = outcome.calls.length > 0;
    ok(`LLM ${mk}: chat`, outcome.ok && (Boolean(outcome.text) || tool), outcome.error || "");
    ok(`LLM ${mk}: tool_use`, outcome.ok && tool, outcome.error || (tool ? "" : "未触发工具调用"));
  }

  // ② 视频：upsert Wan + 视频 mapping → tasks.run → 轮询出片。
  console.log("\n▶ ② 魔搭视频（Wan，异步出片）");
  for (const mk of VIDEO_CANDIDATES) {
    await win.evaluate((id) => window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: "modelscope", modelKey: id, labelZh: id, kind: "video", enabled: true }), mk);
    await win.evaluate(({ create, query, sm }) => window.nomiDesktop.modelCatalog.upsertMapping({ vendorKey: "modelscope", taskKind: "text_to_video", name: "魔搭视频", enabled: true, create, query, statusMapping: sm }), { create: VIDEO_CREATE, query: VIDEO_QUERY, sm: STATUS_MAPPING });
    let initial;
    try {
      initial = await win.evaluate(({ mk, size }) => window.nomiDesktop.tasks.run({ vendor: "modelscope", request: { kind: "text_to_video", prompt: "a cat watching the moon on a rooftop, cinematic", extras: { modelKey: mk, size } } }), { mk, size: VIDEO_SIZE });
    } catch (e) { ok(`视频 ${mk}: 提交`, false, String(e?.message || e).split("::").pop()?.slice(0, 120)); continue; }
    if (!initial?.id) { ok(`视频 ${mk}: 提交`, false, JSON.stringify(initial)?.slice(0, 160)); continue; }
    console.log(`   提交 ok task=${initial.id} status=${initial.status}`);
    let final = initial;
    for (let i = 0; i < 40 && !["succeeded", "failed"].includes(final?.status); i++) {
      await win.waitForTimeout(15000);
      const r = await win.evaluate((a) => window.nomiDesktop.tasks.result({ taskId: a.id, vendor: "modelscope", taskKind: "text_to_video", prompt: "a cat", modelKey: a.mk }), { id: initial.id, mk });
      final = r?.result ?? final;
      console.log(`   poll ${i + 1}: ${final?.status}`);
    }
    const url = (final?.assets || []).find((a) => a.url)?.url;
    ok(`视频 ${mk}: 出片`, final?.status === "succeeded" && !!url, `status=${final?.status} url=${(url || "").slice(0, 50)} err=${final?.errorMessage || ""}`);
  }
} catch (e) { ok("e2e 异常", false, String(e?.message || e)); }
finally { await app.close().catch(() => undefined); }

const pass = results.filter((r) => r.v).length;
console.log(`\n═══ 魔搭扩容 verify-first：${pass}/${results.length} ═══`);
for (const r of results) console.log(`  ${r.v ? "✓" : "✗"} ${r.n}`);
process.exit(agentProbeFailed ? 1 : 0); // 候选能力仍供发现；Agent 超时/传输失败不能伪装成成功探针。
