// 完整端到端（规则 13）：HappyHorse 经真实 app runtime 跑通一次生成，验 C4 的两件**只能真打才确认**
// 的事：① per-mode model enum 覆盖（M3，body.model=happyhorse/text-to-video 真被上游接受）；
// ② kie 的尾随空格 input 键（§2 坑1）真能产出结果。默认跑最便宜的 text-to-video（无参考图）。
//
// **会花真实额度**，故 KIE_API_KEY 门控：没设就跳过。
// 用法：pnpm run build && KIE_API_KEY=xxxx node tests/ux/happyhorse.e2e.mjs
//   可选 HAPPYHORSE_MODE=ref + HAPPYHORSE_REF_IMAGE=<url> 验角色参考（reference_image 尾随空格键）。
import { launchNomiApp } from "./_launchApp.mjs";

const KEY = process.env.KIE_API_KEY;
if (!KEY) {
  console.log("SKIP happyhorse.e2e: 未设 KIE_API_KEY（这条会花额度，按需手动跑）。");
  process.exit(0);
}
const MODE = process.env.HAPPYHORSE_MODE === "ref" ? "ref" : "t2v";
const REF_IMAGE = process.env.HAPPYHORSE_REF_IMAGE || "https://picsum.photos/seed/nomi-hh/720/1280";

let passed = 0;
function assert(cond, label) { if (!cond) throw new Error(`E2E FAIL: ${label}`); passed += 1; console.log(`  ✓ ${label}`); }

const { app, win } = await launchNomiApp({ name: "happyhorse", env: { NOMI_E2E_SMOKE: "1" } });
try {

  const seeded = await win.evaluate(async () => {
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；可选链不会替 Promise await，必须显式等待。
    const m = (await window.nomiDesktop?.modelCatalog?.listModels({ kind: "video", enabled: true }))?.find((x) => x.modelKey === "happyhorse");
    return Boolean(m) && m?.meta?.archetypeId === "happyhorse";
  });
  assert(seeded, "启动后 HappyHorse 在目录、带 archetypeId");

  const keySet = await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("kie", { apiKey: key, enabled: true }), KEY);
  assert(keySet?.hasApiKey, "kie API key 已设置");

  // per-mode enum + archetypeInput 由 runtime 拼装：这里直接喂 extras.archetypeInput（模拟 renderer 投影）。
  const archetypeInput = MODE === "ref"
    ? { model: "happyhorse/reference-to-video", reference_image: [REF_IMAGE] }
    : { model: "happyhorse/text-to-video" };
  const initial = await win.evaluate(async (args) => {
    return await window.nomiDesktop.tasks.run({
      vendor: "kie",
      request: {
        kind: "text_to_video",
        prompt: args.prompt,
        extras: { modelKey: "happyhorse", resolution: "1080p", aspect_ratio: "16:9", duration: "5", archetypeInput: args.archetypeInput },
      },
    });
  }, { prompt: "a serene timelapse of clouds over mountains", archetypeInput });
  assert(initial?.id, "app runtime 返回 taskId（createTask + per-mode enum 成功）");
  console.log(`    mode=${MODE} taskId=${initial.id} status=${initial.status}`);

  let final = initial;
  const terminal = new Set(["succeeded", "failed"]);
  for (let i = 0; i < 40 && !terminal.has(final.status); i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const resp = await win.evaluate(async (args) => window.nomiDesktop.tasks.result({ taskId: args.id, vendor: "kie", taskKind: "text_to_video", prompt: args.prompt, modelKey: "happyhorse" }), { id: initial.id, prompt: "a serene timelapse of clouds over mountains" });
    final = resp?.result ?? final;
    console.log(`    poll ${i + 1}: ${final.status}`);
  }
  assert(final.status === "succeeded", `生成成功（status=${final.status}）`);
  const video = (final.assets || []).find((a) => a.type === "video" && a.url);
  assert(video, "返回视频 asset");
  console.log(`    video=${video.url}`);
  console.log(`\nHAPPYHORSE E2E PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close().catch(() => {});
  process.exit(1);
} finally {
  await app.close().catch(() => {});
}
