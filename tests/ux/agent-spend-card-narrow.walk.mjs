#!/usr/bin/env node
// 真实用户任务（D2 第③步，NodePointer 板 A4 在真 App 里）：**窄窗口里，对话浮在画布上、把画布盖住大半，点付费卡上的指向元素。**
//
// 最小窗（electron/mainWindowMinSize.json，现 700×720），用户把对话浮窗从左上角那个改大小的角拉大、盖住画布大半，再点卡上的第 2 镜：
//   · board:NodePointer/pointer.narrow.collapse —— 对话收成右下的小球，画布露出来，那个节点闪一下、就在眼前；
//   · board:NodePointer/pointer.narrow.back —— 画布那一格底部正中出现「回到对话」（压在加节点条上面）；按 Esc 或点它，
//     对话原样回来（还是那么大的浮窗），焦点落回刚点的那一项，它标着「已定位」。
// 卡上三格在三种宽下都分得清（用户 10-25 圈出的两处实现缺陷）：默认浮窗（一格约 108px）、最窄浮窗（≤320，窄面板）、
// 拉大的浮窗——三个标题**看得见的字**互不相同（共用一长截开头时截中间）；「已定位」和那一格露着的「不生成 ×」两个包围盒不相交，
// 小钮也不压标题。
// 反例：
//   · 同一个最小窗、默认大小的浮窗只占一角：点指向元素，对话不收、不出「回到对话」，画布照样定位过去（A3 的样子）；
//   · 收成小球以后用户点小球把对话叫回来（没经「回到对话」）：「回到对话」跟着没了；之后用面板头上的「收起」再收成小球，
//     不会冒出一颗指着旧镜头的「回到对话」。
// 中文 · 浅色一轮，英文 · 暗色一轮（截图两轨）。只有远端供应商是 loopback 夹具（零额度）；这条走查一笔都不发（最后取消卡）。
import { clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { MIN_WINDOW } from './_minWindow.mjs'
import { AGENT_PANEL, CANVAS_ADD_BAR, COLLAPSE_BUTTON } from './_shell.mjs'
import {
  CARD_BODY, POINTER, armCanvasBridges, canvasHighlightOf, canvasNode, cardTitle, createPresenter, pointerAway, pointerFace,
  pointerOf, say, seenHighlights, shotNodes, watchCanvasHighlights,
} from './_spendCardWalk.mjs'
import { COLLAPSED_DOCK, closeSpendCard, createRuntimeWalk, expandResidentPanel, openCanvas, recorded } from './agent-runtime-walk-support.mjs'

const IMAGE = { providerId: 'apimart', modelId: 'gpt-image-2' }
const A = {
  collapse: 'board:NodePointer/pointer.narrow.collapse',
  back: 'board:NodePointer/pointer.narrow.back',
  located: 'board:NodePointer/pointer.located',
  exclude: 'board:SpendCardQ1/card.pointer.exclude',
  label: 'board:NodePointer/pointer.label',
}
/** 画布那一格（小球、浮窗、加节点条、「回到对话」都在这一格的坐标里）。 */
const CANVAS_CELL = '.workbench-generation__canvas'
const STAGE = '.generation-canvas-v2__stage'
const FLOAT = '[data-agent-float="generation"]'
const RETURN_PILL = '[data-node-pointer-return-dock="generation"] [data-node-pointer-return]'
/** 「回到对话」和正下方那块停靠区之间留的缝（NodePointerReturnDock 的 RETURN_DOCK_CLEARANCE）。 */
const CLEARANCE = 12

const present = createPresenter('S_NARROW')

const rectOf = (win, selector) => win.evaluate((sel) => {
  const rect = document.querySelector(sel)?.getBoundingClientRect()
  return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null
}, selector)

/** 浮窗盖掉画布多少（和 revealNodeFromChat 的 agentCoversCanvas 同一个量法的前一半：重叠面积 / 画布面积）。 */
async function floatCoverage(win) {
  const stage = await rectOf(win, STAGE)
  const float = await rectOf(win, FLOAT)
  if (!stage || !float) return 0
  const width = Math.max(0, Math.min(stage.right, float.right) - Math.max(stage.left, float.left))
  const height = Math.max(0, Math.min(stage.bottom, float.bottom) - Math.max(stage.top, float.top))
  return (width * height) / (stage.width * stage.height)
}

/** 像用户一样把浮窗拉大：按住左上角那个改大小的角（react-rnd 的 topLeft 把手），拖到画布左上角附近。 */
async function enlargeFloat(win, label) {
  const handle = await win.evaluate((floatSelector) => {
    const section = document.querySelector(floatSelector)
    const root = section?.parentElement
    const corner = [...(root?.querySelectorAll('div') ?? [])].find((element) => element.style.cursor === 'nw-resize')
    const rect = corner?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  }, FLOAT)
  if (!handle) throw new Error(`${label}：浮窗左上角没有改大小的把手`)
  const stage = await rectOf(win, STAGE)
  await win.mouse.move(handle.x, handle.y)
  await win.mouse.down()
  await win.mouse.move(stage.left + 40, stage.top + 24, { steps: 16 })
  await win.mouse.up()
  await expect.poll(() => floatCoverage(win), { message: `${label}：拉大之后浮窗盖住画布大半`, timeout: stationTimeout() }).toBeGreaterThanOrEqual(0.5)
  return rectOf(win, FLOAT)
}

/** 像用户一样把浮窗拉到最窄：按住左上角那个改大小的角往右拖过头（react-rnd 停在最小宽 320）。此时面板是窄面板（≤320）。 */
async function shrinkFloat(win, label) {
  const handle = await win.evaluate((floatSelector) => {
    const section = document.querySelector(floatSelector)
    const corner = [...(section?.parentElement?.querySelectorAll('div') ?? [])].find((element) => element.style.cursor === 'nw-resize')
    const rect = corner?.getBoundingClientRect()
    return rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null
  }, FLOAT)
  if (!handle) throw new Error(`${label}：浮窗左上角没有改大小的把手`)
  const float = await rectOf(win, FLOAT)
  await win.mouse.move(handle.x, handle.y)
  await win.mouse.down()
  await win.mouse.move(handle.x + float.width, handle.y + 40, { steps: 12 })
  await win.mouse.up()
  await expect.poll(async () => (await rectOf(win, FLOAT))?.width ?? 0, { message: `${label}：浮窗缩到最窄`, timeout: stationTimeout() }).toBeLessThanOrEqual(322)
  return rectOf(win, FLOAT)
}

/**
 * 卡上每一格标题此刻**看得见**的字：被截掉的不算、被露着的小钮盖住的不算，截了的那一截补一个「…」。
 * 「看得见」按每个字自己的方框量（Range），省略号占的那一截按同一字体量出来再扣掉——和人眼看到的差不过一个字，
 * 分不分得清三格足够。
 */
const visibleTitles = (card) => card.evaluate((root) => {
  const opacityOf = (element, stop) => {
    let value = 1
    for (let node = element; node && node !== stop; node = node.parentElement) value *= Number(getComputedStyle(node).opacity)
    return value
  }
  const toggles = [...root.querySelectorAll('[data-spend-exclusion]')].filter((element) => opacityOf(element, root) > 0.01).map((element) => element.getBoundingClientRect())
  const context = document.createElement('canvas').getContext('2d')
  const range = document.createRange()
  return [...root.querySelectorAll('[data-v4-block="spend-body"] [data-node-pointer] [data-node-pointer-title]')].map((title) => {
    let text = ''
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const host = node.parentElement
      const clip = host.getBoundingClientRect()
      const cut = host.scrollWidth > host.clientWidth + 0.5
      context.font = getComputedStyle(host).font
      const ellipsis = cut ? context.measureText('…').width : 0
      let offset = 0
      for (const char of Array.from(node.textContent ?? '')) {
        range.setStart(node, offset)
        range.setEnd(node, offset + char.length)
        offset += char.length
        const box = range.getBoundingClientRect()
        const covered = toggles.some((toggle) => box.left < toggle.right && box.right > toggle.left && box.top < toggle.bottom && box.bottom > toggle.top)
        if (box.width > 0 && box.left >= clip.left - 0.5 && box.right <= clip.right - ellipsis + 0.5 && !covered) text += char
      }
      if (cut && clip.width >= ellipsis) text += '…'
    }
    const pointer = title.closest('[data-node-pointer]')
    return {
      id: pointer?.getAttribute('data-node-pointer-id') ?? null,
      text: text.trim(),
      hover: title.closest('[title]')?.getAttribute('title') ?? '',
      aria: pointer?.getAttribute('aria-label') ?? '',
    }
  })
})

