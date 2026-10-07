#!/usr/bin/env node
// 一次性迁移（2026-10-07，PR「两本账本改成一条一个文件」）：本文件只在一个提交里存在，下一个提交就删掉，
// main 上不留读旧大文件的代码（P1）。在途分支要用它时按提交号取出来跑（命令见那个 PR 的正文）。
//
// 两种用法（都在仓库根跑）：
//   node <本脚本>              整体迁移：把工作树里的两个大文件拆成目录，删掉大文件（目录必须还不存在）
//   node <本脚本> --catchup    合并途中（git merge 停在「一边删了大文件、一边改了大文件」的冲突上）：
//                              只把「还留着大文件的那一边」相对 merge-base 的新增 / 改动 / 删除搬进目录，
//                              再把大文件从工作树和暂存区删掉；同一条两边都改了就停下点名，不覆盖。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href)
const { META_FILE, formatEntryJson } = await load('scripts/lib/entryDirectory.mjs')
const { ESCAPE_LEDGER_DIR, escapeEntryPath } = await load('scripts/escape-ledger-lib.mjs')
const { CONCEPT_OWNERS_DIR, conceptFileName } = await load('scripts/concept-registry-lib.mjs')

const LEDGERS = [
  { old: 'tests/ux/full-walk/escapeLedger.json', dir: ESCAPE_LEDGER_DIR, list: 'entries', key: (record) => record.id, file: (record) => path.posix.basename(escapeEntryPath(record.id)) },
  { old: 'docs/engineering/concept-owners.json', dir: CONCEPT_OWNERS_DIR, list: 'concepts', key: (record) => record.subject, file: (record) => conceptFileName(record.subject) },
]

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return result.status === 0 ? result.stdout : null
}

const showJson = (ref, rel) => {
  const text = git(['show', `${ref}:${rel}`])
  return text === null ? null : JSON.parse(text)
}

function split(document, ledger) {
  const { [ledger.list]: records, ...meta } = document
  if (!Array.isArray(records)) throw new Error(`${ledger.old} 里没有 ${ledger.list} 数组`)
  const byKey = new Map()
  for (const record of records) {
    const key = ledger.key(record)
    if (byKey.has(key)) throw new Error(`${ledger.old}：${key} 出现两次，拆不成一条一个文件`)
    byKey.set(key, record)
  }
  return { meta, byKey }
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

function readCurrent(absFile) {
  try { return JSON.parse(fs.readFileSync(absFile, 'utf8')) } catch { return undefined }
}

/** 把 side 相对 base 的变化写进目录；目录里同一条已被另一边改过（≠ base）就记冲突、不覆盖。 */
function apply(ledger, base, side) {
  const dirAbs = path.join(root, ledger.dir)
  fs.mkdirSync(dirAbs, { recursive: true })
  const conflicts = []
  const written = []
  const removed = []
  const put = (name, baseValue, sideValue) => {
    const absFile = path.join(dirAbs, name)
    const current = readCurrent(absFile)
    if (current !== undefined && !same(current, baseValue ?? undefined) && !same(current, sideValue)) {
      conflicts.push(`${ledger.dir}/${name}`)
      return
    }
    fs.writeFileSync(absFile, formatEntryJson(sideValue))
    written.push(name)
  }
  if (!same(base.meta, side.meta)) put(META_FILE, base.meta, side.meta)
  for (const [key, record] of side.byKey) {
    const before = base.byKey.get(key)
    if (!same(before, record)) put(ledger.file(record), before, record)
  }
  for (const [key, record] of base.byKey) {
    if (side.byKey.has(key)) continue
    const absFile = path.join(dirAbs, ledger.file(record))
    const current = readCurrent(absFile)
    if (current !== undefined && !same(current, record)) { conflicts.push(`${ledger.dir}/${ledger.file(record)}（这边删了、另一边改了）`); continue }
    fs.rmSync(absFile, { force: true })
    removed.push(ledger.file(record))
  }
  return { conflicts, written, removed }
}

const empty = { meta: undefined, byKey: new Map() }
const catchup = process.argv.includes('--catchup')
let mergeBase = null
let sides = null
if (catchup) {
  const mergeHead = git(['rev-parse', '-q', '--verify', 'MERGE_HEAD'])?.trim()
  if (!mergeHead) { console.error('✖ --catchup 只在 git merge 停在冲突上时用（没找到 MERGE_HEAD）'); process.exit(2) }
  mergeBase = git(['merge-base', 'HEAD', mergeHead])?.trim()
  sides = ['HEAD', mergeHead]
}

let failed = false
for (const ledger of LEDGERS) {
  let base = empty
  let side
  if (catchup) {
    const holder = sides.find((ref) => git(['cat-file', '-e', `${ref}:${ledger.old}`]) !== null)
    if (!holder) { console.log(`· ${ledger.old}：两边都没有了，跳过`); continue }
    const baseDocument = mergeBase ? showJson(mergeBase, ledger.old) : null
    base = baseDocument ? split(baseDocument, ledger) : empty
    side = split(showJson(holder, ledger.old), ledger)
  } else {
    const oldAbs = path.join(root, ledger.old)
    if (!fs.existsSync(oldAbs)) { console.log(`· ${ledger.old} 不存在，跳过`); continue }
    if (fs.existsSync(path.join(root, ledger.dir))) { console.error(`✖ ${ledger.dir} 已经存在——整体迁移只跑一次；合并途中补搬用 --catchup`); failed = true; continue }
    side = split(JSON.parse(fs.readFileSync(oldAbs, 'utf8')), ledger)
  }
  const { conflicts, written, removed } = apply(ledger, base, side)
  console.log(`· ${ledger.old} → ${ledger.dir}/：写 ${written.length} 个文件，删 ${removed.length} 个`)
  if (conflicts.length) {
    failed = true
    console.error(`✖ 两边都改了同一条，没覆盖，手工合：${conflicts.join('、')}`)
    continue
  }
  fs.rmSync(path.join(root, ledger.old), { force: true })
  git(['rm', '-q', '--cached', '--ignore-unmatch', '--', ledger.old])
  git(['add', '--', ledger.dir])
}
process.exitCode = failed ? 1 : 0
