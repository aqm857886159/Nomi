// Feedback Radar · 微信 adapter —— 经 chatlog 本地 HTTP API 只读群消息。
//
// 为什么走 chatlog：macOS 上收发类框架（WeChatFerry/ntchat）全是 Windows-only + 封号风险。
// chatlog（github.com/sjzar/chatlog）本地解密微信库、提供 HTTP API，不注入进程、不发消息，
// 风险≈零，是 Mac 上唯一干净的只读路。本 adapter 只当它的 HTTP 客户端。
//
// 前置（用户侧，一次性）：装 chatlog → 获取密钥/解密 → 开 HTTP 服务（默认 127.0.0.1:5030）。
// 服务没起时本 adapter 不报错炸雷达——优雅跳过并让 CLI 打出清晰指引（其余渠道照跑）。
//
// 诚实边界：只读群消息文本，存昵称不存 wxid 明文；不回消息。字段映射对 chatlog 当前返回做了
// 兼容兜底，若它改了返回结构，调 mapMessage 一处即可（单一映射点）。

const DEFAULT_BASE = "http://127.0.0.1:5030";

const ymd = (d) => d.toISOString().slice(0, 10);

/** 把 chatlog 一条消息映射成 FeedbackSignal。字段做多名兜底——这是唯一映射点。 */
function mapMessage(m, group) {
  const id = m.id ?? m.seq ?? m.MsgSvrID ?? m.msgId ?? "";
  const author = m.senderName ?? m.nickName ?? m.sender ?? m.talkerName ?? "群友";
  const text = (typeof m.content === "string" ? m.content : m.content?.text ?? m.message ?? "").trim();
  const ts = m.time ?? m.CreateTime ?? m.createTime;
  return {
    source: "wechat",
    sourceId: id ? `msg_${id}` : "", // 无稳定 id 时留空，normalize 用内容指纹兜底去重
    kind: "group_msg",
    author,
    text,
    url: "", // 微信无可点回的公开链接
    createdAt: ts ? new Date(typeof ts === "number" ? ts * 1000 : ts).toISOString() : "",
    context: `微信群「${group}」`,
  };
}

async function fetchGroup(baseUrl, group, timeRange) {
  const u = `${baseUrl}/api/v1/chatlog?talker=${encodeURIComponent(group)}&time=${encodeURIComponent(timeRange)}&format=json&limit=500`;
  const res = await fetch(u, { headers: { "User-Agent": "nomi-feedback-radar" } });
  if (!res.ok) throw new Error(`chatlog ${res.status}`);
  const json = await res.json();
  const list = Array.isArray(json) ? json : json.items ?? json.data ?? [];
  return list.map((m) => mapMessage(m, group)).filter((s) => s.text);
}

/**
 * @param {{baseUrl?:string, groups?:string[], sinceDays?:number}} cfg
 * @returns {Promise<{signals:FeedbackSignal[], meta:object}>}
 */
export async function collectWechat(cfg = {}) {
  const groups = cfg.groups ?? [];
  if (!groups.length) return { signals: [], meta: { groups: 0, skipped: "未配置 wechat.groups" } };
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE;
  const sinceDays = cfg.sinceDays ?? 3;
  const from = new Date(Date.now() - sinceDays * 86400_000);
  const timeRange = `${ymd(from)}~${ymd(new Date())}`;

  // 先探活：服务没起就整渠道跳过，给清晰指引，不连累 GitHub/B站。
  try {
    await fetch(`${baseUrl}/api/v1/session`, { headers: { "User-Agent": "nomi-feedback-radar" } });
  } catch {
    return {
      signals: [],
      meta: {
        groups: groups.length,
        skipped: `chatlog 服务未在 ${baseUrl} 运行——先启动 chatlog 并开启 HTTP 服务再跑（见 docs/plan/2026-06-28-feedback-radar.md）`,
      },
    };
  }

  const all = [];
  const errors = [];
  for (const g of groups) {
    try {
      all.push(...(await fetchGroup(baseUrl, g, timeRange)));
    } catch (e) {
      errors.push(`${g}: ${e.message}`);
    }
  }
  return { signals: all, meta: { groups: groups.length, messages: all.length, timeRange, errors } };
}
