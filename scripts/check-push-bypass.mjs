#!/usr/bin/env node
// push 绕口留痕门岗（2026-09-03）。
//
// 起因：编排者连续多次用 `git -c core.hooksPath=/dev/null push` 绕过 native pre-push 钩子
// （ponytail-review + 门岗链），且这些推送来自子 agent worktree，Claude Code PreToolUse
// 钩子在那些会话里**不激活**——两层防线同时失效。
//
// 设计原则：「留痕而非禁止」——禁止只会逼出更脏的绕法；留痕让绕口行为变得可审计、
// 可在 gates 链里作为「必须有对应合规证据」的输入。
//
// 机制：
//   1. Claude Code PreToolUse(Bash) 钩子（pre-push-check.sh）检测命令里的 `-c core.hooksPath=`
//      并追加记录到 `.claude/push-bypass.log`（含分支/SHA/时间/完整命令）。
//   2. 本门岗（`check:push-bypass`）读取 push-bypass.log，对每条记录检查：
//      在绕口发生的那个 worktree 里，该 HEAD SHA 是否有对应的 gates 戳（nomi-gates-ok）。
//      没有就报红——这是「绕口必须用可验证的代价换来」的机器对账。
//   3. 用户看过日志后可以用 `--accept <sha>` 标记已人工确认的绕口，
//      或用 `--clear-confirmed` 删除已确认的行，减少噪音。
//
// 日志格式（每行）：
//   <ISO-timestamp>|bypass|branch=<branch>|sha=<sha>|worktree=<path>|cmd=<cmd>|confirmed=no
//
// 门岗判定：confirmed=yes 的行不计入红灯；confirmed=no 且无对应 gates 戳 → 红。
// 门岗本身是「零容忍」的——没有棘轮基线，每条未确认绕口当场报红。
//
// 为什么不禁止：
//   ① git -c core.hooksPath=/dev/null 是合法的 git 命令，用于调试/应急；
//   ② 真正禁止它需要 git 包装器（改 PATH），破坏性大；
//   ③ 留痕比禁止更诚实——让绕口行为进入审计视野，逼使用者记录理由。

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 测试时可通过 NOMI_BYPASS_LOG_OVERRIDE 注入隔离路径，避免污染真实 .claude/push-bypass.log
const BYPASS_LOG = process.env.NOMI_BYPASS_LOG_OVERRIDE ?? path.join(repoRoot, '.claude', 'push-bypass.log')
const MARKER_BASENAME = 'nomi-gates-ok'

// ── 解析命令行 ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const acceptIdx = args.indexOf('--accept')
const acceptSha = acceptIdx !== -1 ? args[acceptIdx + 1] : null
const clearConfirmed = args.includes('--clear-confirmed')

// ── 日志不存在 → 零绕口 → 直接通过 ─────────────────────────────────────────
if (!fs.existsSync(BYPASS_LOG)) {
  console.log('check:push-bypass: 无绕口记录，通过。')
  process.exit(0)
}

const raw = fs.readFileSync(BYPASS_LOG, 'utf8')
let lines = raw.split('\n').filter((l) => l.trim())

// ── --clear-confirmed：删掉已确认的行 ────────────────────────────────────────
if (clearConfirmed) {
  const before = lines.length
  lines = lines.filter((l) => !l.includes('confirmed=yes'))
  fs.writeFileSync(BYPASS_LOG, lines.join('\n') + (lines.length ? '\n' : ''))
  console.log(`check:push-bypass: 已删除 ${before - lines.length} 条已确认记录。`)
  if (lines.length === 0) { process.exit(0) }
}

