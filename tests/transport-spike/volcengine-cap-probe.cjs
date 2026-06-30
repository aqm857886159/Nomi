// 火山方舟 Ark 能力探测（清审计存疑项）：① Seedream 4.0 是否收 1024x1024（我们 size 下限卡 2K，疑过严）
// ② Seedance 2.0 fast 是否支持 1080p（我们给 fast 砍到 720p，疑过严）。
//   跑：./node_modules/.bin/electron tests/transport-spike/volcengine-cap-probe.cjs
// 判据：400「size/resolution 不支持」=我们卡得对（免费，扣费前拦）；200+url/taskId=能放宽（会扣少量额度）。
const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage, session } = require("electron");
app.setName("nomi");
const repoRoot = path.resolve(__dirname, "../..");
const { applySystemProxy } = require(path.join(repoRoot, "dist-electron/systemProxy.js"));
const ARK = "https://ark.cn-beijing.volces.com";
const mask = (k) => (k ? k.slice(0, 4) + "…" + k.slice(-3) : "(空)");

function loadKey(vendor) {
  for (const dir of ["nomi", "Nomi"]) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(app.getPath("appData"), dir, "model-catalog.json"), "utf8"));
      const rec = c.apiKeysByVendor && c.apiKeysByVendor[vendor];
      if (rec && rec.apiKey && rec.enc === "safeStorage") {
        try { const p = safeStorage.decryptString(Buffer.from(rec.apiKey, "base64")); if (p) return p; } catch { /* next */ }
      } else if (rec && rec.apiKey) return rec.apiKey;
    } catch { /* next */ }
  }
  return "";
}

async function call(key, label, p, body) {
  try {
    const res = await fetch(ARK + p, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await res.text();
    console.log(`\n  【${label}】[HTTP ${res.status}]`);
    console.log(`      ${p}  body=${JSON.stringify(body).slice(0, 120)}`);
    console.log(`      resp: ${text.slice(0, 320).replace(/\s+/g, " ")}`);
    return { status: res.status, text };
  } catch (e) { console.log(`  【${label}】✗ fetch failed: ${e.message}`); return { status: 0, text: "" }; }
}

async function main() {
  await app.whenReady();
  console.log("══════════ 火山 Ark 能力探测 ══════════");
  const proxyRes = await applySystemProxy(session.defaultSession);
  console.log("代理:", proxyRes.kind === "http" ? proxyRes.url : proxyRes.kind);
  const key = loadKey("volcengine");
  if (!key) { console.log("✗ 拿不到 volcengine key"); app.exit(1); return; }
  console.log(`✓ volcengine key: ${mask(key)}`);

  // ① Seedream 4.0 + 1024x1024（疑：4.0 下限其实是 1K 不是 2K）
  await call(key, "Seedream4.0 @1024x1024", "/api/v3/images/generations",
    { model: "doubao-seedream-4-0-250828", prompt: "a small red cube on a gray table", size: "1024x1024", watermark: false });

  // 对照：Seedream 4.5 + 1024x1024（应 400，证 4.5 确实只 2K 起——我们卡得对）
  await call(key, "Seedream4.5 @1024x1024(对照)", "/api/v3/images/generations",
    { model: "doubao-seedream-4-5-251128", prompt: "a small red cube on a gray table", size: "1024x1024", watermark: false });

  // ② Seedance 2.0 fast + 1080p（疑：fast 其实支持到 1080p/4K，我们砍到 720p）
  await call(key, "Seedance fast @1080p", "/api/v3/contents/generations/tasks",
    { model: "doubao-seedance-2-0-fast-260128", content: [{ type: "text", text: "a cat jumps off a sofa, camera pans" }], resolution: "1080p", ratio: "16:9", duration: 5 });

  console.log("\n（200+url/taskId=能放宽该档；400=我们卡得对）");
  app.exit(0);
}
main().catch((e) => { console.error(e); app.exit(1); });
