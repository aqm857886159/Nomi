// 设计实验室 · 写作区「选中文字 → AI 编辑」走查。零额度：纯本地渲染，模型一头是假桌面桥。
// 产出：`tests/ux/shots/design-lab-creation-ai-rewrite/<state>.png` + `_contact-sheet.png`。
// 其中 `rewrite-live-zh-light` 那一格由 Playwright 真选字、真点、真敲（见 expectRewriteState）。
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './design-lab/labStates.mjs'
import { walkDesignLabScreen } from './design-lab/walkScreen.mjs'
import { expectAbsent, proveProbe } from './_assert.mjs'
import { uiText } from './full-walk/invariants.mjs'

const OUT_DIR = path.join(REPO_ROOT, 'tests/ux/shots/design-lab-creation-ai-rewrite')
const TARGET_ZH = '她盯着纸条看了很久，才慢慢展开。'
const REWRITTEN_ZH = '慢慢展开纸条。'

function expect(record, condition, message) {
  if (!condition) record(message)
}

/** 真键鼠走一遍：选字 → 点 AI 编辑 → 点「缩短」→ 看结果 → Enter 接受 → Ctrl+Z 撤回 → 再来一次后 Esc 放弃。 */
async function liveJourney(page, record) {
  // 读文档本身（编辑器里的真文字），不读屏幕上的字：结果态屏幕上有叠着的新旧对比，会把原句从中间切开。
  const text = () => page.evaluate(() => document.querySelector('.workbench-editor__content').editor.state.doc.textBetween(0, document.querySelector('.workbench-editor__content').editor.state.doc.content.size, ' '))
  const shot = (name) => page.locator('[data-design-lab-shot]').screenshot({ path: path.join(OUT_DIR, `${name}.png`), animations: 'disabled' })
  const paragraph = page.locator('.workbench-editor__content p', { hasText: TARGET_ZH })
  // 选中这一段的全部文字（selectText：和拖选到底同一个选区；用键盘 End / Shift+Home 选，在改写条刚消失、版面还在挪动的瞬间会点偏，偶发选不上）。
  const selectParagraph = async () => {
    await paragraph.selectText()
    // 选区真的建好、浮条上的「AI 编辑」落定（连续三帧位置不动）再往下：条件等待，不是墙钟。
    await page.waitForFunction(() => {
      const editor = document.querySelector('.workbench-editor__content').editor
      return editor.state.selection.to > editor.state.selection.from
    })
    await page.waitForFunction(() => {
      const button = document.querySelector('.workbench-selection-popover__tool--ai')
      if (!button) return false
      const rect = button.getBoundingClientRect()
      const key = Math.round(rect.x) + ',' + Math.round(rect.y)
      const seen = window.__popoverSettle ?? { key: '', frames: 0 }
      window.__popoverSettle = seen.key === key ? { key, frames: seen.frames + 1 } : { key, frames: 0 }
      return window.__popoverSettle.frames >= 3
    }, null, { polling: 'raf' })
    await page.evaluate(() => { window.__popoverSettle = undefined })
  }

  // ① 选中：浮条上出现「AI 编辑」。
  await selectParagraph()
  await page.locator('.workbench-selection-popover__tool--ai').waitFor({ state: 'visible' })
  expect(record, await page.locator('.workbench-selection-popover [aria-label]').count() >= 4, '浮条上原有的加粗 / 斜体 / 标题等按钮被挤没了')
  await shot('live-01-selected')

  // ② 点 AI 编辑 → 输入框 + 常用改法 + 用户已有的写作 Skill。
  await page.locator('.workbench-selection-popover__tool--ai').click()
  const bar = page.locator('.workbench-ai-rewrite-bar')
  await bar.waitFor({ state: 'visible' })
  const chips = (await bar.locator('button').allInnerTexts()).map((value) => value.trim())
  for (const label of ['改写', '缩短', '扩写', '改语气', '翻译']) expect(record, chips.includes(label), `常用改法缺「${label}」：${chips.join('|')}`)
  expect(record, chips.some((value) => value.includes('Kasdan')), `用户的写作 Skill 没出现在常用改法后面：${chips.join('|')}`)
  expect(record, (await page.locator('.workbench-ai-rewrite-bar input').evaluate((node) => document.activeElement === node)), '打开后焦点没在输入框')
  await shot('live-02-menu')

  // ③ 点「缩短」→ 原文划线、新字标出来、段尾只有两个小图标。
  await bar.getByRole('button', { name: '缩短' }).click()
  await page.locator('[data-rewrite-status="result"]').waitFor()
  expect(record, await page.locator('.nomi-ai-rewrite-del').count() > 0, '结果态没有划线的删除部分')
  expect(record, (await page.locator('[data-rewrite-add]').allInnerTexts()).join('').length > 0, '结果态没有标出来的新增部分')
  expect(record, await page.locator('[data-rewrite-action]').count() === 2, '段尾应当只有 ✓ ✕ 两个小图标')
  expect(record, await page.locator('.workbench-ai-rewrite-bar input').inputValue() === '缩短', '输入框没有保留这一次的要求')
  expect(record, await page.locator('.workbench-ai-rewrite-bar [aria-label="用原要求重来"]').count() === 1, '输入框右端没有 ↻')
  expect(record, (await text()).includes(TARGET_ZH), '接受之前原文就被改了')
  await page.locator('[data-rewrite-action="accept"]').hover()
  expect(record, await page.locator('[data-rewrite-action="accept"]').getByText(/Enter/).isVisible(), '悬停 ✓ 没有「接受 Enter」提示')
  await shot('live-03-result')

  // ④ Enter 接受：正文换掉，Ctrl+Z 一步撤回。
  await page.keyboard.press('Enter')
  await page.locator('.workbench-ai-rewrite-bar').waitFor({ state: 'detached' })
  const accepted = await text()
  expect(record, accepted.includes(REWRITTEN_ZH) && !accepted.includes(TARGET_ZH), `Enter 之后正文没有被换成新的：${accepted}`)
  await shot('live-04-accepted')
  await page.locator('.workbench-editor__content').click()
  await page.keyboard.press('ControlOrMeta+z')
  const undone = await text()
  expect(record, undone.includes(TARGET_ZH) && !undone.includes(REWRITTEN_ZH), `Ctrl+Z 没有撤回到改写前：${undone}`)
  await shot('live-05-undone')

  // ⑤ 再来一次，结果出来后 Esc 放弃：原文不变。
  await selectParagraph()
  await page.locator('.workbench-selection-popover__tool--ai').click()
  await page.locator('.workbench-ai-rewrite-bar').getByRole('button', { name: '缩短' }).click()
  await page.locator('[data-rewrite-status="result"]').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.workbench-ai-rewrite-bar').waitFor({ state: 'detached' })
  const discarded = await text()
  expect(record, discarded.includes(TARGET_ZH) && !discarded.includes(REWRITTEN_ZH), `Esc 之后原文变了：${discarded}`)
  await shot('live-06-discarded')

  // ⑥ 改了要求再 Enter = 追加要求；输入框右端 ↻ = 用原要求重来。
  await selectParagraph()
  await page.locator('.workbench-selection-popover__tool--ai').click()
  await page.locator('.workbench-ai-rewrite-bar').getByRole('button', { name: '缩短' }).click()
  await page.locator('[data-rewrite-status="result"]').waitFor()
  const input = page.locator('.workbench-ai-rewrite-bar input')
  await input.fill('缩短，再冷一点')
  await page.keyboard.press('Enter')
  await page.locator('[data-rewrite-status="result"]').waitFor()
  expect(record, await input.inputValue() === '缩短，再冷一点', '追加要求之后输入框没有留着新的要求')
  await page.locator('.workbench-ai-rewrite-bar [aria-label="用原要求重来"]').click()
  await page.locator('[data-rewrite-status="result"]').waitFor()
  expect(record, (await text()).includes(TARGET_ZH), '↻ 重来的时候原文被动了')
  await page.keyboard.press('Escape')

  // ⑦ 切文稿：另一篇文稿的正文和这一篇一模一样（编辑器照旧复用、正文没变，文档本身不发任何事务）。
  //    真实下拉切过去：改写条必须消失、两篇文稿都没被改写、看得到「文稿已切换，这次改写没有写入」。
  //    守的是 WorkbenchEditor 里「换文稿 → 通知插件作废会话」那段接线：单测自己模拟切换，覆盖不到它（V-rewrite 第 2 轮 S3）。
  await page.evaluate(async () => {
    const { useWorkbenchStore } = await import('/src/workbench/workbenchStore.ts')
    const state = useWorkbenchStore.getState()
    const source = state.workbenchDocuments[0]
    window.__rewriteSwitchBefore = JSON.stringify(source.contentJson)
    useWorkbenchStore.setState({ workbenchDocuments: [source, { ...structuredClone(source), id: 'rewrite-draft-copy', title: 'rewrite copy' }] })
  })
  await selectParagraph()
  await page.locator('.workbench-selection-popover__tool--ai').click()
  await page.locator('.workbench-ai-rewrite-bar').getByRole('button', { name: '缩短' }).click()
  await page.locator('[data-rewrite-status="result"]').waitFor()
  // 「消失」类断言先证探针测得到东西：切之前改写条和 ✓ ✕ 确实在。
  // 提示只显示约 3 秒，机器忙时轮询可能错过：切之前先装一个观察器，只要这句话在页面上出现过就记下（出现过 = 真渲染出来过，和轮询快慢无关）。
  const notice = uiText('zh-CN', 'creationAi.rewrite.documentSwitched')
  await page.evaluate((text) => {
    window.__rewriteNoticeSeen = false
    const look = () => { if ([...document.querySelectorAll('[data-notification-reason]')].some((node) => (node.textContent ?? '').includes(text))) window.__rewriteNoticeSeen = true }
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true, characterData: true })
    look()
  }, notice)
  const barProof = await proveProbe(page.locator('.workbench-ai-rewrite-bar'), '切文稿之前改写条在')
  const actionsProof = await proveProbe(page.locator('[data-rewrite-action]'), '切文稿之前段尾的 ✓ ✕ 在')
  await page.locator('[data-creation-document-switcher]').click()
  await page.getByRole('menuitemradio', { name: 'rewrite copy', exact: true }).click()
  await page.locator('[data-creation-document-switcher]').filter({ hasText: 'rewrite copy' }).waitFor()
  await expectAbsent(page.locator('.workbench-ai-rewrite-bar'), { provenBy: barProof, message: '切到正文相同的另一篇文稿后，改写条还在（旧会话没有作废）' })
  await expectAbsent(page.locator('[data-rewrite-action]'), { provenBy: actionsProof, message: '切文稿后段尾的 ✓ ✕ 还在' })
  const toastShown = await page.waitForFunction(() => window.__rewriteNoticeSeen === true).then(() => true, () => false)
  expect(record, toastShown, '切文稿后没有看到「文稿已切换，这次改写没有写入」的提示')
  const unchanged = await page.evaluate(async () => {
    const { useWorkbenchStore } = await import('/src/workbench/workbenchStore.ts')
    return useWorkbenchStore.getState().workbenchDocuments.map((doc) => JSON.stringify(doc.contentJson) === window.__rewriteSwitchBefore)
  })
  expect(record, unchanged.length === 2 && unchanged.every(Boolean), `切文稿后有文稿被改写了：${JSON.stringify(unchanged)}`)
  await shot('live-07-switched')
}