// ── --accept <sha>：把指定 SHA 的记录标记为已确认 ────────────────────────────
if (acceptSha) {
  let changed = 0
  lines = lines.map((l) => {
    if (l.includes(`sha=${acceptSha}`) && l.includes('confirmed=no')) {
      changed++
      return l.replace('confirmed=no', 'confirmed=yes')
    }
    return l
  })
  if (changed > 0) {
    fs.writeFileSync(BYPASS_LOG, lines.join('\n') + '\n')
    console.log(`check:push-bypass: 已确认 SHA ${acceptSha} 的 ${changed} 条绕口记录。`)
  } else {
    console.warn(`check:push-bypass: 未找到 sha=${acceptSha} 且 confirmed=no 的记录。`)
  }
  // Re-read after mutation and continue to check
  lines = fs.readFileSync(BYPASS_LOG, 'utf8').split('\n').filter((l) => l.trim())
}

// ── 分析每条绕口记录 ──────────────────────────────────────────────────────────
const unconfirmed = lines.filter((l) => l.includes('confirmed=no'))

if (unconfirmed.length === 0) {
  console.log('check:push-bypass: 所有绕口记录已确认，通过。')
  process.exit(0)
}

// 对每条未确认记录，尝试找对应的 gates 戳
const red = []
const autoApproved = []

for (const line of unconfirmed) {
  // 解析字段
  const fields = Object.fromEntries(
    line.split('|').slice(1).map((f) => {
      const eq = f.indexOf('=')
      return eq === -1 ? [f, ''] : [f.slice(0, eq), f.slice(eq + 1)]
    })
  )
  const { branch, sha, worktree } = fields

  // 尝试找对应 worktree 的 gates 戳
  let hasValidGates = false
  try {
    if (worktree && fs.existsSync(worktree)) {
      const gitdir = execFileSync('git', ['-C', worktree, 'rev-parse', '--absolute-git-dir'], {
        encoding: 'utf8',
      }).trim()
      const marker = path.join(gitdir, MARKER_BASENAME)
      if (fs.existsSync(marker)) {
        const stamp = fs.readFileSync(marker, 'utf8')
        const stampSha = stamp.match(/^sha=(.+)$/m)?.[1]?.trim()
        // gates 戳的 SHA 要匹配（或 bypass 那次 SHA 是 gates 戳 SHA 的祖先且只有 doc/hook 改动）
        if (stampSha && stampSha === sha) {
          hasValidGates = true
        }
      }
    }
  } catch {
    // worktree 已消失/不可访问 → 无法验证 → 视作无戳
  }

  if (hasValidGates) {
    autoApproved.push({ line, branch, sha })
  } else {
    red.push({ line, branch, sha, worktree })
  }
}

// 自动标记有 gates 戳的为确认
if (autoApproved.length > 0) {
  let content = fs.readFileSync(BYPASS_LOG, 'utf8')
  for (const { sha } of autoApproved) {
    content = content.replace(
      new RegExp(`(sha=${sha}[^\\n]+)confirmed=no`, 'g'),
      '$1confirmed=yes'
    )
  }
  fs.writeFileSync(BYPASS_LOG, content)
  console.log(`check:push-bypass: ${autoApproved.length} 条绕口有有效 gates 戳，自动确认。`)
}

if (red.length === 0) {
  console.log('check:push-bypass: 所有绕口记录已验证，通过。')
  process.exit(0)
}

// ── 报红 ─────────────────────────────────────────────────────────────────────
console.error(`\n⛔ check:push-bypass：${red.length} 条 push 绕口无对应 gates 戳\n`)
for (const { branch, sha, worktree } of red) {
  console.error(`  分支: ${branch || '(未知)'}`)
  console.error(`  SHA:  ${sha ? sha.slice(0, 12) : '(未知)'}`)
  console.error(`  路径: ${worktree || '(未知)'}`)
  console.error()
}
console.error('处置方式：')
console.error('  1. 若该推送在推之前已跑过 gates 并盖戳：')
console.error('     node ./scripts/check-push-bypass.mjs --accept <sha>')
console.error('  2. 若需要清理所有已确认记录：')
console.error('     node ./scripts/check-push-bypass.mjs --clear-confirmed')
console.error('  3. 若推送确实跳过了 gates：补跑 pnpm run gates，确认无回归，再 --accept。')
console.error()
process.exit(1)
