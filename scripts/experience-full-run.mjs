#!/usr/bin/env node
// 体验测试「全量跑」：用户手动触发（workflow_dispatch，没有 schedule）。把路由表（docs/engineering/test-routing.json）
// fullRun.commands 里所有零花费的层串起来跑，每层独立计结果（一层红了后面照跑），出一份汇总报告。
// 真付费、真模型的层（paid）不在这里跑——它们在 PR 上只要求正文交证据，发版时由协调会话亲自抽检。
//
// 用法：
//   node scripts/experience-full-run.mjs            跑全量（CI 里用 xvfb-run -a 包一层）
//   node scripts/experience-full-run.mjs --list     只列出要跑的层
//   node scripts/experience-full-run.mjs --only catalog,laws   只跑指定的几层
// 报告：artifacts/experience-full-run/report.md；在 GitHub Actions 里同时写进 job summary。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadRoutingTable, toolGaps } from './pr-judgement-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPORT_FILE = 'artifacts/experience-full-run/report.md'
const TAIL_LINES = 15

/** 要跑的层：路由表 fullRun.commands，可被 --only 收窄；点名不存在的层 = 报错（不静默跳过）。 */
export function selectCommands(table, only = null) {
  const all = table.fullRun?.commands ?? []
  if (!only) return all
  const known = new Set(all.map((item) => item.id))
  const unknown = only.filter((id) => !known.has(id))
  if (unknown.length) throw new Error(`--only 点名了不存在的层：${unknown.join('、')}（已有：${[...known].join('、')}）`)
  return all.filter((item) => only.includes(item.id))
}

/** 串行跑，一层红了照跑后面的；run(item) → Promise<{ code, output }>。 */
export async function runFull(commands, run, now = () => Date.now()) {
  const results = []
  for (const item of commands) {
    const started = now()
    let outcome
    try { outcome = await run(item) } catch (error) { outcome = { code: 1, output: String(error?.message ?? error) } }
    results.push({ ...item, code: outcome.code, seconds: Math.round((now() - started) / 100) / 10, tail: String(outcome.output ?? '').trim().split('\n').slice(-TAIL_LINES) })
  }
  return results
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function renderReport(results, table, { when = new Date().toISOString() } = {}) {
  const failed = results.filter((item) => item.code !== 0)
  const lines = [
    '# 体验测试全量跑报告',
    '',
    `> 触发：用户手动（workflow_dispatch）· ${when} · ${results.length} 层，${results.length - failed.length} 过，${failed.length} 红`,
    '',
    '| 层 | 说明 | 结果 | 用时（秒） |',
    '|---|---|---|---|',
    ...results.map((item) => `| ${item.id} | ${cell(item.label)} | ${item.code === 0 ? '✅ 通过' : `❌ 退出码 ${item.code}`} | ${item.seconds} |`),
  ]
  for (const item of failed) lines.push('', `## ${item.id} 失败输出（末 ${TAIL_LINES} 行）`, '', '```', ...item.tail, '```')
  const paid = Object.values(table.categories).flatMap((def) => def.evidence).filter((item) => item.paid)
  const gaps = toolGaps(table)
  lines.push(
    '', '## 这次没有覆盖的（不是通过，是没跑）', '',
    '真付费、真模型的层不在全量跑里，PR 上只要求正文交证据，发版时由协调会话亲自抽检：',
    ...paid.map((item) => `- ${item.id}：${item.label}`),
    '', '工具还没建的层（路由表 `tool: missing`）：',
    ...gaps.map((gap) => `- ${gap.id}：${gap.label}——${gap.toolRef}`),
    '',
  )
  return lines.join('\n')
}

function spawnScript(item) {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(command, ['run', item.script], { cwd: repoRoot, shell: process.platform === 'win32' })
    let output = ''
    const take = (chunk) => { output += chunk; process.stdout.write(chunk) }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    child.on('error', (error) => resolve({ code: 1, output: String(error.message) }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

async function main(argv) {
  const table = loadRoutingTable(repoRoot)
  const onlyIndex = argv.indexOf('--only')
  let commands
  try {
    commands = selectCommands(table, onlyIndex >= 0 ? String(argv[onlyIndex + 1] ?? '').split(',').filter(Boolean) : null)
  } catch (error) {
    console.error(`✖ ${error.message}`)
    return 2
  }
  if (argv.includes('--list')) {
    for (const item of commands) console.log(`${item.id}\tpnpm run ${item.script}\t${item.label}`)
    return 0
  }
  const results = await runFull(commands, spawnScript)
  const report = renderReport(results, table)
  fs.mkdirSync(path.dirname(path.join(repoRoot, REPORT_FILE)), { recursive: true })
  fs.writeFileSync(path.join(repoRoot, REPORT_FILE), report)
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`)
  console.log(`\n${report}`)
  return results.some((item) => item.code !== 0) ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2))
