// 剧本里反复用到的**用户动作**（像人一样点、拖；不直调桥、不灌 store）。
// 判据不在这里：这里只负责「点到了没有」，点完之后对不对由监视器按铁律判。
import { clickOrFail, expect, waitForVisualQuiescence } from '../_assert.mjs'
import { stationTimeout } from '../_station-budget.mjs'
import { findCanvasBlankPoint, findConnectionStartPoint, findNodeHitPoint, panCanvasUntilInside } from '../_canvasHit.mjs'
import { canvasFitViewButton } from '../_shell.mjs'

export const nodeSelector = (id) => `.react-flow__node[data-id="${id}"]`
export const SPEND_DIALOG = '[data-spend-confirm-dialog]'

/** 点一下卡上真正点得到的地方，选中它。 */
export async function selectNode(win, nodeId) {
  const point = await findNodeHitPoint(win, { nodeSelector: `[data-node-id="${nodeId}"]` })
  if (!point) throw new Error(`节点 ${nodeId} 在舞台上没有点得到的地方`)
  await win.mouse.click(point.x, point.y)
  await expect(win.locator(`[data-node-id="${nodeId}"]`).first(), `${nodeId} 被选中`).toHaveAttribute('data-selected', 'true')
  return point
}

/**
 * 把窗口缩到指定的内容区尺寸（原生窗口与 Playwright 视口两层一起改，同 agent-runtime-walk-support.mjs 的 resizeWindow）。
 * 调完当场核对，没变成就报错——在一个没真缩下去的窗口里量「关闭钮在不在视口里」是恒真式。
 */
export async function resizeContent(app, win, { width, height }) {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((windowRef, size) => { windowRef.setContentSize(size.width, size.height) }, { width, height })
  await win.setViewportSize({ width, height })
  const actual = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  if (actual.width !== width || actual.height !== height) throw new Error(`窗口没缩成 ${width}×${height}，实际 ${actual.width}×${actual.height}`)
  return actual
}

/** 点画布空白处，取消选中。 */
export async function clickBlank(win) {
  const blank = await findCanvasBlankPoint(win, { inset: 80 })
  if (!blank) throw new Error('画布上找不到空白处')
  await win.mouse.click(blank.x, blank.y)
}

/**
 * 点画布底栏的「适应视图」，把所有卡片放进视野——用户要在某张卡上点按钮之前，先得看见它。
 * 画布只渲染视野里的卡（React Flow onlyRenderVisibleElements），视野外的卡在 DOM 里根本不存在，
 * 不先适应视图就去找它，只会得出「画布上没有这张卡」的假结论。
 */
export async function fitCanvasView(win) {
  const fit = canvasFitViewButton(win)
  await clickOrFail(fit, '画布「适应视图」')
  await waitForVisualQuiescence(win)
}

/**
 * 从 source 卡右侧那颗「+」起线，拖到 target 卡中间松手（同 canvas-batch-production.walk.mjs 的手法）。
 * 返回连线前后画布上的边数，调用方自己判「连上了没有」。
 */
export async function connectNodes(win, sourceId, targetId, readEdges) {
  const before = (await readEdges()).length
  await selectNode(win, sourceId)
  const start = await findConnectionStartPoint(win, { handleSelector: `${nodeSelector(sourceId)} .generation-canvas-react-flow__handle--source[data-side="right"]` })
  const target = await win.locator(nodeSelector(targetId)).first().boundingBox()
  if (!start || !target) throw new Error(`连线起点或目标找不到：${JSON.stringify({ start, target })}`)
  await win.mouse.move(start.x, start.y)
  await win.mouse.down()
  await win.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 14 })
  await win.mouse.up()
  await expect.poll(async () => (await readEdges()).length, { message: `${sourceId} → ${targetId} 连上了`, timeout: stationTimeout() }).toBeGreaterThan(before)
}

/** 这个元素整块都在视口里吗（卡片被放得很大时，它下面那条 composer 常常在视口外）。 */
async function fullyInViewport(win, locator) {
  const box = await locator.boundingBox()
  const viewport = win.viewportSize()
  return Boolean(box && viewport && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height)
}

/**
 * 像人一样把一个画布上的控件弄进视口：它在视口外，就在画布空白处按住 Ctrl 滚轮缩小一点，直到整块看得见。
 * （打开项目时只有一张卡，画布会把它放得很大，那张卡的 ↑ 就在窗口下沿之外。）
 */
