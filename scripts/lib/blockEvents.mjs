// 本机门岗每阻断一次留一条机器可读记录（2026-11-07，10-24 → 11-07 PR 拦截审计的量具最小版）。
//
// 为什么要：审计时本机这几道（推送前快检、推送钩子、整套门岗）拦了多少次只能从报告原文里捞「下限」，
// CI 的红又有三分之一藏在重跑之前——没有记录，就答不了「这道门岗拦下的是真问题还是流程注定的红」。
//
// 写在哪：`$(git rev-parse --git-common-dir)/nomi-block-events.jsonl`，所有工作树共用一份，不进仓库，不碰用户资料目录。
// 谁写：scripts/pre-push-contracts.mjs（推送前快检 / 钩子）与 scripts/run-gates-contracts.mjs（整套门岗）在阻断出口各调一次。
// CI 里不写（CI 的被拦记录由 scripts/block-radar.mjs 读 Actions 日志拿）。
// 一行的形状见 scripts/lib/block-events.schema.json。codeChanged 写入时是 null：它要等这条分支下一次绿了才知道，
// 由 block-radar 读的时候算（这次红的 head 到同一分支下一次绿的 head 之间有没有改代码），不回写文件。
//
// 记录失败（目录不可写、不在 git 仓库里）只出一行警告：量具坏了不许改门岗的结论。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const BLOCK_EVENTS_FILE = 'nomi-block-events.jsonl'
export const BLOCK_EVENTS_SCHEMA = 'scripts/lib/block-events.schema.json'
/** quick = 手动跑推送前快检；push = git push 触发的钩子；gates = 整套门岗（pnpm run gates 等走 gates:contracts 的入口）。 */
export const LOCAL_BLOCK_STAGES = Object.freeze(['quick', 'push', 'gates'])

const defaultGit = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })

/** 记录文件的绝对路径（git common dir 下，所有工作树同一份）。NOMI_BLOCK_EVENTS_FILE 只给测试改写到临时文件。 */
export function blockEventsPath({ cwd = process.cwd(), git = defaultGit, env = process.env } = {}) {
  if (env.NOMI_BLOCK_EVENTS_FILE) return path.resolve(env.NOMI_BLOCK_EVENTS_FILE)
  // --path-format=absolute：主仓和各工作树拿到的是同一个写法的绝对路径（相对写法按 cwd 拼会和工作树那边的真实路径对不上）
  return path.join(git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd).trim(), BLOCK_EVENTS_FILE)
}

/**
 * 追加一条阻断记录。永不抛错：返回 { written, file?, record?, reason? }。
 * @param {{ stage: 'quick' | 'push' | 'gates', gates: string[], durationMs?: number | null, cwd?: string, env?: NodeJS.ProcessEnv,
 *   now?: () => Date, git?: (args: string[], cwd: string) => string, append?: (file: string, text: string) => void, warn?: (line: string) => void }} input
 */
export function recordBlockEvent({ stage, gates, durationMs = null, cwd = process.cwd(), env = process.env, now = () => new Date(), git = defaultGit, append = fs.appendFileSync, warn = (line) => console.error(line) }) {
  if (env.CI) return { written: false, reason: 'CI 里不写（CI 的记录由 scripts/block-radar.mjs 读日志拿）' }
  try {
    if (!LOCAL_BLOCK_STAGES.includes(stage)) throw new Error(`stage 只能是 ${LOCAL_BLOCK_STAGES.join(' / ')}，收到 ${stage}`)
    const names = [...new Set((gates ?? []).map(String).filter(Boolean))]
    if (names.length === 0) throw new Error('没有门岗名')
    const record = {
      at: now().toISOString(),
      stage,
      gates: names,
      branch: git(['branch', '--show-current'], cwd).trim() || null,
      head: git(['rev-parse', 'HEAD'], cwd).trim(),
      runner: 'local',
      durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : null,
      codeChanged: null,
    }
    const file = blockEventsPath({ cwd, git, env })
    append(file, `${JSON.stringify(record)}\n`)
    return { written: true, file, record }
  } catch (error) {
    const reason = String(error?.message ?? error).split('\n')[0]
    warn(`[block-events] 阻断记录没写成（不影响门岗结论）：${reason}`)
    return { written: false, reason }
  }
}

/** 读记录文件：坏行跳过并计数（手改过、写到一半断电），不让一行坏数据拖垮整张表。文件不存在 = 空。 */
export function readBlockEvents(file, readFile = (name) => fs.readFileSync(name, 'utf8')) {
  let text
  try { text = readFile(file) } catch (error) {
    if (error?.code === 'ENOENT') return { records: [], malformed: 0 }
    throw error
  }
  const records = []
  let malformed = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try { records.push(JSON.parse(line)) } catch { malformed += 1 }
  }
  return { records, malformed }
}
