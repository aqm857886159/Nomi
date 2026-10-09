import { makeTempDir } from '../../../scripts/_test-temp.mjs'
// 逃逸账本的追加：只加新的、同 id 不覆盖、类别必须登记过、id 必须能当文件名；一条一个文件（新增不碰别的条目）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { ESCAPE_LEDGER_DIR, loadEscapeLedger } from '../../../scripts/escape-ledger-lib.mjs'
import { appendEscapeCandidates } from './escapeLedger.mjs'

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..')

/** 临时仓库根：把真实账本目录整个拷过去。 */
function copyLedger() {
  const root = makeTempDir('nomi-escape-ledger-')
  fs.cpSync(path.join(REPO_ROOT, ESCAPE_LEDGER_DIR), path.join(root, ESCAPE_LEDGER_DIR), { recursive: true })
  return root
}

const snapshot = (root) => Object.fromEntries(fs.readdirSync(path.join(root, ESCAPE_LEDGER_DIR)).map((name) => [name, fs.readFileSync(path.join(root, ESCAPE_LEDGER_DIR, name), 'utf8')]))

const candidate = (id) => ({ id, source: 'test', category: 'interaction-semantics', problem: '点了不是以为的', ironLaws: ['⑫'], useCases: ['S6'], evidence: ['shot.png'] })

describe('appendEscapeCandidates', () => {
  it('只追加新的 id；同一个 id 第二次不动，证据不被覆盖；已有条目的文件一个字节都不动', () => {
    const root = copyLedger()
    const before = snapshot(root)
    expect(appendEscapeCandidates([candidate('LAW12-test-a')], root)).toEqual(['LAW12-test-a'])
    expect(appendEscapeCandidates([{ ...candidate('LAW12-test-a'), evidence: ['other.png'] }], root)).toEqual([])
    const after = snapshot(root)
    expect(Object.keys(after)).toHaveLength(Object.keys(before).length + 1)
    for (const [name, text] of Object.entries(before)) expect(after[name]).toBe(text)
    const ledger = loadEscapeLedger(root)
    const added = ledger.entries.find((entry) => entry.id === 'LAW12-test-a')
    expect(added).toMatchObject({ id: 'LAW12-test-a', status: 'candidate', manualReview: 'pending', evidence: ['shot.png'], completionCommits: [] })
    expect(added.since).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('没登记的类别、不能当文件名的 id 当场拒绝，不写半批进去', () => {
    const root = copyLedger()
    const before = snapshot(root)
    expect(() => appendEscapeCandidates([candidate('LAW12-test-b'), { ...candidate('LAW12-test-c'), category: 'no-such-category' }], root)).toThrow(/没有类别/)
    expect(() => appendEscapeCandidates([candidate('LAW12-test-d'), candidate('LAW12/../evil')], root)).toThrow(/只许字母数字开头/)
    expect(snapshot(root)).toEqual(before)
  })
})
