#!/usr/bin/env node
/**
 * 渲染进程同步 IPC 棘轮（2026-10-16 卡顿波）。
 *
 * `ipcRenderer.sendSync` 会卡住整个渲染进程直到主进程回话（Electron 官方 ipc-renderer 文档的 WARNING，
 * 性能指南第 2 条）。点卡出生成框那条链路上就有一条（渠道 mapping），主进程一忙点卡就跟着等。
 * 那一条已改成 invoke；剩下的同步通道冻结在基线里，**只减不增**：
 *
 * - 预加载脚本（electron/preload.ts、electron/preload/**）里新出现一条同步通道 → 红（新代码用 ipcRenderer.invoke）；
 * - 基线里的某条已经不存在了 → 也红（顺手把基线删掉，棘轮才往下走）；
 * - 同步调用的频道名不是字符串字面量（除了 ipcCall.ts 里 invokeSync 本身那一处）→ 红：认不出是哪条，就没法冻结。
 *
 * 身份是「文件 + 频道名」，不是计数也不是行号（同 check-ipc-sender-binding 的理由：计数说不出是哪一条新来的）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootFlag = process.argv.indexOf('--root')
const repoRoot = rootFlag >= 0 && process.argv[rootFlag + 1]
  ? path.resolve(process.argv[rootFlag + 1])
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = path.join(repoRoot, 'scripts', 'renderer-sync-ipc-baseline.json')
const HELPER_FILE = 'electron/preload/ipcCall.ts'

function preloadFiles() {
  const out = []
  const single = path.join(repoRoot, 'electron', 'preload.ts')
  if (fs.existsSync(single)) out.push(single)
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.(?:ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\.[cm]?tsx?$/.test(entry.name)) out.push(file)
    }
  }
  walk(path.join(repoRoot, 'electron', 'preload'))
  return out
}

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

/** 扫出所有同步调用：{ file, channel } 或 { file, unnamed: true }。 */
export function scanSyncIpc() {
  const found = []
  for (const file of preloadFiles()) {
    const source = fs.readFileSync(file, 'utf8')
    const relative = rel(file)
    for (const match of source.matchAll(/\b(invokeSync|sendSync)\s*(?:<[^>()]*>)?\s*\(\s*([^,)]*)/g)) {
      const [, fn, firstArg] = match
      const before = source.slice(Math.max(0, match.index - 20), match.index)
      if (fn === 'invokeSync' && /function\s+$/.test(before)) continue // 定义本身
      const literal = firstArg.trim().match(/^(["'`])([^"'`]+)\1$/)
      if (literal) found.push({ file: relative, channel: literal[2] })
      else if (!(relative === HELPER_FILE && fn === 'sendSync')) found.push({ file: relative, unnamed: true, expression: firstArg.trim() })
    }
  }
  return found
}

function readBaseline() {
  try { return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).channels ?? [] } catch { return [] }
}

const key = (entry) => `${entry.file} :: ${entry.channel}`

export function decide(found, baseline) {
  const errors = []
  for (const entry of found.filter((item) => item.unnamed)) {
    errors.push(`${entry.file}：同步 IPC 的频道名不是字面量（${entry.expression}），认不出是哪条通道。用 ipcRenderer.invoke。`)
  }
  const current = new Set(found.filter((item) => !item.unnamed).map(key))
  const allowed = new Set(baseline.map(key))
  for (const entry of current) if (!allowed.has(entry)) errors.push(`新增的同步 IPC：${entry}。sendSync 会卡住整个渲染进程，改用 ipcRenderer.invoke + ipcMain.handle。`)
  for (const entry of allowed) if (!current.has(entry)) errors.push(`基线里的同步 IPC 已经不在了：${entry}。从 scripts/renderer-sync-ipc-baseline.json 删掉这一条（棘轮只减不增）。`)
  return errors
}

function main() {
  const errors = decide(scanSyncIpc(), readBaseline())
  if (errors.length) {
    console.error('[check:renderer-sync-ipc] 渲染进程同步 IPC 棘轮没过：')
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }
  console.log(`[check:renderer-sync-ipc] 通过：同步 IPC ${readBaseline().length} 条，与基线一致（只减不增）。`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