/** 三格标题看得见的字互不相同；全名还在悬停提示和读屏名里。 */
async function expectTitlesTellable(card, label) {
  const titles = await visibleTitles(card)
  expect(titles.length, `${A.label}：${label}，卡上三格都有标题`).toBe(3)
  const texts = titles.map((title) => title.text)
  expect(new Set(texts).size, `${A.label}：${label}，三个标题看得见的字互不相同 ${JSON.stringify(texts)}`).toBe(3)
  for (const title of titles) {
    expect(title.text.replace('…', '').length, `${A.label}：${label}，每格至少露几个字 ${JSON.stringify(texts)}`).toBeGreaterThan(1)
    expect(title.hover.length > 0 && title.aria.includes(title.hover), `${A.label}：${label}，全名在悬停提示和读屏名里 ${JSON.stringify(title)}`).toBe(true)
  }
  return texts
}

/**
 * 那一格标着「已定位」、小钮此刻露着：两个包围盒不相交，小钮也不压标题。
 * 小钮量**看得见的那一块**：「不生成 ×」是 28px 透明点击区里一颗 16px 圆点（共用 ThumbCornerX，和参考图的 × 同一件），
 * 压不压胶囊 / 标题要看圆点；透明的点击区本来就伸到框外 10px，量它会把「看不见的边」当成压住。
 */
