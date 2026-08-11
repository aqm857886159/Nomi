// R1 真实验证 harness（零额度：KIE 文件上传免费）。
// catalog 在测试进程读(有 fs);密钥密文传进 app 主进程,仅在那里 safeStorage 解密 + fetch
// (fetch 是主进程全局,runtime 就在用),解出的明文 key 不回传测试进程。
// 流程：1x1 PNG 走 assetIngestion(upload-url) 上传 → 拿回 data.downloadUrl → 再 GET 确认公网可达。
// 验证 R1 最关键、单测覆盖不到的外部假设：本地素材真能变成 vendor 够得着的 URL。
// 用法：pnpm run build && node tests/ux/r1-upload-verify.mjs   （无 KIE key 时自动跳过,不失败）
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";


// catalog 落在 userData/nomi/model-catalog.json（macOS: ~/Library/Application Support/nomi）。
const catalogPath = path.join(os.homedir(), "Library", "Application Support", "nomi", "model-catalog.json");
let rec = null;
try {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  rec = (catalog.apiKeysByVendor || {}).kie || null;
} catch { /* no catalog */ }

if (!rec || !rec.apiKey) {
  console.log(`⏭  跳过 R1 验证：未找到已配置的 KIE api key（${catalogPath}）`);
  process.exit(0);
}

const ONE_PX_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

const { app } = await launchNomiApp({ name: "r1-upload-verify" });

try {

  const result = await app.evaluate(async ({ safeStorage }, args) => {
    let key = "";
    try {
      key = args.enc === "safeStorage" ? safeStorage.decryptString(Buffer.from(args.cipher, "base64")) : args.cipher;
    } catch (e) { return { ok: false, stage: "decrypt", error: String(e) }; }
    if (!key) return { ok: false, stage: "decrypt", error: "decrypted empty (safeStorage 不可用?)" };

    const body = { base64Data: "data:image/png;base64," + args.png, uploadPath: "images/nomi", fileName: "r1-verify.png" };
    let up;
    try {
      const resp = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify(body),
      });
      up = { status: resp.status, json: await resp.json().catch(() => null) };
    } catch (e) { return { ok: false, stage: "upload", error: String(e) }; }

    const downloadUrl = up.json && up.json.data ? up.json.data.downloadUrl : null;
    if (!downloadUrl) return { ok: false, stage: "parse", upStatus: up.status, upJson: up.json };

    let fetchback;
    try {
      const g = await fetch(downloadUrl);
      fetchback = { status: g.status, ok: g.ok, contentType: g.headers.get("content-type") || "" };
    } catch (e) { return { ok: false, stage: "fetchback", downloadUrl, error: String(e) }; }

    return {
      ok: true,
      uploadCode: up.json.code,
      downloadUrl,
      fetchback,
      isNomiLocal: downloadUrl.startsWith("nomi-local://"),
      isHttp: /^https?:\/\//.test(downloadUrl),
    };
  }, { cipher: rec.apiKey, enc: rec.enc, png: ONE_PX_PNG });

  console.log("\n=== R1 上传验证结果 ===");
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) { console.error(`\n❌ R1 验证失败（stage=${result.stage}）`); process.exitCode = 1; }
  else {
    const good = result.isHttp && !result.isNomiLocal && result.fetchback.ok;
    console.log(good
      ? "\n✅ R1 通：本地素材 → 公网可达 URL → 真实可 GET。生成发送链能用了。"
      : "\n⚠️ 上传成功但返回 URL 非可达 http 或取不回,复查 urlPath/端点。");
    process.exitCode = good ? 0 : 1;
  }
} finally {
  await app.close();
}
