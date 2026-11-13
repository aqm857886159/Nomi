import { describe, expect, it } from 'vitest'
import { normalizeWorkbenchContentJson } from '../workbenchTypes'
import { sameDocumentContent } from './WorkbenchEditor'

// 编辑器挂载时的初始化不算编辑（复盘 docs/engineering/direction-checks/2026-11-13-open-writes-project.md）：
// 存的是 `content: []`，TipTap 挂上后发来「一段空段落」——两者是同一份空文稿，不能改文稿、改 updatedAt、让项目落盘。
describe('编辑器初始化不算编辑', () => {
  const stored = normalizeWorkbenchContentJson({ type: 'doc', content: [] })
  it('空文稿的两种写法相等', () => {
    expect(sameDocumentContent(stored, { type: 'doc', content: [{ type: 'paragraph' }] })).toBe(true)
    expect(sameDocumentContent(stored, { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null } }] })).toBe(true)
    expect(sameDocumentContent({ type: 'doc', content: [{ type: 'paragraph' }] }, { type: 'doc', content: [] })).toBe(true)
  })
  it('真的敲了字就不相等（照常落盘）', () => {
    expect(sameDocumentContent(stored, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] })).toBe(false)
    expect(sameDocumentContent(stored, { type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph' }] })).toBe(false)
    expect(sameDocumentContent(stored, { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] })).toBe(false)
  })
})
