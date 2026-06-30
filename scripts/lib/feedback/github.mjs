// Feedback Radar · GitHub adapter —— 拉 open issues + 近期评论。
//
// 为什么是它：GitHub issue 是最干净的反馈源——官方 API、公开仓库无需 token、零风险。
// 拉「open issue 本体」+「近期 issue 评论」两路：前者是新报的问题，后者是老问题的追加讨论。
// PR 也走 issues 端点（带 pull_request 字段），这里显式剔除——PR 不是用户反馈。
//
// 诚实边界：只读。不开 issue、不回评论、不改 label。纯抓取。

import { execSync } from "node:child_process";
import { ROOT } from "./normalize.mjs";

const API = "https://api.github.com";
const MAX_BODY = 4000; // 截断超长正文，保 raw.json 可读、可喂分诊

/** 从 GITHUB_REPOSITORY 或 git remote 推断 owner/repo（与 stats-downloads 同口径）。 */
export function resolveRepo(explicit) {
  if (explicit) return explicit;
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = execSync("git remote get-url origin", { cwd: ROOT }).toString().trim();
  const m = url.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/);
  if (!m) throw new Error(`无法从 origin 推断 GitHub 仓库：${url}`);
  return `${m[1]}/${m[2]}`;
}

async function ghFetch(pathname) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "nomi-feedback-radar" };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${pathname}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const truncate = (s) => (s && s.length > MAX_BODY ? s.slice(0, MAX_BODY) + " …(截断)" : s || "");

async function fetchOpenIssues(repo, sinceISO) {
  const signals = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghFetch(
      `/repos/${repo}/issues?state=open&sort=updated&direction=desc&since=${sinceISO}&per_page=100&page=${page}`,
    );
    if (!batch.length) break;
    for (const it of batch) {
      if (it.pull_request) continue; // 剔 PR——不是用户反馈
      signals.push({
        source: "github",
        sourceId: `issue_${it.number}`,
        kind: "issue",
        author: it.user?.login ?? "unknown",
        text: `${it.title}\n\n${truncate(it.body)}`.trim(),
        url: it.html_url,
        createdAt: it.created_at,
        context: `issue #${it.number}「${it.title}」· 👍${it.reactions?.["+1"] ?? 0} · 💬${it.comments ?? 0}`,
      });
    }
    if (batch.length < 100) break;
  }
  return signals;
}

async function fetchRecentComments(repo, sinceISO) {
  const signals = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await ghFetch(
      `/repos/${repo}/issues/comments?sort=created&direction=desc&since=${sinceISO}&per_page=100&page=${page}`,
    );
    if (!batch.length) break;
    for (const c of batch) {
      const num = (c.issue_url || "").split("/").pop();
      signals.push({
        source: "github",
        sourceId: `comment_${c.id}`,
        kind: "issue_comment",
        author: c.user?.login ?? "unknown",
        text: truncate(c.body),
        url: c.html_url,
        createdAt: c.created_at,
        context: `issue #${num} 的评论`,
      });
    }
    if (batch.length < 100) break;
  }
  return signals;
}

/**
 * @param {{repo?:string, sinceDays?:number, comments?:boolean}} cfg
 * @returns {Promise<{signals:FeedbackSignal[], meta:object}>}
 */
export async function collectGithub(cfg = {}) {
  const repo = resolveRepo(cfg.repo);
  const sinceDays = cfg.sinceDays ?? 30;
  const sinceISO = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const issues = await fetchOpenIssues(repo, sinceISO);
  const comments = cfg.comments === false ? [] : await fetchRecentComments(repo, sinceISO);
  return {
    signals: [...issues, ...comments],
    meta: { repo, sinceDays, issues: issues.length, comments: comments.length },
  };
}
