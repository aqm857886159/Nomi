// 模态弹层的输入优先（真窗走查，中英两轨）。设计卡 docs/plan/2026-10-31-modal-input-priority.md ★9 的 A1–A13 逐项对应。
//
// 用法：WALK_LOCALE=zh-CN node tests/ux/modal-input-priority.walk.mjs；WALK_LOCALE=en 同一条。
// 产出：$NOMI_WALK_TEMP_ROOT/modal-input-priority-<locale>/ 下的截图和 observations.json。
//
// 每个键都先备好「按了就看得出来」的前提：撤销栈、重做栈、画布剪贴板都有东西，选中的只是其中一张。否则按键没生效和按键被挡住长得一样，
// 绿灯是假的。每一段的最后再用正向断言确认同一个键在弹层关掉后真的生效。
// 一段红了不停，整张红绿表一次看全；画布的改动从 store 还原，所以后面的段不受牵连。
import fs from 'node:fs'
import path from 'node:path'
import { expect } from './_assert.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from './_canvasHit.mjs'
import {
  canvasFrameToolPressed, canvasZoomStep, closeCanvasViewOptions, closeSettings, collapseAgentPanel, ensureAgentPanelOpen,
  openCanvasViewOptions, openSettings, settingsDialog, switchGenerationView, switchWorkspace,
} from './_shell.mjs'
import { launchParityFixture, selectParityNode } from './_viewParityFixture.mjs'

const KEYS = ['Delete', 'Backspace', 'Meta+z', 'Meta+Shift+z', 'Meta+a', 'Meta+v']
// 画布的 Cmd+V 走 120ms 兜底计时器（useCanvasShortcuts）：等够了才算这一键真的没动静。
const PASTE_SETTLE_MS = 320
const KEY_SETTLE_MS = 60

const CONFIRM = '[data-confirm-dialog-surface]'
const CONFIRM_CANCEL = '[data-confirm-dialog-cancel]'
const SPEND = '[data-spend-confirm-dialog]'
const STAGE = '.generation-canvas-v2__stage'
const GENERATION_TIMELINE = '.workbench-generation__timeline'
const PREVIEW_TIMELINE = '.workbench-preview .workbench-timeline'
const LIGHTBOX = '.workbench-generation__canvas > [role="dialog"]'
const NODE_SELECTOR = '.react-flow__node[data-id="shared-node"]'

let fixture
const results = []

const failed = () => results.filter((entry) => !entry.ok)

async function step(id, title, run) {
  try {
    await fixture.win.evaluate(() => { window.__modalWalkStepStart = window.__nomiCanvasStore?.getState() })
    const detail = await run()
    results.push({ id, title, ok: true, detail })
    console.log(`PASS ${id} ${title}${detail ? ` ${JSON.stringify(detail)}` : ''}`)
  } catch (error) {
    const message = String(error?.message ?? error).slice(0, 1200)
    results.push({ id, title, ok: false, error: message })
    console.error(`FAIL ${id} ${title}: ${message}`)
    await fixture?.shot(`fail-${id}`).catch(() => {})
    await recover()
  }
}

/** 一段红了之后把窗口摆回「什么都没开」：弹层逐层按 Esc 关，回到生成页的画布，画布还原成这一段开始时的样子，文字选区清掉。 */
async function recover() {
  const { win } = fixture
  await win.mouse.up().catch(() => {})
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const open = await win.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
    if (!open) break
    await win.keyboard.press('Escape')
    await win.waitForTimeout(200)
  }
  await switchWorkspace(win, 'generation').catch(() => {})
  await switchGenerationView(win, 'canvas').catch(() => {})
  await win.evaluate(() => {
    if (window.__modalWalkStepStart) window.__nomiCanvasStore.setState(window.__modalWalkStepStart)
    window.getSelection()?.removeAllRanges()
  })
  await clickCanvasBlank().catch(() => {})
}

