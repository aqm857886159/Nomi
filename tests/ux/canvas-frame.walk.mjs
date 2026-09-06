// R13 走查 —— 画布框工具（Frame）第一档的真实用户任务串。
// 用法: node tests/ux/canvas-frame.walk.mjs   产出: tests/ux/shots/canvas-frame/*.png
//
// 走的是一件**用户真会做的事**，不是功能点巡检：
//   按 F 画一个框 → 把 3 个镜头拖进去 → 给这段戏起个名 → 又把 1 个挪出去 →
//   折叠起来腾地方 → 展开 → 整框生成 → 整框排进时间轴 → 解散。
//
// 最要紧的两条断言在「拖进」和「拖出」的**半空中**：实拍里（tests/ux/shots/group-frame-now
// 的 e、e2）那一刻完全没有反馈，松手才发现框追着长大把成员重新包住。所以这里在 mouse.up
// **之前**就要读到 data-frame-membership 与计数预览——松手后再看等于没验到那条反馈。
//
// UI / IPC / 队列 / HTTP 传输 / 持久化 / 时间轴全是真的，只有远端供应商换成 loopback fixture。
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { launchNomiApp } from './_launchApp.mjs'
import { addCanvasNodeFromRail } from './_canvasRail.mjs'
import { findCanvasBlankPoint, findCanvasBlankRect, findNodeHitPoint } from './_canvasHit.mjs'
import { expectAbsent, expectCount, expectVisible, proveProbe, screenshotSettled } from './_assert.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/canvas-frame')
fs.rmSync(shotsDir, { recursive: true, force: true })
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-frame-'))
const userDataDir = path.join(tempRoot, 'user-data')
const settingsDir = path.join(tempRoot, 'settings')
const projectsDir = path.join(tempRoot, 'projects')
for (const dir of [shotsDir, userDataDir, settingsDir, projectsDir]) fs.mkdirSync(dir, { recursive: true })

const NOW = '2026-09-06T00:00:00.000Z'
const VENDOR = 'frame-mock'
const VIDEO_MODEL = 'frame-mock-video'
const videoBytes = fs.readFileSync(path.join(repoRoot, 'tests/ux/fixtures/fixture-video.mp4'))

// 产物用 data: URL 回，而不是回一个 http://127.0.0.1/... 的链接：
// 主进程的 hardenedFetch 对私有/回环地址是**拒绝**的（electron/hardenedFetch.ts:90），
// 只有「供应商 baseUrl 自己的 origin」才在白名单里，而产物取证走的是另一条路径。
// 回 data: URL 让这条走查验的是「整框生成 → 出片 → 落盘 → 进时间轴」，
// 而不是去验一道与本轨无关的网络策略（canvas-batch-production.walk.mjs 同样这么做）。
const videoDataUrl = `data:video/mp4;base64,${videoBytes.toString('base64')}`

// ── loopback 供应商：请求这一段是真的走 HTTP，只是对面是本机 ──
const vendorServer = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/v1/videos/generations') {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ url: videoDataUrl }] }))
      }, 400)
    })
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: `No route ${req.method} ${req.url}` } }))
})
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve))
const port = vendorServer.address().port

fs.writeFileSync(path.join(settingsDir, 'model-catalog.json'), JSON.stringify({
  version: 8,
  vendors: [{
    key: VENDOR,
    name: 'Frame Mock',
    enabled: true,
    baseUrlHint: `http://127.0.0.1:${port}`,
    authType: 'none',
    authHeader: null,
    authQueryParam: null,
    providerKind: 'openai-compatible',
    createdAt: NOW,
    updatedAt: NOW,
  }],
  models: [
    { modelKey: VIDEO_MODEL, vendorKey: VENDOR, labelZh: '框走查视频', kind: 'video', enabled: true, createdAt: NOW, updatedAt: NOW },
  ],
  mappings: [{
    id: `${VIDEO_MODEL}-text_to_video`,
    vendorKey: VENDOR,
    taskKind: 'text_to_video',
    modelKey: VIDEO_MODEL,
    name: `${VIDEO_MODEL} text_to_video`,
    enabled: true,
    create: {
      method: 'POST',
      path: '/v1/videos/generations',
      headers: { 'Content-Type': 'application/json' },
      body: { model: '{{model.modelKey}}', prompt: '{{request.prompt}}' },
      response_mapping: { video_url: 'data.0.url' },
    },
    createdAt: NOW,
    updatedAt: NOW,
  }],
  apiKeysByVendor: {},
}, null, 2))

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

