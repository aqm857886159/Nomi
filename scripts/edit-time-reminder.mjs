#!/usr/bin/env node
// 「动手那一刻」的两个提醒（PreToolUse · Write|Edit）。只提醒、不拦、fail-open（任何异常都静默放行）。
//
//  (a) 在 src/、electron/ 新建文件 → 附一份接口级「已有能力清单」，请回一行「已查过 / 没找到」。
//      起因：laneContextFit 是在「pi 已经有压缩」没人看的地方长出来的；agent 不知道有，就不会触发 R5.3。
//  (b) 改的文件或所在目录近 14 天已有 ≥2 个 fix 提交（这一刀是第 3 个）或出现 revert fix → 提醒先做方向检查（类根因复盘）。
//
// 机制已对着官方 hooks 文档核过（https://code.claude.com/docs/en/hooks，2026-10-01）：PreToolUse 的
// `hookSpecificOutput.additionalContext` 会进上下文，位置在**工具结果旁边**——也就是提醒随写入结果一起到，
// 不是写入前；它能让 agent 立刻自查、重写，但拦不住这一次写入。普通 stdout（exit 0）对 PreToolUse 只进调试日志、
// 不进上下文，所以必须走 JSON。stdin 有 session_id / cwd / tool_name / tool_input.file_path。
//
// 阈值与数法在 scripts/fix-churn.mjs。这里只是 Claude 一侧的提醒；真正的拦截在 git commit-msg（所有执行者都经过）。
// 每次触发写一行 .claude/reuse-reminders.log，供校准。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCapabilityIndex, loadRegistries } from './build-capability-index.mjs'
import { churnFor, directionMessage, isWatchedSource } from './fix-churn.mjs'

// 数法、阈值、watched 源码判据的唯一 owner 是 scripts/fix-churn.mjs（git commit-msg、派工、CI 同用）；这里只转出口。
export { countRecentFixes, FIX_WINDOW_DAYS, isWatchedSource, PRIOR_FIX_THRESHOLD as FIX_THRESHOLD } from './fix-churn.mjs'

const norm = (p) => String(p || '').split('\\').join('/')

export function newFileMessage(rel, indexText) {
  return [
    `【已有能力 · 新建文件前】你在新建 ${rel}。动手前先对一遍：这件事仓库或依赖里是不是已经有了？`,
    indexText,
    '请在回复里补一行：`已查：X、Y；没找到：Z`。（只是提醒，不拦你。这份清单只和登记表一样全——登记漏的能力这里列不出来，拿不准就去读依赖的文档。）',
    '设计卡 ★3「一致与复用」填了吗？（同一件事别处怎么做、复用还是为什么不复用——docs/engineering/design-card.md）',
  ].filter(Boolean).join('\n')
}

/** 纯决策：给定载荷和环境，返回 { kind, message, ... } 或 null。 */
export function decideEditTimeReminder(payload, env) {
  const tool = payload?.tool_name
  if (tool !== 'Write' && tool !== 'Edit') return null
  const abs = payload?.tool_input?.file_path
  if (typeof abs !== 'string' || !abs) return null
  const root = env.root
  const rel = norm(path.relative(root, path.resolve(root, abs)))
  if (rel.startsWith('..') || !isWatchedSource(rel)) return null

  const exists = env.exists(path.resolve(root, abs))
  if (!exists) {
    const index = buildCapabilityIndex({ ...env.registries(), targetRel: rel })
    return { kind: 'new-file', rel, message: newFileMessage(rel, index.text), indexBytes: index.bytes }
  }
  const entry = env.churn(rel)
  if (entry?.hot) return { kind: 'repeat-fix', rel, count: entry.file.fixes, message: directionMessage([entry]) }
  return null
}

function sessionMarker(sessionId) {
  return path.join(os.tmpdir(), `nomi-edit-reminders-${String(sessionId).replace(/[^\w-]/g, '_')}.json`)
}

/** 同一会话同一文件同一类提醒只来一次（否则每次 Edit 都重复，等于噪音）。 */
function alreadySent(sessionId, key) {
  if (!sessionId) return false
  try { return JSON.parse(fs.readFileSync(sessionMarker(sessionId), 'utf8')).includes(key) } catch { return false }
}
function markSent(sessionId, key) {
  if (!sessionId) return
  try {
    const file = sessionMarker(sessionId)
    let list = []
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* 第一次 */ }
    fs.writeFileSync(file, JSON.stringify([...list, key]))
  } catch { /* fail-open */ }
}

function appendLog(root, line) {
  try {
    const dir = path.join(root, '.claude')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'reuse-reminders.log'), `${new Date().toISOString()} | ${line}\n`)
  } catch { /* fail-open */ }
}

async function main() {
  let raw = ''
  for await (const chunk of process.stdin) raw += chunk
  const payload = JSON.parse(raw || '{}')
  const cwd = payload.cwd || process.cwd()
  const root = process.env.CLAUDE_PROJECT_DIR
    || execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  const result = decideEditTimeReminder(payload, {
    root,
    exists: (p) => fs.existsSync(p),
    registries: () => loadRegistries(root),
    churn: (rel) => churnFor(root, rel),
  })
  if (!result) return
  const key = `${result.kind}:${result.rel}`
  if (alreadySent(payload.session_id, key)) return
  markSent(payload.session_id, key)
  appendLog(root, `${result.kind} | ${result.rel} | ${result.count ?? result.indexBytes ?? ''}`)
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: result.message } }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { /* fail-open：任何异常都静默放行 */ }).finally(() => process.exit(0))
}