fs.mkdirSync(OUT_DIR, { recursive: true })

/**
 * 选区浮条「拆成镜头」的位置与长相（样张 B，用户 2026-11-12 拍板；清单 SelectionStoryboard）。
 * 读的是浮条真 DOM 的从左到右顺序，不读截图：「放回生成组」「换回胶片」「AI 编辑不在时丢了分隔线」都会在这里红。
 */
async function expectSelectionBarState(page, state, record) {
  const layout = await page.evaluate(() => {
    const bar = document.querySelector('.workbench-selection-popover')
    if (!bar) return null
    const slot = (node) => {
      if (node.classList.contains('workbench-selection-popover__divider')) return 'divider'
      if (node.classList.contains('workbench-selection-popover__format-group')) return 'format'
      const cluster = node.getAttribute('data-selection-cluster')
      if (!cluster) return node.className
      const items = [...node.children].map((child) => (
        child.classList.contains('workbench-selection-popover__tool--ai') ? 'ai-edit' : child.getAttribute('data-selection-action') ?? '?'
      ))
      return `${cluster}[${items.join(',')}]`
    }
    const storyboard = bar.querySelector('[data-selection-action="storyboard"]')
    return {
      slots: [...bar.children].map(slot),
      storyboardIcon: storyboard?.querySelector('svg')?.getAttribute('class') ?? '',
      storyboardDisabled: storyboard ? storyboard.disabled : null,
      storyboardName: storyboard?.getAttribute('aria-label') ?? '',
      storyboardTitle: storyboard?.getAttribute('title') ?? '',
    }
  })
  if (!layout) {
    record(`${state.id} 选区浮条没出来`)
    return
  }
  const scene = state.id.includes('no-ai-edit') ? 'no-ai-edit' : state.id.includes('unavailable') ? 'unavailable' : 'ready'
  const besideAi = scene === 'no-ai-edit' ? 'beside-ai-edit[storyboard]' : 'beside-ai-edit[ai-edit,storyboard]'
  const expected = ['format', 'divider', besideAi, 'divider', 'generate[image,video]']
  // board:SelectionStoryboard/bar.shell board:SelectionStoryboard/bar.storyboard-beside-ai-edit board:SelectionStoryboard/bar.generate-pair
  expect(record, JSON.stringify(layout.slots) === JSON.stringify(expected), `${state.id} 浮条从左到右应是 ${expected.join(' | ')}，实际 ${layout.slots.join(' | ')}`)
  // board:SelectionStoryboard/bar.storyboard-icon
  expect(record, layout.storyboardIcon.includes('tabler-icon-layout-rows'), `${state.id} 「拆成镜头」图标不是分镜 IconLayoutRows：${layout.storyboardIcon}`)
  // board:SelectionStoryboard/bar.storyboard-name
  const name = uiText(state.id.includes('-en-') ? 'en' : 'zh-CN', 'creationAi.selection.storyboard')
  expect(record, layout.storyboardName === name && layout.storyboardTitle === name, `${state.id} 「拆成镜头」悬停名字不对：${layout.storyboardName} / ${layout.storyboardTitle}`)
  // board:SelectionStoryboard/bar.storyboard-unavailable
  expect(record, layout.storyboardDisabled === (scene === 'unavailable'), `${state.id} 「拆成镜头」置灰状态不对：disabled=${layout.storyboardDisabled}`)
  // board:SelectionStoryboard/bar.no-ai-edit
  if (scene === 'no-ai-edit') expect(record, !layout.slots.some((slot) => slot.includes('ai-edit,')), `${state.id} 没有 AI 编辑时浮条上还画着它`)
}

