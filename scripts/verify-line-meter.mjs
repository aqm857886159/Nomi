#!/usr/bin/env node
// 验证线用量量具：给一条线的临时目录（或一个装着很多线目录的父目录），数出这条线自写了几个驱动脚本、多少行、
// 调了几次常驻驱动（tests/ux/ui.mjs 的命令流水，见 ui-driver.mjs 的 commands.jsonl）。协调用它做前后对比。
//
//   node scripts/verify-line-meter.mjs <线目录>                 一条线
//   node scripts/verify-line-meter.mjs --lines <父目录> [--prefix V-] [--days 14] [--json]   每个子目录一条线，最后给中位数
//
// 「驱动脚本」= 线目录里自己写的 .mjs/.cjs/.js/.ts，内容里起 Electron 或驱动页面（launchNomiApp / _electron / electron.launch /
// chromium.launch / connectOverCDP / playwright 的 locator·click）。整棵源码拷贝（同一层同时有 package.json 与 src/ 或 electron/）、
// node_modules、dist*、.git 整个跳过——那是拷过来的仓库，不是这条线写的。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SCRIPT_EXT = /\.(mjs|cjs|js|ts)$/
const DRIVER_SIGNS = /launchNomiApp|_electron\b|electron\.launch|chromium\.launch|connectOverCDP|\.locator\(|getByRole\(|getByText\(/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', '.tmp', '.vite'])
export const COMMAND_LOG = 'commands.jsonl'

/** 一层目录是不是整棵源码拷贝：有 package.json，且旁边有 src/ 或 electron/。 */
export function isSourceCopy(dir) {
  try {
    return fs.existsSync(path.join(dir, 'package.json'))
      && (fs.existsSync(path.join(dir, 'src')) || fs.existsSync(path.join(dir, 'electron')))
  } catch {
    return false
  }
}

/** 数一条线：{ scripts, lines, driverCalls, skippedCopies }。 */
export function meterLine(lineDir) {
  const result = { dir: lineDir, scripts: 0, lines: 0, driverCalls: 0, skippedCopies: [] }
  const walk = (dir, depth) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('dist')) continue
        if (isSourceCopy(full)) { result.skippedCopies.push(full); continue }
        if (depth < 6) walk(full, depth + 1)
        continue
      }
      if (entry.name === COMMAND_LOG) {
        const text = fs.readFileSync(full, 'utf8')
        result.driverCalls += text.split('\n').filter((line) => line.trim()).length
        continue
      }
      if (!SCRIPT_EXT.test(entry.name) || entry.name.endsWith('.d.ts')) continue
      let text
      try {
        const stat = fs.statSync(full)
        if (stat.size > 2_000_000) continue
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (!DRIVER_SIGNS.test(text)) continue
      result.scripts += 1
      result.lines += text.split('\n').filter((line) => line.trim()).length
    }
  }
  if (isSourceCopy(lineDir)) result.skippedCopies.push(lineDir)
  else walk(lineDir, 0)
  return result
}

export function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** 父目录下每个（按前缀、近 N 天改过的）子目录当一条线。 */
export function meterLines(parent, { prefix = '', days = 14, now = Date.now() } = {}) {
  const cutoff = now - days * 86_400_000
  const rows = []
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const full = path.join(parent, entry.name)
    if (fs.statSync(full).mtimeMs < cutoff) continue
    rows.push(meterLine(full))
  }
  const withScripts = rows.filter((row) => row.scripts > 0)
  return {
    lines: rows.length,
    linesWithScripts: withScripts.length,
    linesUsingDriver: rows.filter((row) => row.driverCalls > 0).length,
    medianScripts: median(rows.map((row) => row.scripts)),
    medianLines: median(rows.map((row) => row.lines)),
    medianScriptsAmongWriters: median(withScripts.map((row) => row.scripts)),
    medianLinesAmongWriters: median(withScripts.map((row) => row.lines)),
    skippedCopies: rows.reduce((sum, row) => sum + row.skippedCopies.length, 0),
    rows,
  }
}

function main(argv) {
  const json = argv.includes('--json')
  const flag = (name, fallback) => {
    const index = argv.indexOf(name)
    return index >= 0 ? argv[index + 1] : fallback
  }
  const parent = flag('--lines')
  if (parent) {
    const summary = meterLines(path.resolve(parent), { prefix: flag('--prefix', ''), days: Number(flag('--days', 14)) })
    if (json) { console.log(JSON.stringify(summary, null, 2)); return }
    console.log(`线 ${summary.lines} 条（其中自写驱动脚本的 ${summary.linesWithScripts} 条，用过常驻驱动的 ${summary.linesUsingDriver} 条；跳过源码拷贝 ${summary.skippedCopies} 处）`)
    console.log(`中位数（全部线）：脚本 ${summary.medianScripts} 个 · ${summary.medianLines} 行`)
    console.log(`中位数（自写过的线）：脚本 ${summary.medianScriptsAmongWriters} 个 · ${summary.medianLinesAmongWriters} 行`)
    return
  }
  const dir = argv.find((arg) => !arg.startsWith('--'))
  if (!dir) {
    console.error('用法：node scripts/verify-line-meter.mjs <线目录> | --lines <父目录> [--prefix V-] [--days 14] [--json]')
    process.exit(2)
  }
  const row = meterLine(path.resolve(dir))
  if (json) { console.log(JSON.stringify(row, null, 2)); return }
  console.log(`驱动脚本 ${row.scripts} 个 · ${row.lines} 行 · 常驻驱动命令 ${row.driverCalls} 次（跳过源码拷贝 ${row.skippedCopies.length} 处）`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
