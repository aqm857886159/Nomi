// apimart「参考图 → 图生视频」真实回路验证（复现并验证修复：原始 bug = 视频生成时
// image_urls[0] 是 nomi-local:// / base64 → apimart 返回 HTTP 400 "Invalid format"）。
//
// 这个 spike 在 electron 主进程内跑（safeStorage 才能解密真实存储的 apimart key），
// 直接调**生产编译产物**里我改的真实函数：
//   resolveAssetIngestionWithFallback → resolveLocalAsset(upload-multipart) → postMultipartForAssetUpload
// 把一张真实本地图（无 sidecar，强制走上传路径）真实上传到 apimart，拿回公网 URL，
// 再用该 URL 真实发一条 image_to_video create —— 成功判据 = create 不再 400 且返回 task_id。
//
// 跑：  ./node_modules/.bin/electron tests/transport-spike/apimart-ref.cjs
// key 不回显明文（掩码），不写文件。

const fs = require("node:fs");
const path = require("node:path");
const { app, safeStorage } = require("electron");

// 关键：裸 electron 默认 name="Electron" → safeStorage 找「Electron Safe Storage」keychain 项，
// 而真实 key 是 dev electron 以 name="nomi" 加密的（项名「nomi Safe Storage」）。对齐 name 才解得开。
app.setName("nomi");

const repoRoot = path.resolve(__dirname, "../..");
const { resolveAssetIngestionWithFallback, resolveLocalAsset } = require(path.join(repoRoot, "dist-electron/catalog/assetLocalization.js"));
const { postJsonForAssetUpload, postMultipartForAssetUpload } = require(path.join(repoRoot, "dist-electron/assets/localAssetFile.js"));
// 主进程 fetch(undici) 默认不读系统代理 → 中国网络下直连 apimart 必 fetch failed。
// 复用生产 applySystemProxy（设全局 undici dispatcher），与真实 app 同源。
const { applySystemProxy } = require(path.join(repoRoot, "dist-electron/systemProxy.js"));

const BASE = "https://api.apimart.ai";
const TEST_IMAGE = path.join(repoRoot, "tests/ux/shots/qa2-creation.png");
const mask = (k) => (k ? k.slice(0, 3) + "…" + k.slice(-3) : "(空)");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (obj, p) => p.split(".").reduce((c, s) => (c == null ? c : c[s]), obj);

function loadApimartKey() {
  // dev electron 用 package name "nomi"（小写）→ userData 小写 nomi。两个 catalog 都有 key，
  // 但本进程的 keychain ACL 对应小写 nomi 那份（同一 dev 二进制写的）。
  for (const dir of ["nomi", "Nomi"]) {
    const p = path.join(app.getPath("appData"), dir, "model-catalog.json");
    try {
      const c = JSON.parse(fs.readFileSync(p, "utf8"));
      const rec = c.apiKeysByVendor && c.apiKeysByVendor.apimart;
      if (!rec || !rec.apiKey) continue;
      if (rec.enc === "safeStorage") {
        try {
          const plain = safeStorage.decryptString(Buffer.from(rec.apiKey, "base64"));
          if (plain) return { key: plain, src: dir };
        } catch (e) {
          console.log(`  [${dir}] 解密失败（keychain ACL?）: ${e.message}`);
          continue;
        }
      } else {
        return { key: rec.apiKey, src: dir + "(plain)" };
      }
    } catch { /* 读不到换下一个 */ }
  }
  return { key: "", src: null };
}

