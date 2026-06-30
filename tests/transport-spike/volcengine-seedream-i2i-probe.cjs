// 验证火山 Seedream 5.0 lite 图生图/改图契约（审计 A2）：官方称统一生成-编辑架构，图传 `image` 字段数组。
// 5.0 lite 已在用户账号开通（t2i 出过图），故可真机验。判据：200+data[0].url=i2i 契约对（会扣少量额度）；
// 400「image 字段不认/格式错」=审计的字段名要改。
//   跑：./node_modules/.bin/electron tests/transport-spike/volcengine-seedream-i2i-probe.cjs
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage, session } = require("electron");
app.setName("nomi");
const repoRoot = path.resolve(__dirname, "../..");
const { applySystemProxy } = require(path.join(repoRoot, "dist-electron/systemProxy.js"));
const ARK = "https://ark.cn-beijing.volces.com";
const mask = (k) => (k ? k.slice(0, 4) + "…" + k.slice(-3) : "(空)");
// 公网测试图（火山 Seedream image 字段收 URL）。用一张稳定可达的小图。
const TEST_IMG = "https://ark-project.tos-cn-beijing.volces.com/doc_image/seed_i2i.png";

function loadKey(vendor) {
  for (const dir of ["nomi", "Nomi"]) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), dir, "model-catalog.json"), "utf8"));
      const rec = c.apiKeysByVendor && c.apiKeysByVendor[vendor];
      if (rec && rec.apiKey && rec.enc === "safeStorage") { try { const p = safeStorage.decryptString(Buffer.from(rec.apiKey, "base64")); if (p) return p; } catch { /* next */ } }
      else if (rec && rec.apiKey) return rec.apiKey;
    } catch { /* next */ }
  }
  return "";
}
async function call(key, label, body) {
  const res = await fetch(ARK + "/api/v3/images/generations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  console.log(`\n【${label}】[HTTP ${res.status}] body.keys=${Object.keys(body).join(",")}`);
  console.log(`   resp: ${text.slice(0, 360).replace(/\s+/g, " ")}`);
}
async function main() {
  await app.whenReady();
  console.log("══════════ 火山 Seedream 5.0 lite 图生图契约验证 ══════════");
  const proxyRes = await applySystemProxy(session.defaultSession);
  console.log("代理:", proxyRes.kind === "http" ? proxyRes.url : proxyRes.kind);
  const key = loadKey("volcengine");
  if (!key) { console.log("✗ 拿不到 volcengine key"); app.exit(1); return; }
  console.log(`✓ key: ${mask(key)}  测试图: ${TEST_IMG}`);
  const M = "doubao-seedream-5-0-260128";
  // 审计推断的 i2i body：image 字段数组 + sequential_image_generation:disabled
  await call(key, "i2i: image 数组 + seq disabled", { model: M, prompt: "把这张图改成水彩风格", image: [TEST_IMG], sequential_image_generation: "disabled", size: "2048x2048", watermark: false });
  app.exit(0);
}
main().catch((e) => { console.error(e); app.exit(1); });
