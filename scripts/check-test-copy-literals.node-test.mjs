// 测试抄文案门岗的自测：先证明会红，再证明不误报，再证明棘轮只减不增。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCopyIndex, isSentence, regressionsAgainst, scanSource, tightenBaseline } from './check-test-copy-literals.mjs'

const index = buildCopyIndex([
  ['', { project: { createBlank: '新建空白项目', saved: 'Saved · Not verified yet', count: '将生成 {{count}} 段文本，放进画布' } }],
  ['desktop:', { 'outbound.blocked': '这次生成**没有发出去**：{{host}} 被拦下' }],
])

test('会红：断言值、定位器名字、正则备选、模板静态段、主进程文案', () => {
  const source = [
    "expect(label).toBe('新建空白项目')",
    'await page.getByRole("button", { name: "Saved · Not verified yet" }).click()',
    'expect(text).toMatch(/旧说法|新建空白项目/)',
    'const line = `将生成 ${count} 段文本，放进画布`',
    "expect(text).toContain('这次生成没有发出去：')",
  ].join('\n')
  const hits = scanSource(source, index)
  assert.deepEqual(hits.map((hit) => [hit.line, hit.key]), [
    [1, 'project.createBlank'],
    [2, 'project.saved'],
    [3, 'project.createBlank'],
    [4, 'project.count'],
    [5, 'desktop:outbound.blocked'],
  ])
})

test('不误报：按键取值、describe / it 标题、注释、短词、不在词典里的句子', () => {
  const source = [
    "expect(label).toBe(uiText('zh-CN', 'project.createBlank'))",
    "describe('新建空白项目', () => {",
    "  it('新建空白项目', () => {})",
    "  test.each([1])('新建空白项目', () => {})",
    "// expect(label).toBe('新建空白项目')",
    "expect(x).toBe('设置')",
    "expect(x).toBe('这一句词典里没有')",
  ].join('\n')
  assert.deepEqual(scanSource(source, index), [])
})

test('够长才算一句文案', () => {
  assert.equal(isSentence('新建空白项目'), true)
  assert.equal(isSentence('设置'), false)
  assert.equal(isSentence('Generate this one'), true)
  assert.equal(isSentence('Settings'), false)
})

test('棘轮：变多、新文件都红；持平、变少不红', () => {
  const baseline = { 'a.test.ts': 2, 'b.test.ts': 1 }
  assert.deepEqual(regressionsAgainst(new Map([['a.test.ts', 2], ['b.test.ts', 0]]), baseline), [])
  assert.deepEqual(regressionsAgainst(new Map([['a.test.ts', 3]]), baseline).map((entry) => entry.file), ['a.test.ts'])
  assert.deepEqual(regressionsAgainst(new Map([['c.walk.mjs', 1]]), baseline).map((entry) => [entry.file, entry.allowed]), [['c.walk.mjs', 0]])
})

test('收紧基线只减不增：有文件变多就拒绝，降到 0 的条目清掉', () => {
  const baseline = { 'a.test.ts': 2, 'b.test.ts': 1 }
  assert.equal(tightenBaseline(new Map([['a.test.ts', 3]]), baseline).ok, false)
  assert.deepEqual(tightenBaseline(new Map([['a.test.ts', 1]]), baseline), { ok: true, next: { 'a.test.ts': 1 } })
})
