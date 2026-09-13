#!/usr/bin/env node
// 本机 gates 的**选测调度点**（2026-09-12，R22）。
//
// 起因：R22 自 2026-08-30 起就把 unit 面分成 focused/full 两档，`.github/workflows/quality-gate.yml`
// 的 Unit job 也确实照 `scripts/validation-policy.mjs` 分档跑——**唯独本机 `pnpm run gates` 没有**，
// 它写死 `pnpm run test`（全量 Vitest + agent-runtime 原生套件 + stats），改一行文案也跑一万二千多个用例。
//
// 这在这台机器上不是「慢一点」而是**排队**：全机共用一把 `/tmp/nomi-gates.lock`（with-gates-lock.py），
// 20+ 棵 worktree 轮流拿。2026-09-11 22:00–09-12 03:30 实测 8 棵树轮流持锁、每次 10–25 分钟、队列峰值 18。
// 每棵树都在为「别人那棵树跑一遍与自己无关的全量」付墙钟。
//
// 所以本文件**不新造选测逻辑**，它只是把本机入口接到两份既有实现上（R29：已有的不许再长一份）：
//   · 档位判据 = `classifyValidationPolicy(...).unit`（与 CI 同一份，漂移不可能发生）；
//   · focused 的选测 = `scripts/test-focused.mjs`（changed / sibling / related）。
//
// 失败方向固定为**升档**：判不出来就跑全量。空 diff、删除/重命名、验证基础设施、electron/、
// journey/canvas/performance/package 风险面全部由那份 policy 判成 `unit: 'full'`，本文件原样继承并打印原因。
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyValidationPolicy } from './validation-policy.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 档位记录落在 gitdir 里（一棵 worktree 一份，和五门戳同一个位置、同一条理由）。 */
export const TIER_RECORD_BASENAME = 'nomi-gates-tier'

/** 两档各自跑什么。**这是本文件唯一的映射表**，别在 package.json 里再写一份。 */
export const TIER_COMMANDS = Object.freeze({
  focused: ['run', 'test:system:focused'],
  full: ['run', 'test'],
})

function git(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** `-z` 的 name-status 流：状态、路径交替；R/C 带两个路径（旧、新），取新路径、保留 R/C 状态。 */
export function parseNameStatusZ(stdout) {
  const tokens = String(stdout || '').split('\0').filter((token) => token.length > 0)
  const entries = []
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index++]
    if (!/^[A-Z]/.test(status)) continue
    const first = tokens[index++]
    if (first === undefined) break
    if (/^[RC]/.test(status)) {
      const second = tokens[index++]
      entries.push({ status, path: (second ?? first).replaceAll('\\', '/') })
    } else {
      entries.push({ status, path: first.replaceAll('\\', '/') })
    }
  }
  return entries
}

/**
 * 本机这次要验的改动面 = `origin/main..HEAD` ∪ 工作区未提交改动 ∪ untracked。
 *
 * 为什么三份都要：本机 gates 常常在 commit **之前**跑（hook 链就是这么排的），只看 origin/main..HEAD
 * 会把正在改的文件整个漏掉——漏掉的后果是降档，而降档的失败是看不见的假绿。untracked 按 `A` 记，
 * 因为「新加一个 electron/xxx.ts」在风险上和「改一个」没区别。
 *
 * 拿不到 origin/main（没 fetch 过的 checkout）→ 返回空 → 上游判成空 diff → full。不猜。
 */
export function collectChangedEntries(cwd = repoRoot) {
  const entries = []
  try {
    git(['rev-parse', '--verify', 'origin/main^{commit}'], cwd)
    entries.push(...parseNameStatusZ(git(['diff', '--name-status', '-z', 'origin/main', 'HEAD'], cwd)))
  } catch {
    return []
  }
  try {
    entries.push(...parseNameStatusZ(git(['diff', '--name-status', '-z', 'HEAD'], cwd)))
  } catch {
    /* 没有 HEAD（空仓库）→ 只按上面那份算 */
  }
  try {
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], cwd)
    for (const file of String(untracked).split('\0')) {
      if (file) entries.push({ status: 'A', path: file.replaceAll('\\', '/') })
    }
  } catch {
    /* ls-files 失败不改变结论方向：已有条目照算，没有条目就是空 diff → full */
  }
  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.status}:${entry.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 档位判据。`requestedTier === 'full'`（= `pnpm run gates:full`）直接全量，不经过 policy——
 * policy 的 `requestedMode: 'full'` 还会连带置 `release: true`，那是发布边界的语义，不该被本地全量借用。
 */
export function resolveGatesTier(entries, { requestedTier = '' } = {}) {
  if (requestedTier === 'full') return { tier: 'full', reasons: ['explicit_full_tier'] }
  const policy = classifyValidationPolicy(entries)
  const reasons = policy.reasons.length > 0 ? policy.reasons : [policy.reason]
  return { tier: policy.unit === 'full' ? 'full' : 'focused', reasons }
}

function resolveRecordPath(cwd = repoRoot) {
  return path.join(git(['rev-parse', '--absolute-git-dir'], cwd).trim(), TIER_RECORD_BASENAME)
}

/** 写下这次跑的是哪一档，供盖戳方记录。带 sha 是为了让读的一方能拒绝陈旧记录。 */
export function writeTierRecord(tier, cwd = repoRoot) {
  const record = resolveRecordPath(cwd)
  const sha = git(['rev-parse', 'HEAD'], cwd).trim()
  fs.mkdirSync(path.dirname(record), { recursive: true })
  fs.writeFileSync(record, `tier=${tier}\nsha=${sha}\n`)
  return { record, tier, sha }
}

/**
 * 读回档位。**sha 对不上就不采信**（返回 null）：手工盖戳的场景下，gitdir 里很可能躺着上一次
 * 跑 gates 时的记录，照抄它等于给这次的戳编一个它没跑过的档位。
 */
export function readTierRecord(cwd = repoRoot) {
  let record
  try {
    record = resolveRecordPath(cwd)
  } catch {
    return null
  }
  if (!fs.existsSync(record)) return null
  const text = fs.readFileSync(record, 'utf8')
  const tier = /^tier=(.*)$/m.exec(text)?.[1]?.trim()
  const sha = /^sha=(.*)$/m.exec(text)?.[1]?.trim()
  if (!tier || !sha) return null
  let head
  try {
    head = git(['rev-parse', 'HEAD'], cwd).trim()
  } catch {
    return null
  }
  return sha === head ? { tier, sha } : null
}

function runTier(tier, cwd = repoRoot) {
  const args = TIER_COMMANDS[tier]
  if (!args) throw new Error(`未知档位：${tier}`)
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return result.status ?? 1
}

export function main(argv = process.argv.slice(2), cwd = repoRoot) {
  const requestedTier = argv.includes('--tier=full') ? 'full' : ''
  const dryRun = argv.includes('--dry-run')
  const entries = collectChangedEntries(cwd)
  const { tier, reasons } = resolveGatesTier(entries, { requestedTier })

  console.log(`gates 选测档位：${tier}（${entries.length} 个改动条目）`)
  console.log(`  原因：${reasons.join('、')}`)
  if (tier === 'full') {
    console.log('  → 全量：pnpm run test（Vitest 全量 + agent-runtime 原生套件 + stats）')
  } else {
    console.log('  → 改动相关：pnpm run test:system:focused；全量由 GitHub CI 的 Unit job 承担（R22）')
    console.log('  → 想在本机自己兜底跑全量：pnpm run gates:full')
  }
  if (dryRun) return 0

  writeTierRecord(tier, cwd)
  return runTier(tier, cwd)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
