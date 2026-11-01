#!/usr/bin/env node
// 每日雷达（SessionStart hook 的本体）：会话一开就把「用户反馈雷达」「供应商模型雷达」跑掉并把结果注入上下文，
// 再提醒「三日竞品雷达」。论文雷达改为按需（2026-10-01 用户拍板），不再每日提醒。
//
// 为什么从 CLAUDE.md 的一段指令改成 hook：必须每次发生的事写成 hook，不写成指令（调研报告 §一.2；官方：CLAUDE.md 是 advisory，
// hook 是 deterministic）。原先靠 agent 在第一条消息里自觉去跑，跑没跑、跑败了有没有说成「没有新东西」都没人管。
//
// 三条不变量：
//  1. **脚本跑败 = 明说「今天没查成」，绝不能说成「没有新反馈 / 没有新模型」**。还有几条反馈没人管由待分诊账回答，每次开会话现读。
//  2. **一台机器一天只跑一次，摘要放仓库外，后开的会话直接拿缓存摘要。** 用户反馈雷达的增量状态（seenKeys）是整台机器共享的：
//     若标记放在各自的 worktree 里，一天里第一个开起来的会话（常常是某个实施会话）会把「新反馈」吃掉，之后协调会话再跑就是
//     「新增 0 条」——从后门把「没看到」变成「没有新反馈」。所以标记和当天摘要都在 intake 的缓存目录（NOMI_INTAKE_CACHE 可改）。
//     失败的不记成功，下次会话重试。
//  3. **hook 不许动工作树里任何文件**（含未跟踪文件）：运行结果都在仓库外；模型雷达的基线快照只由 --update-baseline 写；
//     hook 路径不发任何扣费请求（模型雷达带 --no-liveness，跳过每周一次的付费存活探测）。
// 两个雷达并行跑，缩短开会话的等待。细则见 docs/engineering/daily-radars.md。普通 stdout 在 SessionStart 会进上下文。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readInbox, untriagedItems } from './lib/intake-radar/inbox.mjs'
import { resolveCacheDir } from './lib/intake-radar/store.mjs'
import { killProcessTree, processTreeSpawnOptions } from './lib/processTree.mjs'

const TRIAGE = '分诊只由协调会话做；其他会话看到不动手、不写待办。'
const MODEL_TRIAGE_PLAN = 'docs/plan/2026-08-27-vendor-model-radar.md'
const lastLine = (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? ''
export const RADARS = [
  { key: 'intake', label: '用户反馈雷达', script: 'intake:radar', argv: ['scripts/intake-radar.mjs'], skill: 'nomi-intake-radar',
    // 版本健康判停也退出 1（发布流程靠它拦放量），但雷达是跑完了的：报告最后一行固定是结论（docs/release-process.md）。
    ranWithAlarm: (result) => result.status === 1 && lastLine(result.stdout).startsWith('停止放量：'),
    next: (hasSkill) => (hasSkill
      ? `待分诊不为 0 或有突增时，由协调会话起 nomi-intake-radar 技能分诊，记进待办后出账。${TRIAGE}`
      : `技能 nomi-intake-radar 在这台机器上没有，今天没法按技能分诊（不是没有新反馈）；把「待分诊 N 条」告诉协调会话。${TRIAGE}`) },
  // --no-liveness：每周一次的存活探测会发付费请求，hook 路径里不许有任何扣费请求。
  { key: 'models', label: '供应商模型雷达', script: 'radar:models', argv: ['node_modules/tsx/dist/cli.mjs', 'scripts/model-radar.ts', '--no-liveness'],
    // 不恢复模型雷达的分诊技能（2026-10-01 用户拍板）：分诊一律按方案文档的规则，由协调会话手做。
    next: () => `\`新增 > 0\` 时按 ${MODEL_TRIAGE_PLAN} 的分诊规则由协调会话处理；要接某个先出接入方案，点头后才写码；快照等用户看过再 -- --update-baseline。${TRIAGE}` },
]
const TAIL_LINES = 14
const TAIL_CHARS = 1200
const TIMEOUT_MS = 60_000
const LOCK_STALE_MS = 150_000
const LOCK_WAIT_MS = 100_000

/** 待分诊行里最多列几个编号：开会话时扫一眼，全部的在报告里。 */
const TRIAGE_LINE_IDS = 5

const pad = (n) => String(n).padStart(2, '0')
export const localDate = (now) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
const localTime = (now) => `${pad(now.getHours())}:${pad(now.getMinutes())}`

const tail = (text) => {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter(Boolean)
  const out = lines.slice(-TAIL_LINES).join('\n')
  return out.length > TAIL_CHARS ? `…${out.slice(-TAIL_CHARS)}` : out
}

/**
 * 技能在这台机器上有没有：仓库里 agent-skills/<名>/SKILL.md、项目 .claude/skills、用户目录 ~/.claude/skills 任一处。
 * 没有就不能叫人「去跑」它——叫人去跑一个不存在的东西，等于让这一步静悄悄地不发生（论文雷达最新一份就这么停在 09-07）。
 */
export function skillExists(name, { root, home = os.homedir(), exists = fs.existsSync } = {}) {
  return [
    path.join(root, 'agent-skills', name, 'SKILL.md'),
    path.join(root, '.claude', 'skills', name, 'SKILL.md'),
    path.join(home, '.claude', 'skills', name, 'SKILL.md'),
  ].some((file) => exists(file))
}

/** 标记与当天摘要的位置：intake 缓存目录（仓库外；NOMI_INTAKE_CACHE 可改，测试用）。 */
export function radarStateFile(env = process.env) {
  return path.join(resolveCacheDir(env), 'daily-radar.json')
}

// 直接用 node 跑脚本本体（等价于 package.json 里 intake:radar / radar:models 的命令），不经 pnpm：
// hook 的 PATH 里不一定有 pnpm（Windows 上从 cmd 起子进程就找不到），而找不到它只会让雷达天天「没查成」。
function defaultRun(root, radar) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const done = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve(result) } }
    let child
    try {
      child = spawn(process.execPath, radar.argv, { cwd: root, windowsHide: true, ...processTreeSpawnOptions() })
    } catch (error) { return resolve({ status: null, stdout, stderr, error }) }
    const timer = setTimeout(() => { killProcessTree(child, 'SIGTERM'); done({ status: null, signal: 'SIGTERM', stdout, stderr, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) }) }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => done({ status: null, stdout, stderr, error }))
    child.on('close', (status, signal) => done({ status, signal, stdout, stderr }))
  })
}

