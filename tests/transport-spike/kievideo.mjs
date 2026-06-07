// P0 verify-first：用真 kie key 端到端测三家视频模型（createTask → 轮询 recordInfo → 取 video_url）。
// body 形状逐字对齐生产 catalog（electron/catalog/kie{Kling,Happyhorse,Seedance}.ts），
// 才能证明"产品里这条路真能出视频"。
//
// key 从环境变量读，不写进文件、不回显明文：
//   KIE_KEY=sk-xxx node tests/transport-spike/kievideo.mjs            # 跑全部纯文生视频用例
//   KIE_KEY=sk-xxx node tests/transport-spike/kievideo.mjs kling      # 只跑某家
//   KIE_KEY=sk-xxx FIRST_FRAME=https://...jpg node ... seedance       # Seedance 首帧需一张图
//
// 判读：
//   ✅ 出 video_url 且拉回是真视频(magic/Content-Type) → 这家这模式产品链路通
//   ❌ createTask 非 200 或 body.code 非 200 → 请求形状/参数错（断点在 catalog mapping）
//   ❌ 轮询 state=fail → kie 侧失败，failMsg 即真实原因（P0 错误人话层要覆盖的样本）

const BASE = "https://api.kie.ai";
const CREATE = `${BASE}/api/v1/jobs/createTask`;
const RECORD = `${BASE}/api/v1/jobs/recordInfo`;

const key = process.env.KIE_KEY || "";
if (!key) { console.log("缺 key：KIE_KEY=sk-xxx node tests/transport-spike/kievideo.mjs"); process.exit(1); }
const mask = (k) => k.slice(0, 3) + "…" + k.slice(-3);
const auth = { Authorization: `Bearer ${key}` };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 取值路径（data.resultJson.resultUrls.0 这种点路径；resultJson 可能是 JSON 字符串，需先 parse）。
function pick(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    if (typeof cur === "string") { try { cur = JSON.parse(cur); } catch { return undefined; } }
    cur = cur[seg];
  }
  return cur;
}

// 生产 body 形状（只填纯文生视频会用到的键；其余键在生产里因 undefined 被模板引擎丢弃，这里直接不写 = 等价）。
const CASES = {
  kling: {
    label: "可灵 3.0 · 文生视频",
    body: { model: "kling-3.0/video", input: { prompt: "a red paper crane unfolding on a wooden desk, soft window light, cinematic", mode: "pro", duration: "5", aspect_ratio: "16:9", sound: false } },
  },
  happyhorse: {
    label: "HappyHorse 1.0 · 文生视频",
    body: { model: "happyhorse/text-to-video", input: { prompt: "a small red cat walking across a sunny windowsill, gentle camera push-in", resolution: "720p", aspect_ratio: "16:9", duration: 5 } },
  },
  seedance: {
    label: "Seedance 2.0 · 首帧",
    needsFirstFrame: true,
    body: (firstFrame) => ({ model: "bytedance/seedance-2", input: { prompt: "the scene comes alive, leaves gently sway, subtle parallax", first_frame_url: firstFrame, resolution: "720p", aspect_ratio: "16:9", duration: 5, generate_audio: true } }),
  },
};

async function runCase(id) {
  const c = CASES[id];
  if (!c) { console.log(`未知用例: ${id}（可选 ${Object.keys(CASES).join("/")}）`); return; }
  console.log(`\n=== ${c.label}（${id}）===`);

  let body = typeof c.body === "function" ? null : c.body;
  if (c.needsFirstFrame) {
    const ff = process.env.FIRST_FRAME;
    if (!ff) { console.log("  ⏭  跳过：Seedance 首帧需一张图，设 FIRST_FRAME=https://...jpg"); return; }
    body = c.body(ff);
  }

  // ① createTask
  console.log(`  ① POST createTask  model=${body.model}`);
  let createJson;
  try {
    const res = await fetch(CREATE, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const txt = await res.text();
    try { createJson = JSON.parse(txt); } catch {}
    console.log(`     HTTP ${res.status} | body.code=${createJson?.code} ${createJson?.msg ? `msg=${createJson.msg}` : ""}`);
    // kie：HTTP 常 200，真实状态在 body.code（200=成功）
    if (createJson?.code !== 200) { console.log(`     ❌ createTask 失败（形状/参数/余额问题）: ${txt.slice(0, 200)}`); return; }
  } catch (e) { console.log(`     ❌ 网络失败: ${e.message}`); return; }

  const taskId = pick(createJson, "data.taskId");
  if (!taskId) { console.log(`     ❌ 没拿到 taskId: ${JSON.stringify(createJson).slice(0, 200)}`); return; }
  console.log(`     taskId=${taskId}`);

  // ② 轮询 recordInfo（视频长任务：1.5s 间隔，最多 240s）
  const start = Date.now();
  const TIMEOUT = 240_000, INTERVAL = 1500;
  let lastState = "";
  while (Date.now() - start < TIMEOUT) {
    await delay(INTERVAL);
    let j;
    try {
      const res = await fetch(`${RECORD}?taskId=${encodeURIComponent(taskId)}`, { headers: auth });
      j = await res.json();
    } catch (e) { console.log(`     轮询异常: ${e.message}`); continue; }
    const state = pick(j, "data.state");
    if (state !== lastState) { console.log(`     ② state=${state}  (+${Math.round((Date.now() - start) / 1000)}s)`); lastState = state; }
    if (["success", "succeeded", "completed"].includes(state)) {
      const url = pick(j, "data.resultJson.resultUrls.0");
      console.log(`     ✅ 成功 → video_url: ${url ? url.slice(0, 90) + "…" : "(没取到!)"}`);
      if (url) await verifyVideo(url);
      return;
    }
    if (["fail", "failed", "error", "expired"].includes(state)) {
      console.log(`     ❌ kie 侧失败 failMsg=${pick(j, "data.failMsg")}`);
      return;
    }
  }
  console.log(`     ⏱ 超时（>${TIMEOUT / 1000}s 仍未出，state=${lastState}）`);
}

async function verifyVideo(url) {
  try {
    const res = await fetch(url);
    const ct = res.headers.get("content-type") || "";
    const buf = Buffer.from(await res.arrayBuffer());
    const isMp4 = ct.includes("video") || buf.slice(4, 8).toString("ascii") === "ftyp";
    console.log(`     ③ 拉回 ${(buf.length / 1024).toFixed(0)}KB content-type=${ct} → ${isMp4 ? "✅ 是真视频" : "⚠️ 不像视频"}`);
  } catch (e) { console.log(`     ③ 拉回失败: ${e.message}`); }
}

async function main() {
  console.log(`kie 视频端到端测试  key=${mask(key)}`);
  const only = process.argv[2];
  const ids = only ? [only] : ["kling", "happyhorse", "seedance"];
  for (const id of ids) await runCase(id);
  console.log("\n完成。");
}
await main();