const canvasFacts = () => fixture.win.evaluate(() => {
  const state = window.__nomiCanvasStore.getState()
  return {
    nodes: state.nodes.map((node) => ({ id: node.id, x: node.position.x, y: node.position.y })),
    edges: state.edges.length,
    groups: state.groups.length,
    selected: [...state.selectedNodeIds],
    // Cmd+A 的默认动作是把整页的字都选中：关掉弹层选区还在，下一个 Cmd+C 复制的就成了这些字，所以它也算工作区变了。
    textSelected: !(window.getSelection()?.isCollapsed ?? true),
  }
})

const saveCanvas = () => fixture.win.evaluate(() => { window.__modalWalkCanvas = window.__nomiCanvasStore.getState() })
const restoreCanvas = () => fixture.win.evaluate(() => {
  if (window.__modalWalkCanvas) window.__nomiCanvasStore.setState(window.__modalWalkCanvas)
})
const selectCanvasNode = (id) => fixture.win.evaluate((nodeId) => window.__nomiCanvasStore.getState().selectNode(nodeId), id)
const clearTextSelection = () => fixture.win.evaluate(() => window.getSelection()?.removeAllRanges())

/** Mantine 的遮罩比弹层内容晚一拍卸载（淡出）：等它走了再点后面的东西。 */
const modalOverlayGone = () => expect.poll(() => fixture.win.evaluate(() => Boolean(document.querySelector('.mantine-Modal-overlay')))).toBe(false)

/** 点画布空白：取消选择，也收掉 React Flow 全选后盖在节点上的那层选区框（只改 store 选区时它不走，节点就点不到了）。 */
async function clickCanvasBlank() {
  await modalOverlayGone()
  const blank = await findCanvasBlankPoint(fixture.win)
  if (!blank) throw new Error('走查前提失效：画布上没有空白处')
  await fixture.win.mouse.click(blank.x, blank.y)
}

/** 指针选中节点。先点空白：已选中的节点身上是按钮，全选后还盖着选区框，都点不到。 */
async function pointerSelectNode() {
  await clickCanvasBlank()
  await selectParityNode(fixture.win)
  await expect.poll(async () => (await canvasFacts()).selected).toEqual(['shared-node'])
}

const clipFacts = (root) => fixture.win.locator(`${root} [data-clip-id]`).evaluateAll((elements) =>
  elements.map((element) => ({ id: element.getAttribute('data-clip-id'), selected: element.getAttribute('data-selected') })))

async function openConfirm(tag = 'A') {
  const { win, locale } = fixture
  await win.evaluate(({ title, message }) => {
    void window.__nomiConfirmDialogE2E({ title, message, danger: true })
  }, locale === 'en'
    ? { title: `Delete project assets ${tag}?`, message: 'Cancel this check to retain all assets.' }
    : { title: `删除项目素材 ${tag}？`, message: '取消本次检查以保留所有素材。' })
  await expect(win.locator(CONFIRM)).toBeVisible()
}

async function closeConfirm() {
  const { win } = fixture
  await win.locator(CONFIRM_CANCEL).click()
  await expect(win.locator(CONFIRM)).toHaveCount(0)
}

/**
 * 真的 paste 事件打到 window，走真实的监听；内容是页内造的 DataTransfer，不读也不写用户的系统剪贴板。
 * 按键 Cmd+V 走的是兜底计时器那条路，这里补上事件那条路。
 */
const dispatchPaste = (selector = null) => fixture.win.evaluate((target) => {
  const data = new DataTransfer()
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
  ;(target ? document.querySelector(target) : window).dispatchEvent(event)
  return event.defaultPrevented
}, selector)

async function pressAndSettle(key) {
  await fixture.win.keyboard.press(key)
  await fixture.win.waitForTimeout(key === 'Meta+v' ? PASTE_SETTLE_MS : KEY_SETTLE_MS)
}

