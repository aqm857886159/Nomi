// apimart 策展接入 verify-first：用真 key 端到端探一次完整回路，把精确请求/响应形状定透，
// 再据此写生产 catalog（electron/catalog/apimart*.ts）。docs.apimart.ai 文档没给视频 item 字段，
// 这个脚本就是来定型的（plan: docs/plan/2026-06-07-apimart-curated-onboarding.md §2 留的口子）。
//
// key 从环境变量读，不写进文件、不回显明文：
//   APIMART_KEY=sk-xxx node tests/transport-spike/apimart.mjs           # 默认：一张图（最省额度）
//   APIMART_KEY=sk-xxx node tests/transport-spike/apimart.mjs video     # 加测一条最短视频（sora-2, 4s）
//
// 文档推导的契约（待这脚本核验）：
//   POST /v1/images|videos/generations  → { code:200, data:[{ status:"submitted", task_id }] }
//   GET  /v1/tasks/{task_id}            → { code, data:{ status, result:{ images:[{url:[..]}] | videos:[..] }, error:{message} } }
//   status: pending|processing|completed|failed|cancelled

const BASE = "https://api.apimart.ai";
const key = process.env.APIMART_KEY || "";
if (!key) { console.log("缺 key：APIMART_KEY=sk-xxx node tests/transport-spike/apimart.mjs [video]"); process.exit(1); }
const mask = (k) => k.slice(0, 3) + "…" + k.slice(-3);
const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function pick(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

const PROMPT = "a single red paper crane on a wooden desk, soft window light, minimal";
const IMG_RESULT = ["data.result.images.0.url.0", "data.result.images.0.url", "data.result.images.0"];
const VID_RESULT = ["data.result.videos.0.url.0", "data.result.videos.0.url", "data.result.videos.0"];

// 生产 body 形状（与 electron/catalog/apimartImages.ts 的 mapping 逐字对齐——证明产品里这条路能出图）。
const CASES = {
  // ── 6 个图片模型（文生图，生产 body）──
  seedream: { label: "Seedream 4.5", path: "/v1/images/generations", body: { model: "doubao-seedream-4.5", prompt: PROMPT, size: "1:1", resolution: "2K" }, resultPaths: IMG_RESULT },
  gemini: { label: "Nano Banana(Gemini 2.5 Flash)", path: "/v1/images/generations", body: { model: "gemini-2.5-flash-image-preview", prompt: PROMPT, size: "1:1" }, resultPaths: IMG_RESULT },
  gpt: { label: "GPT Image 2", path: "/v1/images/generations", body: { model: "gpt-image-2", prompt: PROMPT, size: "1:1", resolution: "1k" }, resultPaths: IMG_RESULT },
  qwen: { label: "Qwen-Image 2.0", path: "/v1/images/generations", body: { model: "qwen-image-2.0", prompt: PROMPT, size: "1:1", resolution: "1K" }, resultPaths: IMG_RESULT },
  imagen: { label: "Imagen 4", path: "/v1/images/generations", body: { model: "imagen-4.0-apimart", prompt: PROMPT, size: "16:9" }, resultPaths: IMG_RESULT },
  zimage: { label: "Z-Image Turbo", path: "/v1/images/generations", body: { model: "z-image-turbo", prompt: PROMPT, size: "1:1", resolution: "1K" }, resultPaths: IMG_RESULT },
  // ── 视频代表（Sora 2，4s 最短）──
  video: { label: "Sora 2 · 文生视频(4s)", path: "/v1/videos/generations", body: { model: "sora-2", prompt: "a waterfall cascading down rocks forming a small rainbow, cinematic", duration: 4, resolution: "720p", aspect_ratio: "16:9" }, resultPaths: VID_RESULT },
};
const IMAGE_KEYS = ["seedream", "gemini", "gpt", "qwen", "imagen", "zimage"];

async function run(name) {
  const c = CASES[name];
  console.log(`\n──────── ${c.label} ────────`);
  console.log(`POST ${BASE}${c.path}  body=${JSON.stringify(c.body)}`);
  let res = await fetch(`${BASE}${c.path}`, { method: "POST", headers: auth, body: JSON.stringify(c.body) });
  const createText = await res.text();
  console.log(`create HTTP ${res.status} → ${createText.slice(0, 400)}`);
  let create; try { create = JSON.parse(createText); } catch { console.log("❌ create 非 JSON"); return; }
  const taskId = pick(create, "data.0.task_id") || pick(create, "data.0.taskId");
  if (!taskId) { console.log("❌ 没拿到 data[0].task_id（请求形状/参数错）"); return; }
  console.log(`✅ task_id = ${taskId} · 初始 status = ${pick(create, "data.0.status")}`);

  // 轮询 /v1/tasks/{task_id}
  for (let i = 0; i < 60; i += 1) {
    await delay(5000);
    res = await fetch(`${BASE}/v1/tasks/${encodeURIComponent(taskId)}?language=zh`, { headers: { Authorization: auth.Authorization } });
    const text = await res.text();
    let poll; try { poll = JSON.parse(text); } catch { console.log(`轮询 ${i} 非 JSON: ${text.slice(0, 200)}`); continue; }
    const status = pick(poll, "data.status");
    const progress = pick(poll, "data.progress");
    process.stdout.write(`  [${i}] status=${status} progress=${progress ?? "-"}\n`);
    if (status === "completed") {
      console.log("✅ completed · 完整 data.result =", JSON.stringify(pick(poll, "data.result"), null, 2).slice(0, 800));
      let url;
      for (const p of c.resultPaths) { url = pick(poll, p); if (typeof url === "string" && /^https?:/.test(url)) { console.log(`  ← 结果 URL 路径命中: ${p}`); break; } url = undefined; }
      if (!url) { console.log("⚠️ 未命中预期结果路径，看上面完整 result 自己定位"); return; }
      const head = await fetch(url, { method: "GET" });
      console.log(`  拉回 URL: HTTP ${head.status} · Content-Type=${head.headers.get("content-type")} → ${head.ok ? "✅ 真媒体" : "❌"}`);
      return;
    }
    if (status === "failed" || status === "cancelled") {
      console.log(`❌ ${status} · error=`, JSON.stringify(pick(poll, "data.error")));
      return;
    }
  }
  console.log("⏱ 轮询超时（5min）");
}

const arg = process.argv[2];
console.log(`apimart 探测 · key=${mask(key)}`);
// 无参数 = 跑 6 个图片模型；"video" = 跑 Sora 视频；具体模型名 = 只跑那个。
const targets = !arg ? IMAGE_KEYS : arg === "images" ? IMAGE_KEYS : CASES[arg] ? [arg] : IMAGE_KEYS;
for (const t of targets) await run(t);
