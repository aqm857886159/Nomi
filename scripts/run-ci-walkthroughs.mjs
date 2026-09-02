#!/usr/bin/env node
// 按 tests/ux/ci-roster.mjs 真跑一遍清单里的走查。
//
// 串行而不是并行：每条各起一个真 Electron 实例，并行会互相抢 CPU/GPU，把耗时放大到
// 假超时（本机实测 load 52 时一条 providerAdapter 单测就会超时红，而单跑 58/58 绿）。
// CI runner 的核数更少，并行只会更糟。慢一点换来的是「红了就真是红」。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROSTER } from '../tests/ux/ci-roster.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PER_WALK_TIMEOUT_MS = 300_000

function runOne(file) {
  return new Promise((resolve) => {
    const started = Date.now()
    const child = spawn(process.execPath, [path.join('tests', 'ux', file)], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, PER_WALK_TIMEOUT_MS)
    child.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ file, code, signal, ms: Date.now() - started })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ file, code: 1, signal: null, ms: Date.now() - started, error: error.message })
    })
  })
}

const missing = ROSTER.filter((entry) => !fs.existsSync(path.join(repoRoot, 'tests', 'ux', entry.file)))
if (missing.length) {
  // 清单指向不存在的文件 = 清单本身腐烂了，正是这套机制要防的病。fail-closed。
  console.error('✖ CI 走查清单指向不存在的文件：')
  for (const entry of missing) console.error(`   ${entry.file}`)
  process.exit(1)
}

console.log(`▶ CI 走查清单：${ROSTER.length} 条（串行真跑）\n`)
const results = []
for (const entry of ROSTER) {
  console.log(`\n═══ ${entry.file} ═══`)
  results.push(await runOne(entry.file))
}

console.log('\n──────── 汇总 ────────')
for (const r of results) {
  const secs = (r.ms / 1000).toFixed(0)
  const verdict = r.code === 0 ? '✓' : r.signal === 'SIGKILL' ? `✗ 超时(${PER_WALK_TIMEOUT_MS / 1000}s)` : `✗ exit=${r.code}`
  console.log(`  ${verdict}  ${r.file}  ${secs}s`)
}

const failed = results.filter((r) => r.code !== 0)
if (failed.length) {
  console.error(`\n❌ ${failed.length}/${results.length} 条走查未通过`)
  console.error('   注意分辨：断言真红 vs 机器负载导致的超时。'
    + '判不准就在本地单跑那一条（并行 suite 能把耗时放大到假红）。')
  process.exit(1)
}
console.log(`\n✅ CI 走查清单全过：${results.length}/${results.length}`)