export async function zoomOutUntilVisible(win, locator, { maxSteps = 8 } = {}) {
  for (let step = 0; step < maxSteps; step += 1) {
    if (await fullyInViewport(win, locator)) return true
    const blank = await findCanvasBlankPoint(win)
    if (!blank) break
    await win.mouse.move(blank.x, blank.y)
    await win.keyboard.down('Control')
    await win.mouse.wheel(0, 240)
    await win.keyboard.up('Control')
    await win.waitForTimeout(250)
  }
  return fullyInViewport(win, locator)
}

/** 点一个只露出一部分的控件：点它露在视口里的那一块的中心（真人就是这么点被裁掉半截的按钮的）。 */
export async function clickVisiblePart(win, locator, label) {
  const target = locator.first()
  await expect(target, `「${label}」没出现`).toBeAttached({ timeout: stationTimeout() })
  // 人点的是**看得见、点得着**的那一块：伸出窗口的部分、被别的面板盖住的部分都点不到。
  // 在元素盒子里撒一排点，逐个问浏览器「这一点上最上面的是谁」，点第一个真落在它身上的点；顺手报回有多少点被盖住。
  const hit = await target.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const cols = 9
    const rows = 3
    let reachable = 0
    let point = null
    for (let column = 0; column < cols; column += 1) {
      for (let row = 0; row < rows; row += 1) {
        const x = rect.left + (rect.width * (column + 0.5)) / cols
        const y = rect.top + (rect.height * (row + 0.5)) / rows
        if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue
        const top = document.elementFromPoint(x, y)
        if (!top || (top !== element && !element.contains(top))) continue
        reachable += 1
        point ??= { x, y }
      }
    }
    return { rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, reachable, total: cols * rows, point }
  })
  if (!hit.point) throw new Error(`「${label}」没有一处点得到（在视口外或被盖住：${JSON.stringify(hit.rect)}），用户点不到`)
  await win.mouse.click(hit.point.x, hit.point.y)
  return { covered: hit.reachable < hit.total, reachable: hit.reachable, total: hit.total, rect: hit.rect }
}

/**
 * 选中节点，点它 composer 上的 ↑（生成）。弹出付费确认框就点确认——那一下和 ↑ 是同一次「用户点头」。
 * @returns {Promise<'direct'|'dialog'>}
 */
export async function clickNodeGenerate(win, nodeId) {
  await selectNode(win, nodeId)
  const generate = win.locator(`[data-node-id="${nodeId}"] [data-bar-segment="generate"]`).first()
  await expect(generate, `${nodeId} 的 ↑ 能按`).toBeEnabled({ timeout: stationTimeout() })
  // 人会先把它弄到看得见、点得着的地方：拖画布（中键）让它落进舞台；卡太大拖不进来，就先缩小一点再拖。
  let reach = await panCanvasUntilInside(win, generate)
  if (!reach.ok) {
    await zoomOutUntilVisible(win, generate)
    reach = await panCanvasUntilInside(win, generate)
  }
  if (!reach.ok) throw new Error(`${nodeId} 的 ↑ 拖不进舞台：${JSON.stringify(reach)}`)
  // 按下去之后只有两种结果：弹出付费确认框（那一下还要再点确认），或者这张卡直接开跑（data-status 变了——
  // 进了 queued / running，或者快到直接落成 success / error）。按之前先记下它原来的状态，免得把上一次的失败当成这一次开跑。
  const dialog = win.locator(SPEND_DIALOG).first()
  const card = win.locator(`[data-node-id="${nodeId}"]`).first()
  const before = (await card.getAttribute('data-status').catch(() => null)) ?? 'idle'
  const runsBefore = await card.getAttribute('data-run-count').catch(() => null)
  await clickOrFail(generate, `${nodeId} 的 ↑（生成）`, { noWaitAfter: true })
  let outcome = 'waiting'
  await expect.poll(async () => {
    const status = (await card.getAttribute('data-status').catch(() => null)) ?? 'idle'
    if (await dialog.isVisible().catch(() => false)) outcome = 'dialog'
    else if (status === 'queued' || status === 'running' || status !== before
      || (runsBefore !== null && (await card.getAttribute('data-run-count').catch(() => null)) !== runsBefore)) outcome = 'direct'
    return outcome
  }, { message: `${nodeId} 按了 ↑ 之后既没弹确认框、也没开跑（点击没生效）`, timeout: stationTimeout() }).not.toBe('waiting')
  if (outcome === 'direct') return 'direct'
  await clickOrFail(dialog.locator('[data-spend-confirm-action="confirm"]'), '付费确认框「确认」', { noWaitAfter: true })
  return 'dialog'
}
