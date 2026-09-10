// R13 走查：节点生成浮框「钉在节点下方、不出视口、不漂移」+ 底栏不被裁 + ×N 通用化。
//
// 症状（2026-09-10 用户真机反馈 #10 / #11）：
//   · 点击节点后浮出的 composer 来回漂移、不在节点正下方、有时被截断；
//   · 「一次生成几个」只有图片/视频节点有，声音节点没有。
// 根因：placement 之前把全场元素当障碍物做空矩形搜索，任何布局变化都重定位（漂移）。
// 修：`nodes/anchoredPlacement.ts` —— 位置只是 (stage, anchor, 自然尺寸) 的函数。
//
// 底栏本身**不动**（2026-09-10 用户复核：单行没有问题，底栏整合另有设计讨论）：
// 这里因此把「底栏仍是单行」当回归断言守着，防止后续定位改动把它挤成两行。
//
// 全程 UI 驱动（建节点、选节点、拖画布都是真实鼠标动作），不灌 store、不注入夹具。
// 用法: node tests/ux/node-composer-placement.walk.mjs（需先 pnpm run build）
import { launchNomiApp } from './_launchApp.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { expect, screenshotSettled } from './_assert.mjs'

const repoRoot = process.cwd()
const shotsDir = path.join(repoRoot, 'tests/ux/shots/node-composer-placement')
fs.mkdirSync(shotsDir, { recursive: true })

const userData = path.join(repoRoot, '.tmp', 'nomi-composer-placement')
const projectsDir = path.join(repoRoot, '.tmp', 'nomi-composer-placement-projects')
for (const dir of [userData, projectsDir]) { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }) }

const results = []
function check(name, ok, detail) {
  results.push({ name, ok })
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const { app, win: initialWin } = await launchNomiApp({
  name: 'node-composer-placement',
  userDataDir: userData,
  settingsDir: userData,
  projectsDir,
  settleMs: 0,
})
let win = initialWin
const consoleErrors = []
win.on('console', (message) => { try { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)) } catch { /* 窗口已关 */ } })
const getWin = () => {
  const live = app.windows().filter((candidate) => { try { return !candidate.isClosed() && !candidate.url().startsWith('devtools://') } catch { return false } })
  win = live.find((candidate) => { try { return /projectId=/.test(candidate.url()) } catch { return false } }) || live[live.length - 1] || win
  return win
}
const dismiss = async () => { await getWin().keyboard.press('Escape').catch(() => {}); await getWin().waitForTimeout(150) }

/**
 * 一次量清「舞台 / 节点 / 浮框卡 / 底栏每个控件 / 摘要 pill」的真实几何。
 * evaluate 只读不写；所有状态改变都由上面的真实鼠标键盘动作造成。
 */
