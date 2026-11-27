import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'
import { boardApprovalSubject } from '../../scripts/lib/coordApprovals.mjs'
import { assertBoardAnchor, readApprovedBoardHtml } from './_boardAnchorAssert.mjs'
import { uiText } from './full-walk/invariants.mjs'

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

const refundCopy = uiText('zh-CN', 'onboardingProviders.apimartConnect.fineprint.refundHeading')
const offer = (copy) => `<span data-board="refund" style="padding:10px">${copy}</span>`
const frames = [
  ['Main', 'zh-CN', 'light', refundCopy],
  ['M1-dark', 'zh-CN', 'dark', '暗色条款'],
  ['M1-en', 'en', 'light', 'Refund in 7 days'],
]
const board = locator(new JSDOM(frames.map(([id, , , copy]) => `<section id="${id}">${offer(copy)}</section>`).join('')).window.document)
const screen = (lang, theme, copy) => locator(new JSDOM(`<html lang="${lang}" data-mantine-color-scheme="${theme}"><body>${offer(copy)}</body></html>`).window.document)
const check = ([id, lang, theme], page) => assertBoardAnchor({
  frame: board.locator(`#${id}`), page, screen: page, lang, theme,
  element: { id: 'refund', anchor: '[data-board="refund"]' }, text: true, css: ['padding-top'], timeout: 50,
})

test('拍板退款天数改为 30 天内可退会被发现', async () => {
  await assert.rejects(check(frames[0], screen('zh-CN', 'light', '30 天内可退')), /30 天内可退/)
})
test('语言与主题分别从真窗读，两种错轨各自失败', async () => {
  await assert.rejects(check(frames[0], screen('en', 'light', refundCopy)), /zh-CN/)
  await assert.rejects(check(frames[0], screen('zh-CN', 'dark', refundCopy)), /light/)
})
test('拍板与真屏的 10px 一致即通过，改为 12px 会失败', async () => {
  const page = screen('zh-CN', 'light', refundCopy)
  await check(frames[0], page)
  page.locator('[data-board="refund"]').evaluate(el => { el.style.paddingTop = '12px' })
  await assert.rejects(check(frames[0], page), /12px/)
})
test('三个分镜复用元素 id，各自的文案与状态独立', async () => {
  for (const frame of frames) await check(frame, screen(...frame.slice(1)))
})
test('严格从已提交 Git 对象读取预期值（忽略工作树未提交篡改，基线缺失时判红）；保留清单 artboardFiles 且源图指纹独立触发确认', () => {
  const dir = makeTempDir('board-approved-')
  try {
    const file = path.join(dir, 'docs/design/boards/demo/preview/Demo.html')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '<html><head></head><body><button data-board="btn" style="font-weight:900">未提交篡改</button></body></html>')
    const baseHtml = '<html><head></head><body><button data-board="btn" style="font-weight:600">基线批准稿</button></body></html>'
    const headHtml = '<html><head></head><body><button data-board="btn" style="font-weight:500">本支新锚点已提交稿</button></body></html>'
    const fromBase = readApprovedBoardHtml(file, 'btn', {
      repoRoot: dir,
      git: (args) => (args[0] === 'merge-base' ? 'base-sha\n' : baseHtml),
    })
    assert.match(fromBase, /font-weight:600/)
    assert.doesNotMatch(fromBase, /font-weight:900/)
    const fromCommittedHead = readApprovedBoardHtml(file, 'btn', {
      repoRoot: dir,
      git: (args) => (args[0] === 'merge-base' ? 'base-sha\n' : args[1]?.startsWith('base-sha:') ? '<html><body>无锚点旧稿</body></html>' : headHtml),
    })
    assert.match(fromCommittedHead, /font-weight:500/)
    assert.doesNotMatch(fromCommittedHead, /font-weight:900/)
    assert.throws(() => readApprovedBoardHtml(file, 'btn', {
      repoRoot: dir,
      git: () => { throw new Error('shallow clone') },
    }), /shallow clone/)
    const unchangedManifest = {
      board: 'Demo',
      stage: 'built',
      artboardFiles: [{ artboard: 'Main', sha256: '111' }],
      elements: [{ id: 'btn', anchor: '[data-board="btn"]', status: 'implemented', states: ['empty'] }],
    }
    const blobChanged = boardApprovalSubject(
      'Demo',
      { ...unchangedManifest, __artboardBlobs: { 'preview/Demo.html': 'aaa' } },
      { ...unchangedManifest, __artboardBlobs: { 'preview/Demo.html': 'bbb' } },
    )
    assert.equal(blobChanged.needsApproval, true)
    assert.equal(blobChanged.artboardChanged, true)
    assert.equal(blobChanged.boardLevel, false)
    const manifestFieldChanged = boardApprovalSubject(
      'Demo',
      { ...unchangedManifest, __artboardBlobs: { 'preview/Demo.html': 'aaa' } },
      { ...unchangedManifest, artboardFiles: [{ artboard: 'Main', sha256: '222' }], __artboardBlobs: { 'preview/Demo.html': 'aaa' } },
    )
    assert.equal(manifestFieldChanged.needsApproval, true)
    assert.equal(manifestFieldChanged.boardLevel, true)
  } finally {
    cleanupTestTemp(dir)
  }
})
