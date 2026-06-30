// Feedback Radar · Bilibili adapter —— 拉指定视频评论区的近期评论。
//
// 为什么复杂：B站没有官方开放评论 API，社区逆出的 `reply/wbi/main` 端点要 WBI 签名，
// 且配置里给的是人能复制的 BV 号，得本地转成接口要的 oid(aid)。三件事都不能凭记忆写——
// 算法取自社区权威实现 bilibili-API-collect 并用已知向量校验（见 bilibili.test.mjs）：
//   · WBI 签名：mixinKeyEncTab(64) + md5(sorted_query + mixin_key)
//   · BV→AV：BigInt 版（XOR_CODE/MASK_CODE/58 进制表 + 位置交换 3↔9 / 4↔7）
//
// 诚实边界：只读、可匿名（不带任何账号 cookie）。不发评论、不点赞。封号风险≈零。

import crypto from "node:crypto";

// ── WBI 签名（算法：bilibili-API-collect/docs/misc/sign/wbi）────────────────────
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];

const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** imgKey+subKey 按固定表重排取前 32 位 = mixin_key。 */
export function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join("").slice(0, 32);
}

/** 给参数加 wts、排序、过滤 !'()* 、拼 mixin_key 算 md5 = w_rid。返回带 w_rid 的 query 串。 */
export function encWbi(params, imgKey, subKey) {
  const mixinKey = getMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const signed = { ...params, wts };
  const query = Object.keys(signed)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(signed[k]).replace(/[!'()*]/g, ""))}`)
    .join("&");
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

// ── BV → AV（算法：bilibili-API-collect/docs/misc/bvid_desc，第二代）──────────────
const XOR_CODE = 23442827791579n;
const MASK_CODE = 2251799813685247n;
const BV_BASE = 58n;
const BV_ALPHA = "FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf";

/** "BV1L9Uoa9EUx" → 111298867365120（数字 aid）。 */
export function bv2av(bvid) {
  const a = Array.from(bvid);
  [a[3], a[9]] = [a[9], a[3]];
  [a[4], a[7]] = [a[7], a[4]];
  a.splice(0, 3); // 去掉 "BV1"
  const tmp = a.reduce((pre, c) => pre * BV_BASE + BigInt(BV_ALPHA.indexOf(c)), 0n);
  return Number((tmp & MASK_CODE) ^ XOR_CODE);
}

/** 配置里给 "BV..." 转 aid；给纯数字就当 aid 直接用。 */
function toOid(videoId) {
  const s = String(videoId).trim();
  if (/^BV/i.test(s)) return bv2av(s);
  if (/^av/i.test(s)) return Number(s.slice(2));
  return Number(s);
}

// ── 评论拉取 ──────────────────────────────────────────────────────────────────
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function getNavKeys() {
  const res = await fetch("https://api.bilibili.com/x/web-interface/nav", { headers: { "User-Agent": UA } });
  const json = await res.json();
  // 未登录时 code=-101，但 data.wbi_img 仍带 img_url/sub_url——照取即可。
  const img = json?.data?.wbi_img;
  if (!img?.img_url || !img?.sub_url) throw new Error("nav 接口没返回 wbi_img（B站可能改了接口）");
  const fileKey = (u) => u.slice(u.lastIndexOf("/") + 1).split(".")[0];
  return { imgKey: fileKey(img.img_url), subKey: fileKey(img.sub_url) };
}

function replyToSignal(r, bvid, oid, kind) {
  return {
    source: "bilibili",
    sourceId: `rpid_${r.rpid}`,
    kind,
    author: r.member?.uname ?? "匿名",
    text: (r.content?.message ?? "").trim(),
    url: `https://www.bilibili.com/video/${bvid || "av" + oid}#reply${r.rpid}`,
    createdAt: r.ctime ? new Date(r.ctime * 1000).toISOString() : "",
    context: `B站视频 ${bvid || "av" + oid} 评论 · 👍${r.like ?? 0}`,
  };
}

async function fetchVideoComments(videoId, keys, mode) {
  const oid = toOid(videoId);
  const bvid = /^BV/i.test(String(videoId)) ? String(videoId) : "";
  const params = { oid, type: 1, mode, plat: 1, web_location: 1315875 };
  const query = encWbi(params, keys.imgKey, keys.subKey);
  const url = `https://api.bilibili.com/x/v2/reply/wbi/main?${query}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: `https://www.bilibili.com/video/${bvid || "av" + oid}` },
  });
  const json = await res.json();
  if (json.code !== 0) throw new Error(`评论接口 code=${json.code}: ${json.message || ""}（${bvid || oid}）`);
  const top = json.data?.replies ?? [];
  const signals = [];
  for (const r of top) {
    signals.push(replyToSignal(r, bvid, oid, "reply"));
    for (const sub of r.replies ?? []) signals.push(replyToSignal(sub, bvid, oid, "sub_reply"));
  }
  return signals;
}

/**
 * @param {{videos?:string[], mode?:number}} cfg  videos 为 BV 号或 av 号数组；mode=2 按时间(默认)
 * @returns {Promise<{signals:FeedbackSignal[], meta:object}>}
 */
export async function collectBilibili(cfg = {}) {
  const videos = cfg.videos ?? [];
  if (!videos.length) return { signals: [], meta: { videos: 0, skipped: "未配置 bilibili.videos" } };
  const mode = cfg.mode ?? 2; // 2=按时间，最新评论在前，正是反馈雷达要的
  const keys = await getNavKeys();
  const all = [];
  const errors = [];
  for (const v of videos) {
    try {
      all.push(...(await fetchVideoComments(v, keys, mode)));
    } catch (e) {
      errors.push(`${v}: ${e.message}`); // 单个视频挂不拖垮整轮
    }
  }
  return { signals: all, meta: { videos: videos.length, comments: all.length, errors } };
}
