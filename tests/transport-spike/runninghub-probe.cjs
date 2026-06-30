// RunningHub 路径/契约真机探测（解决审计里 ⚠️未验证 项——SPA 文档 WebFetch 取不到，只能真机定）。
// 在 electron 主进程内跑（safeStorage 才能解密真实存的 runninghub key）。
//   跑：./node_modules/.bin/electron tests/transport-spike/runninghub-probe.cjs
//
// 判据（最省额度：用最小 body 触发服务端校验，多数在「扣费前」就返回，不真出片）：
//   404 / "model not found" / "endpoint not exist"  → 路径错（model 不存在）
//   400 "missing/invalid param X"                    → 路径对（model 存在），且暴露真实必填参数
//   200 + taskId                                     → 路径对 + 参数够（会扣费，记下 taskId 不再轮询）
// key 不回显明文。

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage, session } = require("electron");
app.setName("nomi");

const repoRoot = path.resolve(__dirname, "../..");
const { applySystemProxy } = require(path.join(repoRoot, "dist-electron/systemProxy.js"));

const BASE = "https://www.runninghub.cn/openapi/v2";
const mask = (k) => (k ? k.slice(0, 4) + "…" + k.slice(-3) : "(空)");

function loadKey(vendor) {
  // env 覆盖：临时用企业 key 验证（不写盘、不入库、输出只掩码）。
  if (process.env.RH_KEY_OVERRIDE) return process.env.RH_KEY_OVERRIDE.trim();
  for (const dir of ["nomi", "Nomi"]) {
    const p = path.join(app.getPath("appData"), dir, "model-catalog.json");
    try {
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      const rec = c.apiKeysByVendor && c.apiKeysByVendor[vendor];
      if (!rec || !rec.apiKey) continue;
      if (rec.enc === "safeStorage") {
        try { const plain = safeStorage.decryptString(Buffer.from(rec.apiKey, "base64")); if (plain) return plain; }
        catch { continue; }
      } else return rec.apiKey;
    } catch { /* next */ }
  }
  return "";
}

// 我们 catalog 现用的 t2v/t2i 路径（审计存疑的重点带 ★）。只探「文生」端点足够定路径真伪。
const ENDPOINTS = [
  ["Seedance2.0 t2v", "/bytedance/seedance-2.0-global/text-to-video", { prompt: "a small red cube on a table", resolution: "720p", duration: 5, ratio: "16:9", generateAudio: false }],
  ["Veo3.1 t2v",      "/rhart-video-v3.1-pro-official/text-to-video", { prompt: "a small red cube on a table", resolution: "720p", duration: 8, aspectRatio: "16:9", generateAudio: false }],
  ["Kling3.0 t2v",    "/kling-v3.0-pro/text-to-video", { prompt: "a small red cube on a table", duration: 5, aspectRatio: "16:9", sound: false }],
  ["★Wan2.7 t2v",     "/alibaba/wan-2.7/text-to-video", { prompt: "a small red cube on a table", resolution: "720p", duration: 5, aspectRatio: "16:9" }],
  ["Hailuo2.3 t2v",   "/minimax/hailuo-2.3/t2v-standard", { prompt: "a small red cube on a table", duration: 6 }],
  ["Sora2 t2v",       "/rhart-video-s-official/text-to-video", { prompt: "a small red cube on a table", size: "16:9", duration: 5 }],
  ["Seedream4.5 t2i", "/seedream-v4.5/text-to-image", { prompt: "a small red cube on a table", resolution: "2k" }],
  ["NanoBanana t2i",  "/rhart-image-v1/text-to-image", { prompt: "a small red cube on a table", aspectRatio: "1:1" }],
  ["GPTImage2 t2i",   "/rhart-image-g-2-official/text-to-image", { prompt: "a small red cube on a table", aspectRatio: "1:1", resolution: "1k", quality: "high" }],
  ["★Qwen2.0 t2i",    "/alibaba/qwen-image-2.0/text-to-image", { prompt: "a small red cube on a table", size: "1024*1024" }],
  // 审计怀疑的「正确」候选——一并探，server 说话最准：
  ["?Wan2.2 t2v(候选)", "/rhart-video/wan-2.2/text-to-video", { prompt: "a small red cube on a table" }],
  ["?Qwen bare t2i(候选)", "/qwen-image-2.0/text-to-image", { prompt: "a small red cube on a table", size: "1024*1024" }],
];

async function probe(key, label, p, body) {
  const url = BASE + p;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let verdict;
    const low = text.toLowerCase();
    if (res.status === 200 && /taskid/i.test(text)) verdict = "✓ 路径对+参数够(已提交·会扣费)";
    else if (res.status === 404 || /not\s*found|not\s*exist|不存在|no\s*such|invalid.*(model|endpoint|webapp)/i.test(low)) verdict = "✗ 路径/模型不存在";
    else if (res.status === 400 || res.status === 422) verdict = "△ 路径对·参数需调(看 msg)";
    else verdict = `? status=${res.status}`;
    console.log(`  ${label.padEnd(22)} [${res.status}] ${verdict}`);
    console.log(`      ${p}`);
    console.log(`      resp: ${text.slice(0, 220).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`  ${label.padEnd(22)} ✗ fetch failed: ${e.message}`);
  }
}

async function main() {
  await app.whenReady();
  console.log("══════════ RunningHub 路径/契约真机探测 ══════════");
  console.log("safeStorage 可用:", safeStorage.isEncryptionAvailable());
  const proxyRes = await applySystemProxy(session.defaultSession);
  console.log("代理:", proxyRes.kind === "http" ? proxyRes.url : proxyRes.kind);
  const key = loadKey("runninghub");
  if (!key) { console.log("✗ 拿不到 runninghub key（解密失败/未配置）"); app.exit(1); return; }
  console.log(`✓ runninghub key 解出: ${mask(key)}\n`);
  for (const [label, p, body] of ENDPOINTS) {
    await probe(key, label, p, body);
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log("\n（★=审计重点存疑项  ?=审计猜的候选路径）");
  app.exit(0);
}
main().catch((e) => { console.error(e); app.exit(1); });