/** 画布：六个键逐个按，节点、位置、连线、选区一处都不许变；变了记下来、从 store 还原，继续按下一个。 */
async function canvasIgnoresKeys(label, keys = KEYS) {
  const before = await canvasFacts()
  await saveCanvas()
  const changed = []
  for (const key of keys) {
    await pressAndSettle(key)
    const after = await canvasFacts()
    if (JSON.stringify(after) === JSON.stringify(before)) continue
    changed.push({ key, nodes: `${before.nodes.length}→${after.nodes.length}`, selected: `${before.selected.length}→${after.selected.length}`, textSelected: after.textSelected })
    await restoreCanvas()
    await clearTextSelection()
  }
  await dispatchPaste()
  await fixture.win.waitForTimeout(KEY_SETTLE_MS)
  const afterPaste = await canvasFacts()
  if (JSON.stringify(afterPaste) !== JSON.stringify(before)) {
    changed.push({ key: 'paste 事件', nodes: `${before.nodes.length}→${afterPaste.nodes.length}` })
    await restoreCanvas()
  }
  if (changed.length) throw new Error(`${label}: 画布变了 ${JSON.stringify(changed)}`)
  return { keys: keys.length, nodes: before.nodes.length, selected: before.selected.length }
}

/** 时间轴：同样六键（Cmd+A / Cmd+V 时间轴本来没绑，由画布那一段证明不落到画布上）。 */
async function timelineIgnoresKeys(root, label) {
  let before = await clipFacts(root)
  if (!before.length) throw new Error(`${label}: 走查前提失效，时间轴上没有片段`)
  const canvasBefore = await canvasFacts()
  await saveCanvas()
  const changed = []
  for (const key of KEYS) {
    await pressAndSettle(key)
    const after = await clipFacts(root)
    if (JSON.stringify(after) !== JSON.stringify(before)) {
      changed.push({ key, clips: `${before.length}→${after.length}` })
      before = after
    }
    const canvasAfter = await canvasFacts()
    if (JSON.stringify(canvasAfter) !== JSON.stringify(canvasBefore)) {
      changed.push({ key, surface: 'canvas', nodes: `${canvasBefore.nodes.length}→${canvasAfter.nodes.length}`, textSelected: canvasAfter.textSelected })
      await restoreCanvas()
      await clearTextSelection()
    }
  }
  if (changed.length) throw new Error(`${label}: 工作区变了 ${JSON.stringify(changed)}`)
  return { keys: KEYS.length, clips: before.length }
}

/** 撤销栈和重做栈都备上东西，选中其中一张，再复制一次：六个键每一个在没有弹层时都有看得见的效果。 */
async function prepareCanvasEffects() {
  const { win, snapshot } = fixture
  // 适应视图后单个节点占满画布：缩小留出空白，节点工具条、弹层和时间轴才不互相挡。
  for (let step = 0; step < 6; step += 1) await canvasZoomStep(win, 'out')
  await selectParityNode(win)
  await expect.poll(async () => (await snapshot()).selected).toEqual(['shared-node'])
  await win.keyboard.press('Meta+d')
  await expect.poll(async () => (await snapshot()).nodes.length).toBe(2)
  await win.keyboard.press('Meta+d')
  await expect.poll(async () => (await snapshot()).nodes.length).toBe(3)
  await win.keyboard.press('Meta+z')
  await expect.poll(async () => (await snapshot()).nodes.length).toBe(2)
  await selectCanvasNode('shared-node')
  await win.keyboard.press('Meta+c')
  await win.waitForTimeout(KEY_SETTLE_MS)
  return { nodes: 2 }
}

/** 预览页的 Cmd+Z 先撤面板布局（PreviewWorkspace 的 undoEditingPanelLayout），再撤时间轴：按到片段数真的变了为止。 */
async function undoTimelineClip(root, from) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await fixture.win.keyboard.press('Meta+z')
    await fixture.win.waitForTimeout(200)
    if ((await clipFacts(root)).length !== from) return
  }
  throw new Error(`${root}: 按了 4 次 Cmd+Z，片段数还是 ${from}`)
}

async function prepareTimelineEffects(root) {
  const { win } = fixture
  await win.locator(`${root} [data-clip-id]`).first().click()
  await expect.poll(async () => (await clipFacts(root)).filter((clip) => clip.selected === 'true').length).toBeGreaterThan(0)
  const start = (await clipFacts(root)).length
  await win.keyboard.press('Meta+d')
  await expect.poll(async () => (await clipFacts(root)).length).toBe(start + 1)
  await win.keyboard.press('Meta+d')
  await expect.poll(async () => (await clipFacts(root)).length).toBe(start + 2)
  await undoTimelineClip(root, start + 2)
  await expect.poll(async () => (await clipFacts(root)).length).toBe(start + 1)
  await expect.poll(async () => (await clipFacts(root)).filter((clip) => clip.selected === 'true').length).toBeGreaterThan(0)
  return { clips: start + 1 }
}

