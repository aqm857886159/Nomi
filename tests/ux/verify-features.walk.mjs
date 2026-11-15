// 功能地图全到走查（不进快检）：隔离起一只常驻驱动，把 verifyFeatures.mjs 里每个功能名各 `goto` 一遍，全到才绿。
// 它守的是「验证技能教给各线的那条路今天还走得通」：外壳一改、某个出口断了，这里先红，而不是哪条验收线现场卡住。
// 走的就是技能里写的命令（tests/ux/ui.mjs up / goto / down），用独立的 IPC 目录，不和本工作树里手动起的那只抢。
//
//   node tests/ux/verify-features.walk.mjs                     # 默认 1280×800 中文浅色
//   node tests/ux/verify-features.walk.mjs --locale en --theme dark --size 700x720
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FEATURES } from './verifyFeatures.mjs'

const UX = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(UX, 'ui.mjs')
const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-verify-features-'))
const env = { ...process.env, NOMI_UI_DIR: path.join(runDir, 'ipc') }
const out = path.join(runDir, 'evidence')
/** 带参数的功能走地图里的默认参数（design-lab 必须点名一屏）。 */
const ARGS = { 'design-lab': ['storyboard'] }

function ui(args) {
  const result = spawnSync(process.execPath, [CLIENT, ...args], { env, encoding: 'utf8', timeout: 300_000 })
  return { status: result.status, text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() }
}

const up = ui(['up', '--out', out, ...process.argv.slice(2)])
if (up.status === 125) {
  console.log(up.text)
  process.exit(125)
}
if (up.status !== 0) {
  console.error(`驱动没起来（退出码 ${up.status}）：\n${up.text}`)
  process.exit(1)
}
console.log(up.text.split('\n').filter((line) => line.startsWith('PROFILE') || line.startsWith('READY')).join('\n'))

const results = []
try {
  for (const name of Object.keys(FEATURES)) {
    const t0 = Date.now()
    const step = ui(['goto', name, ...(ARGS[name] ?? [])])
    const ok = step.status === 0 && !step.text.includes('"error"')
    results.push({ name, ok, ms: Date.now() - t0, text: step.text.split('\n')[0].slice(0, 240) })
    console.log(`${ok ? '✓' : '✗'} goto ${name} (${Date.now() - t0}ms) ${ok ? '' : step.text.slice(0, 300)}`)
  }
} finally {
  const down = ui(['down'])
  console.log(down.text)
}

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} 个功能名走到。证据：${out}`)
if (failed.length) {
  console.error(`没走到：${failed.map((entry) => entry.name).join(', ')}`)
  process.exit(1)
}
