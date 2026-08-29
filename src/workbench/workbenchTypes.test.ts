import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchDocument, mintDocumentId } from './workbenchTypes'

// P2 多文档：WorkbenchDocument 加 id 身份 + 归一化兼容。这里锁住「id 生成」和「归一化保 id」两个不变量，
// 防止后续改动把文档身份丢掉（丢了会导致多文档侧栏切错、持久化错绑）。
describe('normalizeWorkbenchDocument — id 身份', () => {
  it('无 id 的文档归一化后补一个稳定 id', () => {
    const out = normalizeWorkbenchDocument({ version: 1, title: '稿', contentJson: { type: 'doc', content: [] }, updatedAt: 1 })
    expect(typeof out.id).toBe('string')
    expect(out.id.length).toBeGreaterThan(0)
  })

  it('已有 id 的文档归一化后保 id 不变', () => {
    const out = normalizeWorkbenchDocument({ id: 'doc-1', version: 1, title: '稿', contentJson: { type: 'doc', content: [] }, updatedAt: 1 })
    expect(out.id).toBe('doc-1')
  })

  it('非法输入回退默认文档，仍有 id', () => {
    const out = normalizeWorkbenchDocument(null)
    expect(typeof out.id).toBe('string')
    expect(out.version).toBe(1)
  })

  it('mintDocumentId 每次生成不同 id', () => {
    expect(mintDocumentId()).not.toBe(mintDocumentId())
  })
})
