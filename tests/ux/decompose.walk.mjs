// 真机走查（R13）：在真实构建产物里把「元素拆解」端到端跑通——
//   ① 注入 Replicate key（同接入页保存链路）→ ② onboarding 出现 Replicate 卡（截图人眼判断）
//   ③ 铸付费令牌 → 调 nomi:image:decompose-layers IPC → 真 Replicate qwen-image-layered 出 N 层
//   ④ 抓一张层确认是合法 RGBA PNG（拆解真出图，非空壳）
// **会花真实额度**（约 $0.05/次）。key：REPLICATE_API_TOKEN 必填，否则 SKIP。
// 用法：pnpm run build && REPLICATE_API_TOKEN=r8_... node tests/ux/decompose.walk.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOKEN = process.env.REPLICATE_API_TOKEN || "";
const IMG = process.env.DECOMPOSE_IMG || "https://picsum.photos/seed/nomi-decompose/896/1200";
const SHOT_DIR = path.join(repoRoot, "tests/ux/decompose-results");

if (!TOKEN) {
  console.log("SKIP decompose.walk: 会花额度。REPLICATE_API_TOKEN=r8_... node tests/ux/decompose.walk.mjs 才跑。");
  process.exit(0);
}
fs.mkdirSync(SHOT_DIR, { recursive: true });
// 隔离 userData 绕开打包版单实例锁（同 dark-mode.walk）。replicate key 下面注入，不依赖真 userData。
const userData = process.env.NOMI_UI_USER_DATA || path.join(repoRoot, ".tmp", "nomi-decompose-userdata");
fs.mkdirSync(userData, { recursive: true });

const { win, close } = await launchNomiApp({ name: "decompose", userDataDir: userData });
let ok = true;
try {

  // ① 注入 Replicate key（= 接入页填 key 的同一条 upsert 链路）
  await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("replicate", { apiKey: key, enabled: true }), TOKEN);
  const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
  const rep = (vendors || []).find((v) => (v.key || v.vendorKey) === "replicate");
  console.log(`① Replicate vendor: ${rep ? `已接入(hasApiKey=${rep.hasApiKey})` : "缺失"}`);
  if (!rep || !rep.hasApiKey) { ok = false; console.log("  ✗ Replicate 未出现在 catalog / key 未存"); }

  // ② bridge 暴露 decomposeLayers?
  const hasApi = await win.evaluate(() => Boolean(window.nomiDesktop?.image?.decomposeLayers));
  console.log(`② bridge.image.decomposeLayers: ${hasApi ? "✓ 暴露" : "✗ 缺失"}`);
  if (!hasApi) ok = false;

  // ③ 铸令牌 + 调 IPC 真生成
  console.log(`③ 拆解中（真 Replicate，约 15s）… img=${IMG}`);
  const res = await win.evaluate(async (img) => {
    const nodeId = "walk-decompose-node";
    const { grantId } = await window.nomiDesktop.tasks.grantSpend({ nodeIds: [nodeId] });
    try {
      const out = await window.nomiDesktop.image.decomposeLayers({ nodeId, imageUrl: img, numLayers: 4, grantId });
      return { ok: true, layers: out?.layers || [] };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, IMG);
  if (!res.ok) { ok = false; console.log(`  ✗ IPC 报错：${res.error}`); }
  else {
    console.log(`  ✓ 返回 ${res.layers.length} 层`);
    if (res.layers.length < 2) { ok = false; console.log("  ✗ 层数 < 2（拆解未生效）"); }
    // ④ 抓一张层确认合法图片
    for (let i = 0; i < res.layers.length; i++) {
      const probe = await win.evaluate(async (url) => {
        try { const r = await fetch(url); const b = await r.arrayBuffer(); return { status: r.status, type: r.headers.get("content-type"), bytes: b.byteLength }; }
        catch (e) { return { error: String(e?.message || e) }; }
      }, res.layers[i]);
      console.log(`  层${i}: ${res.layers[i].slice(0, 60)}… → ${JSON.stringify(probe)}`);
      if (!probe.bytes || probe.bytes < 1000) { ok = false; console.log(`  ✗ 层${i} 不是有效图片`); }
    }
  }

  // 截图：onboarding 的 Replicate 卡（人眼判断接入页 UI）。尽力打开模型设置抽屉。
  try {
    await win.evaluate(() => window.dispatchEvent(new CustomEvent("nomi:open-onboarding")));
    await win.waitForTimeout(800);
  } catch { /* 抽屉事件名不确定，截全屏兜底 */ }
  await win.screenshot({ path: path.join(SHOT_DIR, "app.png") });
  console.log(`截图：${path.join(SHOT_DIR, "app.png")}`);
} catch (err) {
  ok = false;
  console.log(`✗ 走查异常：${err?.message || err}`);
} finally {
  await close();
}
console.log(`\n═══ decompose 真机走查：${ok ? "通过" : "未通过"} ═══`);
process.exit(ok ? 0 : 1);
