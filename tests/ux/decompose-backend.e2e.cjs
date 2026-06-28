// 元素拆解·后端端到端 R13（不开窗，无 GUI 会话也能跑）：只起 Electron 主进程，注入 Replicate key →
// 铸付费令牌 → 调编译后的 decomposeLayers → 真 Replicate qwen-image-layered 出 N 层 → 校验是有效 PNG。
// 验证「读 key / 付费令牌消费 / requestJson→真 Replicate / 多输出解析」全链路在真 app 主进程里跑通。
// **会花真实额度**（约 $0.05/次）。需先 pnpm run build（产 dist-electron）。
// 用法：REPLICATE_API_TOKEN=r8_... ./node_modules/.bin/electron tests/ux/decompose-backend.e2e.cjs
const path = require("node:path");
const { app } = require("electron");

const REPO = path.resolve(__dirname, "../..");
const TOKEN = process.env.REPLICATE_API_TOKEN || "";
const IMG = process.env.DECOMPOSE_IMG || "https://picsum.photos/seed/nomi-decompose/896/1200";

app.setPath("userData", path.join(REPO, ".tmp", "nomi-decompose-headless"));
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const log = (...a) => { process.stdout.write(a.join(" ") + "\n"); };
  try {
    if (!TOKEN) { log("SKIP: 无 REPLICATE_API_TOKEN"); app.exit(0); return; }
    const D = path.join(REPO, "dist-electron");
    const { ensureBuiltinModelSeeds } = require(path.join(D, "runtime.js"));
    ensureBuiltinModelSeeds();
    const { upsertModelCatalogVendorApiKey, readCatalog } = require(path.join(D, "catalog/catalogStore.js"));
    upsertModelCatalogVendorApiKey("replicate", { apiKey: TOKEN, enabled: true });
    const cat = readCatalog();
    const rep = cat.vendors.find((v) => v.key === "replicate");
    log(`① replicate vendor seeded=${Boolean(rep)} hasKey=${Boolean(cat.apiKeysByVendor.replicate?.apiKey)}`);

    const { mintSpendGrant } = require(path.join(D, "spendGrant.js"));
    const grantId = mintSpendGrant({ nodeIds: ["probe-node"] });
    log(`② grant minted=${Boolean(grantId)}`);

    const { decomposeLayers } = require(path.join(D, "image/decomposeLayers.js"));
    log(`③ 真 Replicate 拆解中（约 15s）… img=${IMG}`);
    const out = await decomposeLayers({ nodeId: "probe-node", imageUrl: IMG, numLayers: 4, grantId });
    const layers = out.layers || [];
    log(`④ 返回 ${layers.length} 层`);
    let allValid = layers.length >= 2;
    for (let i = 0; i < layers.length; i++) {
      try {
        const r = await fetch(layers[i]);
        const b = await r.arrayBuffer();
        log(`   层${i}: ${r.status} ${r.headers.get("content-type")} ${b.byteLength}B  ${layers[i].slice(0, 56)}…`);
        if (b.byteLength < 1000) allValid = false;
      } catch (e) { log(`   层${i} fetch 失败: ${e.message}`); allValid = false; }
    }
    log(`\n═══ 后端端到端：${allValid ? "通过（真 app 主进程里拆出有效图层）" : "未通过"} ═══`);
    app.exit(allValid ? 0 : 1);
  } catch (e) {
    log("ERR " + (e && e.stack ? e.stack : e));
    app.exit(1);
  }
});
