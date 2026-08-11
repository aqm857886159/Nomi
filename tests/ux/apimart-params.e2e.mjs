// 真实端到端（R13 + 接入即验证）：用 Playwright 驱动**真实构建产物**，经 app 运行时把本轮 apimart
// 参数补全的**新机制**逐条真实生成跑通——验证 vendor 真的接受这些请求形状（catalog body 模板层 +
// apimart 服务端），补齐单测覆盖不到的「真实 HTTP 是否被接受」：
//   ① 变体 modelKey 传输（sora-2-pro / MiniMax-Hailuo-2.3-Fast / qwen-image-2.0-pro 在 apimart 真实存在且出片）
//   ② generation_type:reference（Omni 参考图，避 3 图被拒）+ generation_type:frame（Veo 首尾帧）
//   ③ combineSlotsInto.flat 产出的 image_urls=[首,尾] 被接受
//   ④ duration 整数（select 数值 option → 整数，非字符串）被接受
//
// **会花真实额度**。key：默认用 app 已配 apimart key（dev userData 自解密）；APIMART_API_KEY 可覆盖。
// 额度闸：不显式 APIMART_E2E=1 / APIMART_API_KEY 就 SKIP。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/apimart-params.e2e.mjs
//   可选 ONLY=sora-pro,veo-frame,... 只跑指定用例省额度。全 720p / 最短时长 / 无音频省额度。
import { launchNomiApp } from "./_launchApp.mjs";


if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP apimart-params.e2e: 会花额度。APIMART_E2E=1 node tests/ux/apimart-params.e2e.mjs 才跑（用 app 已配 apimart key）。");
  process.exit(0);
}

const REF = process.env.APIMART_REF_IMG || "https://picsum.photos/seed/nomi-ref/1280/720";
const REF2 = process.env.APIMART_REF_IMG2 || "https://picsum.photos/seed/nomi-ref2/1280/720";
const ENV_KEY = process.env.APIMART_API_KEY;
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);

// 每条用例：mimic 真实渲染层 buildArchetypeInputParams 的产出（archetypeInput.model = 变体 modelKey、
// generation_type = fixedParams、image_urls = flat 合并），标量参数走 extras 顶层（同 seedance.e2e）。
const CASES = [
  {
    id: "sora-pro", labelZh: "Sora 2 Pro（变体 modelKey）", kind: "text_to_video",
    extras: { modelKey: "sora-2", aspect_ratio: "16:9", resolution: "720p", duration: 4,
      archetypeInput: { model: "sora-2-pro" } },
    prompt: "a calm sunrise over a quiet sea, gentle waves",
  },
  {
    id: "veo-reference", labelZh: "Veo 3.1 参考图（generation_type:reference）", kind: "image_to_video",
    extras: { modelKey: "veo3.1-fast", resolution: "720p",
      archetypeInput: { model: "veo3.1-fast", generation_type: "reference", image_urls: [REF] } },
    prompt: "slow cinematic push-in based on the reference image",
  },
  {
    id: "veo-frame", labelZh: "Veo 3.1 首尾帧（generation_type:frame + flat image_urls[首,尾]）", kind: "image_to_video",
    extras: { modelKey: "veo3.1-fast", resolution: "720p",
      archetypeInput: { model: "veo3.1-fast", generation_type: "frame", image_urls: [REF, REF2] } },
    prompt: "smooth transition from the first frame to the last frame",
  },
  {
    id: "omni-reference", labelZh: "Omni-Flash-Ext 参考图融合（generation_type:reference）", kind: "image_to_video",
    extras: { modelKey: "Omni-Flash-Ext", size: "16:9", resolution: "720p", duration: 4,
      archetypeInput: { generation_type: "reference", image_urls: [REF] } },
    prompt: "animate the reference image with subtle camera motion",
  },
  {
    // Fast 官方要求 first_frame_image（i2v），故走图生（不能纯文生 t2v）。
    id: "hailuo-fast", labelZh: "Hailuo 2.3 Fast（变体 modelKey，i2v 首帧）", kind: "image_to_video",
    extras: { modelKey: "MiniMax-Hailuo-2.3", resolution: "768p", duration: 6,
      archetypeInput: { model: "MiniMax-Hailuo-2.3-Fast", first_frame_image: REF } },
    prompt: "a paper boat floating down a rainy street",
  },
  {
    id: "qwen-pro", labelZh: "Qwen-Image 2.0 Pro（图像变体 modelKey）", kind: "text_to_image",
    extras: { modelKey: "qwen-image-2.0", size: "1:1", resolution: "1K",
      archetypeInput: { model: "qwen-image-2.0-pro" } },
    prompt: "a minimalist poster of a single red maple leaf, studio lighting",
  },
];

const cases = ONLY.length ? CASES.filter((c) => ONLY.includes(c.id)) : CASES;

const { app, win } = await launchNomiApp({ name: "apimart-params" });
const results = [];

try {

  // key：env 覆盖否则用已存的（自解密）。未配 → SKIP。
  if (ENV_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((v) => v.key === "apimart" || v.vendorKey === "apimart");
    if (!(apimart && (apimart.hasApiKey || apimart.enabledApiKey))) {
      console.log("SKIP apimart-params.e2e: apimart 未配 API key（app「模型接入」里配，或设 APIMART_API_KEY）。");
      await app.close(); process.exit(0);
    }
  }

  for (const c of cases) {
    console.log(`\n▶ ${c.labelZh}`);
    try {
      const initial = await win.evaluate(async (a) => {
        return await window.nomiDesktop.tasks.run({ vendor: "apimart", request: { kind: a.kind, prompt: a.prompt, extras: a.extras } });
      }, c);
      if (!initial?.id) throw new Error(`无 taskId（createTask 被拒）：${JSON.stringify(initial)?.slice(0, 200)}`);
      console.log(`  ✓ createTask 接受，taskId=${initial.id} status=${initial.status}`);

      let final = initial;
      const terminal = new Set(["succeeded", "failed"]);
      for (let i = 0; i < 50 && !terminal.has(final.status); i++) {
        await new Promise((r) => setTimeout(r, 15000));
        const resp = await win.evaluate(async (a) => {
          return await window.nomiDesktop.tasks.result({ taskId: a.id, vendor: "apimart", taskKind: a.kind, prompt: a.prompt, modelKey: a.extras.modelKey });
        }, { id: initial.id, kind: c.kind, prompt: c.prompt, extras: c.extras });
        final = resp?.result ?? final;
        console.log(`  poll ${i + 1}: ${final.status}`);
      }
      if (final.status !== "succeeded") {
        const dump = JSON.stringify(final, null, 0).slice(0, 600);
        const msg = final.errorMessage || final.error || final.message || final.failureReason || "(无错误文本)";
        throw new Error(`生成未成功（status=${final.status}）err="${msg}" full=${dump}`);
      }
      const asset = (final.assets || []).find((x) => x.url);
      console.log(`  ✓ 出片：${(asset?.url || "").slice(0, 64)}…`);
      results.push({ id: c.id, ok: true });
    } catch (err) {
      console.log(`  ✗ ${err?.message || err}`);
      results.push({ id: c.id, ok: false, err: String(err?.message || err) });
    }
  }
} finally {
  await app.close().catch(() => undefined);
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n═══ apimart-params E2E：${pass}/${results.length} 通过 ═══`);
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.id}${r.ok ? "" : ` — ${r.err}`}`);
process.exit(pass === results.length ? 0 : 1);