async function measure() {
  return getWin().evaluate(() => {
    const stage = document.querySelector('.generation-canvas-v2__stage')
    const anchor = document.querySelector('.generation-canvas-v2-node__composer')
    const card = document.querySelector('.generation-canvas-v2-node__composer-card')
    const nodeEl = anchor?.parentElement
    const leftDockEl = document.querySelector('[data-canvas-left-dock="true"]')
    if (!stage || !anchor || !card || !nodeEl) return null
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    }
    const hits = (element) => {
      const rect = element.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return false
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return Boolean(target && (element.contains(target) || target.contains(element)))
    }
    const footer = card.querySelector('[data-node-composer-footer]')
    const cardRect = card.getBoundingClientRect()
    const controls = footer
      ? [...footer.querySelectorAll('button, [role="button"], select')].filter((element) => {
        const style = getComputedStyle(element)
        return style.visibility !== 'hidden' && style.display !== 'none'
      })
      : []
    return {
      // 拖动期间浮框刻意不重排（也刻意 invisible），所以量之前必须等这面旗降下来，
      // 否则量到的是「拖到一半」的中间态，看起来和真 bug 一模一样。
      dragging: stage.getAttribute('data-dragging') === 'true',
      stage: box(stage),
      node: box(nodeEl),
      card: box(card),
      // 左缘常驻工具条（CanvasToolbar）的真实矩形——浮框左缘必须让在它右边，
      // 不是硬编码一个宽度去比（2026-09-10 反馈 #10：截图 02 里浮框左缘被它压住）。
      leftDock: leftDockEl ? box(leftDockEl) : null,
      flipped: anchor.getAttribute('data-flipped'),
      // 「几行」按**竖直中心**聚类算，不能按 top：`items-center` 的同一行里控件高矮不同，
      // top 天生各不相同，按 top 数会把一条正常单行数成 4 行（第一版就是这么假红的）。
      footerRows: footer ? controls.reduce((rows, element) => {
        const rect = element.getBoundingClientRect()
        const centre = rect.top + rect.height / 2
        if (!rows.some((existing) => Math.abs(existing - centre) <= 4)) rows.push(centre)
        return rows
      }, []).length : 0,
      controlCount: controls.length,
      controlsInsideCard: controls.every((element) => {
        const rect = element.getBoundingClientRect()
        return rect.left >= cardRect.left - 1 && rect.right <= cardRect.right + 1
          && rect.top >= cardRect.top - 1 && rect.bottom <= cardRect.bottom + 1
      }),
      controlsHittable: controls.every(hits),
      variantControl: Boolean(card.querySelector('[aria-label="每次生成几个"]')),
    }
  })
}

const inside = (inner, outer, slack = 1) => inner.left >= outer.left - slack && inner.right <= outer.right + slack
  && inner.top >= outer.top - slack && inner.bottom <= outer.bottom + slack

/**
 * 首启引导/弹层清场。锚点抄自已跑通的 tests/ux/canvas-control-clarity.walk.mjs：
 * 起始页停在 #/studio 而不进项目，就是引导层还压着没被点掉。
 */
// 等待一律不写死 ≥5s 的超时：那是私有墙钟，`check:test-waits`（R18）会拦，
// 单跑绿、并行翻红也正是它拦的那一族。用 Playwright 自己的默认超时。
async function dismissFirstRun() {
  for (let index = 0; index < 6; index += 1) {
    const action = getWin().locator('button, [role="button"], a', { hasText: /跳过|完成|知道了|开始创作|稍后/ }).first()
    if (await action.isVisible().catch(() => false)) await action.click({ timeout: 900 }).catch(() => {})
    await getWin().keyboard.press('Escape').catch(() => {})
    await getWin().waitForTimeout(180)
  }
}