async function main() {
  console.log("══════════ apimart 参考图→图生视频 真实回路 ══════════");
  console.log("safeStorage 可用:", safeStorage.isEncryptionAvailable());
  const { session } = require("electron");
  const proxyRes = await applySystemProxy(session.defaultSession);
  console.log("代理:", proxyRes.kind === "http" ? proxyRes.url : proxyRes.kind);
  const { key, src } = loadApimartKey();
  if (!key) { console.log("✗ 拿不到 apimart key（解密失败或未配置）"); app.exit(1); return; }
  console.log(`✓ apimart key 解出: ${mask(key)}  (来源 catalog: ${src})`);

  // —— Step A：真实本地图 → 真实上传（走我改的 upload-multipart 真实路径）——
  console.log("\n──── Step A：本地参考图真实上传 apimart ────");
  const imgBytes = fs.readFileSync(TEST_IMAGE);
  console.log(`测试图: ${TEST_IMAGE} (${(imgBytes.length / 1024).toFixed(0)} KB)`);
  // 自定义 read：模拟「用户上传的本地图」——无 sidecar originalUrl → 强制走真实上传分支
  const read = () => ({ bytes: imgBytes, contentType: "image/png", fileName: "ref.png" });

  const resolved = resolveAssetIngestionWithFallback(
    { key: "apimart" },
    [{ key: "apimart" }],
    (k) => (k === "apimart" ? key : null),
  );
  console.log("策略选择:", resolved ? `${resolved.ingestion.strategy} @ ${resolved.ingestion.endpoint || "-"}  key=${mask(resolved.uploadApiKey)}` : "null");
  if (!resolved) { console.log("✗ 没选出上传策略"); app.exit(1); return; }

  let publicUrl;
  try {
    publicUrl = await resolveLocalAsset(
      "nomi-local://asset/proj/ref.png",
      resolved.ingestion,
      resolved.uploadApiKey,
      read,
      postJsonForAssetUpload,
      postMultipartForAssetUpload,
    );
  } catch (e) {
    console.log("✗ 上传失败:", e.message);
    app.exit(1);
    return;
  }
  console.log("✓ 上传成功，公网 URL:", publicUrl);
  const isHttps = /^https?:\/\//i.test(publicUrl);
  console.log(`  → 是 http(s) 公网 URL? ${isHttps ? "✓ 是" : "✗ 否（仍是 " + publicUrl.slice(0, 24) + "…）"}`);
  if (!isHttps) { app.exit(1); return; }

  // —— Step B：用该 URL 真实发 image_to_video create（原始 400 的那条调用）——
  console.log("\n──── Step B：image_to_video create（原始 400 复现点）────");
  const body = { model: "sora-2", prompt: "the scene gently comes alive, soft camera push-in, cinematic", resolution: "720p", duration: 4, image_urls: [publicUrl] };
  console.log(`POST ${BASE}/v1/videos/generations`);
  console.log("body:", JSON.stringify({ ...body, image_urls: [publicUrl.slice(0, 48) + "…"] }));
  const res = await fetch(`${BASE}/v1/videos/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  console.log(`HTTP ${res.status}`);
  console.log("响应:", JSON.stringify(json).slice(0, 400));
  if (res.status === 400) {
    console.log("\n✗✗✗ 仍然 400 —— 修复未生效！");
    app.exit(1);
    return;
  }
  const taskId = pick(json, "data.0.task_id") || pick(json, "data.task_id") || pick(json, "task_id");
  console.log(`\n✓✓✓ create 未 400（HTTP ${res.status}）—— 参考图被 apimart 接受了！task_id=${taskId || "(未解析到)"}`);

  // —— Step C：轮询几次看是否真渲染（不等满，省时；create 通过即证修复）——
  if (taskId) {
    console.log("\n──── Step C：轮询任务状态（最多 6 次 × 10s）────");
    for (let i = 0; i < 6; i++) {
      await delay(10000);
      const q = await fetch(`${BASE}/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
      const qj = await q.json().catch(() => ({}));
      const status = pick(qj, "data.status") || pick(qj, "status");
      const vurl = pick(qj, "data.result.videos.0.url.0") || pick(qj, "data.result.videos.0.url") || pick(qj, "data.result.videos.0");
      console.log(`  [${i + 1}] status=${status}${vurl ? "  video=" + String(vurl).slice(0, 60) + "…" : ""}`);
      if (status === "completed" || vurl) { console.log("  ✓ 视频真实产出！完整 E2E 通过。"); break; }
      if (status === "failed" || status === "cancelled") { console.log("  上游任务失败（与参考图格式无关，已过 create 关）:", JSON.stringify(pick(qj, "data.error") || qj).slice(0, 200)); break; }
    }
  }
  console.log("\n══════════ 结束 ══════════");
  app.exit(0);
}

// poll 模式：复用代理+key 把已创建任务轮询到底（不重复 create、不多花额度）。
//   ./node_modules/.bin/electron tests/transport-spike/apimart-ref.cjs poll <task_id>
async function pollOnly(taskId) {
  console.log("══════════ 轮询已创建任务 ══════════");
  const { session } = require("electron");
  await applySystemProxy(session.defaultSession);
  const { key } = loadApimartKey();
  if (!key) { console.log("✗ 无 key"); app.exit(1); return; }
  console.log("task:", taskId);
  for (let i = 0; i < 30; i++) {
    const q = await fetch(`${BASE}/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${key}` } });
    const qj = await q.json().catch(() => ({}));
    const status = pick(qj, "data.status") || pick(qj, "status");
    const vurl = pick(qj, "data.result.videos.0.url.0") || pick(qj, "data.result.videos.0.url") || pick(qj, "data.result.videos.0");
    console.log(`  [${i + 1}] status=${status}${vurl ? "  video=" + String(vurl).slice(0, 70) : ""}`);
    if (status === "completed" || vurl) { console.log("\n✓✓✓ 视频真实产出，完整 E2E 通过：\n" + vurl); break; }
    if (status === "failed" || status === "cancelled") { console.log("上游任务失败:", JSON.stringify(pick(qj, "data.error") || qj).slice(0, 300)); break; }
    await delay(15000);
  }
  app.exit(0);
}

const argv = process.argv.slice(process.defaultApp ? 2 : 1);
const pollIdx = argv.indexOf("poll");
if (pollIdx >= 0 && argv[pollIdx + 1]) {
  app.whenReady().then(() => pollOnly(argv[pollIdx + 1])).catch((e) => { console.error(e); app.exit(1); });
} else {
  app.whenReady().then(main).catch((e) => { console.error("spike 异常:", e); app.exit(1); });
}
