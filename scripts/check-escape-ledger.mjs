#!/usr/bin/env node
// 门岗：逃逸账本结账（P2「修根因」闭环）。判据住在 scripts/escape-ledger-lib.mjs，本文件只负责读盘与报红。
// 账本格式不合法 / fixed 条目缺根因合同、类级检查、PR 号 → 红；candidate 停留超过 14 天 → 警告（不阻断）。
//
// 环境变量（给测试用）：ESCAPE_LEDGER_REPO_ROOT 覆盖仓库根；ESCAPE_LEDGER_TODAY 覆盖「今天」。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { CANDIDATE_MAX_DAYS, ESCAPE_LEDGER_FILE, validateEscapeLedger } from './escape-ledger-lib.mjs'

const repoRoot = process.env.ESCAPE_LEDGER_REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const file = path.join(repoRoot, ESCAPE_LEDGER_FILE)
if (!fs.existsSync(file)) {
  console.error(`✖ 逃逸账本不存在：${ESCAPE_LEDGER_FILE}`)
  process.exit(1)
}
let ledger
try {
  ledger = JSON.parse(fs.readFileSync(file, 'utf8'))
} catch (error) {
  console.error(`✖ ${ESCAPE_LEDGER_FILE} 解析失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
const today = process.env.ESCAPE_LEDGER_TODAY || new Date().toISOString().slice(0, 10)
const { errors, warnings } = validateEscapeLedger(ledger, {
  today,
  exists: (rel) => fs.existsSync(path.join(repoRoot, rel)),
  read: (rel) => { try { return fs.readFileSync(path.join(repoRoot, rel), 'utf8') } catch { return '' } },
})
for (const message of warnings) console.warn(`⚠️ ${message}`)
if (errors.length > 0) {
  console.error('✖ 逃逸账本门岗失败（P2：用户发现的问题结账必须挂结构性预防，只修现场不算修好）：')
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
const count = (status) => ledger.entries.filter((entry) => entry.status === status).length
console.log(`✅ 逃逸账本门岗：${ledger.entries.length} 条（candidate ${count('candidate')} / reviewed ${count('reviewed')} / fixed ${count('fixed')}）`
  + `；candidate 超 ${CANDIDATE_MAX_DAYS} 天警告 ${warnings.length} 条`)
