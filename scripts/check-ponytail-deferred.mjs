#!/usr/bin/env node
// Ponytail 延后账本门岗（2026-09-11）。
//
// 起因：`REVIEW_TIMEOUT_MS` 是写死的 180 秒墙钟。这台机器上常年 20+ worktree、三四棵同时跑
// gates，负载一高，评审进程被饿死在超时里——2026-09-11 一晚六条分支被拦十几次，
// 没有一条 diff 有问题。闸门开始拦无辜的人，人就开始琢磨绕口写法。
//
// 自适应超时 + 全机串行锁（见 scripts/ponytail-review-hook.mjs）把常见情形治掉了；
// 但 runner 真的不可用时（Codex 没装、插件没开、机器要死不活），仍然需要**一条明路**，
// 否则唯一的出路就是 `-c core.hooksPath=/dev/null`——那会连敏感数据扫描一起跳过，
// 而敏感数据一旦进历史就是永久的。
//
// 明路只有一条：`PONYTAIL_REVIEW_DEFER=1`。它保留敏感数据扫描、把这次跳过写进账本、
// 让提交放行，然后由本门岗**一直红**到那条被补审或被人工确认。
// 设计与 `scripts/check-push-bypass.mjs` 同源（「留痕而非禁止」），日志格式逐字对齐它。
//
// 账本格式（每行）：
//   <ISO时间>|deferred|branch=<分支>|sha=<提交前 HEAD>|worktree=<路径>|reason=<理由>|reviewed=no
//
// 注意 `sha=` 记的是**提交前的 HEAD**（pre-commit 跑的时候新提交还不存在）。
// 报红时会把它整条打出来，`--accept` 认整串也认前缀，直接复制即可。
//
// 判定：零容忍，没有棘轮基线。任一 reviewed=no → 红；读不懂的行 → 也红（fail-closed：
// 读不懂的账本不许当成「没有延后」）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 测试时用 NOMI_PONYTAIL_DEFERRED_LOG_OVERRIDE 注入隔离路径，别碰真实账本。
const LEDGER = process.env.NOMI_PONYTAIL_DEFERRED_LOG_OVERRIDE
  ?? path.join(repoRoot, '.claude', 'ponytail-deferred.log')

const ROW = /^(?<time>[^|]+)\|deferred\|branch=(?<branch>[^|]*)\|sha=(?<sha>[0-9a-f]{40})\|worktree=(?<worktree>[^|]*)\|reason=(?<reason>[^|]*)\|reviewed=(?<reviewed>yes|no)$/

const args = process.argv.slice(2)
const acceptIdx = args.indexOf('--accept')
const acceptSha = acceptIdx !== -1 ? String(args[acceptIdx + 1] || '').toLowerCase() : null
const clearReviewed = args.includes('--clear-reviewed')

if (!fs.existsSync(LEDGER)) {
  console.log('check:ponytail-review: 无延后记录，通过。')
  process.exit(0)
}

const read = () => fs.readFileSync(LEDGER, 'utf8').split('\n').filter((line) => line.trim())
const write = (rows) => fs.writeFileSync(LEDGER, rows.length ? `${rows.join('\n')}\n` : '')

let rows = read()

if (clearReviewed) {
  const kept = rows.filter((line) => !line.endsWith('reviewed=yes'))
  console.log(`check:ponytail-review: 已删除 ${rows.length - kept.length} 条已补审记录。`)
  write(kept)
  rows = kept
}

if (acceptSha) {
  let changed = 0
  const next = rows.map((line) => {
    const parsed = ROW.exec(line)
    if (parsed && parsed.groups.reviewed === 'no' && parsed.groups.sha.startsWith(acceptSha)) {
      changed += 1
      return line.replace(/reviewed=no$/, 'reviewed=yes')
    }
    return line
  })
  if (changed > 0) {
    write(next)
    rows = next
    console.log(`check:ponytail-review: 已确认 sha=${acceptSha} 的 ${changed} 条延后记录已补审。`)
  } else {
    console.warn(`check:ponytail-review: 未找到 sha 以 ${acceptSha} 开头且 reviewed=no 的记录。`)
  }
}

const malformed = rows.filter((line) => !ROW.test(line))
const pending = rows.filter((line) => ROW.exec(line)?.groups.reviewed === 'no')

if (malformed.length === 0 && pending.length === 0) {
  console.log('check:ponytail-review: 所有延后记录均已补审，通过。')
  process.exit(0)
}

console.error(`\n⛔ check:ponytail-review：${pending.length} 条评审被延后且尚未补审${malformed.length ? `，另有 ${malformed.length} 行无法解析` : ''}\n`)
for (const line of pending) {
  const { time, branch, sha, worktree, reason } = ROW.exec(line).groups
  console.error(`  时间: ${time}`)
  console.error(`  分支: ${branch || '(未知)'}`)
  console.error(`  SHA:  ${sha.slice(0, 12)}   （提交前 HEAD）`)
  console.error(`  路径: ${worktree || '(未知)'}`)
  console.error(`  理由: ${reason || '(未写)'}`)
  console.error()
}
for (const line of malformed) console.error(`  无法解析的账本行：${line.slice(0, 200)}`)
if (malformed.length) console.error()
console.error(`账本：${LEDGER}`)
console.error('处置方式：')
console.error('  1. 在那棵 worktree 里补跑 @ponytail-review（Codex）/ /ponytail-review（Claude），处理完发现后：')
console.error('     node ./scripts/check-ponytail-deferred.mjs --accept <sha>')
console.error('  2. 清理已补审的旧记录：')
console.error('     node ./scripts/check-ponytail-deferred.mjs --clear-reviewed')
console.error('  3. 无法解析的行请人工修正或删除——读不懂的账本不算「没有延后」。')
console.error()
process.exit(1)
