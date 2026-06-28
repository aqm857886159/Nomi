// Feedback Radar —— 归一化 + 去重状态 + 配置加载。
//
// 为什么单独一层：三个 adapter（GitHub / B站 / 微信）抓回来的原始结构天差地别，
// 但下游分诊只认一种形状。把「形状定义 + 稳定 id + seen 去重 + 配置」收在这里，
// adapter 只负责「把自己那套翻译成 FeedbackSignal」，单一真相源、互不耦合（R9 分层）。
//
// 诚实边界：这层不调 LLM、不分诊、不判 bug。它只做确定性的搬运与去重。
// 「是不是 bug / 要不要修」是 skill 里 agent 的活，不在脚本里 hardcode。

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FEEDBACK_DIR = path.join(ROOT, "docs", "feedback");
export const STATE_PATH = path.join(FEEDBACK_DIR, "state.json");
export const SOURCES_PATH = path.join(FEEDBACK_DIR, "sources.json");
export const SOURCES_EXAMPLE_PATH = path.join(FEEDBACK_DIR, "sources.example.json");

/**
 * FeedbackSignal —— 三渠道归一后的唯一形状。adapter 必须吐这个。
 * @typedef {Object} FeedbackSignal
 * @property {"github"|"bilibili"|"wechat"} source  来源渠道
 * @property {string} sourceId   渠道内稳定 id（issue number / rpid / 消息序号），用于去重
 * @property {string} kind       渠道内子类型（issue / issue_comment / reply / sub_reply / group_msg）
 * @property {string} author     发声的人（脱敏到昵称即可，不存手机号/wxid 明文）
 * @property {string} text       正文
 * @property {string} url        能点回原帖的链接（微信无 url 则留空）
 * @property {string} createdAt  ISO 时间
 * @property {string} context    给分诊用的一句话上下文（哪个视频/哪个 issue 标题/哪个群）
 */

/** 稳定 id：source + sourceId 决定唯一性。同一条反馈无论抓几次都是同一个 key，保证去重幂等。 */
export function signalKey(sig) {
  return `${sig.source}:${sig.sourceId}`;
}

/** 内容指纹（兜底）：当渠道给不出稳定 id 时，用 source+author+正文 hash 兜底去重。 */
export function contentFingerprint(source, author, text) {
  const h = crypto.createHash("sha1").update(`${source}\n${author}\n${text}`).digest("hex");
  return `${source}:fp_${h.slice(0, 16)}`;
}

export function readState() {
  if (!fs.existsSync(STATE_PATH)) return { seen: {}, lastRun: {} };
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    // 状态文件坏了不该让整条雷达瘫——退回空状态（最多重复报一次，不丢数据）。
    return { seen: {}, lastRun: {} };
  }
}

export function writeState(state) {
  fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/**
 * 过滤掉已见过的信号，并把新信号登记进 state。
 * 返回 { fresh, state }——fresh 是这轮真正新出现的，state 是更新后的（调用方负责落盘）。
 */
export function dedupe(signals, state, nowISO) {
  const fresh = [];
  for (const sig of signals) {
    const key = sig.sourceId ? signalKey(sig) : contentFingerprint(sig.source, sig.author, sig.text);
    if (state.seen[key]) continue;
    state.seen[key] = nowISO;
    fresh.push(sig);
  }
  return { fresh, state };
}

/** 加载用户配置。没有 sources.json 时返回 null，让 CLI 给出「复制模板」的清晰指引。 */
export function loadSources() {
  if (!fs.existsSync(SOURCES_PATH)) return null;
  return JSON.parse(fs.readFileSync(SOURCES_PATH, "utf8"));
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
