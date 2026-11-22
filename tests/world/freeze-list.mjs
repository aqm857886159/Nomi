/* global process, console */
// 生成「还没迁」冻结名单（D-test-world-owner-only 批 1）：
//   1. 全量单测加记录模式跑一遍：NOMI_WORLD_LOCK_RECORD=<jsonl> pnpm exec vitest run
//   2. node tests/world/freeze-list.mjs <jsonl>          → 把两份名单写成记录里命中的文件
//      node tests/world/freeze-list.mjs <jsonl> --check  → 只对账，名单和记录不一致就退出 1
// 名单只许减：迁完一份就在对应 JSON 里删掉那一行（锁会在名单里的文件不再命中时让它红）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const [recordFile, flag] = process.argv.slice(2)
if (!recordFile) {
  console.error('用法：node tests/world/freeze-list.mjs <记录 jsonl> [--check]')
  process.exit(2)
}
const hits = { fsLock: new Set(), exportLock: new Set() }
for (const line of fs.readFileSync(recordFile, 'utf8').split('\n').filter(Boolean)) {
  const row = JSON.parse(line)
  hits[row.lock]?.add(row.file)
}
let drift = false
for (const lock of Object.keys(hits)) {
  const file = path.join(root, 'tests/world/not-yet-migrated', `${lock}.json`)
  const current = JSON.parse(fs.readFileSync(file, 'utf8'))
  const next = [...hits[lock]].sort()
  if (flag === '--check') {
    const a = JSON.stringify(current.files)
    const b = JSON.stringify(next)
    console.log(`${lock}: 名单 ${current.files.length} 条，记录 ${next.length} 条，${a === b ? '一致' : '不一致'}`)
    if (a !== b) drift = true
  } else {
    fs.writeFileSync(file, `${JSON.stringify({ ...current, files: next }, null, 2)}\n`)
    console.log(`${lock}: 写入 ${next.length} 条`)
  }
}
process.exit(drift ? 1 : 0)
