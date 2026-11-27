import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { assertBoardAnchor } from './_boardAnchorAssert.mjs'

// Exercise the same DOM reads and Playwright polling as a walk, without a browser install in Contracts.
function locator(root) {
  return {
    locator(selector) {
      const matches = root.querySelectorAll(selector)
      assert.equal(matches.length, 1, selector)
      return locator(matches[0])
    },
    waitFor() { assert.ok(root.isConnected) },
    evaluate(read, argument) { return read(root, argument) },
  }
}

const offer = (copy) => `<span data-board="refund" style="padding:10px">${copy}</span>`
const frames = [
  ['Main', 'zh-CN', 'light', '7 天内可退'],
  ['M1-dark', 'zh-CN', 'dark', '暗色条款'],
  ['M1-en', 'en', 'light', 'Refund in 7 days'],
]
const board = locator(new JSDOM(frames.map(([id, , , copy]) => `<section id="${id}">${offer(copy)}</section>`).join('')).window.document)
const screen = (lang, theme, copy) => locator(new JSDOM(`<html lang="${lang}" data-mantine-color-scheme="${theme}"><body>${offer(copy)}</body></html>`).window.document)
const check = ([id, lang, theme], page) => assertBoardAnchor({
  frame: board.locator(`#${id}`), page, screen: page, lang, theme,
  element: { id: 'refund', anchor: '[data-board="refund"]' }, text: true, css: ['padding-top'], timeout: 50,
})

test('7 天内可退改为 30 天内可退会被发现', async () => {
  await assert.rejects(check(frames[0], screen('zh-CN', 'light', '30 天内可退')), /30 天内可退/)
})
test('语言与主题分别从真窗读，两种错轨各自失败', async () => {
  await assert.rejects(check(frames[0], screen('en', 'light', '7 天内可退')), /zh-CN/)
  await assert.rejects(check(frames[0], screen('zh-CN', 'dark', '7 天内可退')), /light/)
})
test('拍板与真屏的 10px 一致即通过，改为 12px 会失败', async () => {
  const page = screen('zh-CN', 'light', '7 天内可退')
  await check(frames[0], page)
  page.locator('[data-board="refund"]').evaluate(el => { el.style.paddingTop = '12px' })
  await assert.rejects(check(frames[0], page), /12px/)
})
test('三个分镜复用元素 id，各自的文案与状态独立', async () => {
  for (const frame of frames) await check(frame, screen(...frame.slice(1)))
})