try {
  await getWin().waitForLoadState('domcontentloaded')
  await getWin().evaluate(() => localStorage.setItem('nomi-color-scheme', 'light')).catch(() => {})
  let mounted = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const buttons = await getWin().evaluate(() => document.querySelectorAll('button,[role="button"]').length).catch(() => 0)
    if (buttons > 0) { mounted = true; break }
    await getWin().waitForTimeout(500)
  }
  check('应用 mount（起始页就绪）', mounted, `console 错误 ${consoleErrors.length} 条`)
  await dismissFirstRun()

  const blankProject = getWin().locator('button, [role="button"]', { hasText: '新建空白项目' }).first()
  await blankProject.waitFor()
  await blankProject.click()
  await getWin().waitForTimeout(2200)
  await dismissFirstRun()
  check('新建并进入项目', /projectId=/.test(getWin().url()), getWin().url())

  // 进「生成」工作区并等真实 React Flow 画布挂载（不是等超时）。
  const generationTab = getWin().getByRole('button', { name: '生成', exact: true }).first()
  await generationTab.waitFor()
  await generationTab.click()
  const toolbar = getWin().locator('.generation-canvas-v2-toolbar').first()
  await toolbar.waitFor()
  await getWin().locator('.react-flow').first().waitFor()
  check('生成画布就绪（React Flow 已挂载）', true)

  /** 用左侧栏真按钮建节点——常驻的直接点，收进「更多」的先展开。 */
  async function addNode(kind, label) {
    const before = await getWin().locator('[data-node-id]').count()
    const resident = toolbar.locator(`[data-node-kind="${kind}"]`).first()
    if (await resident.isVisible().catch(() => false)) {
      await resident.click({ timeout: 4000 })
    } else {
      await toolbar.locator('[data-canvas-add-more="true"]').first().click({ timeout: 4000 })
      await getWin().locator(`.generation-canvas-v2-toolbar__more-menu [data-node-kind="${kind}"]`).first().click({ timeout: 4000 })
    }
    await expect.poll(() => getWin().locator('[data-node-id]').count(), { message: `添加${label}节点后画布节点数必须增加` }).toBeGreaterThan(before)
  }

  await addNode('video', '视频')
  const composer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await composer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
  }
  await composer.waitFor({ state: 'visible' })
  check('视频节点选中后浮框出现', true)

  await screenshotSettled(getWin(), { path: path.join(shotsDir, '01-video-node-composer.png') })
  const first = await measure()
  if (!first) throw new Error('量不到浮框几何：舞台 / 节点 / 卡片有一个没找到')
  console.log('  几何:', JSON.stringify(first, null, 2))

  // ① 浮框顶边在节点底边下方（未翻转时），且不是压在节点身上。
  check(
    '浮框顶边在节点底边之下（贴着这个节点，不侧挂、不压图）',
    first.flipped === 'true' ? first.card.bottom <= first.node.top + 1 : first.card.top >= first.node.bottom - 1,
    `flipped=${first.flipped} card.top=${Math.round(first.card.top)} node.bottom=${Math.round(first.node.bottom)}`,
  )
  // ② 整框在视口内。
  check('整框在画布视口内（左右上下都没出界）', inside(first.card, first.stage, 2),
    `card=${JSON.stringify(first.card)} stage=${JSON.stringify(first.stage)}`)
  // ②.5 浮框左缘不被左缘常驻工具条压住（2026-09-10 反馈 #10 复核：截图里「生成方式」
  // 标签与第一个模式页签左半被 CanvasToolbar 盖住，根因是可用区算漏了这一块）。
  check(
    '浮框左缘 ≥ 左栏工具条右缘 + 间距（不被左栏压住）',
    !first.leftDock || first.card.left >= first.leftDock.right + 1,
    `card.left=${Math.round(first.card.left)} leftDock.right=${first.leftDock ? Math.round(first.leftDock.right) : 'n/a'}`,
  )
  // ③ 底栏所有控件都在卡内并且真的点得到（不是被 overflow-hidden 裁在外面）。
  check('底栏控件全部在卡内', first.controlsInsideCard, `控件 ${first.controlCount} 个，${first.footerRows} 行`)
  check('底栏控件全部可命中（没有被别的东西盖住）', first.controlsHittable)
  // ④ 底栏仍是单行：用户拍板「单行没有问题」，这条守住它不被后续改动挤成两行。
  check('底栏仍是单行（控件竖直中心只有一条）', first.footerRows === 1, `${first.footerRows} 行 / ${first.controlCount} 个控件`)
  // ⑤ 「一次生成几个」在视频节点上可见。
  check('视频节点有「每次生成几个」控件', first.variantControl)

  // ⑥ 拖动画布后浮框仍贴着节点：节点动了多少，浮框就动多少（相对偏移逐像素不变 = 不漂移）。
  const stageBox = await getWin().locator('.generation-canvas-v2__stage').first().boundingBox()
  if (!stageBox) throw new Error('舞台不可见，无法拖动画布')
  const emptyPoint = { x: stageBox.x + stageBox.width - 80, y: stageBox.y + stageBox.height - 80 }
  await getWin().mouse.move(emptyPoint.x, emptyPoint.y)
  await getWin().mouse.down()
  await getWin().mouse.move(emptyPoint.x - 160, emptyPoint.y - 90, { steps: 14 })
  await getWin().mouse.up()
  await expect.poll(async () => Math.round((await measure())?.node.left ?? first.node.left), { message: '拖画布后节点必须真的移动了（否则这条断言什么都没验）' })
    .not.toBe(Math.round(first.node.left))

  // 等拖动旗降下来 + 位置落定，再量。
  await expect.poll(async () => (await measure())?.dragging, { message: '松手后画布必须退出拖动态' }).toBe(false)
  // 再等它连着两帧不动，避免量到重排的中间帧。
  let settled = null
  await expect.poll(async () => {
    const sample = Math.round((await measure())?.card.left ?? Number.NaN)
    const stable = settled !== null && settled === sample
    settled = sample
    return stable
  }, { message: '浮框横向位置必须落定（连续两次采样相同）' }).toBe(true)
  const dragged = await measure()
  if (!dragged) throw new Error('拖动后量不到浮框几何')
  const offsetBefore = { x: first.card.left - first.node.left, y: first.card.top - first.node.top }
  const offsetAfter = { x: dragged.card.left - dragged.node.left, y: dragged.card.top - dragged.node.top }
  // 竖直方向必须逐像素贴着节点底边——这是「跟着这个节点走」的判据。
  check(
    '拖动画布后浮框仍贴在节点底边下方（竖直偏移逐像素不变）',
    Math.abs(offsetAfter.y - offsetBefore.y) <= 2,
    `before=${JSON.stringify(offsetBefore)} after=${JSON.stringify(offsetAfter)}`,
  )
  // 横向**不能**要求偏移不变：卡比节点宽得多，正常就贴着视口边被 clamp 住。
  // 该断的是「横向 = 以节点为心、被视口 clamp 之后的那个唯一值」——既证明它跟着节点算，
  // 也证明 clamp 的输入只有两个：VIEWPORT_MARGIN=12（与 useComposerViewportPlacement 同一个数）
  // 和左栏工具条的真实矩形（LEFT_DOCK_GAP=12，同一份 stageLeft 公式）——不是硬编码宽度。
  const expectedLeft = (item) => {
    const margin = 12
    const leftDockGap = 12
    const leftDockUsable = item.leftDock && item.leftDock.width > 0 && item.leftDock.bottom > item.stage.top && item.leftDock.top < item.stage.bottom
    const min = item.stage.left + (leftDockUsable ? Math.max(margin, item.leftDock.right - item.stage.left + leftDockGap) : margin)
    const max = Math.max(min, item.stage.right - margin - item.card.width)
    return Math.min(Math.max((item.node.left + item.node.right - item.card.width) / 2, min), max)
  }
  for (const [label, item] of [['拖动前', first], ['拖动后', dragged]]) {
    check(
      `${label}横向 = 以节点为心 + 视口 clamp（没有第三个输入）`,
      Math.abs(item.card.left - expectedLeft(item)) <= 2,
      `实测 ${Math.round(item.card.left)} / 期望 ${Math.round(expectedLeft(item))}`,
    )
  }
  check('拖动后整框仍在视口内', inside(dragged.card, dragged.stage, 2))
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '02-after-canvas-drag.png') })

  // ⑦ ×N 通用化：声音节点以前没有这个控件，现在按执行类派生 → 也有。
  await getWin().keyboard.press('Escape').catch(() => {})
  await addNode('audio', '声音')
  const audioComposer = getWin().locator('.generation-canvas-v2-node__composer').last()
  if (!(await audioComposer.isVisible().catch(() => false))) {
    await getWin().locator('[data-node-id]').last().click({ timeout: 3000 }).catch(() => {})
  }
  await audioComposer.waitFor({ state: 'visible' })
  const audio = await measure()
  if (!audio) throw new Error('量不到声音节点浮框几何')
  check('声音节点也有「每次生成几个」（×N 已按执行类派生，不再只给图片/视频）', audio.variantControl)
  check('声音节点浮框同样贴在节点下方且在视口内',
    (audio.flipped === 'true' ? audio.card.bottom <= audio.node.top + 1 : audio.card.top >= audio.node.bottom - 1) && inside(audio.card, audio.stage, 2),
    `flipped=${audio.flipped}`)
  check('声音节点底栏控件全部在卡内且可命中', audio.controlsInsideCard && audio.controlsHittable, `控件 ${audio.controlCount} 个，${audio.footerRows} 行`)
  check('声音节点底栏同样是单行', audio.footerRows === 1, `${audio.footerRows} 行`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '03-audio-node-composer.png') })

  // ⑧ 窄视口：真实场景不是缩小 OS 窗口（主窗口 minWidth=1100，缩不下去，而且 Electron
  // 真实窗口下 `page.setViewportSize` 只改 CDP 上报的量值、不动原生边界，会撞出「布局和
  // React Flow 各读各的尺寸」——实测就是这条路先炸了：composer 整个从 DOM 消失，量了 8 次全
  // null）。真实会让画布变窄的是**拉宽常驻 Agent 面板**这个既有 UI（`AssistantPane` 的
  // 分隔条，键盘 End 直接跳到当前视口下的最大宽度），画布宽度因此被真实地挤掉一块，
  // 不用碰原生窗口。浮框自然宽必须超出这块收窄后的可用区，才真的走到 anchoredPlacement
  // 的「收窄到 stage 宽度」分支——不是把左栏那块也算进可用区、溢出到左栏底下或伸出视口。
  const assistantResizer = getWin().getByRole('separator', { name: '拖动调整助手宽度' }).first()
  await assistantResizer.waitFor({ state: 'visible' })
  await assistantResizer.focus()
  await getWin().keyboard.press('End')
  let narrowSettled = null
  await expect.poll(async () => {
    const sample = await measure()
    const signature = sample ? `${Math.round(sample.card.left)},${Math.round(sample.card.width)},${Math.round(sample.stage.width)}` : null
    const stable = narrowSettled !== null && narrowSettled === signature
    narrowSettled = signature
    return stable
  }, { message: '拉宽 Agent 面板后浮框位置必须落定（连续两次采样相同）' }).toBe(true)
  const narrow = await measure()
  if (!narrow) throw new Error('拉宽 Agent 面板后量不到浮框几何')
  check('拉宽 Agent 面板确实挤窄了画布（这条断言不是摆设）', narrow.stage.width < first.stage.width - 40,
    `narrow.stage.width=${Math.round(narrow.stage.width)} first.stage.width=${Math.round(first.stage.width)}`)
  check('窄画布下浮框仍完整在可用区内（不出视口）', inside(narrow.card, narrow.stage, 2),
    `card=${JSON.stringify(narrow.card)} stage=${JSON.stringify(narrow.stage)}`)
  check('窄画布下浮框左缘仍不压左栏工具条', !narrow.leftDock || narrow.card.left >= narrow.leftDock.right + 1,
    `card.left=${Math.round(narrow.card.left)} leftDock.right=${narrow.leftDock ? Math.round(narrow.leftDock.right) : 'n/a'}`)
  await screenshotSettled(getWin(), { path: path.join(shotsDir, '04-narrow-canvas.png') })

  fs.writeFileSync(path.join(shotsDir, 'geometry.json'), JSON.stringify({ first, dragged, audio, narrow }, null, 2))
} catch (error) {
  console.error(`VERIFY ERROR: ${error?.stack || error?.message || error}`)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}

const failed = results.filter((entry) => !entry.ok)
if (failed.length) { console.error(`\n✗ ${failed.length}/${results.length} 项未过`); process.exitCode = 1 }
else console.log(`\n✓ 全部 ${results.length} 项通过`)