export function readState(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return {} }
}

/**
 * 「还有几条反馈没人管」。**每次开会话都现读账本**，不走缓存摘要：摘要是当时的数，
 * 这一行要回答的是现在。脚本跑败、拿缓存、退出码 1 都照样报，新反馈才不会从这些分支溜走。
 */
export function triageLine(cacheDir) {
  const inbox = readInbox(cacheDir)
  if (!inbox.exists) return '【待分诊】账还没建（今天还没有新版雷达成功跑过）；不是没有待分诊。手动跑 pnpm run intake:radar 就有了。'
  if (inbox.rebuilt) return '【待分诊】账文件读不出来；不是没有待分诊。下一轮 pnpm run intake:radar 会从缓存重建。'
  const pending = untriagedItems(inbox)
  if (pending.length === 0) return '【待分诊】0 条。'
  const ids = pending.slice(0, TRIAGE_LINE_IDS).map((item) => item.id).join(' ')
  return `【待分诊】${pending.length} 条还没记进待办（最新：${ids}${pending.length > TRIAGE_LINE_IDS ? ' …' : ''}）。协调会话分诊后出账：pnpm run intake:radar -- --triaged <编号…> --todo <待办号或说明>。`
}

/**
 * 三日竞品雷达的提醒句。产出只落私有仓（用户 2026-10-15 拍板）：本机位置读 NOMI_PRIVATE_REPO，
 * 没设 / 目录不对 = 明说「今天没查成」，绝不落回公开仓——公开仓这边没有任何可写的输出位置。
 */
export function competitiveRadarLine({ hasSkill, privateRepo, dirExists = fs.existsSync }) {
  if (!hasSkill) return '【三日竞品雷达】技能 nomi-competitive-radar 在这台机器上没有，今天没查成（不是没有更新）；由协调会话处理。'
  if (!privateRepo || !dirExists(path.join(privateRepo, 'research', 'competitive'))) {
    return '【三日竞品雷达】今天没查成：环境变量 NOMI_PRIVATE_REPO 没设，或指向的私有仓里没有 research/competitive/（不是没有更新）。产出只能落私有仓 Nomi-service，不会落回公开仓；设好后由协调会话处理。'
  }
  return '【三日竞品雷达】只由协调会话做：首轮检查到期 / 未完成周期（nomi-competitive-radar；对标名单与全部产出在私有仓 Nomi-service 的 research/competitive/，报告落 <日期>/）；绝不在公开主仓提交、绝不开公开 PR；失败不能记「无更新」，研究建议不能自动变成开发或发布授权。'
}

/**
 * 纯逻辑（可测）：返回 { text, state }。run(root, radar) 注入；两个雷达**并行**。
 * state = 机器级的当天标记 + 摘要：今天已成功的直接给缓存摘要（带跑的时间），失败的重跑。
 */
