// TikHub connector 门控 e2e —— 用真 key 端到端探一次「分享链接 → 无水印直链」，
// 顺带用真实响应坐实 OpenAPI 对账（合同测试的 fixture 依此校准）。
//
// **门控**：需 TIKHUB_E2E=1 才跑；key 从环境变量读，绝不写进文件、不回显明文。
//   TIKHUB_E2E=1 TIKHUB_API_KEY=xxx TIKHUB_SHARE_URL="https://v.douyin.com/…" \
//     node tests/transport-spike/tikhub.mjs
//   不给 TIKHUB_SHARE_URL 时用一条占位抖音短链（可能已失效——失效属正常，抓取源随平台波动）。
//
// 对账基准（一手 api.tikhub.io/openapi.json，checkedAt 2026-09-01）：
//   GET /api/v1/douyin/web/fetch_video_high_quality_play_url?share_url=…&region=CN
//     → ResponseModel 信封 { code, data:{ video_id, original_video_url, video_data } }
//   与生产 electron/connectors/tikhubConnector.ts 的请求/解析逐字对齐。

const BASE = "https://api.tikhub.io";

if (process.env.TIKHUB_E2E !== "1") {
  console.log("[skip] TIKHUB_E2E!=1 —— 门控 e2e 默认跳过（交付后本机 TIKHUB_E2E=1 自验）。");
  process.exit(0);
}

const key = process.env.TIKHUB_API_KEY || "";
if (!key) {
  console.log("缺 key：TIKHUB_E2E=1 TIKHUB_API_KEY=xxx node tests/transport-spike/tikhub.mjs");
  process.exit(1);
}
const mask = (k) => (k.length > 6 ? k.slice(0, 3) + "…" + k.slice(-3) : "***");
const shareUrl = process.env.TIKHUB_SHARE_URL || "https://v.douyin.com/ieFmvv8k/";

console.log(`[tikhub e2e] key=${mask(key)} share_url=${shareUrl}`);

function pick(obj, path) {
  let cur = obj;
  for (const seg of path.split(".")) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

async function main() {
  const url = new URL("/api/v1/douyin/web/fetch_video_high_quality_play_url", BASE);
  url.searchParams.set("share_url", shareUrl);
  url.searchParams.set("region", "CN");

  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    redirect: "manual",
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`✗ 非 JSON 响应（HTTP ${res.status}）：${text.slice(0, 200)}`);
    process.exit(1);
  }

  console.log(`HTTP ${res.status} · envelope.code=${body.code} · message=${body.message_zh || body.message}`);

  if (res.status >= 400 || (typeof body.code === "number" && body.code >= 400)) {
    // 抓取源随平台风控波动是常态；非 200 报清 status/message，不伪装成契约错。
    console.error(`✗ TikHub 返回错误 code=${body.code}。第三方抓取源可能随平台风控波动。`);
    process.exit(1);
  }

  const playUrl = pick(body, "data.original_video_url");
  console.log("data.video_id =", pick(body, "data.video_id"));
  console.log("data.original_video_url =", typeof playUrl === "string" ? playUrl.slice(0, 120) : playUrl);

  // 对账断言：OpenAPI 端点 description 文档化的 data.original_video_url 必须是 http(s) 直链。
  if (typeof playUrl !== "string" || !/^https?:\/\//i.test(playUrl)) {
    console.error("✗ 对账失败：data.original_video_url 不是 http(s) 直链——OpenAPI 对账基准需复核。");
    process.exit(1);
  }
  console.log("✓ 对账通过：拿到无水印直链，形状与合同 fixture 一致。");
}

main().catch((error) => {
  console.error("✗ 连接 TikHub 失败：", error?.message || error);
  process.exit(1);
});
