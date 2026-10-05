// 逃逸账本的追加：只加新的、同 id 不覆盖、类别必须登记过、文件仍是合法 JSON 且保持原有的紧凑写法。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { appendEscapeCandidates, ESCAPE_LEDGER_FILE } from './escapeLedger.mjs'

function copyLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-escape-ledger-'))
  const file = path.join(dir, 'escapeLedger.json')
  fs.copyFileSync(ESCAPE_LEDGER_FILE, file)
  return file
}

const candidate = (id) => ({ id, source: 'test', category: 'interaction-semantics', problem: '点了不是以为的', ironLaws: ['⑫'], useCases: ['S6'], evidence: ['shot.png'] })

describe('appendEscapeCandidates', () => {
  it('只追加新的 id；同一个 id 第二次不动，证据不被覆盖', () => {
    const file = copyLedger()
    const before = JSON.parse(fs.readFileSync(file, 'utf8')).entries.length
    expect(appendEscapeCandidates([candidate('LAW12-test-a')], file)).toEqual(['LAW12-test-a'])
    expect(appendEscapeCandidates([{ ...candidate('LAW12-test-a'), evidence: ['other.png'] }], file)).toEqual([])
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(ledger.entries).toHaveLength(before + 1)
    expect(ledger.entries.at(-1)).toMatchObject({ id: 'LAW12-test-a', status: 'candidate', manualReview: 'pending', evidence: ['shot.png'], completionCommits: [] })
    // 原有的紧凑写法（数组一行）保住：追加的 diff 只有新增那几行。
    expect(fs.readFileSync(file, 'utf8')).toContain('"statusValues": ["candidate", "reviewed", "fixed"]')
  })

  it('没登记的类别当场拒绝，不写半条进去', () => {
    const file = copyLedger()
    const text = fs.readFileSync(file, 'utf8')
    expect(() => appendEscapeCandidates([{ ...candidate('LAW12-test-b'), category: 'no-such-category' }], file)).toThrow(/没有类别/)
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
  })
})
