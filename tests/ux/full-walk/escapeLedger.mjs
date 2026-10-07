// 逃逸账本（tests/ux/full-walk/escapeLedger/，一条一个文件）的追加：走查发现「点了 ≠ 以为的」时立刻写进 candidate，
// 人工复核后才转正式回归。
//
// 只追加、按 id 去重（同一个可点目标反复跑只留第一条，证据也不覆盖——复核的人看的是第一次抓到它的那一场）。
// 一条一个文件（2026-10-07）：新增 = 新建 `<id>.json`，并行的走查 / PR 各加各的，不再在同一个数组末尾相撞。
// 读账本、文件名规则、落盘写法都走 scripts/ 里的唯一实现，这里不另写一份。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { escapeEntryPath, loadEscapeLedger } from '../../../scripts/escape-ledger-lib.mjs'
import { formatEntryJson } from '../../../scripts/lib/entryDirectory.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

/** 新 candidate 的字段与顺序（和账本里已有条目一致）。 */
function candidateEntry(entry) {
  return {
    id: entry.id,
    since: entry.since ?? new Date().toISOString().slice(0, 10),
    source: entry.source,
    category: entry.category,
    problem: entry.problem,
    existingInvariants: entry.existingInvariants ?? [],
    ironLaws: entry.ironLaws ?? [],
    useCases: entry.useCases ?? [],
    fullWalkJourneys: entry.fullWalkJourneys ?? [],
    status: entry.status ?? 'candidate',
    manualReview: entry.manualReview ?? 'pending',
    evidence: entry.evidence ?? [],
    completionCommits: entry.completionCommits ?? [],
  }
}

/**
 * 追加 candidate；已有同 id 的不动。返回真正新加的 id。
 * 先把整批校验完（类别登记过、id 能当文件名）再落盘，不写半批进去。
 * @param {Array<object>} entries
 * @param {string} [repoRoot] 仓库根（测试传临时目录）
 */
export function appendEscapeCandidates(entries, repoRoot = REPO_ROOT) {
  const ledger = loadEscapeLedger(repoRoot)
  if (!ledger) throw new Error('逃逸账本目录不存在（tests/ux/full-walk/escapeLedger/）')
  const known = new Set(ledger.entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (!ledger.categories?.[entry.category]) throw new Error(`逃逸账本没有类别 ${entry.category}（先在 _meta.json 的 categories 里登记）`)
    escapeEntryPath(entry.id)
  }
  const fresh = []
  for (const entry of entries) {
    if (known.has(entry.id)) continue
    known.add(entry.id)
    fresh.push(candidateEntry(entry))
  }
  for (const entry of fresh) fs.writeFileSync(path.join(repoRoot, escapeEntryPath(entry.id)), formatEntryJson(entry))
  return fresh.map((entry) => entry.id)
}
