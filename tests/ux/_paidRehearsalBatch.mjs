#!/usr/bin/env node
// 付费走查批量演练（2026-11-15）：把仓库里经 openPaidWalk 起窗的每份 *.paid.mjs 用「不要 Key」那一档各演练一遍，出清单。
// 零花费：每份都带 NOMI_PAID_REHEARSAL=no-key 跑，子进程环境里 NOMI_SPEND_OK、APIMART_API_KEY 一律删掉——
// 放行名单是空的、凭据是假钥匙（见 tests/ux/_paidRun.mjs 文件里「演练」一节），结构上花不了钱。
//
//   pnpm build
//   node tests/ux/_paidRehearsalBatch.mjs [--only a.paid.mjs,b.paid.mjs] [--timeout-ms 300000] [--out <目录>] [--nightly]
//
// 缺参数 / 缺环境的（_paidRehearsalList.mjs#REHEARSAL_SKIPS）不跑，记「跳过：要什么」。
// --nightly（夜间走查那一步）：退出码按「今天不过」红名单判（_paidRehearsalList.mjs#KNOWN_RED）——名单外的不过红、名单里的今天过了也红；
// 不带 --nightly：任何一份不过就退出 1。清单表格写成 summary-table.txt（不用 .tsv：夜间汇总会把 nightly-walks/ 下的 .tsv 当免费走查结果读）。
//
// 每份的结论只认它自己落的演练收据（.tmp/paid-rehearsal/receipts/，本场开始之后写的那张）：过 / 不过 + 一句原因（挂在哪一步）。
// 没落收据（起窗前就拒、超时、崩了）= 不过，原因取日志里最后一句 [rehearsal] / 错误。今天演练不过的只列不修。
// 有的付费脚本会把证据摘要写进仓库里已跟踪的文件：跑完把被改的已跟踪文件还原（git checkout），并在清单里点名。
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REHEARSAL_ENV, SPEND_OPT_IN_ENV, rehearsalReceiptFile } from './_paidRun.mjs'
import { nightlyProblems, reasonFromLog, rehearsalSkipOf, rehearsalTargets } from './_paidRehearsalList.mjs'
import { ENV_KEY_VAR } from './_paidEnvKey.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const trackedChanges = () => execFileSync('git', ['diff', '--name-only'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
// 新冒出来的未跟踪文件（有的脚本把证据写进仓库里一个还不存在的目录）：只点名、不删，由跑的人决定。
const untrackedFiles = () => execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: REPO_ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)

function runOne(file, { timeoutMs, logFile }) {
  const env = { ...process.env, [REHEARSAL_ENV]: 'no-key', NO_PROXY: '127.0.0.1,localhost' }
  delete env[SPEND_OPT_IN_ENV]
  delete env[ENV_KEY_VAR]
  return new Promise((resolve) => {
    const started = Date.now()
    const log = fs.openSync(logFile, 'w')
    const child = spawn(process.execPath, [path.join('tests', 'ux', file)], { cwd: REPO_ROOT, env, stdio: ['ignore', log, log], detached: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL') } catch { /* 已退出 */ } }, timeoutMs)
    child.on('exit', (code) => { clearTimeout(timer); fs.closeSync(log); resolve({ code, timedOut, ms: Date.now() - started, started }) })
  })
}

async function main() {
  const only = option('--only', '')
  const timeoutMs = Number(option('--timeout-ms', '300000'))
  const outDir = path.resolve(option('--out', path.join(REPO_ROOT, '.tmp', 'paid-rehearsal', `batch-${Date.now()}`)))
  fs.mkdirSync(outDir, { recursive: true })
  const all = rehearsalTargets(fs.readdirSync(path.join(REPO_ROOT, 'tests', 'ux')))
  const targets = only ? only.split(',').map((name) => name.trim()).filter(Boolean) : all
  const unknown = targets.filter((name) => !all.includes(name))
  if (unknown.length) throw new Error(`不是经 openPaidWalk 起窗的付费脚本：${unknown.join('、')}`)
  const before = new Set(trackedChanges())
  const untrackedBefore = new Set(untrackedFiles())
  const rows = []
  const batchStarted = Date.now()
  for (const file of targets) {
    const needs = rehearsalSkipOf(file)
    if (needs) {
      rows.push({ file, status: 'skipped', passed: false, seconds: 0, reason: `跳过：要 ${needs}`, request: '', restoredTracked: [], leftUntracked: [] })
      console.log(`跳过 ${file} · 要 ${needs}`)
      continue
    }
    const logFile = path.join(outDir, `${file}.log`)
    const run = await runOne(file, { timeoutMs, logFile })
    const receiptFile = rehearsalReceiptFile(`tests/ux/${file}`)
    let receipt = null
    try { receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8')) } catch { /* 没落收据 */ }
    const fresh = receipt && Date.parse(receipt.at) >= run.started ? receipt : null
    const dirtied = trackedChanges().filter((name) => !before.has(name))
    if (dirtied.length) execFileSync('git', ['checkout', '--', ...dirtied], { cwd: REPO_ROOT })
    const leftBehind = untrackedFiles().filter((name) => !untrackedBefore.has(name))
    for (const name of leftBehind) untrackedBefore.add(name)
    const passed = Boolean(fresh?.passed)
    const reason = run.timedOut ? `超时（${Math.round(timeoutMs / 1000)} 秒）：${reasonFromLog(fs.readFileSync(logFile, 'utf8'))}` : fresh ? fresh.reason : reasonFromLog(fs.readFileSync(logFile, 'utf8'))
    const request = fresh?.request ? `${fresh.request.via} ${fresh.request.method ?? '-'} ${fresh.request.host}${fresh.request.path ?? ''}` : ''
    rows.push({ file, status: passed ? 'passed' : 'failed', passed, seconds: Math.round(run.ms / 1000), reason: String(reason).replace(/\s+/g, ' ').slice(0, 300), request, restoredTracked: dirtied, leftUntracked: leftBehind })
    console.log(`${passed ? '过  ' : '不过'} ${file} · ${Math.round(run.ms / 1000)}s · ${request || rows.at(-1).reason}${dirtied.length ? ` · 还原了 ${dirtied.join('、')}` : ''}${leftBehind.length ? ` · 留下了未跟踪文件（没删）${leftBehind.join('、')}` : ''}`)
  }
  const count = (status) => rows.filter((row) => row.status === status).length
  const nightly = process.argv.includes('--nightly')
  const problems = nightly ? nightlyProblems(rows) : []
  const summary = {
    at: new Date().toISOString(), tier: 'no-key', total: rows.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped'),
    seconds: Math.round((Date.now() - batchStarted) / 1000), ...(nightly ? { nightlyProblems: problems } : {}), rows,
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  fs.writeFileSync(path.join(outDir, 'summary-table.txt'), ['file\tstatus\tseconds\trequest\treason', ...rows.map((row) => [row.file, row.status, row.seconds, row.request, row.reason].join('\t'))].join('\n') + '\n')
  console.log(`\n演练 ${summary.total} 份：过 ${summary.passed}，不过 ${summary.failed}，跳过 ${summary.skipped}，共 ${summary.seconds} 秒。清单：${path.relative(REPO_ROOT, outDir)}/summary-table.txt`)
  if (nightly) {
    for (const problem of problems) console.log(`红：${problem}`)
    console.log(problems.length ? `夜间演练红 ${problems.length} 条（「今天不过」名单见 tests/ux/_paidRehearsalList.mjs）` : '夜间演练绿：不过的都在「今天不过」名单里，名单里的都还没过')
    process.exitCode = problems.length ? 1 : 0
  } else process.exitCode = summary.failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