async function expectLocatedClear(card, nodeId, label) {
  const read = () => card.evaluate((root, id) => {
    const cell = root.querySelector(`[data-node-pointer-id="${id}"]`)?.closest('[data-node-pointer-cell]')
    const box = (element) => {
      const rect = element?.getBoundingClientRect()
      return rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null
    }
    const toggle = cell?.querySelector('[data-spend-exclusion]')
    let opacity = 1
    for (let node = toggle; node && node !== cell; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return {
      located: box(cell?.querySelector('[data-node-pointer-located]')),
      locatedText: cell?.querySelector('[data-node-pointer-located]')?.textContent?.trim() ?? null,
      toggle: box(toggle?.querySelector(':scope > i') ?? toggle),
      toggleText: toggle?.textContent?.trim() ?? null,
      opacity,
      title: box(cell?.querySelector('[data-node-pointer-title]')),
    }
  }, nodeId)
  let facts = await read()
  expect(facts.located, `${A.located}：${label}，那一格标着「已定位」`).toBeTruthy()
  expect(facts.toggle, `${A.exclude}：${label}，那一格有「不生成 ×」`).toBeTruthy()
  // 小钮是淡入的（transition-opacity）：等它露全了再量，不拿半透明那一帧下结论。
  await expect.poll(async () => (facts = await read()).opacity,
    { message: `${A.exclude}：${label}，焦点在那一格，「不生成 ×」露着（这一刻才谈得上压不压）`, timeout: 2000 }).toBeGreaterThan(0.99)
  const apart = facts.located.right <= facts.toggle.left || facts.toggle.right <= facts.located.left
    || facts.located.bottom <= facts.toggle.top || facts.toggle.bottom <= facts.located.top
  expect(apart, `${A.located}：${label}，「已定位」和「不生成 ×」不重叠 ${JSON.stringify(facts)}`).toBe(true)
  // 方案一：标题行不给缩略图上的 × 让位（× 在缩略图角上、不占标题行）；× 的圆点也不压标题字。
  if (facts.title) {
    const clear = facts.title.right <= facts.toggle.left || facts.toggle.right <= facts.title.left
      || facts.title.bottom <= facts.toggle.top || facts.toggle.bottom <= facts.title.top
    expect(clear, `${A.exclude}：${label}，「不生成 ×」不压标题字 ${JSON.stringify(facts)}`).toBe(true)
  }
  return facts
}

/** 「回到对话」摆在哪：画布那一格底部正中、压在加节点条上面。 */
async function expectPillPlacement(win, label) {
  const pill = await rectOf(win, RETURN_PILL)
  const cell = await rectOf(win, CANVAS_CELL)
  const bar = await rectOf(win, CANVAS_ADD_BAR)
  expect(pill, `${label}：「回到对话」量得到`).toBeTruthy()
  expect(Math.abs((pill.left + pill.right) / 2 - (cell.left + cell.right) / 2), `${A.back}：「回到对话」在画布那一格的正中`).toBeLessThanOrEqual(2)
  if (bar && bar.right > pill.left && bar.left < pill.right) {
    expect(pill.bottom, `${A.back}：「回到对话」压在加节点条上面、留一道缝`).toBeLessThanOrEqual(bar.top - CLEARANCE + 1)
  }
  expect(pill.bottom, `${A.back}：「回到对话」在画布那一格里`).toBeLessThanOrEqual(cell.bottom)
  return { pill, cell, bar }
}

/** 焦点此刻落在哪个指向元素上（没有 = null）。 */
const focusedPointer = (win) => win.evaluate(() => document.activeElement?.closest('[data-node-pointer-id]')?.getAttribute('data-node-pointer-id') ?? null)

/** 此刻焦点在什么上（报告用：按 Esc 之前焦点在哪，说明 Esc 不靠焦点在按钮上）。 */
const focusDescription = (win) => win.evaluate(() => {
  const element = document.activeElement
  if (!element || element === document.body) return 'body'
  const tag = element.tagName.toLowerCase()
  const marks = ['data-node-pointer-id', 'data-node-id', 'data-composer-host', 'contenteditable', 'role'].map((name) => (element.getAttribute(name) ? `${name}=${element.getAttribute(name)}` : null)).filter(Boolean)
  return [tag, ...marks].join(' ')
})

/** 点卡上那一镜的缩略图：对话收成小球、画布闪那个节点、底部出「回到对话」。 */
async function clickPointerCollapses(walk, win, card, nodeId, { locale, label }) {
  await watchCanvasHighlights(win)
  await clickOrFail(pointerFace(card, nodeId), `${label}：点卡上那一镜的缩略图`)
  const ball = win.locator(COLLAPSED_DOCK).first()
  await expect(ball, `${A.collapse}：对话收成右下的小球`).toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator(AGENT_PANEL).first(), `${A.collapse}：浮窗让开了画布`).toBeHidden()
  await expect.poll(async () => (await seenHighlights(win)).some((seen) => seen.nodeId === nodeId && seen.value === 'flash'),
    { message: `${A.collapse}：画布上那个节点闪一下`, timeout: stationTimeout() }).toBe(true)
  await expect(win.locator(canvasNode(nodeId)), `${A.collapse}：那个节点露在眼前`).toBeInViewport()
  const pill = win.locator(RETURN_PILL)
  await expect(pill, `${A.back}：画布底部出现「回到对话」`).toBeVisible({ timeout: stationTimeout() })
  await expect(pill, `${A.back}：按钮上写「${say(locale, 'nodePointer.backToChat')}」`).toHaveText(say(locale, 'nodePointer.backToChat'))
  await expect(pill, `${A.back}：读屏名说全「${say(locale, 'nodePointer.backToChatName')}」`).toHaveAttribute('aria-label', say(locale, 'nodePointer.backToChatName'))
  return expectPillPlacement(win, label)
}

