// Agnes AI 真实端到端（R13 + 接入即验证）：Playwright 驱动**真实构建产物**，经 app 运行时
// （catalog mapping → paramMap 派生 → requestPipeline 渲染 → 异步轮询 → 落素材）把 AGNES 四条
// 生成路径真实跑通——比 transport-spike 多覆盖整条 app runtime（不是替我手搓的 body）。验证：
//   ① 图 文生图（同步 data.0.url）
//   ② 图 改图（extra_body.image 嵌套经真 runtime 渲染被接受）
//   ③ 视频 文生视频（paramMap 派生**数字** width/height/num_frames → 提交 200 → /agnesapi?video_id= 轮询
//      → 反常字段 remixed_from_video_id 取片）
//   ④ 视频 图生视频（顶层 image 首帧）
//
// AGNES 免费（零额度），但仍设闸保持一致：AGNES_E2E=1 或 AGNES_API_KEY 才跑。
// 用法：pnpm run build && AGNES_API_KEY=sk-xxx node tests/ux/agnes.e2e.mjs
//   可选 ONLY=t2i,edit,t2v,i2v 只跑指定用例。视频用 480p/3s 最省时。
import { launchNomiApp } from "./_launchApp.mjs";


if (!process.env.AGNES_E2E && !process.env.AGNES_API_KEY) {
  console.log("SKIP agnes.e2e: AGNES_E2E=1 或 AGNES_API_KEY=sk-xxx node tests/ux/agnes.e2e.mjs 才跑。");
  process.exit(0);
}

const ENV_KEY = process.env.AGNES_API_KEY;
const REF = process.env.AGNES_REF_IMG || "https://picsum.photos/seed/nomi-agnes/1024/1024";
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

const ALL_CASES = [
  { id: "t2i", labelZh: "Agnes Image 2.1 · 文生图", kind: "text_to_image",
    extras: { modelKey: "agnes-image-2.1-flash", size: "1024x1024" },
    prompt: "a single red paper crane on a wooden desk, soft window light, minimal" },
  { id: "edit", labelZh: "Agnes Image 2.1 · 改图（extra_body.image）", kind: "image_edit",
    extras: { modelKey: "agnes-image-2.1-flash", size: "1024x1024", archetypeInput: { image: [REF] } },
    prompt: "change the background to a clear blue sky with soft clouds" },
  { id: "t2v", labelZh: "Agnes Video V2.0 · 文生视频（paramMap 派生数字）", kind: "text_to_video",
    extras: { modelKey: "agnes-video-v2.0", aspect_ratio: "16:9", resolution: "480p", duration: 3 },
    prompt: "a waterfall cascading down rocks, slow cinematic push-in" },
  { id: "i2v", labelZh: "Agnes Video V2.0 · 图生视频（顶层 image 首帧）", kind: "image_to_video",
    extras: { modelKey: "agnes-video-v2.0", aspect_ratio: "16:9", resolution: "480p", duration: 3, archetypeInput: { image: REF } },
    prompt: "gentle camera push-in, subtle motion" },
];
const cases = ONLY.length ? ALL_CASES.filter((c) => ONLY.includes(c.id)) : ALL_CASES;

const { app, win } = await launchNomiApp({ name: "agnes" });
const results = [];

try {

  if (ENV_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("agnes", { apiKey: key, enabled: true }), ENV_KEY);
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const agnes = (vendors || []).find((v) => v.key === "agnes" || v.vendorKey === "agnes");
    if (!(agnes && (agnes.hasApiKey || agnes.enabledApiKey))) {
      console.log("SKIP agnes.e2e: agnes 未配 API key（app「模型接入」里配，或设 AGNES_API_KEY）。");
      await app.close(); process.exit(0);
    }
  }

  let lastT2iUrl = null; // AGNES 改图对输入图来源挑剔(外部 host 跳转/慢取被拒)；用自家 t2i 输出做输入=最真实的「改生成的图」流程。
  for (const c of cases) {
    console.log(`\n▶ ${c.labelZh}`);
    try {
      if (c.id === "edit") {
        if (!lastT2iUrl) { console.log("  ⊘ 跳过 edit：无可用 t2i 输出做输入（单跑 edit 请用 ONLY=t2i,edit）"); results.push({ id: c.id, ok: false, err: "无 t2i 输入" }); continue; }
        c.extras.archetypeInput = { image: [lastT2iUrl] };
      }
      const nodeId = `agnes-e2e-${c.id}`;
      // 付费守卫：真人确认 = 这里铸一次性令牌（绑 nodeId），随 extras 下传（同 UI 确认链）。AGNES 免费但闸不分免付费。
      const { grantId } = await win.evaluate((nid) => window.nomiDesktop.tasks.grantSpend({ nodeIds: [nid], maxAttemptsPerNode: 3 }), nodeId);
      const initial = await win.evaluate(async (a) => {
        return await window.nomiDesktop.tasks.run({ vendor: "agnes", request: { kind: a.kind, prompt: a.prompt, extras: { ...a.extras, nodeId: a.nodeId, grantId: a.grantId } } });
      }, { ...c, nodeId, grantId });
      if (!initial?.id) throw new Error(`无 taskId（createTask 被拒）：${JSON.stringify(initial)?.slice(0, 300)}`);
      console.log(`  ✓ createTask 接受，taskId=${initial.id} status=${initial.status}`);

      let final = initial;
      const terminal = new Set(["succeeded", "failed"]);
      for (let i = 0; i < 60 && !terminal.has(final.status); i++) {
        await new Promise((r) => setTimeout(r, c.kind.includes("video") ? 8000 : 4000));
        const resp = await win.evaluate(async (a) => {
          return await window.nomiDesktop.tasks.result({ taskId: a.id, vendor: "agnes", taskKind: a.kind, prompt: a.prompt, modelKey: a.extras.modelKey });
        }, { id: initial.id, kind: c.kind, prompt: c.prompt, extras: c.extras });
        final = resp?.result ?? final;
        console.log(`  poll ${i + 1}: ${final.status}`);
      }
      if (final.status !== "succeeded") {
        const dump = JSON.stringify(final, null, 0).slice(0, 700);
        const msg = final.errorMessage || final.error || final.message || final.failureReason || "(无错误文本)";
        throw new Error(`生成未成功（status=${final.status}）err="${msg}" full=${dump}`);
      }
      const asset = (final.assets || []).find((x) => x.url);
      console.log(`  ✓ 出片：${(asset?.url || "").slice(0, 72)}…`);
      if (c.id === "t2i" && asset?.url) lastT2iUrl = asset.url; // 供 edit 当输入
      results.push({ id: c.id, ok: true, url: asset?.url });
    } catch (err) {
      console.log(`  ✗ ${err?.message || err}`);
      results.push({ id: c.id, ok: false, err: String(err?.message || err) });
    }
  }
} finally {
  await app.close().catch(() => undefined);
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n═══ agnes E2E：${pass}/${results.length} 通过 ═══`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}${r.ok ? "" : ` — ${r.err}`}`);
process.exit(pass === results.length ? 0 : 1);
