#!/usr/bin/env node
// 门岗：自写登记表（P0「只写我们独有的」）。判据住在 scripts/self-written-lib.mjs，本文件只负责读盘与报红。
//
// 一句话：diff（merge-base..HEAD）里在 src/ 或 electron/ **新增**的代码文件，不在 domainRoots 里、
// 也没有被任何 entry 认领，就报。`enforceFrom` 之前只出警告，之后阻断合并（日期写在登记表里，由门岗读）。
//
// 另外：登记表自己的纪律（评估到期、新登记期限、最多续一次、to-replace 已替换要删）见 self-written-lib 的 validateRegistry / evaluateReviewDeadlines。
//
// 环境变量（给测试与特殊 CI 用）：
//   SELF_WRITTEN_BASE_REF   可信 base（缺省 merge-base(HEAD, origin/main)）
//   SELF_WRITTEN_TODAY      覆盖「今天」，验证警告期 / 阻断期用
//   SELF_WRITTEN_REPO_ROOT  覆盖仓库根（测试在临时 git 仓库里跑）
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { gitPaths } from './lib/gitPaths.mjs'
import { SELF_WRITTEN_FILE, evaluateSelfWritten, staticPrefixOf } from './self-written-lib.mjs'

const repoRoot = process.env.SELF_WRITTEN_REPO_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()

function resolveBase() {
  const explicit = process.env.SELF_WRITTEN_BASE_REF?.trim()
  if (explicit && !/^0+$/.test(explicit)) {
    try { git(['rev-parse', '--verify', `${explicit}^{commit}`]); return explicit } catch { /* 往下找 */ }
  }
  try { return git(['merge-base', 'HEAD', 'origin/main']) } catch { return null }
}

const registryPath = path.join(repoRoot, SELF_WRITTEN_FILE)
if (!fs.existsSync(registryPath)) {
  console.error(`✖ 自写登记表不存在：${SELF_WRITTEN_FILE}`)
  process.exit(1)
}
let registry
try {
  registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'))
} catch (error) {
  console.error(`✖ ${SELF_WRITTEN_FILE} 解析失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

const base = resolveBase()
let added = []
let baseNote = ''
let baseRegistry = null
let changedFiles = null
if (base) {
  // 走 gitPaths（加 -z、按 NUL 切）：git 默认会把中文路径转义成八进制串，按行读会漏判（check:git-path-quoting）
  const names = gitPaths(['diff', '--name-only', '--diff-filter=A', '-M', base, 'HEAD', '--', 'src', 'electron'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  added = names.map((file) => {
    let content = ''
    try { content = execFileSync('git', ['show', `HEAD:${file}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) } catch { /* 读不到当空文件 */ }
    return { path: file, content }
  })
  // 评估到期真拦：要 base 登记表（判延期 / 新登记）与这次改动碰过的全部文件（含修改、删除）
  try { baseRegistry = JSON.parse(execFileSync('git', ['show', `${base}:${SELF_WRITTEN_FILE}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })) } catch { baseRegistry = null }
  changedFiles = gitPaths(['diff', '--name-only', '--no-renames', base, 'HEAD'], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
} else {
  baseNote = '（拿不到可信 base，本次不判新增文件——不拿算不出来当通过；登记表形状仍然检查）'
}

const today = process.env.SELF_WRITTEN_TODAY || new Date().toISOString().slice(0, 10)
const exists = (file) => fs.existsSync(path.join(repoRoot, staticPrefixOf(file)))
const { errors, warnings, violations, enforcing } = evaluateSelfWritten({ registry, added, today, exists, baseRegistry, changedFiles })

for (const message of warnings) console.warn(`⚠️ [警告期，${registry.enforceFrom} 起阻断] ${message}`)
if (errors.length > 0) {
  console.error('✖ 自写登记门岗失败（P0：Nomi 自己写的只有领域本身）：')
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(`✅ 自写登记门岗：${registry.domainRoots.length} 个领域目录 · ${registry.entries.length} 项登记 · 新增代码文件 ${added.length} 个`
  + `（${violations.length} 个未认领，${enforcing ? '已进入阻断期' : `警告期至 ${registry.enforceFrom}`}）${baseNote}`)