/**
 * 每一格的检查（walkDesignLabScreen 的逐格钩子）。注意：这和「控制文案动作词登记」里登记的 assertState 不是一件事——
 * 那些是各走查自己的逐格断言，这里也是；它们都只是传给走查框架的钩子，不写控制文案登记。所以不复用别人的函数，只用不同的名字声明。
 */
async function expectRewriteState(page, state, record) {
    if (state.id.startsWith('selbar-')) {
      await expectSelectionBarState(page, state, record)
      return
    }
    if (state.id === 'rewrite-live-zh-light') {
      await liveJourney(page, record)
      return
    }
    const status = state.id.split('-')[1]
    const has = (selector) => page.locator(selector).count()
    if (status === 'selected') expect(record, await has('.workbench-selection-popover__tool--ai') === 1, `${state.id} 浮条上没有 AI 编辑`)
    if (status === 'menu') {
      expect(record, await has('.workbench-ai-rewrite-bar input') === 1, `${state.id} 没有输入框`)
      expect(record, await has('.nomi-ai-rewrite-pending') > 0, `${state.id} 待改的字没有被标出来`)
      expect(record, await has('.workbench-ai-rewrite-bar .nomi-logo-mark') > 0, `${state.id} 输入框前没有 Nomi 标记`)
      expect(record, (await page.locator('.workbench-ai-rewrite-bar input').getAttribute('placeholder') ?? '').length > 0, `${state.id} 输入框占位文字不对`)
      expect(record, await has('.workbench-ai-rewrite-bar button[aria-label]') > 0, `${state.id} 菜单态没有发送钮`)
    }
    if (status === 'result') {
      expect(record, await has('.nomi-ai-rewrite-del') > 0 && await has('[data-rewrite-add]') > 0, `${state.id} 结果态没有新旧对比`)
      expect(record, await has('[data-rewrite-action]') === 2, `${state.id} 段尾应只有 ✓ ✕`)
    }
    if (status === 'accepted' || status === 'discarded') expect(record, await has('.workbench-ai-rewrite-bar') === 0 && await has('[data-rewrite-action]') === 0, `${state.id} 会话没有关干净`)
    if (status === 'failed') expect(record, await has('.workbench-ai-rewrite-bar [role="alert"]') === 1, `${state.id} 没有「没改成」提示`)
}

await walkDesignLabScreen({
  screen: 'creation-ai-rewrite',
  title: '写作区 AI 编辑 ',
  role: 'walk-creation-ai-rewrite',
  cellWidth: 760,
  columns: 2,
  assertState: expectRewriteState,
})