export async function runDailyRadar({ root, now = new Date(), run = defaultRun, state = {}, hasSkill = (name) => skillExists(name, { root }), privateRepo = process.env.NOMI_PRIVATE_REPO, dirExists = fs.existsSync, readTriageLine = () => triageLine(resolveCacheDir(process.env)) }) {
  const today = localDate(now)
  const next = state.date === today ? { ...state } : { date: today }

  const outcomes = await Promise.all(RADARS.map(async (radar) => {
    if (next[radar.key]?.ok) return { radar, cached: next[radar.key] }
    return { radar, result: await run(root, radar), at: localTime(now) }
  }))

  const lines = []
  for (const { radar, cached, result, at } of outcomes) {
    if (cached) {
      lines.push(`【${radar.label}】今天 ${cached.at} 已在本机跑过（别的会话先开了；摘要如下，新增数以当时为准；要重跑：pnpm run ${radar.script}）：`)
      lines.push(cached.text || '（当时脚本没有输出）')
      lines.push(`→ ${radar.next(radar.skill ? hasSkill(radar.skill) : true)}`)
      continue
    }
    const alarmed = radar.ranWithAlarm?.(result) === true
    if (result.status === 0 || alarmed) {
      const text = tail(result.stdout) || '（脚本没有输出）'
      next[radar.key] = { ok: true, at, text }
      lines.push(`【${radar.label}】已跑（${at}，pnpm run ${radar.script}）${alarmed ? '，版本健康判停（退出码 1 是这个结论，不是脚本报错）' : ''}：`)
      lines.push(text)
      lines.push(`→ ${radar.next(radar.skill ? hasSkill(radar.skill) : true)}`)
    } else {
      const why = result.error?.code === 'ETIMEDOUT' || result.signal ? `超时（>${TIMEOUT_MS / 1000}s）`
        : result.error ? `没能启动：${result.error.message}`
          : `脚本退出码 ${result.status}`
      next[radar.key] = { ok: false, at, why }
      lines.push(`【${radar.label}】今天没查成：${why}。这是脚本报错，**不是没有新东西**——不要说成「没有新反馈 / 没有新模型」。下次会话会重试；手动重跑：pnpm run ${radar.script}`)
      const detail = tail(result.stderr || result.stdout)
      if (detail) lines.push(detail)
    }
  }
  // 放在雷达跑完之后读：这一轮新到的也要算进去。
  lines.splice(lines.findIndex((line) => line.startsWith(`【${RADARS[1].label}】`)), 0, readTriageLine())

  lines.push(competitiveRadarLine({ hasSkill: hasSkill('nomi-competitive-radar'), privateRepo, dirExists }))
  return { text: lines.join('\n'), state: next }
}

/** 一台机器同一时刻只让一个会话跑雷达（两个会话同时开时，后者等前者写好缓存）。 */
export function tryLock(lockFile, now = Date.now()) {
  try {
    fs.mkdirSync(path.dirname(lockFile), { recursive: true })
    try { if (now - fs.statSync(lockFile).mtimeMs > LOCK_STALE_MS) fs.rmSync(lockFile, { force: true }) } catch { /* 没有锁 */ }
    fs.closeSync(fs.openSync(lockFile, 'wx'))
    return true
  } catch { return false }
}
export const unlock = (lockFile) => { try { fs.rmSync(lockFile, { force: true }) } catch { /* 无所谓 */ } }

/** 会话级入口（含读写缓存与锁）；测试通过 env.NOMI_INTAKE_CACHE 指到临时目录。 */
export async function runSession({ root, env = process.env, now = () => new Date(), run = defaultRun, hasSkill, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), lockWaitMs = LOCK_WAIT_MS }) {
  const stateFile = radarStateFile(env)
  const lockFile = `${stateFile}.lock`
  let waited = 0
  while (!tryLock(lockFile)) {
    if (waited >= lockWaitMs) return '【每日雷达】另一个会话的雷达跑了超过 100 秒还没出结果；不是没有新东西。稍后重开会话会拿到缓存摘要，或手动跑 pnpm run intake:radar / pnpm run radar:models。'
    await sleep(2000)
    waited += 2000
  }
  try {
    const { text, state } = await runDailyRadar({ root, now: now(), run, state: readState(stateFile), readTriageLine: () => triageLine(resolveCacheDir(env)), ...(hasSkill ? { hasSkill } : {}) })
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)) } catch { /* 写不进去只会让下次再跑一遍 */ }
    return text
  } finally {
    unlock(lockFile)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  runSession({ root })
    .then((text) => process.stdout.write(`${text}\n`))
    .catch((error) => process.stdout.write(`【每日雷达】今天没查成：雷达 hook 自己出错（${error instanceof Error ? error.message : String(error)}）。不是没有新东西；请手动跑 pnpm run intake:radar 与 pnpm run radar:models。\n`))
    .finally(() => process.exit(0))
}
