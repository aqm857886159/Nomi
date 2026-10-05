// 逃逸账本（escapeLedger.json）的读写：走查发现「点了 ≠ 以为的」时立刻写进 candidate，人工复核后才转正式回归。
//
// 只追加、按 id 去重（同一个可点目标反复跑只留第一条，证据也不覆盖——复核的人看的是第一次抓到它的那一场）；
// 保持文件原有的紧凑写法（数组写一行），这样每次追加的 diff 只有新增那几行。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ESCAPE_LEDGER_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'escapeLedger.json')

const inline = (values) => `[${values.map((value) => JSON.stringify(value)).join(', ')}]`

function entryBlock(entry) {
  return [
    '    {',
    `      "id": ${JSON.stringify(entry.id)},`,
    `      "source": ${JSON.stringify(entry.source)},`,
    `      "category": ${JSON.stringify(entry.category)},`,
    `      "problem": ${JSON.stringify(entry.problem)},`,
    `      "existingInvariants": ${inline(entry.existingInvariants ?? [])},`,
    `      "ironLaws": ${inline(entry.ironLaws ?? [])},`,
    `      "useCases": ${inline(entry.useCases ?? [])},`,
    `      "fullWalkJourneys": ${inline(entry.fullWalkJourneys ?? [])},`,
    `      "status": ${JSON.stringify(entry.status ?? 'candidate')},`,
    `      "manualReview": ${JSON.stringify(entry.manualReview ?? 'pending')},`,
    `      "evidence": ${inline(entry.evidence ?? [])},`,
    `      "completionCommits": ${inline(entry.completionCommits ?? [])}`,
    '    }',
  ].join('\n')
}

/**
 * 追加 candidate；已有同 id 的不动。返回真正新加的 id。
 * @param {Array<object>} entries
 * @param {string} [file]
 */
export function appendEscapeCandidates(entries, file = ESCAPE_LEDGER_FILE) {
  const text = fs.readFileSync(file, 'utf8')
  const ledger = JSON.parse(text)
  const known = new Set(ledger.entries.map((entry) => entry.id))
  for (const entry of entries) {
    if (!ledger.categories[entry.category]) throw new Error(`逃逸账本没有类别 ${entry.category}（先在 categories 里登记）`)
  }
  const fresh = entries.filter((entry) => !known.has(entry.id))
  if (fresh.length === 0) return []
  const tail = text.lastIndexOf('    }\n  ]\n}')
  if (tail < 0) throw new Error('逃逸账本结尾不是预期的写法，没法只追加——先把文件格式化回原样')
  const next = `${text.slice(0, tail)}    },\n${fresh.map(entryBlock).join(',\n')}\n  ]\n}\n`
  JSON.parse(next)
  fs.writeFileSync(file, next)
  return fresh.map((entry) => entry.id)
}