/** 对话原样回来：还是那么大的浮窗，「回到对话」没了，焦点在刚点的那一项上，它标着「已定位」。 */
async function expectBackInChat(win, card, nodeId, floatBefore, label) {
  await expect(win.locator(AGENT_PANEL).first(), `${A.back}：${label}，对话回来了`).toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator(RETURN_PILL), `${A.back}：${label}，「回到对话」收起来了`).toHaveCount(0)
  const float = await rectOf(win, FLOAT)
  expect(float, `${A.back}：${label}，回来的是浮窗（收起之前的形态）`).toBeTruthy()
  for (const key of ['left', 'top', 'width', 'height']) {
    expect(Math.abs(float[key] - floatBefore[key]), `${A.back}：${label}，浮窗还是原来那么大、在原处（${key}）`).toBeLessThanOrEqual(2)
  }
  await expect.poll(() => focusedPointer(win), { message: `${A.back}：${label}，焦点落回刚点的那一项`, timeout: stationTimeout() }).toBe(nodeId)
  await expect(card.locator(`${pointerOf(nodeId)} [data-node-pointer-located]`), `${A.back}：${label}，那一项标着「已定位」`).toBeVisible()
}

async function runRound(walk, win, { locale, scheme, round }) {
  const r = (step) => `${round}-${step}`
  await expect(win.locator('html'), `${round}：界面是${scheme === 'dark' ? '暗' : '浅'}色`).toHaveAttribute('data-theme', scheme)
  const zh = locale !== 'en'
  const drafted = await present(walk, win, {
    locale, kind: 'image',
    shots: (tag) => [1, 2, 3].map((index) => ({
      title: zh ? `${tag} 纸船 ${index}` : `${tag} paper boat ${index}`,
      prompt: zh ? `${tag} 纸船第 ${index} 镜：雨后清晨，纸船顺着水流漂` : `${tag} paper boat shot ${index}: a rainy morning, the boat drifts downstream`,
      taskKind: 'text_to_image', candidate: IMAGE,
    })),
  })
  const card = drafted.card
  const cardProof = await proveProbe(card, `${round}：付费卡在 Agent 面板的介入槽里`)
  await expect(card.locator('[data-v4-block="slot-title"]')).toContainText(cardTitle(locale, 3, 'image'))
  const nodes = await shotNodes(win, walk.report.projectId, drafted.operationId)
  expect(nodes.every((shot) => shot.nodeId), `${round}：三镜都落到了画布上`).toBe(true)
  const [first, second, third] = nodes.map((shot) => shot.nodeId)
  await expect(card.locator(`${CARD_BODY} ${POINTER}`), `${round}：卡上是三个指向元素`).toHaveCount(3)
  const facts = walk.report.rounds[round] = { locale, scheme, nodes: [first, second, third] }

  const formBefore = await rectOf(win, FLOAT)
  facts.titlesAtStart = { floatWidth: formBefore?.width ?? null, texts: await expectTitlesTellable(card, `卡刚出来（浮窗 ${Math.round(formBefore?.width ?? 0)}px）`) }
  if (formBefore && (await floatCoverage(win)) < 0.5) {
    // 反例：默认大小的浮窗只占一角（同一个最小窗）——点指向元素，对话不收、不出「回到对话」，画布照样定位过去。
    facts.defaultFloat = { rect: formBefore, coverage: await floatCoverage(win) }
    await watchCanvasHighlights(win)
    await clickOrFail(pointerFace(card, first), `${round}：默认浮窗下点第 1 镜`)
    await expect.poll(async () => (await seenHighlights(win)).some((seen) => seen.nodeId === first && seen.value === 'flash'),
      { message: `${round}：默认浮窗下点指向元素，画布上那个节点照样闪一下`, timeout: stationTimeout() }).toBe(true)
    await expect(win.locator(AGENT_PANEL).first(), `${round}：浮窗只占一角，对话不收`).toBeVisible()
    await expect(win.locator(RETURN_PILL), `${round}：对话没收，就没有「回到对话」`).toHaveCount(0)
    // 焦点留在刚点的那一格上：「不生成 ×」露着、那一格标着「已定位」——用户 10-25 圈出的「已定 不生成 ×」就是这一刻。
    facts.locatedAtStart = await expectLocatedClear(card, first, `${round}：默认浮窗下点了第 1 镜`)
    facts.titlesWithToggle = await expectTitlesTellable(card, `${round}：默认浮窗、第 1 格的小钮露着`)
    await walk.snap(r('default-float-stays-open'))
    await pointerAway(win)
    // 焦点还在那一项上 = 聚焦联动（板 A3），节点亮着是对的：记下来，不等它灭。
    facts.highlightAfterDefaultClick = await canvasHighlightOf(win, first)

    // 窄面板（浮窗拉到最窄，≤320）：一格约 86px，「不生成」只剩 ×；三格照样分得清，「已定位」照样不被压。
    facts.narrowFloat = await shrinkFloat(win, `${round}：把浮窗拉到最窄`)
    await expect(card.locator('[data-spend-exclusion="exclude"]').first(), `${A.exclude}：${round}，窄面板里「不生成 ×」只剩 ×`).toHaveText('')
    await card.locator(pointerOf(first)).focus()
    facts.locatedNarrow = await expectLocatedClear(card, first, `${round}：窄面板、聚焦第 1 镜`)
    facts.titlesNarrow = await expectTitlesTellable(card, `${round}：窄面板`)
    await walk.snap(r('narrow-panel-located-and-tellable-titles'))
    await pointerAway(win)
    facts.enlargedFloat = await enlargeFloat(win, `${round}：把浮窗拉大`)
  } else {
    facts.enlargedFloat = formBefore
  }
  facts.coverage = await floatCoverage(win)
  await walk.snap(r('float-covers-the-canvas'))
  const floatBefore = await rectOf(win, FLOAT)

  // 点第 2 镜：对话收成小球、节点闪、底部「回到对话」；按 Esc 回来。
  facts.collapseByPointer2 = await clickPointerCollapses(walk, win, card, second, { locale, label: `${round}：点第 2 镜` })
  await walk.snap(r('pointer-collapses-chat-back-pill'))
  facts.focusBeforeEscape = await focusDescription(win)
  await win.keyboard.press('Escape')
  await expectBackInChat(win, card, second, floatBefore, '按 Esc')
  facts.locatedEnlarged = await expectLocatedClear(card, second, `${round}：拉大的浮窗、按 Esc 回来`)
  facts.titlesEnlarged = await expectTitlesTellable(card, `${round}：拉大的浮窗`)
  await walk.snap(r('escape-back-to-chat-located'))
  // 焦点回到那一项 = 聚焦联动（板 A3：悬停 / 聚焦都让画布那个节点亮），节点可能还亮着——记下来，不等它灭：
  // 接下来点的是别的镜，它的闪不受影响。
  facts.highlightAfterEscape = await canvasHighlightOf(win, second)
  await pointerAway(win)

  // 点第 3 镜：同样收起；这回点「回到对话」。
  await clickPointerCollapses(walk, win, card, third, { locale, label: `${round}：点第 3 镜` })
  await clickOrFail(win.locator(RETURN_PILL), `${round}：点「回到对话」`)
  await expectBackInChat(win, card, third, floatBefore, '点「回到对话」')
  facts.highlightAfterPill = await canvasHighlightOf(win, third)
  await pointerAway(win)

  // 反例：收起后点小球把对话叫回来（没经「回到对话」）——那一颗跟着没了；之后用「收起」再收成小球，不冒旧的那一颗。
  await clickPointerCollapses(walk, win, card, first, { locale, label: `${round}：点第 1 镜` })
  await clickOrFail(win.locator(COLLAPSED_DOCK).first(), `${round}：点小球把对话叫回来`)
  await expect(win.locator(AGENT_PANEL).first(), `${round}：点小球，对话回来了`).toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator(RETURN_PILL), `${A.back}：没经「回到对话」就回来了，「回到对话」跟着没了`).toHaveCount(0)
  await clickOrFail(win.locator(`${AGENT_PANEL} ${COLLAPSE_BUTTON}`).first(), `${round}：面板头上的「收起」`)
  await expect(win.locator(COLLAPSED_DOCK).first(), `${round}：收成小球了`).toBeVisible({ timeout: stationTimeout() })
  await expect(win.locator(RETURN_PILL), `${A.back}：别的原因收成小球，不冒指着旧镜头的「回到对话」`).toHaveCount(0)
  await walk.snap(r('collapse-by-hand-no-stale-back-pill'))
  await expandResidentPanel(win)

  // 收尾：取消这张卡（一笔都不发）。
  await closeSpendCard(card, `${round}：取消这张卡`)
  await expectAbsent(card, { provenBy: cardProof, message: `${round}：取消之后卡退出介入槽` })
  await recorded(drafted.turnDone.received, `${round}：generate 在卡取消之后返回`)
  // 下一轮从最窄的浮窗起手（窄面板里卡刚出来那一刻也量一次）。
  if (round === 'zh-light') facts.leftNarrowForNextRound = await shrinkFloat(win, `${round}：收尾把浮窗拉到最窄`)
}