/** 拖动中的那一帧：截图不能等静止（手势还在半空），所以这里单独截。 */
async function snapMidflight(win, name) {
  shotIndex += 1
  const file = path.join(shotsDir, `${String(shotIndex).padStart(2, '0')}-${name}.png`)
  await win.screenshot({ path: file })
  console.log(`  · shot ${path.basename(file)} (midflight)`)
  return file
}

const frameLocator = (win) => win.locator('.generation-canvas-v2__group-box[data-group-id]').first()

/**
 * 点一下「适应视图」。**不是**为了好看：React Flow 开了 `onlyRenderVisibleElements`，
 * 视口外的节点连 DOM 都不在，而生成/让位平移会把画面推走。不先把东西拉回视口，
 * 后面每一条「节点上有没有片子」「框还在不在」都会读到 0，看着像功能坏了。
 */
async function fitView(win) {
  await win.locator('.generation-canvas-v2__zoom-bar button[aria-label="适应视图"]').first().click({ timeout: 6000 })
  await win.waitForTimeout(1200)
}

async function readFrameState(win) {
  return win.evaluate(() => {
    const frame = document.querySelector('.generation-canvas-v2__group-box[data-group-id]')
    if (!frame) return null
    return {
      groupId: frame.getAttribute('data-group-id'),
      empty: frame.getAttribute('data-frame-empty') === 'true',
      membership: frame.getAttribute('data-frame-membership'),
      count: frame.querySelector('[data-frame-count="true"]')?.textContent?.trim() ?? '',
      title: frame.querySelector('[data-frame-title="true"]')?.textContent?.trim() ?? '',
      dashed: getComputedStyle(frame).borderStyle,
    }
  })
}

/**
 * 「节点在哪、画布在哪」的一次取样。两者都读 transform 字符串而不是 bounding box：
 * box 会被亚像素与滚动条影响，transform 是 React Flow 自己写上去的那个值，动没动一目了然。
 */
async function readNodeAndViewport(win, nodeId) {
  return win.evaluate((id) => ({
    nodeTransform: document.querySelector(`.react-flow__node[data-id="${id}"]`)?.style.transform ?? null,
    viewportTransform: document.querySelector('.react-flow__viewport')?.style.transform ?? null,
  }), nodeId)
}

/**
 * 把一张卡拖到「它的**中心**落在 desiredCenter」的位置；`onMidflight` 在**松手前**跑
 * （那一刻才有归属反馈可读）。
 *
 * 两个坑都踩过，都写在这儿：
 *  ① 抓点不能用「卡的左上角 + 固定偏移」。新建的节点会落在视口外（实测第 1、2 张卡的
 *     screen y 是负数），往负坐标 move 根本不触发拖动——三次断言全红、卡却一动没动，
 *     看起来像功能坏了。`findNodeHitPoint` 找的是「这张卡上还露着、且不是按钮」的那一点。
 *  ② 落点要按**中心**算，不是按鼠标终点算。入组判据是卡的中心落没落在框里
 *     （canvasPointerGestureModel.frameContainsNodeCenter），而鼠标抓的是卡上的任意一点，
 *     两者差一个偏移；照鼠标终点摆，卡心会落在框外，于是「拖进去了却没入组」。
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
  // 分几步走：React Flow 的拖动内核按 pointermove 积分，一步跳到底会被当成一次瞬移。
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

/**
 * 找一个「肯定在框外」的落点（屏幕坐标）。
 *
 * 必须**现量**框：装进成员之后框已经按「只长不缩」长大了（卡比框大，union 连上沿一起顶），
 * 拿画完那会儿的小框算「上方 90px」，落点其实还在长大后的框里面——判定如实回答「没出去」，
 * 看着却像退组坏了。这一条 2026-09-07 真踩过。
 *
 * 优先往上（截图里框与卡同屏，人眼才看得出「它正被拽出去」），上面挤不下就往左；
 * 两边都挤不下就 fail-closed，不硬拖一个自己都不确定在框外的点。
 */
async function pickPointOutsideFrame(win) {
  const frameBox = await frameLocator(win).boundingBox()
  if (!frameBox) throw new Error('量不到框，找不出框外落点（fail-closed）')
  const stageBox = await win.locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stageBox) throw new Error('量不到画布 stage（fail-closed）')
  const point = frameBox.y - 130 >= stageBox.y + 60
    ? { x: frameBox.x + frameBox.width / 2, y: frameBox.y - 130 }
    : { x: frameBox.x - 150, y: frameBox.y + frameBox.height / 2 }
  if (point.x < stageBox.x + 40 || point.y < stageBox.y + 40) {
    throw new Error(`框四周都没有地方把卡拖出去（fail-closed）：frame=${JSON.stringify(frameBox)}`)
  }
  return point
}

