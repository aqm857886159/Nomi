// R13 / R16 走查 —— 框工具的**另一半**真实任务：先摆东西，再把它们圈起来，然后整块搬家。
// 用法: node tests/ux/canvas-frame-real-task.walk.mjs   产出: tests/ux/shots/canvas-frame-real-task/*.png
//
// 和 canvas-frame.walk.mjs 的分工（两条都要，不是重复）：
//   · canvas-frame.walk.mjs 走的是「**先画空框**，再往里丢东西」，验的是框的生产闭环
//     （画 → 拖进 → 改名 → 拖出 → 折叠 → 整框生成 → 进时间轴 → 解散）。
//   · 本条走的是**反过来的那半**——用户手上**已经有东西**了，他要做的是
//     「把这几样圈成一组」，然后**把这一块整个挪走腾地方**，挪错了再撤销。
//     这半边一条断言都没有过，而它恰好是画布上最常见的动作：先做，再收拾。
//
// 一句话的任务（读得懂的那种）：
//   用户在写第三幕「雨夜」。他已经在画布上摆了三样：一段提示词文字、一张参考图、一个视频镜头。
//   他要：把这三样圈成一个框 → 起名「第三幕 · 雨夜」 → 补一个镜头进来 →
//   把那张其实属于别场戏的参考图挪出去 → 把整框挪到右下角腾地方 → 觉得挪错了，⌘Z 撤销。
//
// 三条最要紧的断言（都在这条路上，别的走查都够不着）：
//   ① 圈完之后框里**就是那三样**——用户圈了三个东西，框却说「0」，是这一族最伤的一下；
//   ② 整框搬家时框**跟着走、不变形**——框的位置有两份真相（用户画的矩形 + 成员位置），
//      只搬其中一份，框就会被拉成一条长方形（左上角钉在原地、右下角被成员拽走）；
//   ③ 搬家**不是**入组/退组——半空中不该冒出「3 → 2」那种归属预览。
//      这条用 expectAbsent + 前面拖进拖出证过的同一把探针，不是空话。
//
// UI / IPC / 持久化全是真的。这条任务里没有任何生成，所以**不需要**供应商 loopback：
// 少接一个 mock 就少一处「其实没验到」的可能。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import {
  CANVAS_FRAME_SELECTOR,
  findCanvasBlankPoint,
  findFrameDragHandlePoint,
  findFrameDrawRectAround,
  findNodeHitPoint,
} from './_canvasHit.mjs'
import {
  applyColorSchemeForShot,
  expectAbsent,
  expectOverlayReachable,
  expectVisible,
  proveProbe,
  screenshotSettled,
} from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-frame-real-task')
fs.rmSync(shotsDir, { recursive: true, force: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-frame-real-task-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const failures = []
let shotIndex = 0

function check(ok, message, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${message}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(`${message}${detail ? ` — ${detail}` : ''}`)
}

async function snap(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await screenshotSettled(win, { path: file })
  console.log(`  · shot ${path.basename(file)}`)
  return file
}

/** 手势还在半空中的那一帧：不能等静止（等到静止手势就结束了），所以单独截。 */
async function snapMidflight(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  · shot ${path.basename(file)} (midflight)`)
  return file
}

const frameLocator = (win) => win.locator(CANVAS_FRAME_SELECTOR).first()
/** 归属预览的探针：拖进/拖出时框上会挂 data-frame-membership。搬家那一步要证明它**不出现**。 */
const membershipProbe = (win) => win.locator(`${CANVAS_FRAME_SELECTOR}[data-frame-membership]`)

async function fitView(win) {
  await win.locator('.generation-canvas-v2__zoom-bar button[aria-label="适应视图"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(1200)
}

/**
 * 缩一点，好在东西**外面**下笔。走的是缩放条那条现役路径（用户会做的动作），
 * 不是 `setCanvasZoom` 走后门——后门改的是 store，改不出用户手上那一下。
 */
async function zoomOutForFraming(win) {
  const slider = win.locator('.generation-canvas-v2__zoom-bar input[aria-label="缩放比例"]').first()
  const current = Number(await slider.inputValue())
  if (!Number.isFinite(current) || current <= 0) throw new Error('读不到当前缩放比例（fail-closed）')
  await slider.fill(String(Math.max(20, Math.round(current * 0.72))))
  await win.waitForTimeout(700)
}

async function readFrameState(win) {
  return win.evaluate((selector) => {
    const frame = document.querySelector(selector)
    if (!frame) return null
    const rect = frame.getBoundingClientRect()
    return {
      groupId: frame.getAttribute('data-group-id'),
      empty: frame.getAttribute('data-frame-empty') === 'true',
      membership: frame.getAttribute('data-frame-membership'),
      count: frame.querySelector('[data-frame-count="true"]')?.textContent?.trim() ?? '',
      title: frame.querySelector('[data-frame-title="true"]')?.textContent?.trim() ?? '',
      borderStyle: getComputedStyle(frame).borderStyle,
      // 屏幕矩形：用户看见的那个。
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      // **画布坐标**里的那个（框是 ViewportPortal 里的绝对定位 div，inline left/top 就是流坐标）。
      // 「框搬了多远」必须在这套坐标里问：屏幕坐标同时被视口平移改写，
      // 拿它去量会把「画布自己滚了一下」算进「框搬了多远」——正好是这一轨在治的那种两份真相混用。
      flowBox: {
        x: parseFloat(frame.style.left),
        y: parseFloat(frame.style.top),
        w: parseFloat(frame.style.width),
        h: parseFloat(frame.style.height),
      },
      viewportTransform: document.querySelector('.react-flow__viewport')?.style.transform ?? null,
    }
  }, CANVAS_FRAME_SELECTOR)
}

/** 从 React Flow 视口的 transform 串里取缩放。取不到就 fail-closed——猜一个 1 会让换算静默错掉。 */
function readViewportScale(transform) {
  const match = /scale\(([-0-9.]+)\)/.exec(transform || '')
  const scale = match ? Number(match[1]) : Number.NaN
  if (!Number.isFinite(scale) || scale <= 0) throw new Error(`读不到画布缩放（fail-closed）：transform=${transform}`)
  return scale
}

/** 一次取样：每个节点此刻在画布坐标系里的位置（读 React Flow 写上去的 transform，不受亚像素影响）。 */
async function readNodePositions(win, nodeIds) {
  return win.evaluate((ids) => {
    const out = {}
    for (const id of ids) {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
      const match = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(el?.style.transform || '')
      out[id] = match ? { x: Number(match[1]), y: Number(match[2]) } : null
    }
    return out
  }, [...nodeIds])
}

/**
 * 找一个「确定在框外」的落点（屏幕坐标）。
 *
 * 框必须**现量**：装进东西之后它按「只长不缩」长过了，照画框那会儿的矩形算「上方一点」
 * 很可能还落在长大后的框**里面**——判定如实回答「没出去」，看着却像退组坏了。
 *
 * 四个方向都试（右 → 下 → 上 → 左）而不是只试上和左：这一屏里框可能已经顶到舞台上沿，
 * 只试两个方向就会在「其实右边空着一大片」的时候 fail-closed，把一次能跑的走查判成跑不了。
 * 四边都挤不下才抛——那时候是真的没地方，不硬拖一个自己都不确定在框外的点。
 */
async function pickPointOutsideFrame(win, { gap = 120, inset = 50 } = {}) {
  const frame = await frameLocator(win).boundingBox()
  if (!frame) throw new Error('量不到框，找不出框外落点（fail-closed）')
  const stage = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stage) throw new Error('量不到画布 stage（fail-closed）')
  const midX = frame.x + frame.width / 2
  const midY = frame.y + frame.height / 2
  const candidates = [
    { x: frame.x + frame.width + gap, y: midY },
    { x: midX, y: frame.y + frame.height + gap },
    { x: midX, y: frame.y - gap },
    { x: frame.x - gap, y: midY },
  ]
  const fits = (point) =>
    point.x >= stage.x + inset &&
    point.x <= stage.x + stage.width - inset &&
    point.y >= stage.y + inset &&
    point.y <= stage.y + stage.height - inset
  const picked = candidates.find(fits)
  if (!picked) {
    throw new Error(
      `框四周都没地方把卡拖出去（fail-closed）：frame=${JSON.stringify(frame)} stage=${JSON.stringify(stage)}`,
    )
  }
  return { x: Math.round(picked.x), y: Math.round(picked.y) }
}

/**
 * 把一张卡拖到「它的**中心**落在 desiredCenter」的位置；`onMidflight` 在**松手前**跑。
 * 抓点必须现找（新建的卡会落在视口外，往负坐标 move 根本不触发拖动），落点必须按**卡心**
 * 算（入组判据看的是中心，鼠标抓的是卡上任意一点，两者差一个偏移）——两个坑都在
 * canvas-frame.walk.mjs 的同名函数里有完整根因，这里保持同一套做法。
 */
async function dragNodeTo(win, nodeId, desiredCenter, onMidflight) {
  const nodeSelector = `.react-flow__node[data-id="${nodeId}"]`
  const handle = await findNodeHitPoint(win, { nodeSelector })
  if (!handle) throw new Error(`拖不动 ${nodeId}：这张卡上找不到露在外面的可抓点（fail-closed，不猜坐标）`)
  const rect = await win.locator(nodeSelector).boundingBox()
  if (!rect) throw new Error(`拖不动 ${nodeId}：量不到这张卡的盒子`)
  const grabOffset = { x: handle.x - (rect.x + rect.width / 2), y: handle.y - (rect.y + rect.height / 2) }
  const target = { x: Math.round(desiredCenter.x + grabOffset.x), y: Math.round(desiredCenter.y + grabOffset.y) }
  await win.mouse.move(handle.x, handle.y)
  await win.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await win.mouse.move(
      handle.x + ((target.x - handle.x) * step) / 6,
      handle.y + ((target.y - handle.y) * step) / 6,
      { steps: 4 },
    )
  }
  await win.waitForTimeout(240)
  if (onMidflight) await onMidflight()
  await win.mouse.up()
  await win.waitForTimeout(700)
}

const { app, win } = await launchNomiApp({
  name: 'canvas-frame-real-task',
  userDataDir,
  settingsDir,
  projectsDir,
  settleMs: 1200,
  args: ['--no-proxy-server'],
})

try {
  const browserWindow = await app.browserWindow(win)
  await browserWindow.evaluate((window) => window.setBounds({ x: 0, y: 0, width: 1680, height: 1020 }))
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi-onboarding-checklist:v1']) {
      window.localStorage.setItem(key, 'seen')
    }
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')
  await win.getByText('新建空白项目', { exact: false }).first().waitFor({ timeout: 30_000 })
  for (let index = 0; index < 4; index += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(200)
  }
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 8000 })
  await win.locator('[aria-label="工作区切换"]').first().waitFor({ timeout: 30_000 })
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 8000 })
  await win.locator('.generation-canvas-v2-toolbar').first().waitFor({ timeout: 30_000 })
  await win.waitForTimeout(600)

  // ── ① 先摆三样东西：一段提示词文字 + 一张参考图 + 一个视频镜头 ──
  // 三种**不同**的节点是刻意的：框不该挑食（它是「你摆东西的地方」，不是某一类内容的容器），
  // 而三种卡的渲染高度差得很远，正好把「判定线跟不跟得上视觉边」这件事一起带过一遍。
  const plan = [
    { kind: 'text', prompt: '第三幕 · 雨夜：霓虹在积水里碎成一片' },
    { kind: 'image', prompt: '雨夜街口的参考图（其实是第一幕的）' },
    { kind: 'video', prompt: '镜头 1：主角推门走进雨里' },
  ]
  const nodeIds = []
  const nodeByKind = {}
  for (const item of plan) {
    await addCanvasNodeFromRail(win, item.kind)
    await win.waitForTimeout(900)
    const ids = await win.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => node.getAttribute('data-id')))
    const created = ids.find((id) => id && !nodeIds.includes(id))
    if (!created) throw new Error(`${item.kind} 节点没建出来`)
    nodeIds.push(created)
    nodeByKind[item.kind] = created
    const editor = win.locator(`[data-node-id="${created}"] div[contenteditable="true"]`).last()
    await editor.click({ timeout: 6000 })
    await editor.fill(item.prompt)
    await win.waitForTimeout(300)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(200)
  }
  check(nodeIds.length === 3, '文字 / 图 / 视频三张卡都摆上了', nodeIds.join(', '))
  await fitView(win)
  // 「适应视图」把三张卡刚好铺满这一屏（实测上下只剩 ~45px），要在它们**外面**起手圈一圈
  // 就没地方下笔了。用户这时会做的事就是缩一点——所以这里也缩一点，走的是缩放条那条现役路径。
  await zoomOutForFraming(win)
  // 清掉选中：刚编辑完的那张还选着，选中的卡会在下方展开提示词面板，把画框要用的空白吃掉。
  const blankPoint = await findCanvasBlankPoint(win, { preference: 'bottom', inset: 48 })
  if (!blankPoint) throw new Error('找不到空白点清选中（fail-closed）')
  await win.mouse.click(blankPoint.x, blankPoint.y)
  await win.waitForTimeout(500)
  await snap(win, 'three-loose-nodes')

  // ── ② 按 F，从三张卡**外面**起手，拖一圈把它们圈起来 ──
  const frameButton = win.locator('.generation-canvas-v2__zoom-bar button[aria-label="画框"]').first()
  await expectVisible(frameButton, '左下画布工具簇里有「画框」这颗钮')
  await win.keyboard.press('f')
  await win.waitForTimeout(400)
  check(await frameButton.getAttribute('aria-pressed') === 'true', '按 F，画框工具就绪')

  const nodeSelectors = nodeIds.map((id) => `.react-flow__node[data-id="${id}"]`)
  let drawRect = await findFrameDrawRectAround(win, { nodeSelectors, margin: 56 })
  if (!drawRect) {
    const diag = await win.evaluate((selectors) => {
      const stage = document.querySelector('.generation-canvas-v2__stage')
      const stageRect = stage?.getBoundingClientRect()
      return {
        stage: stageRect ? { l: Math.round(stageRect.left), t: Math.round(stageRect.top), r: Math.round(stageRect.right), b: Math.round(stageRect.bottom) } : null,
        nodes: selectors.map((selector) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect()
          return rect ? { l: Math.round(rect.left), t: Math.round(rect.top), r: Math.round(rect.right), b: Math.round(rect.bottom) } : null
        }),
      }
    }, nodeSelectors)
    throw new Error(`这一屏圈不下这三张卡（fail-closed，不硬夹一个圈不全的框）：${JSON.stringify(diag)}`)
  }
  await win.mouse.move(drawRect.x, drawRect.y)
  await win.mouse.down()
  await win.mouse.move(drawRect.x + drawRect.width / 2, drawRect.y + drawRect.height / 2, { steps: 6 })
  await win.mouse.move(drawRect.x + drawRect.width, drawRect.y + drawRect.height, { steps: 6 })
  await win.waitForTimeout(200)
  await snapMidflight(win, 'drawing-around-three')
  await win.mouse.up()
  await win.waitForTimeout(900)

  const drawn = await readFrameState(win)
  check(Boolean(drawn), '拖完得到一个框')
  // 这一句同时是后面每一条「框上有/没有某属性」的基线：同一把选择器此刻确实命中得到框。
  const frameProof = await proveProbe(frameLocator(win), '画完之后这把选择器命中画布上的框')
  // ★ 本条走查的第一个要害：用户圈了三样东西，框就该说「3」。
  check(drawn?.count === '3', '★ 圈进去的三样**都进了这个框**（用户圈了 3 个，框就说 3）', `count=${drawn?.count}`)
  check(drawn?.empty === false, '圈住了东西 = 不是空框（实线，不是刚画完那种虚线）', `empty=${drawn?.empty}`)
  check(drawn?.borderStyle === 'solid', '有成员的框画实线', `borderStyle=${drawn?.borderStyle}`)
  check(await frameButton.getAttribute('aria-pressed') === 'false', '画完一次工具自动收起')
  await snap(win, 'framed-three')

  // ── ③ 起个名 ──
  const title = frameLocator(win).locator('[data-frame-title="true"]').first()
  await title.dblclick({ timeout: 6000 })
  await win.waitForTimeout(300)
  const nameInput = frameLocator(win).locator('input[aria-label^="重命名框"]').first()
  await expectVisible(nameInput, '双击标题进了编辑态')
  await nameInput.fill('第三幕 · 雨夜')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(600)
  check((await readFrameState(win))?.title === '第三幕 · 雨夜', '框改名成功')
  await snap(win, 'named')

  // 双击标题会顺带选中全部成员（点框 = 选中全组，既有行为）。下一步要拖的是**一张**卡，
  // 不先松开这批选择，拖的就是整批——量到的会是「4 → 0」这种莫名其妙的数。
  await win.mouse.click(blankPoint.x, blankPoint.y)
  await win.waitForTimeout(500)

  // ── ④ 补一个镜头进来 ──
  await addCanvasNodeFromRail(win, 'video')
  await win.waitForTimeout(900)
  const afterAdd = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => node.getAttribute('data-id')))
  const extraNodeId = afterAdd.find((id) => id && !nodeIds.includes(id))
  if (!extraNodeId) throw new Error('第四个节点没建出来')
  await fitView(win)
  await win.mouse.click(blankPoint.x, blankPoint.y)
  await win.waitForTimeout(400)

  const frameBoxNow = await frameLocator(win).boundingBox()
  if (!frameBoxNow) throw new Error('量不到框，算不出往哪儿拖（fail-closed）')
  let joinMidflight = null
  let joinProof = null
  await dragNodeTo(
    win,
    extraNodeId,
    { x: frameBoxNow.x + frameBoxNow.width * 0.5, y: frameBoxNow.y + frameBoxNow.height * 0.5 },
    async () => {
      joinMidflight = await readFrameState(win)
      // 归属预览确实会出现——这就是第 ⑥ 步 expectAbsent 要用的基线，在**它会出现**的现场证一次。
      joinProof = await proveProbe(membershipProbe(win), '拖进框的半空中，框上确实挂着归属预览')
      await snapMidflight(win, 'drag-join-midflight')
    },
  )
  check(joinMidflight?.membership === 'join', '拖进去的半空中框就亮起「要进来了」', `membership=${joinMidflight?.membership}`)
  check(joinMidflight?.count === '3 → 4', '计数预览写着「3 → 4」', `count=${joinMidflight?.count}`)
  check((await readFrameState(win))?.count === '4', '松手后框里是 4 个')
  await snap(win, 'four-in-frame')

  // ── ⑤ 把那张参考图挪出去（它其实属于第一幕） ──
  const outside = await pickPointOutsideFrame(win)
  let leaveMidflight = null
  await dragNodeTo(win, nodeByKind.image, outside, async () => {
    leaveMidflight = await readFrameState(win)
    await snapMidflight(win, 'drag-leave-midflight')
  })
  check(leaveMidflight?.membership === 'leave', '拖出去的半空中框就说了「要走了」', `membership=${leaveMidflight?.membership}`)
  check(leaveMidflight?.count === '4 → 3', '计数预览写着「4 → 3」', `count=${leaveMidflight?.count}`)
  const afterLeave = await readFrameState(win)
  check(afterLeave?.count === '3', '松手后框里剩 3 个——框没有追着它长大重新包住', `count=${afterLeave?.count}`)
  await snap(win, 'after-leave')

  // ── ⑥ ★ 把整个框挪到别处腾地方 ──
  // 这是本条走查的第二个要害。框的位置有**两份真相**：用户画的那个矩形（frameBounds）
  // 和成员各自的位置；渲染出来的框是两者的并集，而且**只长不缩**。
  // 只搬其中一份，框就会被拉长——左上角钉在原地、右下角被跑掉的成员拽走。
  // 这在真机上看起来不像 bug，像「框怎么越拖越大」，用户会以为自己拖错了。
  await win.mouse.click(blankPoint.x, blankPoint.y)
  await win.waitForTimeout(400)
  const memberIds = nodeIds.filter((id) => id !== nodeByKind.image).concat(extraNodeId)
  const beforeMove = await readFrameState(win)
  const positionsBeforeMove = await readNodePositions(win, memberIds)
  const grab = await findFrameDragHandlePoint(win)
  if (!grab) throw new Error('框上找不到露在外面的可抓点（fail-closed，不去抓标题也不去抓卡片）')
  // 往右下挪多少，按**这一屏还剩多少地方**算，不写死一个数：框的大小取决于用户圈了多大一圈，
  // 写死 150×90 在框已经贴着舞台右下沿时会把框推出视口，量到的「框没走那么远」其实是被裁掉了。
  // 位移必须够大（≥60px），不然「框跟着走了」和「框纹丝不动」在 6px 的容差里分不开。
  const frameBeforeMove = await frameLocator(win).boundingBox()
  if (!frameBeforeMove) throw new Error('量不到框，算不出搬多远（fail-closed）')
  const stageForMove = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stageForMove) throw new Error('量不到画布 stage（fail-closed）')
  const moveDelta = {
    x: Math.round(Math.min(150, stageForMove.x + stageForMove.width - 16 - (frameBeforeMove.x + frameBeforeMove.width))),
    y: Math.round(Math.min(90, stageForMove.y + stageForMove.height - 16 - (frameBeforeMove.y + frameBeforeMove.height))),
  }
  if (moveDelta.x < 60 || moveDelta.y < 40) {
    throw new Error(`这一屏右下角没地方把框整个挪过去（fail-closed）：delta=${JSON.stringify(moveDelta)}`)
  }
  await win.mouse.move(grab.x, grab.y)
  await win.mouse.down()
  for (let step = 1; step <= 6; step += 1) {
    await win.mouse.move(grab.x + (moveDelta.x * step) / 6, grab.y + (moveDelta.y * step) / 6, { steps: 4 })
  }
  await win.waitForTimeout(240)
  await snapMidflight(win, 'frame-moving-midflight')
  // ★ 第三个要害：搬家不是入组也不是退组。基线是第 ④ 步在**它会出现**的现场证过的同一把探针。
  await expectAbsent(membershipProbe(win), {
    provenBy: joinProof,
    message: '整框搬家的半空中不该冒出归属预览（搬家不是入组/退组，别让用户以为有东西要进出）',
  })
  await win.mouse.up()
  await win.waitForTimeout(900)

  const afterMove = await readFrameState(win)
  const positionsAfterMove = await readNodePositions(win, memberIds)
  check(afterMove?.count === '3', '搬家不改成员：框里还是 3 个', `count=${afterMove?.count}`)
  // 尺寸：在**画布坐标**里比（屏幕尺寸还要乘一个缩放，缩放变一下就假红）。允许 1px 取整误差。
  const widthDrift = Math.abs((afterMove?.flowBox.w ?? 0) - (beforeMove?.flowBox.w ?? 0))
  const heightDrift = Math.abs((afterMove?.flowBox.h ?? 0) - (beforeMove?.flowBox.h ?? 0))
  check(
    widthDrift <= 1 && heightDrift <= 1,
    '★ 整框搬家之后框还是原来那么大——没有被拉长',
    `${beforeMove?.flowBox.w}×${beforeMove?.flowBox.h} → ${afterMove?.flowBox.w}×${afterMove?.flowBox.h}`,
  )
  // 位置：手在屏幕上走了多远，框就该在画布上走「那么远 ÷ 缩放」。
  // 两个坐标系必须换算清楚再比——直接拿屏幕位移比屏幕位移，会把视口平移一起算进来。
  const zoomForMove = readViewportScale(beforeMove?.viewportTransform)
  const frameShift = {
    x: (afterMove?.flowBox.x ?? 0) - (beforeMove?.flowBox.x ?? 0),
    y: (afterMove?.flowBox.y ?? 0) - (beforeMove?.flowBox.y ?? 0),
  }
  const expectedShift = { x: moveDelta.x / zoomForMove, y: moveDelta.y / zoomForMove }
  check(
    Math.abs(frameShift.x - expectedShift.x) <= 4 && Math.abs(frameShift.y - expectedShift.y) <= 4,
    '★ 框跟着手走了同样的距离',
    `手 ${moveDelta.x},${moveDelta.y} 屏幕像素 ÷ ${zoomForMove.toFixed(3)} = 画布 ${expectedShift.x.toFixed(1)},${expectedShift.y.toFixed(1)}`
      + ` → 框实走 ${frameShift.x.toFixed(1)},${frameShift.y.toFixed(1)}`,
  )
  const membersFollowed = memberIds.every((id) => {
    const before = positionsBeforeMove[id]
    const after = positionsAfterMove[id]
    if (!before || !after) return false
    return Math.abs(after.x - before.x) > 20 && Math.abs(after.y - before.y) > 10
  })
  check(membersFollowed, '框里的东西跟着框一起搬走了（拖框 = 搬这一块，不是只搬那层皮）')

  // ⑥b 抓完框，它的**名字还看得见**吗？
  // 抓框 = 选中框里全部成员（既有行为），选择浮条随即出现在成员外接盒上方 16px；
  // 而框的名字/说明/计数就写在比成员外接盒还高 52px 的那条标签带上——浮条不偏不倚正好盖住。
  // 真机实拍（2026-09-07 修前的 10-frame-moved.png）里「第三幕 · 雨夜」只从「已选 3 个」
  // 左边露出一点点。用户刚起完名，手一搭上去名字就没了，而那正是他确认「抓的是不是这一个」
  // 唯一的凭据。这两条断言钉的就是这处遮挡。
  const selectionToolbar = win.locator('.generation-canvas-v2__selection-toolbar').first()
  await expectVisible(selectionToolbar, '抓完框，选择浮条确实在这一屏（不然下一条就是句空话）')
  await expectOverlayReachable(
    frameLocator(win).locator('.generation-canvas-v2__group-box-label').first(),
    '框的名字与计数（选择浮条不该盖住你刚抓住的那个框的身份牌）',
  )
  await snap(win, 'frame-moved')

  // ── ⑦ 挪错了，⌘Z 撤销一次 ──
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await win.waitForTimeout(1000)
  const afterUndo = await readFrameState(win)
  const positionsAfterUndo = await readNodePositions(win, memberIds)
  check(
    Math.abs((afterUndo?.flowBox.x ?? 0) - (beforeMove?.flowBox.x ?? 0)) <= 1 &&
      Math.abs((afterUndo?.flowBox.y ?? 0) - (beforeMove?.flowBox.y ?? 0)) <= 1,
    '⌘Z 一次，框回到搬家之前的位置',
    `${JSON.stringify(beforeMove?.flowBox)} → ${JSON.stringify(afterUndo?.flowBox)}`,
  )
  check(
    Math.abs((afterUndo?.flowBox.w ?? 0) - (beforeMove?.flowBox.w ?? 0)) <= 1 &&
      Math.abs((afterUndo?.flowBox.h ?? 0) - (beforeMove?.flowBox.h ?? 0)) <= 1,
    '撤销回来的框还是原来那么大（撤销不该留下一个变形的框）',
    `${beforeMove?.flowBox.w}×${beforeMove?.flowBox.h} → ${afterUndo?.flowBox.w}×${afterUndo?.flowBox.h}`,
  )
  const membersRestored = memberIds.every((id) => {
    const before = positionsBeforeMove[id]
    const after = positionsAfterUndo[id]
    return before && after && Math.abs(after.x - before.x) <= 2 && Math.abs(after.y - before.y) <= 2
  })
  check(membersRestored, '成员也一起回来了——整块搬家是**一层**撤销，不是三次')
  check(afterUndo?.count === '3', '撤销没有把成员关系一起撤掉', `count=${afterUndo?.count}`)
  check(afterUndo?.title === '第三幕 · 雨夜', '撤销只回退了这一步，名字还在')
  await snap(win, 'after-undo')

  // ── ⑧ 光/暗双模式各留一张：框的边框 / 标题 / 计数在两套 token 下都得看得清 ──
  // 先把框整个拉回视口、松开选择：这两张是给人看「这个框长什么样」的，
  // 留着半截露在屏幕外、再压一条浮条，看的人分不清哪些是设计、哪些是这一屏的巧合。
  await fitView(win)
  const themeBlank = await findCanvasBlankPoint(win, { preference: 'bottom', inset: 48 })
  if (themeBlank) {
    await win.mouse.click(themeBlank.x, themeBlank.y)
    await win.waitForTimeout(500)
  }
  for (const scheme of ['light', 'dark']) {
    await applyColorSchemeForShot(win, scheme)
    await win.waitForTimeout(500)
    await expectVisible(frameLocator(win), `${scheme} 模式下框还在`)
    await snap(win, `theme-${scheme}`)
  }
  // 收尾：证明整条走完之后框仍然在（前面那个 proof 的对照物，别让最后一屏是空的）。
  check(Boolean(await readFrameState(win)), '走完整条任务，框还在画布上', frameProof.label)

} finally {
  await app.close().catch(() => {})
}

console.log(`\n截图：${shotsDir}`)
if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言没过：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log('\n✅ 框工具真实任务走查全部通过')
