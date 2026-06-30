// Feedback Radar · 微信 adapter —— 经 WeLive CLI 只读导出群消息。
//
// 为什么是 WeLive：原 chatlog 已被微信官方发函下架(2025-10);macOS 上收发框架(WeChatFerry/
// ntchat)全是 Windows-only。WeLive(github.com/hicccc77/WeLive-release)是其维护中的继任：
// 跨平台原生 CLI，本地解密微信库、导出 JSONL，不注入进程、不发消息。本 adapter 当它的只读壳。
//
// ⚠️ macOS 前置(用户侧，一次性)：WeLive 在 mac 上**不自动取库密钥**(只 Windows 自动)，需先：
//   1) 临时关 SIP(重启进 Recovery `csrutil disable`) 才能读微信进程内存取 db_key；
//   2) 把 wxid/db_key/image_* 填进 welive.yaml 后 `welive init` 到 status=ok。
// 没初始化好时本 adapter 不报错炸雷达——优雅跳过并给指引(其余渠道照跑)。
//
// 诚实边界：只调 WeLive 的**只读**子命令(sessions/export-session)，绝不碰它的写操作
// (防撤回/改库/SQL 写)。存昵称/wxid 不外发，digest 已 gitignore。
// 字段映射对 WeLive USAGE.md 文档形状写就，单一映射点 mapLine；真机核对待密钥到位后跑通确认。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const DEFAULT_WELIVE = path.join(os.homedir(), "welive", "welive");

/** 跑一条 welive 只读子命令，返回 stdout（带 --state-dir 指向 welive.yaml 所在目录）。 */
async function welive(bin, stateDir, args) {
  const { stdout } = await exec(bin, ["--state-dir", stateDir, ...args], { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** WeLive export-session 的一行 JSONL → FeedbackSignal。唯一映射点（字段随 WeLive 版本变只改这里）。 */
function mapLine(m, sessionId, group) {
  const ts = Number(m.create_time);
  return {
    source: "wechat",
    sourceId: `${sessionId}_${m.local_id}`, // local_id 仅会话内唯一，拼 session 保全局唯一
    kind: "group_msg",
    author: m.sender_username ?? "群友", // wxid；需昵称可后续用 welive display-names 解析
    text: (m.message_content ?? "").trim(),
    url: "", // 微信无可点回的公开链接
    createdAt: Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : "",
    context: `微信群「${group}」`,
  };
}

/**
 * @param {{welivePath?:string, stateDir?:string, groups?:string[], sinceDays?:number}} cfg
 *        groups 填群名(WeLive sessions 的 nick_name)或群 id(xxx@chatroom)
 * @returns {Promise<{signals:FeedbackSignal[], meta:object}>}
 */
export async function collectWechat(cfg = {}) {
  const groups = cfg.groups ?? [];
  if (!groups.length) return { signals: [], meta: { groups: 0, skipped: "未配置 wechat.groups" } };

  const bin = cfg.welivePath || DEFAULT_WELIVE;
  if (!fs.existsSync(bin)) {
    return { signals: [], meta: { groups: groups.length, skipped: `WeLive 未安装(${bin})——见 docs/plan/2026-06-28-feedback-radar.md` } };
  }
  const stateDir = cfg.stateDir || path.dirname(bin);

  // 探活 + 拿会话表：未 init/缺密钥时这步必失败 → 整渠道优雅跳过，不连累 GitHub/B站。
  let sessions;
  try {
    sessions = JSON.parse(await welive(bin, stateDir, ["sessions"]));
  } catch {
    return {
      signals: [],
      meta: { groups: groups.length, skipped: "WeLive 未初始化/缺密钥（macOS 需先临时关 SIP 取 db_key，再 welive init 到 ok）" },
    };
  }

  // 群名/群id → session username(xxx@chatroom)
  const resolve = (g) => sessions.find((s) => s.username === g || s.nick_name === g)?.username;
  const sinceDays = cfg.sinceDays ?? 3;
  const begin = Math.floor((Date.now() - sinceDays * 86400_000) / 1000);
  const end = Math.floor(Date.now() / 1000);

  const all = [];
  const errors = [];
  for (const g of groups) {
    const id = resolve(g);
    if (!id) {
      errors.push(`${g}: 在 WeLive 会话里没找到（核对群名）`);
      continue;
    }
    try {
      const out = await welive(bin, stateDir, [
        "export-session", "--session-id", id, "--jsonl", "--parse-content",
        "--begin", String(begin), "--end", String(end),
      ]);
      for (const line of out.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        let obj;
        try { obj = JSON.parse(t); } catch { continue; }
        const sig = mapLine(obj, id, g);
        if (sig.text) all.push(sig);
      }
    } catch (e) {
      errors.push(`${g}: ${e.message.slice(0, 120)}`);
    }
  }
  return { signals: all, meta: { groups: groups.length, messages: all.length, sinceDays, errors } };
}