async function openLightbox() {
  const { win } = fixture
  await selectCanvasNode('shared-node')
  const button = win.locator('.generation-canvas-v2-node[data-node-id="shared-node"]')
    .getByRole('button', { name: /全屏预览图片|Preview image fullscreen/ }).first()
  await button.click()
  await expect(win.locator(LIGHTBOX)).toBeVisible()
}

const agentForm = (surface = 'generation') => fixture.win.evaluate((name) => window.__nomiAgentFormStore?.getState().bySurface[name].form, surface)

try {
  fixture = await launchParityFixture('modal-input-priority')
  const { win, shot, locale } = fixture

  await step('setup', '画布备好撤销、重做、剪贴板', prepareCanvasEffects)
  await saveCanvas()
  await shot('00-canvas-prepared')

  await step('A1', '确认框开着，画布六键不动', async () => {
    await openConfirm()
    await shot('01-confirm-canvas')
    const detail = await canvasIgnoresKeys('确认框 × 画布')
    await shot('02-confirm-after-keys')
    await closeConfirm()
    return detail
  })

  await step('A5', '确认框关掉后画布快捷键第一下就生效', async () => {
    await openConfirm()
    await closeConfirm()
    await selectCanvasNode((await canvasFacts()).selected[0] ?? 'shared-node')
    const before = await canvasFacts()
    await win.keyboard.press('Meta+a')
    await expect.poll(async () => (await canvasFacts()).selected.length).toBe(before.nodes.length)
    await win.keyboard.press('Delete')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(0)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(before.nodes.length)
    await win.keyboard.press('Meta+Shift+z')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(0)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(before.nodes.length)
    await selectCanvasNode(before.selected[0] ?? 'shared-node')
    await win.keyboard.press('Meta+c')
    await win.keyboard.press('Meta+v')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(before.nodes.length + 1)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(before.nodes.length)
    await dispatchPaste()
    await expect.poll(async () => (await canvasFacts()).nodes.length, { message: 'paste 事件在弹层关掉后应当归画布' }).toBe(before.nodes.length + 1)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await canvasFacts()).nodes.length).toBe(before.nodes.length)
    await shot('03-after-close-keys-work')
    return { nodes: before.nodes.length }
  })

  await step('A9', '确认框排队：第一条答完第二条接上，全程不漏键', async () => {
    await pointerSelectNode()
    await win.evaluate(() => {
      void window.__nomiConfirmDialogE2E({ title: 'Q1', message: 'first', danger: true })
      void window.__nomiConfirmDialogE2E({ title: 'Q2', message: 'second', danger: true })
    })
    await expect(win.locator(CONFIRM)).toBeVisible()
    await canvasIgnoresKeys('排队第一条', ['Delete', 'Meta+a'])
    await win.locator(CONFIRM_CANCEL).click()
    await expect(win.getByRole('dialog', { name: 'Q2' })).toBeVisible()
    await canvasIgnoresKeys('排队第二条', ['Delete', 'Meta+a'])
    await closeConfirm()
    await win.keyboard.press('Meta+a')
    await expect.poll(async () => (await canvasFacts()).selected.length).toBe((await canvasFacts()).nodes.length)
  })

  await step('A1b', '确认框开着，Cmd+Z / Cmd+Shift+Z 不动框后面输入框刚打的字', async () => {
    // 工作区不接之后，这两个键的默认动作（浏览器原生撤销）会撤掉框后面输入框里的字。
    const prompt = () => win.evaluate(() => window.__nomiCanvasStore.getState().nodes.find((node) => node.id === 'shared-node').prompt ?? '')
    await pointerSelectNode()
    await win.locator('[data-node-composer-prompt] [contenteditable="true"]').first().click()
    await win.keyboard.type('abc')
    await expect.poll(prompt).toContain('abc')
    const typed = await prompt()
    await openConfirm('U')
    await win.keyboard.press('Meta+z')
    await win.waitForTimeout(KEY_SETTLE_MS)
    expect(await prompt(), 'Cmd+Z 撤了框后面的字').toBe(typed)
    await win.keyboard.press('Meta+Shift+z')
    await win.waitForTimeout(KEY_SETTLE_MS)
    expect(await prompt(), 'Cmd+Shift+Z 动了框后面的字').toBe(typed)
    await closeConfirm()
    await win.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      window.__nomiCanvasStore.getState().updateNode('shared-node', { prompt: '' })
    })
    await modalOverlayGone()
    await saveCanvas()
    return { typed }
  })

  await step('A10', '手势中途弹出确认框：拖动被收掉，不粘手，不提交', async () => {
    await pointerSelectNode()
    const before = await canvasFacts()
    const point = await findNodeHitPoint(win, { nodeSelector: NODE_SELECTOR })
    if (!point) throw new Error('走查前提失效：节点没有可点的落点')
    await win.mouse.move(point.x, point.y)
    await win.mouse.down()
    await win.mouse.move(point.x + 40, point.y + 30, { steps: 8 })
    await expect(win.locator(STAGE)).toHaveAttribute('data-dragging', 'true')
    await openConfirm()
    await expect.poll(() => win.locator(STAGE).getAttribute('data-dragging'), { message: '弹层打开后拖动标志应当被收掉' }).toBe(null)
    await win.mouse.move(point.x + 140, point.y + 90, { steps: 6 })
    await win.mouse.up()
    await shot('04-gesture-interrupted')
    await closeConfirm()
    expect(await canvasFacts()).toEqual(before)
    return { nodes: before.nodes.length }
  })

  await step('A6', '嵌套：设置里再开确认框，Esc 只关确认框，设置关掉才恢复', async () => {
    await selectCanvasNode('shared-node')
    await openSettings(win)
    await canvasIgnoresKeys('设置 × 画布')
    await openConfirm('S')
    await shot('05-settings-with-confirm')
    await canvasIgnoresKeys('设置 + 确认框 × 画布')
    await win.keyboard.press('Escape')
    await expect(win.locator(CONFIRM)).toHaveCount(0)
    await expect(settingsDialog(win), 'Esc 只该关最上面的确认框').toBeVisible()
    await canvasIgnoresKeys('确认框关了、设置还开着 × 画布')
    await closeSettings(win)
    await selectCanvasNode('shared-node')
    await win.keyboard.press('Meta+a')
    await expect.poll(async () => (await canvasFacts()).selected.length).toBe((await canvasFacts()).nodes.length)
    await selectCanvasNode('shared-node')
  })

  await step('A6b', 'Esc 关掉弹层的那一下不漏到后面：画框工具还待命，灯箱还开着', async () => {
    // Mantine 在 window 捕获期关弹层，React 紧接着就提交，同一个 Esc 再往下走时层已经不在了。
    // 画框工具待命时 Esc 会取消它，所以用它看这一下有没有漏到画布。先点空白取消选择：读工具状态要点缩放簇，选中节点时它被生成框盖着。
    await clickCanvasBlank()
    await win.keyboard.press('f')
    expect(await canvasFrameToolPressed(win), '走查前提：按 F 画框工具就绪').toBe(true)
    await openConfirm('E')
    await win.keyboard.press('Escape')
    await expect(win.locator(CONFIRM)).toHaveCount(0)
    await modalOverlayGone()
    expect(await canvasFrameToolPressed(win), 'Esc 只该关确认框，不该同时取消画框工具').toBe(true)
    await win.keyboard.press('Escape')
    expect(await canvasFrameToolPressed(win), '确认框关了之后的 Esc 才归画布').toBe(false)
    await pointerSelectNode()
    await openLightbox()
    await openConfirm('F')
    await win.keyboard.press('Escape')
    await expect(win.locator(CONFIRM)).toHaveCount(0)
    await expect(win.locator(LIGHTBOX), 'Esc 只该关最上面的确认框，灯箱还开着').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.locator(LIGHTBOX)).toHaveCount(0)
  })

  await step('A7', '模态里的输入框打字不受影响，画布不动', async () => {
    const before = await canvasFacts()
    const dialog = await openSettings(win, { tab: 'ai' })
    await dialog.locator('[data-settings-custom-relay] summary').click()
    const input = dialog.locator('[data-settings-field="asset-relay-endpoint"]')
    await input.click()
    await win.keyboard.type('https://a')
    await win.keyboard.press('Backspace')
    await expect(input).toHaveValue('https://')
    await win.keyboard.press('Delete')
    await win.keyboard.press('Meta+a')
    await win.keyboard.type('xy')
    await expect(input).toHaveValue('xy')
    await win.keyboard.press('Meta+z')
    await win.waitForTimeout(KEY_SETTLE_MS)
    await win.keyboard.press('Meta+Shift+z')
    await win.waitForTimeout(KEY_SETTLE_MS)
    await shot('06-typing-in-modal')
    // Cmd+V 只用页内造的 paste 事件验：工作区不许截走、不许 preventDefault。按真键会把用户系统剪贴板的内容贴进来。
    const pasteTaken = await dispatchPaste('[data-settings-field="asset-relay-endpoint"]')
    expect(pasteTaken, '模态里输入框的 paste 不该被工作区截走').toBe(false)
    await input.fill('')
    expect(await canvasFacts()).toEqual(before)
    await closeSettings(win)
  })

  await step('A8a', '手写模态：付费确认卡开着，画布六键不动，Esc 关掉', async () => {
    await win.evaluate((copy) => {
      void window.__nomiSpendConfirmE2E({ title: copy.title, message: copy.message, confirmLabel: copy.confirm, details: [] })
    }, locale === 'en'
      ? { title: 'Walk spend check', message: 'Checks the keyboard only; nothing is sent.', confirm: 'Confirm' }
      : { title: '走查付费确认', message: '只验键盘，不发任何请求。', confirm: '确认' })
    await expect(win.locator(SPEND)).toBeVisible()
    await shot('07-spend-card')
    const detail = await canvasIgnoresKeys('付费确认卡 × 画布')
    await win.keyboard.press('Escape')
    await expect(win.locator(SPEND)).toHaveCount(0)
    return detail
  })

  await step('timeline-setup', '展开生成页时间轴并备好撤销、重做', async () => {
    await win.locator('[data-timeline-strip]').click()
    await expect(win.locator(`${GENERATION_TIMELINE} [data-clip-id]`).first()).toBeVisible()
    return prepareTimelineEffects(GENERATION_TIMELINE)
  })

  await step('A2', '确认框开着，生成页时间轴六键不动，关掉后恢复', async () => {
    await openConfirm('T')
    await shot('08-confirm-timeline')
    const detail = await timelineIgnoresKeys(GENERATION_TIMELINE, '确认框 × 生成页时间轴')
    await closeConfirm()
    const before = await clipFacts(GENERATION_TIMELINE)
    await win.keyboard.press('Delete')
    await expect.poll(async () => (await clipFacts(GENERATION_TIMELINE)).length).toBe(before.length - 1)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await clipFacts(GENERATION_TIMELINE)).length).toBe(before.length)
    return detail
  })

  await step('A8b', '手写模态：时间轴快捷键帮助框，? 开合，Esc 关，开着时键不漏', async () => {
    const dialog = win.getByRole('dialog', { name: /快捷键|Keyboard shortcuts/ })
    await win.locator(`${GENERATION_TIMELINE} [data-clip-id]`).first().click()
    await win.keyboard.press('?')
    await expect(dialog).toBeVisible()
    await shot('09-timeline-help')
    const detail = await timelineIgnoresKeys(GENERATION_TIMELINE, '帮助框 × 生成页时间轴')
    await win.keyboard.press('?')
    await expect(dialog).toHaveCount(0)
    await win.keyboard.press('?')
    await expect(dialog).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    return detail
  })

  await step('A8c', '看大图灯箱：Delete 不删节点，时间轴不被盖，点了就能用，Esc 关', async () => {
    await pointerSelectNode()
    await openLightbox()
    await shot('10-lightbox')
    const clipsBefore = await clipFacts(GENERATION_TIMELINE)
    await canvasIgnoresKeys('灯箱 × 画布')
    expect(await clipFacts(GENERATION_TIMELINE), '指针在被盖的画布上：灯箱开着时键不许转给时间轴').toEqual(clipsBefore)
    await win.locator(`${GENERATION_TIMELINE} [data-clip-id]`).first().click()
    await expect.poll(async () => (await clipFacts(GENERATION_TIMELINE)).filter((clip) => clip.selected === 'true').length).toBeGreaterThan(0)
    await win.keyboard.press('Delete')
    await expect.poll(async () => (await clipFacts(GENERATION_TIMELINE)).length, { message: '灯箱只盖画布：点过时间轴，时间轴就要接键' }).toBe(clipsBefore.length - 1)
    await win.keyboard.press('Meta+z')
    await expect.poll(async () => (await clipFacts(GENERATION_TIMELINE)).length).toBe(clipsBefore.length)
    await expect(win.locator(LIGHTBOX)).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.locator(LIGHTBOX)).toHaveCount(0)
    await pointerSelectNode()
  })

  await step('A8d', '版本灯箱：方向键翻页，Esc 只关灯箱，版本宫格还开着', async () => {
    await win.evaluate(() => {
      const store = window.__nomiCanvasStore.getState()
      const node = store.nodes.find((candidate) => candidate.id === 'shared-node')
      const second = { ...node.result, id: 'shared-r2', createdAt: 2 }
      store.updateNode('shared-node', { history: [node.result, second] })
      window.__nomiCanvasStore.getState().setNodeResultStackOpen('shared-node', true, 'right')
    })
    const grid = win.locator('[data-version-grid="shared-node"]')
    await expect(grid).toBeVisible()
    const card = grid.locator('[data-version-card]').first()
    await card.hover()
    await card.locator('button[aria-label^="预览"], button[aria-label^="Preview"]').first().click()
    const lightbox = win.locator(LIGHTBOX)
    await expect(lightbox).toBeVisible()
    const firstLabel = await lightbox.getAttribute('aria-label')
    await win.keyboard.press('ArrowRight')
    await expect.poll(() => lightbox.getAttribute('aria-label'), { message: '方向键应当翻到另一版' }).not.toBe(firstLabel)
    await shot('11-version-lightbox')
    await canvasIgnoresKeys('版本灯箱 × 画布', ['Delete', 'Meta+a'])
    await win.keyboard.press('Escape')
    await expect(lightbox).toHaveCount(0)
    await expect(grid, 'Esc 只该关灯箱，版本宫格还开着').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(grid, '灯箱关了之后 Esc 才归宫格').toHaveCount(0)
  })

  await step('A12', '灯箱开着切到预览页：别的页快捷键活着，切回来灯箱还在', async () => {
    await pointerSelectNode()
    await openLightbox()
    await switchWorkspace(win, 'preview')
    await expect(win.locator(`${PREVIEW_TIMELINE} [data-clip-id]`).first()).toBeVisible()
    await win.locator(`${PREVIEW_TIMELINE} [data-clip-id]`).first().click()
    const before = await clipFacts(PREVIEW_TIMELINE)
    await win.keyboard.press('Delete')
    await expect.poll(async () => (await clipFacts(PREVIEW_TIMELINE)).length).toBe(before.length - 1)
    await undoTimelineClip(PREVIEW_TIMELINE, before.length - 1)
    await expect.poll(async () => (await clipFacts(PREVIEW_TIMELINE)).length).toBe(before.length)
    await shot('12-preview-while-lightbox')
    await switchWorkspace(win, 'generation')
    await expect(win.locator(LIGHTBOX), '切回来灯箱还在').toBeVisible()
    await win.keyboard.press('Escape')
    await expect(win.locator(LIGHTBOX)).toHaveCount(0)
  })

  await step('A3', '确认框开着，预览页时间轴六键不动，关掉后恢复', async () => {
    await switchWorkspace(win, 'preview')
    await win.locator(`${PREVIEW_TIMELINE} [data-clip-id]`).first().click()
    await prepareTimelineEffects(PREVIEW_TIMELINE)
    await openConfirm('P')
    await shot('13-confirm-preview-timeline')
    const detail = await timelineIgnoresKeys(PREVIEW_TIMELINE, '确认框 × 预览页时间轴')
    await closeConfirm()
    const before = await clipFacts(PREVIEW_TIMELINE)
    await win.keyboard.press('Delete')
    await expect.poll(async () => (await clipFacts(PREVIEW_TIMELINE)).length).toBe(before.length - 1)
    await undoTimelineClip(PREVIEW_TIMELINE, before.length - 1)
    await expect.poll(async () => (await clipFacts(PREVIEW_TIMELINE)).length).toBe(before.length)
    await switchWorkspace(win, 'generation')
    return detail
  })

  await step('A13', 'Mod+J 在窗口级模态下不响应，灯箱下照常', async () => {
    await switchGenerationView(win, 'canvas')
    await collapseAgentPanel(win)
    await expect.poll(() => agentForm()).toBe('ball')
    await openConfirm('J')
    await win.keyboard.press('Meta+j')
    await win.waitForTimeout(150)
    expect(await agentForm(), '窗口级模态开着，Mod+J 不该把面板叫出来').toBe('ball')
    expect(await win.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), '焦点应当还在确认框里').toBe(true)
    await closeConfirm()
    await pointerSelectNode()
    await openLightbox()
    await win.keyboard.press('Meta+j')
    await expect.poll(() => agentForm(), { message: '灯箱只盖画布，Mod+J 照常' }).not.toBe('ball')
    await shot('14-agent-over-lightbox')
    await win.evaluate(() => window.__nomiAgentFormStore.getState().setForm('generation', 'ball'))
    await win.keyboard.press('Escape')
    await expect(win.locator(LIGHTBOX)).toHaveCount(0)
  })

  await step('A11', '非模态不误挡：任务中心、菜单、Agent 面板开着时画布快捷键照常', async () => {
    const selectAll = async (label) => {
      await selectCanvasNode('shared-node')
      await win.keyboard.press('Meta+a')
      await expect.poll(async () => (await canvasFacts()).selected.length, { message: `${label} 开着时 Cmd+A 应当归画布` }).toBe((await canvasFacts()).nodes.length)
    }
    await pointerSelectNode()
    await win.locator('[data-task-center-trigger="true"]').click()
    await win.waitForTimeout(200)
    await shot('15-task-center-open')
    await selectAll('任务中心')
    await win.locator('[data-task-center-trigger="true"]').click()
    await win.waitForTimeout(200)
    await openCanvasViewOptions(win)
    await selectAll('画布菜单')
    await closeCanvasViewOptions(win)
    await ensureAgentPanelOpen(win)
    await pointerSelectNode()
    await selectAll('Agent 面板')
    await shot('16-agent-open-canvas-keys')
  })

  await step('A4', '列表视图：确认框开着 Esc 只关确认框，详情还在，关掉后 Esc 回列表', async () => {
    await switchGenerationView(win, 'list')
    await win.locator('[data-list-card]').first().click()
    const detail = win.locator('[data-generation-list][data-list-layout="detail"]')
    await expect(detail).toBeVisible()
    await openConfirm('L')
    await shot('17-list-detail-with-confirm')
    await win.keyboard.press('Escape')
    await expect(win.locator(CONFIRM)).toHaveCount(0)
    await expect(detail, 'Esc 只该关确认框').toBeVisible()
    // 焦点落回详情之后，同一个 Esc 才归列表。
    await win.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
    await win.keyboard.press('Escape')
    await expect(detail).toHaveCount(0)
    await switchGenerationView(win, 'canvas')
  })

  await shot('99-final')
  const red = failed()
  console.log(`SUMMARY ${results.length - red.length}/${results.length} passed; locale=${locale}`)
  for (const entry of red) console.error(`RED ${entry.id}: ${entry.error}`)
  if (red.length) process.exitCode = 1
} catch (error) {
  results.push({ id: 'walk', title: '走查整体', ok: false, error: String(error?.stack ?? error) })
  console.error(String(error?.stack ?? error))
  process.exitCode = error?.exitCode ?? 1
  await fixture?.shot('99-failed').catch(() => {})
} finally {
  if (fixture) fs.writeFileSync(path.join(fixture.out, 'observations.json'), JSON.stringify(results, null, 2))
  await fixture?.close()
}