const walk = await createRuntimeWalk('spend-card-narrow', { generationProvider: 'apimart', trustFixtureOrigin: true })
walk.report.rounds = {}
let failure
try {
  const { win } = await walk.start({ first: true })
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'light')
    localStorage.setItem('nomi:locale:v1', 'zh-CN')
  })
  await armCanvasBridges(win)
  const project = await walk.newProject()
  walk.report.projectId = project.projectId
  await openCanvas(win)
  const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await noShare.isVisible().catch(() => false)) await noShare.click()
  walk.report.window = await walk.resizeWindow(MIN_WINDOW.width, MIN_WINDOW.height)
  await expect(win.locator(FLOAT), '最小窗里对话是浮窗').toBeVisible()
  await runRound(walk, win, { locale: 'zh-CN', scheme: 'light', round: 'zh-light' })

  // 英文 · 暗色：换语言与明暗只重载渲染层；同一个项目、同一个浮窗（大小记在外壳里）。
  await win.evaluate(() => {
    localStorage.setItem('nomi-color-scheme', 'dark')
    localStorage.setItem('nomi:locale:v1', 'en')
  })
  await win.reload()
  const stage = win.locator(STAGE)
  if (!(await stage.waitFor({ state: 'visible', timeout: stationTimeout() }).then(() => true, () => false))) {
    const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: project.name }).first()
    if (await projectCard.isVisible().catch(() => false)) {
      await projectCard.hover()
      await clickOrFail(projectCard.getByRole('button', { name: /Continue/ }), 'en：从项目库打开刚才那个项目')
      await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), project.projectId)
    }
    await clickOrFail(win.getByRole('button', { name: 'Generate', exact: true }), 'en：生成工作区')
    await expect(stage).toBeVisible({ timeout: stationTimeout() })
  }
  await expandResidentPanel(win)
  await runRound(walk, win, { locale: 'en', scheme: 'dark', round: 'en-dark' })

  expect(walk.fixture.images, '整条走查一笔图片都没提交').toHaveLength(0)
  walk.report.verified = [
    'default-float-in-min-window-does-not-collapse', 'enlarged-float-collapses-on-pointer-click', 'node-flashes-and-is-in-view',
    'back-pill-bottom-centre-above-add-node-bar', 'escape-returns-to-the-same-float', 'pill-click-returns-to-the-same-float',
    'focus-lands-on-the-clicked-pointer-and-it-is-located', 'ball-reopen-clears-the-pill', 'manual-collapse-shows-no-stale-pill',
    'tile-titles-tellable-at-default-narrow-and-enlarged-widths', 'located-and-exclude-never-overlap', 'exclude-never-covers-the-title',
  ]
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  await walk.finish(failure)
}
