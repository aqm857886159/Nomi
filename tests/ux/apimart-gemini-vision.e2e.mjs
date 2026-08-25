// 真实端到端（R5 验收门 · 接模型必须验闭环）：验证 apimart 的 `gemini-3.5-flash` 在 **Nomi 自己的
// 任务管道**上「图进 → 文字出」跑得通。裸 curl 打通不算数——那绕过了 catalog 选型、extras 归一、
// streamTextTask 的多模态 part 拼装和 SSE 解析，这几层任一处错都会让用户侧静默失败。
//
// 判定四条（全中才 PASS）：
//   ① 种子把 gemini-3.5-flash 写进了 catalog（kind=text）；
//   ② 它带 meta.supportsImageInput=true —— chooseTextModel 的 imageInputRank 靠这个把它排到
//      带图请求的第一位（不靠 VISION_MODEL_RE 猜名字）；
//   ③ 真跑一条 kind=image_to_prompt，喂一张**内容已知**的图，拿回非空文本；
//   ④ 文本命中图里真实存在的关键词 —— 证明它真"看见"了，而不是在瞎编
//      （只判 status=succeeded 会被"礼貌地胡说"骗过去）。
//
// **会花真实额度（单张图 ~2.3k token）**。额度闸：不显式 APIMART_E2E=1 / APIMART_API_KEY 就 SKIP。
// 用法：pnpm run build && APIMART_E2E=1 node tests/ux/apimart-gemini-vision.e2e.mjs
import { launchNomiApp } from "./_launchApp.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.APIMART_E2E && !process.env.APIMART_API_KEY) {
  console.log("SKIP apimart-gemini-vision.e2e: 会花额度。APIMART_E2E=1 node tests/ux/apimart-gemini-vision.e2e.mjs 才跑。");
  process.exit(0);
}

const MODEL_KEY = process.env.APIMART_VISION_MODEL || "gemini-3.5-flash";
const ENV_KEY = process.env.APIMART_API_KEY;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 夹具：现造一张**内容确定**的图——左半红、右半蓝。
// 为什么不用 drawtext 画字：那要显式 fontfile，macOS/Linux/CI 路径各不同，硬编码即不可移植
// （实测 macOS 直接报 "No font filename provided"）。纯色块只用 lavfi，零字体依赖。
// 为什么两色而不是一色：单色让模型蒙对的概率太高；"左红右蓝"要同时答对颜色**和方位**，
// 纯文本模型（图没进去）不可能猜中——这才是"真看见了"的硬证据。
const fixture = path.join(repoRoot, ".tmp", "gemini-vision-fixture.jpg");
fs.mkdirSync(path.dirname(fixture), { recursive: true });
const { spawnSync } = await import("node:child_process");
const draw = spawnSync("ffmpeg", [
  "-v", "error", "-y",
  "-f", "lavfi", "-i", "color=c=red:s=320x360",
  "-f", "lavfi", "-i", "color=c=blue:s=320x360",
  "-filter_complex", "[0:v][1:v]hstack",
  "-frames:v", "1", fixture,
]);
if (draw.status !== 0 || !fs.existsSync(fixture)) {
  console.log("SKIP: 造不出夹具图（需要 ffmpeg 在 PATH）：", String(draw.stderr || "").slice(0, 200));
  process.exit(0);
}
const dataUrl = `data:image/jpeg;base64,${fs.readFileSync(fixture).toString("base64")}`;

const fail = [];
const check = (name, ok, detail) => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail.push(name);
};

const { app, win } = await launchNomiApp({
  name: "apimart-gemini-vision",
  args: ["--disable-gpu", "--disable-software-rasterizer"],
});

try {
  if (ENV_KEY) {
    await win.evaluate((key) => window.nomiDesktop.modelCatalog.upsertVendorApiKey("apimart", { apiKey: key, enabled: true }), ENV_KEY);
  } else {
    const vendors = await win.evaluate(() => window.nomiDesktop.modelCatalog.listVendors());
    const apimart = (vendors || []).find((v) => v.key === "apimart" || v.vendorKey === "apimart");
    if (!(apimart && (apimart.hasApiKey || apimart.enabledApiKey))) {
      console.log("SKIP: apimart 未配 API key（app「模型接入」里配，或设 APIMART_API_KEY）。");
      await app.close();
      process.exit(0);
    }
  }

  const seeded = await win.evaluate(async (mk) => {
    // D2 读路径是 ipcRenderer.invoke，返回 Promise；先 await 才能使用数组方法。
    const models = (await window.nomiDesktop.modelCatalog.listModels()) || [];
    const m = models.find((x) => x.vendorKey === "apimart" && x.modelKey === mk);
    if (!m) return null;
    let meta = m.meta;
    if (typeof meta === "string") { try { meta = JSON.parse(meta); } catch { meta = null; } }
    return { kind: m.kind, enabled: m.enabled, supportsImageInput: !!(meta && meta.supportsImageInput) };
  }, MODEL_KEY);

  check("① 种子把模型写进 catalog", !!seeded && seeded.kind === "text", seeded ? `kind=${seeded.kind}` : "没找到");
  check("② 显式声明能读图（不靠名字正则）", !!seeded && seeded.supportsImageInput, seeded ? `supportsImageInput=${seeded.supportsImageInput}` : "");

  const t0 = Date.now();
  const result = await win.evaluate(async ({ mk, img }) => {
    try {
      const r = await window.nomiDesktop.tasks.run({
        vendor: "apimart",
        request: {
          kind: "image_to_prompt",
          prompt: "这张图由左右两个纯色块拼成。只回答左右两边分别是什么颜色，格式：左X右Y。",
          extras: { modelKey: mk, referenceImages: [img], temperature: 0, maxTokens: 3000 },
        },
      });
      return { ok: true, status: r && r.status, raw: r && r.raw };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }, { mk: MODEL_KEY, img: dataUrl });
  const ms = Date.now() - t0;

  const text = (() => {
    const raw = result && result.raw;
    const c = raw && raw.choices && raw.choices[0];
    return String((c && c.message && c.message.content) || "").trim();
  })();

  check("③ 真跑 image_to_prompt 拿回文本", result.ok && result.status === "succeeded" && text.length > 0,
    result.ok ? `status=${result.status} len=${text.length} ${(ms / 1000).toFixed(1)}s` : result.error);
  const said = text.toLowerCase();
  const sawRed = said.includes("红") || said.includes("red");
  const sawBlue = said.includes("蓝") || said.includes("blue");
  check("④ 真看见了图（颜色+方位都对，不是瞎编）", sawRed && sawBlue, text ? `回答="${text.slice(0, 60)}"` : "无文本");

  console.log(fail.length ? `\n❌ 未达标 ${fail.length} 项：${fail.join("、")}` : "\n✅ 全部达标");
} finally {
  await app.close();
}
process.exit(fail.length ? 1 : 0);