const { app, win } = await launchNomiApp({
  name: 'canvas-frame',
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
  // 等项目库真的画出来（有「新建空白项目」这个入口），不是睡两秒赌它渲染完了。
  await win.getByText('新建空白项目', { exact: false }).first().waitFor({ timeout: 30_000 })
  for (let index = 0; index < 4; index += 1) {
    const skip = win.locator('button,[role="button"],a', { hasText: /跳过|开始创作|进入|完成|先逛逛/ }).first()
    if (await skip.count()) await skip.click({ timeout: 800 }).catch(() => {})
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(200)
  }
  await win.getByText('新建空白项目', { exact: false }).first().click({ timeout: 8000 })
  // 等真信号（工作区切换出现 = 项目开好了），不是「睡 2.4 秒应该够了」：
  // 项目初始化耗时随机器负载变，睡不够就在一个还没开的项目上继续点，然后一路「通过」。
  await win.locator('[aria-label="工作区切换"]').first().waitFor({ timeout: 30_000 })
  await win.locator('[aria-label="工作区切换"]').getByText('生成', { exact: true }).click({ timeout: 8000 })
  await win.locator('.generation-canvas-v2-toolbar').first().waitFor({ timeout: 30_000 })
  await win.waitForTimeout(600)

  // ── ① 先摆三个镜头（这一段戏的素材），再去空地上画框 ──
  const nodeIds = []
  for (let index = 0; index < 3; index += 1) {
    await addCanvasNodeFromRail(win, 'video')
    await win.waitForTimeout(900)
    const ids = await win.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => node.getAttribute('data-id')))
    const created = ids.find((id) => id && !nodeIds.includes(id))
    if (!created) throw new Error(`第 ${index + 1} 个视频节点没建出来`)
    nodeIds.push(created)
    const editor = win.locator(`[data-node-id="${created}"] div[contenteditable="true"]`).last()
    await editor.click({ timeout: 6000 })
    await editor.fill(`第二幕 · 镜头 ${index + 1}`)
    await win.waitForTimeout(300)
    await win.keyboard.press('Escape')
    await win.waitForTimeout(200)
  }
  check(nodeIds.length === 3, '三个视频镜头都建出来了', nodeIds.join(', '))
  // 适配视图：新建的卡会落到视口外（实测头两张的 screen y 是负数）。用户遇到这种情况
  // 也是先点一下「适应视图」把东西找回来——这一步既是真实动作，也是后面拖拽的前提。
  await fitView(win)
  await snap(win, 'before-frame')

  // ── ② 按 F 画一个框 ──
  // 这里**刻意不写**「画之前没有框」那条断言：新项目里它从第一次取样就恒真，
  // 与「探针根本没生效」在观测上完全一样（expectAbsent 的 provenBy 挡的正是这种空话）。
  // 真正的证据是下一段——同一把选择器在画完之后命中 1 个；那个 proof 留到最后验解散。
  const frameButton = win.locator('.generation-canvas-v2__zoom-bar button[aria-label="画框"]').first()
  await expectVisible(frameButton, '左下画布工具簇里有「画框」这颗钮')
  check(await frameButton.getAttribute('aria-pressed') === 'false', '未按 F 时框工具是未就绪态')

  await win.locator('.generation-canvas-v2__stage').first().click({ position: { x: 8, y: 8 } }).catch(() => {})
  await win.keyboard.press('f')
  await win.waitForTimeout(400)
  check(await frameButton.getAttribute('aria-pressed') === 'true', '按 F 之后工具钮变成就绪态（键与钮是同一个状态）')
  await snap(win, 'frame-tool-armed')

  // ── ②a 手势归属：就绪期间这次拖动不归内核（R29 §6.2） ──
  // 以前是我们在 capture 阶段偷 pointerdown、内核以为自己还在管平移；现在是
  // `panOnDrag={false}` + `nodesDraggable={false}` 明说。差别在真机上只有一处看得见：
  // 就绪时压在一张卡上拖，卡**不能**跟着走——偷事件那版拦不住它（capture 只在 stage 上，
  // 节点自己的 pointerdown 照常把拖动跑起来）。这两条断言钉的就是那处差别。
  {
    const guineaPig = nodeIds[0]
    const before = await readNodeAndViewport(win, guineaPig)
    const hit = await findNodeHitPoint(win, { nodeSelector: `.react-flow__node[data-id="${guineaPig}"]` })
    if (!hit) throw new Error('框工具就绪校验：找不到这张卡上露着的可抓点（fail-closed）')
    await win.mouse.move(hit.x, hit.y)
    await win.mouse.down()
    for (let step = 1; step <= 5; step += 1) {
      await win.mouse.move(hit.x + step * 24, hit.y + step * 18, { steps: 3 })
    }
    await win.waitForTimeout(200)
    await snapMidflight(win, 'armed-drag-on-node-does-nothing')
    await win.mouse.up()
    await win.waitForTimeout(500)
    const after = await readNodeAndViewport(win, guineaPig)
    check(
      before.nodeTransform === after.nodeTransform,
      '框工具就绪时，压在节点上拖 —— 节点不动（nodesDraggable=false）',
      `${before.nodeTransform} → ${after.nodeTransform}`,
    )
    check(
      before.viewportTransform === after.viewportTransform,
      '框工具就绪时，同一次拖动也没有把画布平移走（panOnDrag=false）',
      `${before.viewportTransform} → ${after.viewportTransform}`,
    )
    check(
      await frameButton.getAttribute('aria-pressed') === 'true',
      '这次拖动没有把工具弄丢（压在卡上不算画框，工具仍就绪）',
    )
    // 收工：刚才那一下把卡选中了，选中的卡会在下方展开提示词面板，把后面要找的那片空白吃掉。
    // 点一下空白既清选中（onPaneClick → clearSelection）又收起工具——正是用户改主意时会做的动作。
    const blank = await findCanvasBlankPoint(win)
    if (!blank) throw new Error('找不到空白点来收起框工具（fail-closed，不猜坐标）')
    await win.mouse.click(blank.x, blank.y)
    await win.waitForTimeout(500)
    check(
      await frameButton.getAttribute('aria-pressed') === 'false',
      '就绪后在空白上只点一下（没拖出矩形）= 什么都不建，工具收起',
    )
    await win.keyboard.press('f')
    await win.waitForTimeout(400)
    check(await frameButton.getAttribute('aria-pressed') === 'true', '再按一次 F 重新就绪，接着画')
  }

  const blankRect = await findCanvasBlankRect(win, { width: 560, height: 300 })
  if (!blankRect) throw new Error('画布上找不到一整片空白来画框（fail-closed，不猜坐标）')
  const viewportBeforeDraw = (await readNodeAndViewport(win, nodeIds[0])).viewportTransform
  await win.mouse.move(blankRect.x, blankRect.y)
  await win.mouse.down()
  await win.mouse.move(blankRect.x + blankRect.width / 2, blankRect.y + blankRect.height / 2, { steps: 6 })
  await win.mouse.move(blankRect.x + blankRect.width, blankRect.y + blankRect.height, { steps: 6 })
  await win.waitForTimeout(200)
  await snapMidflight(win, 'frame-drawing')
  await win.mouse.up()
  await win.waitForTimeout(900)

  const drawn = await readFrameState(win)
  check(Boolean(drawn), '拖完得到一个框')
  // 这一句同时是最后「解散之后没有框」的基线：同一把选择器此刻确实命中得到东西。
  const frameProof = await proveProbe(frameLocator(win), '画完之后这把选择器命中画布上的框')
  check(drawn?.empty === true, '刚画完是空框（data-frame-empty）')
  check(drawn?.count === '0', '空框的计数如实显示 0，不藏起来', `count=${drawn?.count}`)
  check(drawn?.dashed === 'dashed', '空框画的是虚线', `borderStyle=${drawn?.dashed}`)
  check(await frameButton.getAttribute('aria-pressed') === 'false', '画完一次工具自动收起（不留一个出不去的模式）')
  check(
    viewportBeforeDraw === (await readNodeAndViewport(win, nodeIds[0])).viewportTransform,
    '画框那一拖没有顺手把画布也拖走（内核的平移被声明式关掉了，不是被我们偷走事件）',
  )
  await snap(win, 'empty-frame')

  const frameBox = await frameLocator(win).boundingBox()
  if (!frameBox) throw new Error('框画出来了却量不到盒子')

  // ── ③ 把三个镜头拖进框：拖动中就要有反馈 ──
  // 落点按**卡心**摊在框里：卡比框宽，三张必然互相压着，但入组只看中心，
  // 所以三个中心各占一角就够——这也正是用户随手往框里丢东西的样子。
  const dropCenters = [
    { x: frameBox.x + frameBox.width * 0.3, y: frameBox.y + frameBox.height * 0.32 },
    { x: frameBox.x + frameBox.width * 0.7, y: frameBox.y + frameBox.height * 0.4 },
    { x: frameBox.x + frameBox.width * 0.5, y: frameBox.y + frameBox.height * 0.72 },
  ]
  for (let index = 0; index < nodeIds.length; index += 1) {
    const target = dropCenters[index]
    let midflight = null
    await dragNodeTo(win, nodeIds[index], target, async () => {
      midflight = await readFrameState(win)
      if (process.env.FRAME_DEBUG) {
        console.log('    debug', JSON.stringify(await win.evaluate(() => {
          const frame = document.querySelector('.generation-canvas-v2__group-box[data-group-id]')
          const box = frame ? { left: parseFloat(frame.style.left), top: parseFloat(frame.style.top), w: parseFloat(frame.style.width), h: parseFloat(frame.style.height) } : null
          const nodes = Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => {
            const m = /translate\(([-0-9.]+)px,\s*([-0-9.]+)px\)/.exec(node.style.transform || '')
            const r = node.getBoundingClientRect()
            return { id: node.getAttribute('data-id'), x: m ? Number(m[1]) : null, y: m ? Number(m[2]) : null, sw: Math.round(r.width), sh: Math.round(r.height), selected: node.classList.contains('selected') }
          })
          return { box, nodes, zoom: document.querySelector('.react-flow__viewport')?.style.transform }
        })))
      }
      if (index === 0) await snapMidflight(win, 'drag-join-midflight')
    })
    check(midflight?.membership === 'join', `拖第 ${index + 1} 个进框时框亮起「要进来了」`, `membership=${midflight?.membership}`)
    check(
      midflight?.count === `${index} → ${index + 1}`,
      `拖第 ${index + 1} 个时计数预览写着「${index} → ${index + 1}」`,
      `count=${midflight?.count}`,
    )
    const settled = await readFrameState(win)
    check(settled?.count === String(index + 1), `松手后框里真的有 ${index + 1} 个`, `count=${settled?.count}`)
    check(settled?.membership === null, '松手后临时反馈收干净了（accent 只做临时反馈）')
  }
  const filled = await readFrameState(win)
  check(filled?.empty === false, '装了东西之后不再是空框（虚线转实线）')
  await snap(win, 'three-in-frame')

  // ── ④ 双击标题改名 ──
  const title = frameLocator(win).locator('[data-frame-title="true"]').first()
  await title.dblclick({ timeout: 6000 })
  await win.waitForTimeout(300)
  const nameInput = frameLocator(win).locator('input[aria-label^="重命名框"]').first()
  await expectVisible(nameInput, '双击标题进了编辑态（不是弹「添加节点」菜单）')
  await nameInput.fill('第二幕 · 咖啡馆')
  await win.keyboard.press('Enter')
  await win.waitForTimeout(600)
  const renamed = await readFrameState(win)
  check(renamed?.title === '第二幕 · 咖啡馆', '改名生效', `title=${renamed?.title}`)
  await snap(win, 'renamed')

  // ── ⑤ 把 1 个拖出去：这是实拍里最伤的那一下的反面 ──
  // 先点空白清掉选择：上一步双击标题会顺带选中框里全部成员（点框 = 选中全组，既有行为），
  // 此时拖任何一张都是拖整批——量到的就成了「3 → 0」。用户想挪走一张时也会先松开这批选择。
  const clearPoint = await findCanvasBlankPoint(win, { preference: 'bottom', inset: 48 })
  if (!clearPoint) throw new Error('找不到空白处清选择（fail-closed）')
  await win.mouse.click(clearPoint.x, clearPoint.y)
  await win.waitForTimeout(500)
  const selectedBeforeLeave = await win.evaluate(() => document.querySelectorAll('.react-flow__node.selected').length)
  check(selectedBeforeLeave === 0, '点空白后选择清干净了（下一步拖的是一张卡，不是一批）', `selected=${selectedBeforeLeave}`)

  // 落点选在框的**正上方一点点**，而不是画布另一头的空白处：这一步的产物是给人看的截图
  // （R13 走查是人眼判断的素材源），而框和卡片必须同框才看得出「它正被拽出去、框说了要走」。
  // 拖到视口外去，断言照样绿——但那张 midflight 截图上一个框都没有，等于没留下证据。
  //
  // 框要**现量**，不能用画完那会儿量的 `frameBox`：装进三张卡之后框已经按「只长不缩」
  // 长大了（卡比框大，union 会把上沿也顶上去）。照旧的小框算「上方 90px」，落点其实还在
  // 长大后的框**里面**——判定如实回答「没出去」，看着却像退组坏了。
  const outsidePoint = await pickPointOutsideFrame(win)
  let leaveMidflight = null
  await dragNodeTo(win, nodeIds[2], outsidePoint, async () => {
    leaveMidflight = await readFrameState(win)
    await snapMidflight(win, 'drag-leave-midflight')
  })
  check(leaveMidflight?.membership === 'leave', '拖出去的半空中框就说了「要走了」', `membership=${leaveMidflight?.membership}`)
  check(leaveMidflight?.count === '3 → 2', '计数预览写着「3 → 2」', `count=${leaveMidflight?.count}`)
  const afterLeave = await readFrameState(win)
  check(afterLeave?.count === '2', '松手后框里只剩 2 个——框没有追着它长大重新包住', `count=${afterLeave?.count}`)
  const stillInside = await win.evaluate((id) => {
    const frame = document.querySelector('.generation-canvas-v2__group-box[data-group-id]')
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    if (!frame || !node) return null
    const f = frame.getBoundingClientRect()
    const n = node.getBoundingClientRect()
    const cx = n.left + n.width / 2
    const cy = n.top + n.height / 2
    return cx >= f.left && cx <= f.right && cy >= f.top && cy <= f.bottom
  }, nodeIds[2])
  check(stillInside === false, '被拖出去的那张卡确实在框外面（框没长过去）')
  await snap(win, 'after-leave')

  // ── ⑤b 判定线必须落在用户看得见的那条边上（R29 §6.1） ──
  //
  // 验的是一件用户永远说不出口、但一定会当成 bug 的事：
  // 「我明明看着这张卡进框里了，它却没进这一组。」
  //
  // 成因是尺寸有两份定义：判定用**声明**尺寸（节点类型的标称宽高），用户看的是浏览器
  // **实际渲染**出来的那个盒子。平时两者一样，看不出来；一旦某张卡的实际高度和标称不符，
  // 判定线就和视觉边分了家。所以这里造一张「渲染出来比声明矮一大截」的卡当夹具，
  // 再把它拖到「**看得见的中心**刚进框、而**按声明尺寸算的中心**已在框外」的位置。
  // 判定跟着看得见的那条边走 = 入组；跟着声明尺寸走 = 什么都不发生。
  // 第 2 条断言先证明这两个判据此刻确实给出相反答案——没有它，这就是一条恒真的空断言。
  const fixtureNodeId = nodeIds[2] // 刚被拖出去那张：此刻不是成员，正好用来验「进」
  const fixtureBefore = await win.evaluate((id) => {
    const el = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    const viewport = document.querySelector('.react-flow__viewport')
    const scale = /scale\(([-0-9.]+)\)/.exec(viewport?.style.transform || '')
    const rect = el?.getBoundingClientRect()
    return {
      declaredFlowHeight: el ? parseFloat(el.style.height) : Number.NaN,
      zoom: scale ? Number(scale[1]) : 1,
      screenHeight: rect ? rect.height : Number.NaN,
    }
  }, fixtureNodeId)
  if (!Number.isFinite(fixtureBefore.declaredFlowHeight)) throw new Error('夹具节点读不到声明高度（fail-closed）')

  // 截到声明高度的 45%：够拉开差距，又不至于短到抓不住。用可摘掉的 style 元素，
  // 验完就摘——夹具留在页面上会污染后面每一条断言。
  const shrunkFlowHeight = Math.round(fixtureBefore.declaredFlowHeight * 0.45)
  await win.evaluate(({ id, height }) => {
    const style = document.createElement('style')
    style.id = 'nomi-frame-measured-fixture'
    style.textContent = `.react-flow__node[data-id="${id}"] { max-height: ${height}px !important; overflow: hidden !important; }`
    document.head.appendChild(style)
  }, { id: fixtureNodeId, height: shrunkFlowHeight })
  await win.waitForTimeout(900)
  const shrunkScreenHeight = await win.evaluate((id) =>
    document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect().height ?? Number.NaN, fixtureNodeId)
  check(
    shrunkScreenHeight < fixtureBefore.screenHeight - 20,
    '夹具生效：这张卡实际渲染出来比它的声明尺寸矮了一截',
    `${Math.round(fixtureBefore.screenHeight)}px → ${Math.round(shrunkScreenHeight)}px`,
  )

  const frameBoxForMeasured = await frameLocator(win).boundingBox()
  if (!frameBoxForMeasured) throw new Error('量不到框，没法算「刚进框」的落点（fail-closed）')
  const visualCenter = {
    x: frameBoxForMeasured.x + frameBoxForMeasured.width / 2,
    y: frameBoxForMeasured.y + frameBoxForMeasured.height - 18,
  }
  // 卡被截短了，所以「按声明尺寸算的中心」比「看得见的中心」更靠下这么多。
  const centerGap = (fixtureBefore.declaredFlowHeight * fixtureBefore.zoom - shrunkScreenHeight) / 2
  const declaredCenterY = visualCenter.y + centerGap
  const frameBottom = frameBoxForMeasured.y + frameBoxForMeasured.height
  check(
    declaredCenterY > frameBottom,
    '这一拖的两个判据确实相反：看得见的中心在框内，按声明尺寸算的中心已经在框外',
    `视觉中心 y=${Math.round(visualCenter.y)} · 声明中心 y=${Math.round(declaredCenterY)} · 框下沿 y=${Math.round(frameBottom)}`,
  )

  let measuredMidflight = null
  await dragNodeTo(win, fixtureNodeId, visualCenter, async () => {
    measuredMidflight = await readFrameState(win)
    await snapMidflight(win, 'measured-size-join-midflight')
  })
  check(
    measuredMidflight?.membership === 'join',
    '判定跟着**看得见的那条边**走：卡的视觉中心进框，框就亮起「要进来了」',
    `membership=${measuredMidflight?.membership}`,
  )
  const measuredSettled = await readFrameState(win)
  check(measuredSettled?.count === '3', '松手后它真的进了这一组', `count=${measuredSettled?.count}`)
  await snap(win, 'measured-size-membership')

  // 复位：把它再拖出去、摘掉夹具。后面「框里就是 2 个」那几条才仍然说的是真话。
  await dragNodeTo(win, fixtureNodeId, await pickPointOutsideFrame(win))
  await win.evaluate(() => document.getElementById('nomi-frame-measured-fixture')?.remove())
  await win.waitForTimeout(700)
  const restored = await readFrameState(win)
  check(restored?.count === '2', '夹具验完复位：框里回到 2 个，后面的断言接着说真话', `count=${restored?.count}`)

  // ── ⑥ 折叠腾地方，再展开 ──
  const collapseButton = frameLocator(win).locator('button[aria-label^="收起分组"]').first()
  await expectVisible(collapseButton, '框头部有折叠钮')
  await collapseButton.click({ timeout: 6000 })
  await win.waitForTimeout(900)
  await expectCount(win.locator('[data-collapsed-group-id]'), 1, '折叠成一张卡')
  await snap(win, 'collapsed')
  const expandButton = win.locator('[data-collapsed-group-id] button[aria-expanded="false"]').first()
  await expandButton.click({ timeout: 6000 })
  await win.waitForTimeout(900)
  await expectCount(win.locator('.generation-canvas-v2__group-box[data-group-id]'), 1, '展开回框')
  await snap(win, 'expanded')

  // ── ⑦ 把框里的镜头统一到 loopback 模型 ──
  // 新建节点默认挂的是内置目录里的真供应商（没 key 会当场失败）。用户要用哪家模型本来
  // 就得自己选一次；这里走的是浮条上「统一模型」那条现役路径，不走后门写 store。
  // 用 ⌘A 全选当前分类（现役快捷键）而不是点框体：卡比框宽，两张一叠就把框面盖满了，
  // 「点框空白处选中全组」在这一屏根本没有可点的空处——那是既有交互的边界，不是本轨要改的事。
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  await win.waitForTimeout(700)
  const bulkModel = win.locator('.generation-canvas-v2__selection-toolbar button[aria-label^="视频 ×"]').first()
  await expectVisible(bulkModel, '全选后浮条上出现「统一模型」')
  await bulkModel.click({ timeout: 6000 })
  const mockOption = win.getByRole('option').filter({ hasText: '框走查视频' }).first()
  await mockOption.waitFor({ timeout: 8000 })
  await mockOption.click()
  await win.waitForTimeout(900)
  await win.mouse.click(clearPoint.x, clearPoint.y)
  await win.waitForTimeout(500)

  // ── ⑧ ⋯ 菜单：整框生成（loopback 真出片） ──
  const moreButton = frameLocator(win).locator('button[data-frame-more="true"]').first()
  await moreButton.click({ timeout: 6000 })
  await win.waitForTimeout(500)
  const menu = win.locator('[data-frame-menu="true"]').first()
  await expectVisible(menu, '⋯ 打开了框自己的菜单')
  await snap(win, 'frame-menu')
  const timelineItemDisabled = await menu.locator('button', { hasText: '整框进时间轴' }).first().isDisabled()
  check(timelineItemDisabled === true, '还没出片时「整框进时间轴」是禁用的（可点即有效，否则禁用+解释）')

  await menu.locator('button', { hasText: '生成整框' }).first().click({ timeout: 6000 })
  await win.waitForTimeout(900)
  const spendDialog = win.locator('div.fixed.inset-0').filter({ hasText: /开始生成/ }).last()
  await spendDialog.waitFor({ timeout: 10_000 })
  check(true, '整框生成走的是浮条那一条批量确认卡（一份实现两个入口）')
  await snap(win, 'frame-generate-confirm')
  await spendDialog.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: 8000 })
  // 等的是**真信号**（轨道上出现成片的节点），不是「睡够 2.5 秒应该好了」——
  // 出片耗时随机器负载变，睡不够就读到空、还报绿（check:walkthroughs 拦的正是这一族）。
  await win.waitForFunction(
    () => Array.from(document.querySelectorAll('.react-flow__node video')).length >= 2,
    undefined,
    { timeout: 120_000 },
  ).catch(() => {})
  // 生成会把视口推走（让位平移），而 onlyRenderVisibleElements 让视口外的节点连 DOM 都没有。
  await fitView(win)
  if (process.env.FRAME_DEBUG) {
    console.log('    debug nodes', JSON.stringify(await win.evaluate(() =>
      Array.from(document.querySelectorAll('.react-flow__node[data-id]')).map((node) => ({
        id: node.getAttribute('data-id'),
        status: node.querySelector('[data-status]')?.getAttribute('data-status') ?? null,
        text: (node.textContent || '').replace(/\s+/g, ' ').slice(0, 160),
      })))))
  }
  const generated = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.react-flow__node video')).length)
  check(generated >= 1, '整框生成真的出了片（loopback 供应商 → 落盘 → 节点上放得出来）', `videos=${generated}`)
  await snap(win, 'frame-generated')

  // ── ⑨ ⋯ 菜单：整框进时间轴 ──
  await moreButton.click({ timeout: 6000 })
  await win.waitForTimeout(500)
  const menu2 = win.locator('[data-frame-menu="true"]').first()
  await expectVisible(menu2, '⋯ 菜单再次打开')
  const timelineItem = menu2.locator('button', { hasText: '整框进时间轴' }).first()
  check(await timelineItem.isDisabled() === false, '出片之后「整框进时间轴」可用了')
  await timelineItem.click({ timeout: 6000 })
  // 时间轴面板默认是收起的，收起时轨道里连 DOM 都没有——先展开再数，否则读到的 0
  // 说的是「面板没展开」，不是「没排进去」（那正是 dead-selector 那一族的假红）。
  const expandTimeline = win.locator('button[aria-label="展开生成时间轴"]').first()
  await expandTimeline.waitFor({ timeout: 20_000 })
  await expandTimeline.click({ timeout: 6000 })
  // 等真信号：轨道上出现第一个 clip。落轴是异步的（要探时长、写轴、再渲染），
  // 睡固定时长在负载高的机器上会读到空、还报绿。
  await win.locator('.workbench-timeline-track__clips [data-clip-id]').first().waitFor({ timeout: 30_000 })
  const clipCount = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.workbench-timeline-track__clips [data-clip-id]')).length)
  check(clipCount === 2, '框里那 2 个镜头按框内顺序排进了时间轴（第三个已经挪出框，不该进来）', `clips=${clipCount}`)
  await snap(win, 'frame-to-timeline')

  // ── ⑩ ⋯ 菜单：解散（节点和连线都留着） ──
  const edgesBefore = await win.evaluate(() => document.querySelectorAll('.react-flow__edge').length)
  const nodesBefore = await win.evaluate(() => document.querySelectorAll('.react-flow__node[data-id]').length)
  await moreButton.click({ timeout: 6000 })
  await win.waitForTimeout(500)
  await win.locator('[data-frame-menu="true"] button', { hasText: '解散' }).first().click({ timeout: 6000 })
  await win.waitForTimeout(900)
  await expectAbsent(frameLocator(win), {
    provenBy: frameProof,
    message: '解散之后画布上不该再有框',
  })
  const nodesAfter = await win.evaluate(() => document.querySelectorAll('.react-flow__node[data-id]').length)
  const edgesAfter = await win.evaluate(() => document.querySelectorAll('.react-flow__edge').length)
  check(nodesAfter === nodesBefore, '解散不删节点', `${nodesBefore} → ${nodesAfter}`)
  check(edgesAfter === edgesBefore, '解散不撤边（解散的是组织方式，不是节点关系）', `${edgesBefore} → ${edgesAfter}`)
  await snap(win, 'dissolved')

} finally {
  await app.close().catch(() => {})
  vendorServer.close()
}

console.log(`\n截图：${shotsDir}`)
if (failures.length) {
  console.error(`\n❌ ${failures.length} 条断言没过：`)
  for (const failure of failures) console.error(`  · ${failure}`)
  process.exit(1)
}
console.log('\n✅ 框工具走查全部通过')
