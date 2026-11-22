// 写作区「选中文字 → AI 编辑 → 就地出结果」整机闭环的步骤本体（真付费走查与 loopback 演练共用一份，不抄第二份）。
//
// 流程（全是真键鼠，走的是真 Electron、真 IPC、真文本任务流）：
//   开项目（文稿）→ 敲三句 → 选中第二句 → 点浮条上的「AI 编辑」→ 点「缩短」→ 等模型回 → 就地出新旧对比 →
//   Enter 接受（正文换成新的）→ Ctrl+Z 撤回（回到改写前）。
// 每一步只读界面上看得见的东西和文稿本身的字，不读内部状态。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { DOCUMENT } from './agent-runtime-walk-support.mjs'

export const REWRITE_DOC_LINES = [
  '△ 林薇回到家，没开大灯。台灯下，她撬开怀表后盖，抽出一张折成四折的纸条。',
  '她盯着纸条看了很久，才慢慢展开，像是怕它在手里碎掉，又像是怕自己看清上面写的是什么。',
  '△ 纸上的字被潮气洇开，只认得出一个“沉”字。',
]
export const REWRITE_TARGET = REWRITE_DOC_LINES[1]

const BAR = '.workbench-ai-rewrite-bar'
const RESULT = '[data-rewrite-status="result"]'

/** 文稿里现在的字（编辑器文档本身的字，按段用换行连起来；不读屏幕：结果态屏幕上叠着新旧对比，会把原句从中间切开）。 */
async function documentText(win) {
  return win.evaluate(() => {
    const editor = document.querySelector('.workbench-creation .ProseMirror').editor
    return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
  })
}

/**
 * @param {{ win: import('playwright').Page, snap: (label: string) => Promise<string>, resultTimeout?: number }} ctx
 * @returns 报告里记的事实（不含任何 key）
 */
export async function runCreationAiRewriteJourney({ win, snap, resultTimeout = stationTimeout({ turns: 1 }) }) {
  const facts = {}
  // ① 写三句（真键盘），选中第二句。
  await clickOrFail(win.locator(DOCUMENT), '文稿编辑区')
  await win.keyboard.type(REWRITE_DOC_LINES.join('\n'))
  await expect.poll(() => documentText(win), { message: '三句都写进了文稿' }).toBe(REWRITE_DOC_LINES.join('\n'))
  // 选中第二段：Playwright 的 selectText 选中这一段元素里的全部文字（和用户在这一段上拖选到底同一个选区，不依赖换行 / 折行的键盘行为）。
  await win.locator(DOCUMENT).locator('p').nth(1).selectText()
  // 选区要正好是第二段：取浏览器里的选中文字核对（读的是屏幕上的真选区）。
  const selected = await win.evaluate(() => String(window.getSelection() ?? ''))
  facts.selectedText = selected
  expect(selected.replace(/\s+/g, ''), '选中的是第二句').toContain(REWRITE_TARGET.replace(/\s+/g, '').slice(0, 20))
  await snap('rewrite-01-selected')

  // ② 浮条上的「AI 编辑」。
  const aiButton = win.locator('.workbench-selection-popover__tool--ai')
  await expect(aiButton, '选区浮条上有「AI 编辑」').toBeVisible()
  await clickOrFail(aiButton, '浮条上的「AI 编辑」')
  const bar = win.locator(BAR)
  await expect(bar, 'AI 编辑条出现').toBeVisible()
  const barProof = await proveProbe(bar, 'AI 编辑条在文稿里出现过')
  await expect(bar.locator('input'), '输入框在').toBeVisible()
  await snap('rewrite-02-menu')

  // ③ 点「缩短」→ 等模型回（真模型这里要几秒到几十秒）。
  await clickOrFail(bar.getByRole('button', { name: '缩短', exact: true }), '常用改法「缩短」')
  await expect(win.locator(RESULT), '模型回来后就地出结果（不是「没改成」）').toBeVisible({ timeout: resultTimeout })
  facts.originalUnchangedBeforeAccept = (await documentText(win)).includes(REWRITE_TARGET)
  expect(facts.originalUnchangedBeforeAccept, '接受之前原文一个字没动').toBe(true)
  await expect(win.locator('.nomi-ai-rewrite-del').first(), '结果里有划线的删除部分').toBeVisible()
  expect(await win.locator('[data-rewrite-action]').count(), '段尾只有 ✓ ✕').toBe(2)
  await snap('rewrite-03-result')

  // ④ Enter 接受：这一段换成新的，其余两句不动。
  await win.keyboard.press('Enter')
  await expectAbsent(win.locator(BAR), { provenBy: barProof, message: '接受后条消失' })
  const accepted = await documentText(win)
  facts.acceptedText = accepted
  const lines = accepted.split('\n')
  expect(lines, '接受后仍是三段').toHaveLength(3)
  expect(lines[0], '第一句没动').toBe(REWRITE_DOC_LINES[0])
  expect(lines[2], '第三句没动').toBe(REWRITE_DOC_LINES[2])
  expect(lines[1].length, '第二句换成了新的非空文字').toBeGreaterThan(0)
  expect(lines[1], '第二句确实变了').not.toBe(REWRITE_TARGET)
  await snap('rewrite-04-accepted')

  // ⑤ Ctrl+Z：一步回到改写前。
  await win.locator(DOCUMENT).click({ position: { x: 4, y: 4 } })
  await win.keyboard.press('Control+z')
  await expect.poll(() => documentText(win), { message: 'Ctrl+Z 一步撤回到改写前' }).toBe(REWRITE_DOC_LINES.join('\n'))
  await snap('rewrite-05-undone')
  facts.undoRestoredOriginal = true
  return facts
}
